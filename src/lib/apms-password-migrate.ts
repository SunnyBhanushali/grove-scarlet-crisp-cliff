/**
 * BATCH-3: one-time conversion of plain-text passwords to scrypt hashes.
 *
 * Live does not apply migration files on boot, so this runs from the database
 * bootstrap (`db.ts`, before the first app query of the process) under a
 * Postgres advisory lock (PM2 workers do not race). It is idempotent: it only
 * touches values that are not a hash yet, so the second run converts 0.
 *
 * Before anything is changed, every plain-text value found is copied into
 * `apms_password_backup_<yyyymmddhhmmss>` (source, ref, password). The table
 * is revoked from PUBLIC and, when the app role may do it, handed to the
 * `APMS_PW_BACKUP_OWNER` role (default `postgres`) and revoked from the app
 * role, so only an admin SQL user can read it. Drop it once sign-in is
 * confirmed: `DROP TABLE apms_password_backup_<stamp>;` (see REPORT-BATCH-3.md).
 *
 * Converted, in order: issued_logins.password, people.payload.password /
 * passwordHash, entities (logins rows) payload.password, entity_log payloads,
 * company_books (org book people[] + logins{}), company_notebook rows. Old
 * backup copies (company_backups) are converted in the background after boot.
 */
import { bookHash } from "./company-books.ts";
import { hashSnapshotSecrets, isPasswordHash, hashPassword } from "./apms-password.ts";

type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

const LOCK_KEY = 815_082_082; // arbitrary constant for pg_advisory_lock

function stampNow(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(sql: Q, name: string): Promise<boolean> {
  const rows = await sql.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [name]);
  return !!rows[0]?.ok;
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Plain text found in a snapshot (people[] + logins{}), for the backup table. */
function snapshotPlain(snap: Record<string, unknown>, source: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const p of (Array.isArray(snap.people) ? snap.people : []) as Array<Record<string, unknown>>) {
    for (const f of ["password", "passwordHash"]) {
      const v = p?.[f];
      if (typeof v === "string" && v && !isPasswordHash(v)) out.push([source, `person:${p.id}:${f}`, v]);
    }
  }
  const logins = snap.logins;
  if (logins && typeof logins === "object" && !Array.isArray(logins)) {
    for (const [k, r] of Object.entries(logins as Record<string, Record<string, unknown>>)) {
      const v = r?.password;
      if (typeof v === "string" && v && !isPasswordHash(v)) out.push([source, `login:${k}`, v]);
    }
  }
  return out;
}

export type PasswordSweepResult = { converted: number; backupTable: string | null; skipped?: string };

/**
 * Convert every live plain-text password. Safe to call on every boot.
 * `log` receives one summary line.
 */
