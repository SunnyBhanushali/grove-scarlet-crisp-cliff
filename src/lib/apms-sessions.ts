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
const CACHE_MS = 15_000;

type Cached = { personId: string; until: number; expiresAt: number };
const cache = new Map<string, Cached>();
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
      else if (t.startsWith("delete")) rows.delete(String(params[0]));
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
  cache.set(hashToken(token), { personId, until: Date.now() + CACHE_MS, expiresAt });
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
    cache.set(h, { personId: row.person_id, until: now + CACHE_MS, expiresAt });
    return row.person_id;
  } catch (err) {
    console.error("[apms-sessions] lookup", err);
    return null;
  }
}

export async function revokeSessionToken(token: string | null | undefined): Promise<void> {
  if (!looksIssued(token)) return;
  const h = hashToken(token);
  cache.delete(h);
  try {
    await ensureTable();
    const sql = await db();
    await sql.query(`delete from apms_sessions where token_hash = $1`, [h]);
  } catch (err) {
    console.error("[apms-sessions] revoke", err);
  }
}

export function resetSessionCacheForTests(): void {
  cache.clear();
}
