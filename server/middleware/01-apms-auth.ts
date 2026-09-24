/**
 * Preview/published login for Aliens APMS.
 * Authenticates against the company people list plus issued_logins.
 * sunny.b / 0000 always works as the super-admin fallback (pending Sunny's decision).
 *
 * BATCH-2: sign-in issues a random server-side session token
 * (`apms-sessions.ts`); every other /api/* route and /_serverFn call needs
 * one (401 otherwise). Login writes need an admin (403) — except a person
 * posting their own row (own-password change).
 */
import {
  loadCompanySnapshot,
} from "../../src/lib/company-notebook";
import {
  SUNNY,
  findPerson,
  sessionUser,
  usernameKey,
  verifyLoginDetailedAsync,
  type LoginMap,
  type LoginPerson,
} from "../../src/lib/apms-credentials";
import { loadIssuedLogins, mergeLogins, upsertIssuedLogins } from "../../src/lib/issued-logins";
import { issueSessionToken, revokeSessionToken } from "../../src/lib/apms-sessions";
import { readSessionToken, sessionFromHeaders, sessionPersonId, unauthorizedJson } from "../../src/lib/apms-request-auth";
import { authorizeLoginWrite, requireAdmin } from "../../src/lib/apms-admin-auth";
import {
  clientIp,
  listLockedUsernames,
  lockMessage,
  unlockUsername,
  recordSigninFailure,
  recordSigninSuccess,
  signinLock,
} from "../../src/lib/apms-signin-guard";
import { applyPasswordReset, requestPasswordReset } from "../../src/lib/password-reset";

const SESSION_COOKIE = "better-auth.session_token";
/** `companyIsEmpty` server fn: a boolean the sign-in page may ask for. */
const SERVERFN_EMPTY = "dcd7bc2b15da053b70f7c67cd9d467cf0304406295d5c072a5c9196f3829fc7f";

interface Event {
  url: URL;
  req: Request & { method: string; headers: Headers };
}

/** Routes reachable without a session. Everything else under /api and /_serverFn needs one. */
function isPublicPath(path: string, url: URL): boolean {
  if (path.startsWith("/api/auth/") || path === "/api/auth") return true;
  if (path === "/api/password-reset" || path === "/api/password-reset/apply") return true;
  if (path === `/_serverFn/${SERVERFN_EMPTY}`) return true;
  // VPS cron: the route itself allows ?daily=1 / ?hourly=1 from loopback only.
  if (path === "/api/company-backups" && (url.searchParams.get("daily") === "1" || url.searchParams.get("hourly") === "1")) return true;
  return false;
}

async function readCompany(): Promise<{ people: LoginPerson[]; logins: LoginMap }> {
  try {
    const loaded = await loadCompanySnapshot();
    const snap = loaded.snapshotJson ? JSON.parse(loaded.snapshotJson) : null;
    const people = Array.isArray(snap?.people) ? (snap.people as LoginPerson[]) : [];
    const snapshotLogins =
      snap?.logins && typeof snap.logins === "object" && !Array.isArray(snap.logins)
        ? (snap.logins as LoginMap)
        : {};
    const issued = await loadIssuedLogins();
    return { people, logins: mergeLogins(snapshotLogins, issued) };
  } catch (err) {
    console.error("[apms-auth] snapshot", err);
    return { people: [], logins: await loadIssuedLogins().catch(() => ({})) };
  }
}

/**
 * PERF: sign-in and every page open's get-session assembled the whole company
 * (all four books, ~6 MB, parsed and re-stringified) to find one person. The
 * people and logins rows are the authority for exactly these fields: read
 * them. The book path stays as the fallback for a database whose rows are not
 * filled yet.
 */
