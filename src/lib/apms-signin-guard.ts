/**
 * BATCH-3: failed sign-in limits, stored in the database (survives restarts,
 * shared by PM2 workers).
 *
 *   - per username: 5 wrong tries within 15 minutes → locked for 15 minutes;
 *   - per IP: 30 wrong tries within 15 minutes → that IP is locked for 15 minutes.
 *
 * A successful sign-in clears the username counter (not the IP one). An admin
 * unlocks a username from Settings → Assign people (POST /api/login-locks).
 * While a username is locked, even the right password is refused.
 */
type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

export const USER_LIMIT = 5;
export const IP_LIMIT = 30;

/** Limits in force: APMS_SIGNIN_USER_LIMIT / APMS_SIGNIN_IP_LIMIT override the defaults (test runs only). */
export function signinLimits(env: Record<string, string | undefined> = process.env): { user: number; ip: number } {
  const n = (v: string | undefined, d: number) => {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x > 0 ? x : d;
  };
  return { user: n(env.APMS_SIGNIN_USER_LIMIT, USER_LIMIT), ip: n(env.APMS_SIGNIN_IP_LIMIT, IP_LIMIT) };
}
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

let sqlOverride: Q | null = null;
let ensured: Promise<void> | null = null;

export function useSigninSqlForTests(sql: Q | null): void {
  sqlOverride = sql;
  ensured = null;
}

async function db(): Promise<Q> {
  if (sqlOverride) return sqlOverride;
  const { getSql } = await import("./db.ts");
  return (await getSql()) as unknown as Q;
}

async function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const sql = await db();
      await sql.query(`
        create table if not exists apms_signin_failures (
          key          text primary key,
          fails        integer not null default 0,
          window_start timestamptz not null default now(),
          locked_until timestamptz,
          updated_at   timestamptz not null default now()
        )
      `);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

export type SigninLock = { scope: "user" | "ip"; until: number; minutes: number };

function minutesLeft(until: number): number {
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

/** The lock that applies to this attempt, or null. */
export async function signinLock(username: string, ip: string): Promise<SigninLock | null> {
  await ensureTable();
  const sql = await db();
  const rows = await sql.query<{ key: string; locked_until: string | Date }>(
    `select key, locked_until from apms_signin_failures where key = any($1::text[]) and locked_until > now()`,
    [[`u:${username}`, `ip:${ip}`]],
  );
  const user = rows.find((r) => r.key === `u:${username}`);
  const pick = user || rows[0];
  if (!pick) return null;
  const until = new Date(pick.locked_until).getTime();
  return { scope: pick.key.startsWith("u:") ? "user" : "ip", until, minutes: minutesLeft(until) };
}

async function bump(sql: Q, key: string, limit: number): Promise<{ fails: number; locked: boolean }> {
  const rows = await sql.query<{ fails: number; locked_until: string | Date | null }>(
    `insert into apms_signin_failures (key, fails, window_start, locked_until, updated_at)
       values ($1, 1, now(), case when 1 >= $2 then now() + ($3 || ' milliseconds')::interval else null end, now())
     on conflict (key) do update set
       fails = case when apms_signin_failures.window_start < now() - ($4 || ' milliseconds')::interval
                    then 1 else apms_signin_failures.fails + 1 end,
       window_start = case when apms_signin_failures.window_start < now() - ($4 || ' milliseconds')::interval
                    then now() else apms_signin_failures.window_start end,
       updated_at = now()
     returning fails, locked_until`,
    [key, limit, String(LOCK_MS), String(WINDOW_MS)],
  );
  const fails = Number(rows[0]?.fails || 0);
  if (fails >= limit) {
    await sql.query(
      `update apms_signin_failures set locked_until = now() + ($2 || ' milliseconds')::interval, fails = 0, window_start = now()
        where key = $1`,
      [key, String(LOCK_MS)],
    );
    return { fails, locked: true };
  }
  return { fails, locked: false };
}

/** Count one wrong try for this username and IP. Returns the lock it caused, if any. */
export async function recordSigninFailure(username: string, ip: string): Promise<SigninLock | null> {
  await ensureTable();
  const sql = await db();
  const lim = signinLimits();
  const u = username ? await bump(sql, `u:${username}`, lim.user) : { locked: false, fails: 0 };
  const i = ip ? await bump(sql, `ip:${ip}`, lim.ip) : { locked: false, fails: 0 };
  if (u.locked) return { scope: "user", until: Date.now() + LOCK_MS, minutes: LOCK_MS / 60000 };
  if (i.locked) return { scope: "ip", until: Date.now() + LOCK_MS, minutes: LOCK_MS / 60000 };
  return null;
}

export async function recordSigninSuccess(username: string): Promise<void> {
  if (!username) return;
  await ensureTable();
  const sql = await db();
  await sql.query(`delete from apms_signin_failures where key = $1`, [`u:${username}`]);
}

/** Admin: unlock a username (and forget its wrong tries). */
export async function unlockUsername(username: string): Promise<boolean> {
  await ensureTable();
  const sql = await db();
  const rows = await sql.query(`delete from apms_signin_failures where key = $1 returning key`, [`u:${username}`]);
  return rows.length > 0;
}

/** Admin: usernames locked right now. */
export async function listLockedUsernames(): Promise<Array<{ username: string; until: string; minutes: number }>> {
  await ensureTable();
  const sql = await db();
  const rows = await sql.query<{ key: string; locked_until: string | Date }>(
    `select key, locked_until from apms_signin_failures where key like 'u:%' and locked_until > now() order by key`,
  );
  return rows.map((r) => {
    const until = new Date(r.locked_until).getTime();
    return { username: r.key.slice(2), until: new Date(until).toISOString(), minutes: minutesLeft(until) };
  });
}

export function lockMessage(lock: SigninLock): string {
  const m = `${lock.minutes} minute${lock.minutes === 1 ? "" : "s"}`;
  return lock.scope === "user"
    ? `Too many wrong passwords for this username. Sign-in is locked for ${m}. Try again later, or ask an admin to unlock it (Settings → Assign people).`
    : `Too many wrong sign-in tries from this network. Try again in ${m}.`;
}

/**
 * The client IP. Behind the VPS proxy the trusted address is the LAST entry of
 * X-Forwarded-For (the one the proxy appended); X-Real-IP next; the socket last.
 */
export function clientIp(headers: Headers, socketIp?: string | null): string {
  const xff = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  const real = (headers.get("x-real-ip") || "").trim();
  if (real) return real;
  return String(socketIp || "unknown");
}
