/**
 * BATCH-2 security: server-issued session tokens.
 *
 * Sign-in issues a random token (`apms-s.<43 chars>`), and only its SHA-256
 * is stored (`apms_sessions`). Every API route resolves the bearer / cookie
 * token here; anything the server did not issue (a made-up bearer, the old
 * guessable `apms-login.<personId>` / `apms-preview-sunny`) resolves to null.
 *
 * Both server module copies (Nitro middleware and SSR routes) read the same
 * table. A short positive cache keeps a request from hitting the database
 * on every call; sign-out deletes the row and drops this copy's cache entry.
 */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_TOKEN_PREFIX = "apms-s.";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
// BATCH-3: shared by both server module copies (globalThis). Ending a session
// (sign-out, password change / reset) deletes it from this cache at once, and
// PERF (p0aw5) tells every other server process through
// pg_notify('apms_sessions') (`startSessionListen`), so the cache can hold a
// good token for 30 s instead of re-reading it from the database every 2 s
// for every request of every open tab. Without LISTEN (PGlite / preview) the
// short 2 s window stays.
const CACHE_MS_LISTENING = 30_000;
const CACHE_MS_POLLING = 2_000;
function cacheMs(): number {
  return listening ? CACHE_MS_LISTENING : CACHE_MS_POLLING;
}
let listening = false;
const lookups = new Map<string, Promise<string | null>>();

type Cached = { personId: string; until: number; expiresAt: number };
const g = globalThis as typeof globalThis & { __apmsSessionCache__?: Map<string, Cached> };
const cache: Map<string, Cached> = (g.__apmsSessionCache__ ??= new Map<string, Cached>());
let ensured: Promise<void> | null = null;

type QuerySql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
let sqlOverride: QuerySql | null = null;

/** Tests: run the session store on this SQL client (PGlite / mini-pg) instead of `@/lib/db`. */
export function useSessionSqlForTests(sql: QuerySql | null): void {
  sqlOverride = sql;
  ensured = null;
  cache.clear();
}

/** Tests without any database: keep sessions in a table emulated in memory. */
export function useMemorySessionsForTests(): void {
  const rows = new Map<string, { person_id: string; expires_at: string }>();
  useSessionSqlForTests({
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const t = text.trim().toLowerCase();
      if (t.startsWith("insert")) rows.set(String(params[0]), { person_id: String(params[1]), expires_at: String(params[2]) });
      else if (t.startsWith("delete") && t.includes("person_id")) {
        const out: Array<{ token_hash: string }> = [];
        for (const [h, r] of rows) if (r.person_id === String(params[0]) && h !== String(params[1])) (rows.delete(h), out.push({ token_hash: h }));
        return out as T[];
      } else if (t.startsWith("delete")) rows.delete(String(params[0]));
      else if (t.startsWith("select")) {
        const r = rows.get(String(params[0]));
        return (r && new Date(r.expires_at).getTime() > Date.now() ? [r] : []) as T[];
      }
      return [];
    },
  });
}