async function readLoginRows(): Promise<{ people: LoginPerson[]; logins: LoginMap } | null> {
  try {
    const { getSql } = await import("../../src/lib/db");
    const sql = await getSql();
    const people = (
      await sql.query<{ id: string; payload: Record<string, unknown> }>(`select id, payload from people where deleted_at is null`)
    ).map((r) => ({ ...(r.payload || {}), id: r.id }) as unknown as LoginPerson);
    if (!people.length) return null;
    const { collections } = await import("../../src/lib/apms-collections.ts");
    const spec = collections.specForField("logins");
    const rows = await sql.query<{ kind: string; id: string; k1: string | null; k2: string | null; payload: Record<string, unknown>; rev: number }>(
      `select kind, id, k1, k2, payload, rev from entities where kind = 'logins' and deleted_at is null order by updated_at asc, id asc`,
    );
    const fromRows = spec ? (collections.fromRows(spec, rows.map((r) => ({ ...r, deleted: false }))) as LoginMap | undefined) : undefined;
    const issued = await loadIssuedLogins();
    return { people, logins: mergeLogins(fromRows && typeof fromRows === "object" ? fromRows : {}, issued) };
  } catch (err) {
    console.error("[apms-auth] login rows", err);
    return null;
  }
}

async function readLoginDirectory(): Promise<{ people: LoginPerson[]; logins: LoginMap }> {
  return (await readLoginRows()) || readCompany();
}

async function personFromId(id: string): Promise<LoginPerson | null> {
  try {
    const { getSql } = await import("../../src/lib/db");
    const sql = await getSql();
    const key = id === "p-admin" ? null : id;
    if (key) {
      const rows = await sql.query<{ payload: Record<string, unknown> }>(`select payload from people where id = $1 and deleted_at is null`, [key]);
      if (rows[0]) return { ...(rows[0].payload || {}), id } as unknown as LoginPerson;
      const any = await sql.query<{ n: number }>(`select 1 as n from people limit 1`);
      if (any.length) return null;
    }
  } catch {
    /* rows not ready: book path below */
  }
  const { people } = await readLoginDirectory();
  if (id === "p-admin") return people.find((p) => p.id === "p-admin" || p.username === "sunny.b") || SUNNY;
  return people.find((p) => p.id === id) || null;
}

