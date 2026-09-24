import { getSql } from "./db";
import type { LoginMap } from "./apms-credentials";

export type IssuedRow = {
  username?: string;
  password?: string;
  personId?: string;
  name?: string;
  email?: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  const sql = await getSql();
  await sql.query(`
    create table if not exists issued_logins (
      username text primary key,
      person_id text,
      password text not null,
      updated_at timestamptz not null default now()
    )
  `);
  ensured = true;
}

function usernameKey(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

export type LoginWriteOpts = {
  /** The signed-in caller: their own session survives their own password change. */
  requester?: { personId: string; token: string | null } | null;
};

/**
 * BATCH-3: passwords are stored as scrypt hashes. A row whose password equals
 * the stored one is left alone; a changed password ends every other session
 * of that person (the caller's own browser stays signed in when they changed
 * their own password; an admin reset ends all of the person's sessions).
 */
export async function upsertIssuedLogins(rows: IssuedRow[], opts: LoginWriteOpts = {}): Promise<number> {
  await ensureTable();
  const sql = await getSql();
  const { ensureHashed, verifyPassword } = await import("./apms-password.ts");
  let added = 0;
  const changed = new Set<string>();
  for (const row of rows || []) {
    const username = usernameKey(row.username || row.email || "");
    const password = String(row.password || "");
    if (!username || !password) continue;
    let personId = String(row.personId || "");
    const prev = await sql.query<{ password: string; person_id: string }>(
      `select password, person_id from issued_logins where username = $1`,
      [username],
    );
    if (!personId) personId = prev[0]?.person_id || (await personIdForUsername(sql, username));
    const same = !!prev[0] && (password === prev[0].password || verifyPassword(password, prev[0].password));
    const stored = same ? prev[0].password : ensureHashed(password);
    await sql.query(
      `
        insert into issued_logins (username, person_id, password, updated_at)
        values ($1, $2, $3, now())
        on conflict (username) do update
          set person_id = excluded.person_id,
              password = excluded.password,
              updated_at = now()
      `,
      [username, personId, stored],
    );
    if (!same && personId) changed.add(personId);
    added += 1;
  }
  if (changed.size) await endSessionsAfterPasswordChange([...changed], opts.requester || null);
  return added;
}

async function personIdForUsername(sql: Awaited<ReturnType<typeof getSql>>, username: string): Promise<string> {
  try {
    const rows = await sql.query<{ id: string }>(
      `select id from people where lower(payload->>'username') = $1 and deleted_at is null limit 1`,
      [username],
    );
    return rows[0]?.id || "";
  } catch {
    return "";
  }
}

/** End the sessions of people whose password just changed (see upsertIssuedLogins). */
export async function endSessionsAfterPasswordChange(
  personIds: string[],
  requester: { personId: string; token: string | null } | null,
): Promise<number> {
  const { revokePersonSessions } = await import("./apms-sessions.ts");
  let n = 0;
  for (const id of personIds) {
    n += await revokePersonSessions(id, requester && requester.personId === id ? requester.token : null);
  }
  if (n) console.log(`[apms-sessions] password changed: ended ${n} session(s) for ${personIds.length} person(s)`);
  return n;
}

export async function loadIssuedLogins(): Promise<LoginMap> {
  try {
    await ensureTable();
    const sql = await getSql();
    const rows = await sql.query<{ username: string; person_id: string; password: string }>(
      `select username, person_id, password from issued_logins`,
    );
    const map: LoginMap = {};
    for (const row of rows || []) {
      const username = usernameKey(row.username);
      if (!username || !row.password) continue;
      map[username] = { personId: row.person_id, password: row.password };
      if (row.person_id) map[row.person_id] = { personId: row.person_id, password: row.password };
    }
    return map;
  } catch (err) {
    console.error("[issued-logins] load", err);
    return {};
  }
}

export function mergeLogins(base: LoginMap, extra: LoginMap): LoginMap {
  return { ...base, ...extra };
}