async function db(): Promise<QuerySql> {
  if (sqlOverride) return sqlOverride;
  // Lazy: importing ./db starts the database bootstrap.
  const { getSql } = await import("./db.ts");
  return (await getSql()) as unknown as QuerySql;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Only tokens of the issued shape are looked up at all. */
export function looksIssued(token: string | null | undefined): token is string {
  return typeof token === "string" && token.startsWith(SESSION_TOKEN_PREFIX) && token.length === SESSION_TOKEN_PREFIX.length + 43;
}

async function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const sql = await db();
      await sql.query(`
        create table if not exists apms_sessions (
          token_hash text primary key,
          person_id text not null,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        )
      `);
      await sql.query(`create index if not exists apms_sessions_person on apms_sessions (person_id)`);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

export async function issueSessionToken(personId: string): Promise<string> {
  if (!personId) throw new Error("issueSessionToken: personId required");
  await ensureTable();
  const token = SESSION_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const sql = await db();
  await sql.query(`insert into apms_sessions (token_hash, person_id, expires_at) values ($1, $2, $3)`, [
    hashToken(token),
    personId,
    new Date(expiresAt).toISOString(),
  ]);
  cache.set(hashToken(token), { personId, until: Date.now() + cacheMs(), expiresAt });
  return token;
}

/** The person a server-issued, unexpired token belongs to; otherwise null. */
export async function personIdForSessionToken(token: string | null | undefined): Promise<string | null> {
  if (!looksIssued(token)) return null;
  const h = hashToken(token);
  const now = Date.now();
  const hit = cache.get(h);
  if (hit && hit.until > now && hit.expiresAt > now) return hit.personId;
  cache.delete(h);
  startSessionListen();
  // A tab sends several requests at once: one lookup answers them all.
  const flying = lookups.get(h);
  if (flying) return flying;
  const run = (async () => {
    try {
      await ensureTable();
      const sql = await db();
      const rows = await sql.query<{ person_id: string; expires_at: string | Date }>(
        `select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now()`,
        [h],
      );
      const row = rows[0];
      if (!row) return null;
      const expiresAt = new Date(row.expires_at).getTime();
      // A revoke that ran while this read was in flight wins.
      if (!revokedDuring.has(h)) cache.set(h, { personId: row.person_id, until: Date.now() + cacheMs(), expiresAt });
      return row.person_id;
    } catch (err) {
      console.error("[apms-sessions] lookup", err);
      return null;
    }
  })().finally(() => {
    lookups.delete(h);
    revokedDuring.delete(h);
  });
  lookups.set(h, run);
  return run;
}

/** Hashes revoked while a lookup for them was in flight (that lookup must not re-cache). */
const revokedDuring = new Set<string>();
function dropCached(h: string): void {
  cache.delete(h);
  if (lookups.has(h)) revokedDuring.add(h);
}

async function notifySessions(msg: { h?: string; personId?: string; keep?: string }): Promise<void> {
  try {
    const sql = await db();
    await sql.query(`select pg_notify('apms_sessions', $1)`, [JSON.stringify(msg)]);
  } catch {
    /* PGlite: no NOTIFY; this process's cache is already cleared */
  }
}

/**
 * PERF: one LISTEN connection per process; another process ending a session
 * clears it here. Until it is listening, the cache keeps the short window.
 */
let listenStarted = false;
export function startSessionListen(): void {
  if (listenStarted || sqlOverride) return;
  listenStarted = true;
  const url = typeof process !== "undefined" ? String(process.env.DATABASE_URL || "").trim() : "";
  if (!url) return;
  const connect = async (): Promise<void> => {
    try {
      const pg = (await import("pg")).default;
      const client = new pg.Client({ connectionString: url });
      let retried = false;
      const retry = () => {
        listening = false;
        if (retried) return;
        retried = true;
        client.end().catch(() => {});
        const t = setTimeout(() => void connect(), 2000);
        (t as unknown as { unref?: () => void }).unref?.();
      };
      client.on("error", retry);
      client.on("end", retry);
      client.on("notification", (m: { channel: string; payload?: string }) => {
        if (m.channel !== "apms_sessions") return;
        try {
          const msg = JSON.parse(m.payload || "{}") as { h?: string; personId?: string; keep?: string };
          if (msg.h) dropCached(msg.h);
          if (msg.personId) {
            for (const [h, c] of cache) if (c.personId === msg.personId && h !== msg.keep) dropCached(h);
            for (const h of lookups.keys()) if (h !== msg.keep) revokedDuring.add(h);
          }
        } catch {
          /* ignore */
        }
      });
      await client.connect();
      const stream = (client as unknown as { connection?: { stream?: { unref?: () => void } } }).connection?.stream;
      stream?.unref?.();
      await client.query("LISTEN apms_sessions");
      // Anything cached before we listened may have been revoked elsewhere meanwhile.
      cache.clear();
      listening = true;
    } catch (err) {
      listening = false;
      console.error("[apms-sessions] LISTEN failed; short cache", err);
      const t = setTimeout(() => void connect(), 5000);
      (t as unknown as { unref?: () => void }).unref?.();
    }
  };
  void connect();
}

export async function revokeSessionToken(token: string | null | undefined): Promise<void> {
  if (!looksIssued(token)) return;
  const h = hashToken(token);
  dropCached(h);
  try {
    await ensureTable();
    const sql = await db();
    await sql.query(`delete from apms_sessions where token_hash = $1`, [h]);
  } catch (err) {
    console.error("[apms-sessions] revoke", err);
  }
  dropCached(h);
  await notifySessions({ h });
}

/**
 * BATCH-3: end every session of a person (admin password reset, own password
 * change), except `keepToken` (the browser that made the change). Returns the
 * number of sessions ended.
 */
export async function revokePersonSessions(personId: string, keepToken?: string | null): Promise<number> {
  if (!personId) return 0;
  const keep = looksIssued(keepToken) ? hashToken(keepToken) : "";
  for (const [h, c] of cache) if (c.personId === personId && h !== keep) dropCached(h);
  for (const h of lookups.keys()) if (h !== keep) revokedDuring.add(h);
  try {
    await ensureTable();
    const sql = await db();
    const rows = await sql.query<{ token_hash: string }>(
      `delete from apms_sessions where person_id = $1 and token_hash <> $2 returning token_hash`,
      [personId, keep],
    );
    // A lookup that read a row just before the delete must not keep it cached.
    for (const r of rows) dropCached(r.token_hash);
    for (const [h, c] of cache) if (c.personId === personId && h !== keep) dropCached(h);
    await notifySessions({ personId, keep });
    return rows.length;
  } catch (err) {
    console.error("[apms-sessions] revoke person", err);
    return 0;
  }
}

export function resetSessionCacheForTests(): void {
  cache.clear();
}