function sessionPayload(person: LoginPerson, token: string) {
  const user = sessionUser(person);
  return {
    session: {
      id: `sess-${person.id}`,
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    },
    user,
    token,
    redirect: false,
  };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.clone().text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function sessionCookie(token: string | null, https: boolean): string {
  const base = token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly`
    : `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly`;
  return https ? `${base}; SameSite=None; Secure` : `${base}; SameSite=Lax`;
}

function requestIsHttps(event: Event): boolean {
  const xf = (event.req.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (xf.includes("https")) return true;
  return event.url.protocol === "https:";
}

function socketIp(event: Event): string | null {
  const req = event.req as unknown as {
    ip?: string;
    runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } };
  };
  return req.ip || req.runtime?.node?.req?.socket?.remoteAddress || null;
}

function rowsFrom(body: Record<string, unknown>) {
  const inner = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : body;
  const rows = inner.rows;
  if (Array.isArray(rows)) return rows;
  if (inner.username || inner.password) return [inner];
  return [];
}

export default async function apmsAuthMiddleware(
  event: Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  const method = (event.req.method || "GET").toUpperCase();

  if (path === "/api/password-reset" || path === "/api/password-reset/apply") {
    if (method !== "POST") return json(405, { ok: false });
    try {
      const body = await readJson(event.req);
      const inner = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : body;
      const token = String(inner.token || "");
      const password = String(inner.password || "");
      if (token && password) return json(200, await applyPasswordReset(token, password));
      return json(
        200,
        await requestPasswordReset(
          String(inner.login || inner.username || inner.email || ""),
          String(inner.origin || ""),
        ),
      );
    } catch (err) {
      console.error("[password-reset]", err);
      return json(200, { ok: true });
    }
  }

  if (path === "/api/issued-logins" || path === "/api/provision-logins") {
    if (method === "GET" || method === "HEAD") {
      if (!(await sessionPersonId(event.req.headers))) return unauthorizedJson();
      return json(200, { ok: true, added: 0, sent: 0, failed: [] });
    }
    if (method === "POST") {
      try {
        const body = await readJson(event.req);
        const rows = rowsFrom(body);
        const refused = await authorizeLoginWrite(event.req.headers, rows as Array<Record<string, string>>, {
          allowOwn: path === "/api/issued-logins",
        });
        if (refused) return refused;
        const added = await upsertIssuedLogins(rows, { requester: await sessionFromHeaders(event.req.headers) });
        return json(200, { ok: true, added, sent: 0, failed: [] });
      } catch (err) {
        console.error("[issued-logins]", err);
        return json(200, {
          ok: false,
          added: 0,
          sent: 0,
          failed: [{ reason: err instanceof Error ? err.message : "failed" }],
        });
      }
    }
    return json(405, { ok: false });
  }

  if (path === "/api/login-locks") {
    // BATCH-3: admin sees / clears sign-in lock-outs (Settings → Assign people).
    const gate = await requireAdmin(event.req.headers);
    if (gate.response) return gate.response;
    if (method === "GET") return json(200, { ok: true, locks: await listLockedUsernames() });
    if (method === "POST") {
      const body = await readJson(event.req);
      const username = usernameKey(String(body.username || ""));
      if (!username) return json(400, { ok: false, error: "username required" });
      const unlocked = await unlockUsername(username);
      console.log(`[apms-signin] ${gate.person.username || gate.person.id} unlocked ${username} (${unlocked ? "was locked" : "not locked"})`);
      return json(200, { ok: true, username, unlocked });
    }
    return json(405, { ok: false });
  }

  if (!path.startsWith("/api/auth")) {
    if ((path.startsWith("/api/") || path.startsWith("/_serverFn/")) && !isPublicPath(path, event.url)) {
      if (!(await sessionPersonId(event.req.headers))) return unauthorizedJson();
    }
    return next();
  }

  if (path.endsWith("/get-session") && (method === "GET" || method === "POST")) {
    const session = await sessionFromHeaders(event.req.headers);
    const person = session ? await personFromId(session.personId) : null;
    if (!session || !person) return json(200, null);
    return json(200, sessionPayload(person, session.token));
  }

  if (
    (path.endsWith("/sign-in/username") || path.endsWith("/sign-in/email")) &&
    method === "POST"
  ) {
    const body = await readJson(event.req);
    const user = String(body.username || body.email || "");
    const pass = String(body.password || "");
    const { people, logins } = await readLoginDirectory();
    // BATCH-3: lock-out per username (5 / 15 min) and per IP (30 / 15 min), in the DB.
    const known = findPerson(people, user);
    const lockKey = usernameKey(known?.username || known?.email || user);
    const ip = clientIp(event.req.headers, socketIp(event));
    const locked = await signinLock(lockKey, ip).catch(() => null);
    if (locked) {
      return json(429, { code: "LOCKED", message: lockMessage(locked), lockedMinutes: locked.minutes, scope: locked.scope });
    }
    const verdict = await verifyLoginDetailedAsync(people, logins, user, pass);
    const person = verdict.person;
    if (!person) {
      const lock = await recordSigninFailure(lockKey, ip).catch(() => null);
      if (lock) {
        return json(429, { code: "LOCKED", message: lockMessage(lock), lockedMinutes: lock.minutes, scope: lock.scope });
      }
      if (verdict.reason === "default-pin-off") {
        return json(401, {
          code: "DEFAULT_PIN_OFF",
          message: "The starter password 0000 is switched off. Use the password you were given, or ask an admin for a new one.",
        });
      }
      return json(401, { message: "Invalid username or password" });
    }
    await recordSigninSuccess(lockKey).catch(() => undefined);
    const payload = sessionPayload(person, await issueSessionToken(person.id));
    return json(200, payload, {
      "set-cookie": sessionCookie(payload.token, requestIsHttps(event)),
      "set-auth-token": payload.token,
    });
  }

  if (path.endsWith("/sign-out") && (method === "POST" || method === "GET")) {
    const session = await sessionFromHeaders(event.req.headers);
    await revokeSessionToken(session?.token || readSessionToken(event.req.headers));
    return json(200, { success: true }, {
      "set-cookie": sessionCookie(null, requestIsHttps(event)),
    });
  }

  return next();
}