export async function sweepPlaintextPasswords(
  sql: Q,
  log: (line: string) => void = (l) => console.log(l),
): Promise<PasswordSweepResult> {
  if (process.env.APMS_PASSWORD_SWEEP === "off") return { converted: 0, backupTable: null, skipped: "off" };
  await sql.query(`select pg_advisory_lock($1)`, [LOCK_KEY]);
  try {
    const cache = new Map<string, string>();
    const hashFor = (key: string, plain: string) => {
      const k = `${key}\u0000${plain}`;
      let h = cache.get(k);
      if (!h) {
        h = hashPassword(plain);
        cache.set(k, h);
      }
      return h;
    };
    const found: Array<[string, string, string]> = [];

    // Gather first (nothing changed yet).
    const issued = (await tableExists(sql, "issued_logins"))
      ? await sql.query<{ username: string; person_id: string; password: string }>(
          `select username, person_id, password from issued_logins where password <> '' and password not like 'scrypt$%'`,
        )
      : [];
    for (const r of issued) found.push(["issued_logins", r.username, r.password]);

    const people = (await tableExists(sql, "people"))
      ? await sql.query<{ id: string; payload: Record<string, unknown> }>(
          `select id, payload from people
            where (coalesce(payload->>'password','') <> '' and payload->>'password' not like 'scrypt$%')
               or (coalesce(payload->>'passwordHash','') <> '' and payload->>'passwordHash' not like 'scrypt$%')`,
        )
      : [];
    for (const r of people) {
      for (const f of ["password", "passwordHash"]) {
        const v = r.payload?.[f];
        if (typeof v === "string" && v && !isPasswordHash(v)) found.push(["people", `${r.id}:${f}`, v]);
      }
    }

    const ents = (await tableExists(sql, "entities"))
      ? await sql.query<{ kind: string; id: string; payload: Record<string, unknown> }>(
          `select kind, id, payload from entities
            where coalesce(payload->>'password','') <> '' and payload->>'password' not like 'scrypt$%'`,
        )
      : [];
    for (const r of ents) found.push(["entities", `${r.kind}/${r.id}`, String(r.payload.password)]);

    const logRows = (await tableExists(sql, "entity_log"))
      ? await sql.query<{ seq: number; kind: string; id: string; payload: Record<string, unknown> }>(
          `select seq, kind, id, payload from entity_log
            where payload is not null and (
              (coalesce(payload->>'password','') <> '' and payload->>'password' not like 'scrypt$%')
              or (coalesce(payload->>'passwordHash','') <> '' and payload->>'passwordHash' not like 'scrypt$%'))`,
        )
      : [];
    for (const r of logRows) found.push(["entity_log", `${r.seq}`, String(r.payload.password || r.payload.passwordHash)]);

    const books = (await tableExists(sql, "company_books"))
      ? await sql.query<{ book: string; snapshot_json: string }>(
          `select book, snapshot_json from company_books where snapshot_json like '%"password"%'`,
        )
      : [];
    const bookSnaps: Array<{ book: string; old: string; snap: Record<string, unknown> }> = [];
    for (const r of books) {
      const snap = parse(r.snapshot_json);
      if (!snap) continue;
      const plain = snapshotPlain(snap, `company_books:${r.book}`);
      if (!plain.length) continue;
      found.push(...plain);
      bookSnaps.push({ book: r.book, old: r.snapshot_json, snap });
    }

    const nbRows = (await tableExists(sql, "company_notebook"))
      ? await sql.query<{ id: string; snapshot_json: string }>(
          `select id, snapshot_json from company_notebook where snapshot_json like '%"password"%'`,
        )
      : [];
    const nbSnaps: Array<{ id: string; old: string; snap: Record<string, unknown> }> = [];
    for (const r of nbRows) {
      const snap = parse(r.snapshot_json);
      if (!snap) continue;
      const plain = snapshotPlain(snap, `company_notebook:${r.id}`);
      if (!plain.length) continue;
      found.push(...plain);
      nbSnaps.push({ id: r.id, old: r.snapshot_json, snap });
    }

    if (!found.length) {
      log("[apms-passwords] plain-text passwords converted: 0 (already hashed)");
      return { converted: 0, backupTable: null };
    }

    // Back up before changing anything.
    const table = `apms_password_backup_${stampNow()}`;
    await sql.query(`create table if not exists ${ident(table)} (
      source text not null, ref text not null, password text not null, saved_at timestamptz not null default now())`);
    for (let i = 0; i < found.length; i += 200) {
      const chunk = found.slice(i, i + 200);
      const params: string[] = [];
      const values = chunk.map((row, j) => {
        params.push(...row);
        return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`;
      });
      await sql.query(`insert into ${ident(table)} (source, ref, password) values ${values.join(",")}`, params);
    }
    await restrictBackupTable(sql, table, log);

    let converted = 0;
    for (const r of issued) {
      await sql.query(`update issued_logins set password = $2 where username = $1 and password = $3`, [
        r.username,
        hashFor(`p:${r.person_id || r.username}`, r.password),
        r.password,
      ]);
      converted += 1;
    }
    for (const r of people) {
      const next = { ...r.payload };
      for (const f of ["password", "passwordHash"]) {
        const v = next[f];
        if (typeof v === "string" && v && !isPasswordHash(v)) {
          next[f] = hashFor(`p:${r.id}`, v);
          converted += 1;
        }
      }
      // Same row, no rev bump: the stored secret changes form, nothing a client sees.
      await sql.query(`update people set payload = $2::jsonb where id = $1`, [r.id, JSON.stringify(next)]);
    }
    for (const r of ents) {
      const pid = String(r.payload.personId || r.id);
      const next = { ...r.payload, password: hashFor(`p:${pid}`, String(r.payload.password)) };
      await sql.query(`update entities set payload = $3::jsonb where kind = $1 and id = $2`, [r.kind, r.id, JSON.stringify(next)]);
      converted += 1;
    }
    for (const r of logRows) {
      const next = { ...r.payload };
      for (const f of ["password", "passwordHash"]) {
        const v = next[f];
        if (typeof v === "string" && v && !isPasswordHash(v)) {
          next[f] = hashFor(`p:${r.kind === "logins" ? String(next.personId || r.id) : r.id}`, v);
          converted += 1;
        }
      }
      await sql.query(`update entity_log set payload = $2::jsonb where seq = $1`, [r.seq, JSON.stringify(next)]);
    }
    for (const b of bookSnaps) {
      converted += hashSnapshotSecrets(b.snap, cache);
      const json = JSON.stringify(b.snap);
      await sql.query(
        `update company_books set snapshot_json = $2, content_hash = $3 where book = $1 and snapshot_json = $4`,
        [b.book, json, bookHash(b.snap), b.old],
      );
    }
    for (const n of nbSnaps) {
      converted += hashSnapshotSecrets(n.snap, cache);
      await sql.query(`update company_notebook set snapshot_json = $2 where id = $1 and snapshot_json = $3`, [
        n.id,
        JSON.stringify(n.snap),
        n.old,
      ]);
    }
    log(`[apms-passwords] plain-text passwords converted: ${converted} (backup table ${table})`);
    return { converted, backupTable: table };
  } finally {
    await sql.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => undefined);
  }
}

async function restrictBackupTable(sql: Q, table: string, log: (l: string) => void): Promise<void> {
  try {
    await sql.query(`revoke all on table ${ident(table)} from public`);
  } catch {
    /* ignore */
  }
  const owner = process.env.APMS_PW_BACKUP_OWNER || "postgres";
  try {
    const me = (await sql.query<{ u: string }>(`select current_user as u`))[0]?.u;
    if (me && me !== owner) {
      await sql.query(`alter table ${ident(table)} owner to ${ident(owner)}`);
      await sql.query(`revoke all on table ${ident(table)} from ${ident(me)}`);
    }
  } catch (err) {
    log(
      `[apms-passwords] could not hand ${table} to ${owner} (${err instanceof Error ? err.message : err}); ` +
        `run as a DB admin: ALTER TABLE ${table} OWNER TO ${owner}; REVOKE ALL ON ${table} FROM <app role>;`,
    );
  }
}

/** Old backup copies: convert in the background, one row at a time. */
export async function sweepBackupPasswords(sql: Q, log: (line: string) => void = (l) => console.log(l)): Promise<number> {
  if (process.env.APMS_PASSWORD_SWEEP === "off") return 0;
  if (!(await tableExists(sql, "company_backups"))) return 0;
  const ids = await sql.query<{ id: string }>(
    `select id from company_backups where snapshot_json like '%"password"%' order by created_at desc`,
  );
  let rows = 0;
  let converted = 0;
  let table: string | null = null;
  const cache = new Map<string, string>();
  for (const { id } of ids) {
    const r = (await sql.query<{ snapshot_json: string }>(`select snapshot_json from company_backups where id = $1`, [id]))[0];
    if (!r) continue;
    const snap = parse(r.snapshot_json);
    if (!snap) continue;
    const inner = (snap.state && typeof snap.state === "object" ? snap.state : snap) as Record<string, unknown>;
    const plain = snapshotPlain(inner, `company_backups:${id}`);
    if (!plain.length) continue;
    if (!table) {
      table = `apms_password_backup_${stampNow()}_copies`;
      await sql.query(`create table if not exists ${ident(table)} (
        source text not null, ref text not null, password text not null, saved_at timestamptz not null default now())`);
    }
    for (const row of plain) await sql.query(`insert into ${ident(table)} (source, ref, password) values ($1, $2, $3)`, row);
    const n = hashSnapshotSecrets(inner, cache);
    if (!n) continue;
    await sql.query(`update company_backups set snapshot_json = $2 where id = $1 and snapshot_json = $3`, [
      id,
      JSON.stringify(snap),
      r.snapshot_json,
    ]);
    rows += 1;
    converted += n;
  }
  if (table) await restrictBackupTable(sql, table, log);
  if (converted) log(`[apms-passwords] backup copies: ${converted} plain-text passwords hashed in ${rows} copies (backup table ${table})`);
  return converted;
}
