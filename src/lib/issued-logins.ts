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

export async function upsertIssuedLogins(rows: IssuedRow[]): Promise<number> {
  await ensureTable();
  const sql = await getSql();
  let added = 0;
  for (const row of rows || []) {
    const username = usernameKey(row.username || row.email || "");
    const password = String(row.password || "");
    if (!username || !password) continue;
    const personId = String(row.personId || "");
    await sql.query(
      `
        insert into issued_logins (username, person_id, password, updated_at)
        values ($1, $2, $3, now())
        on conflict (username) do update
          set person_id = excluded.person_id,
              password = excluded.password,
              updated_at = now()
      `,
      [username, personId, password],
    );
    added += 1;
  }
  return added;
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
