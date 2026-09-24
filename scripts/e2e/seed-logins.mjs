#!/usr/bin/env node
/**
 * Test fixture: give B and C (and the non-admin used by the security checks)
 * a known password in issued_logins on a FRESH e2e database.
 *   DATABASE_URL=… node scripts/e2e/seed-logins.mjs floyd.dsil=pw1 ronlind.mene=pw2 …
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`create table if not exists issued_logins (
  username text primary key, person_id text, password text not null,
  updated_at timestamptz not null default now())`);
for (const arg of process.argv.slice(2)) {
  const [username, password] = arg.split("=");
  const r = await pool.query("select id from people where payload->>'username' = $1 and deleted_at is null", [username]);
  if (!r.rows[0]) throw new Error(`no person ${username}`);
  await pool.query(
    `insert into issued_logins (username, person_id, password) values ($1, $2, $3)
     on conflict (username) do update set person_id = excluded.person_id, password = excluded.password, updated_at = now()`,
    [username, r.rows[0].id, password],
  );
  console.log(`login ${username} → ${r.rows[0].id}`);
}
await pool.end();
