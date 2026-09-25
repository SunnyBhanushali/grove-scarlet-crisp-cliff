#!/usr/bin/env node
/**
 * Make a fresh copy of the live database safe for staging.
 *
 *   - every stored password (columns and JSON fields named password /
 *     passwordHash / tempPassword …) becomes ONE staging-only scrypt hash, and
 *     every person row gets it, so anyone can sign in on staging with the
 *     staging password — and with nothing else;
 *   - every email address is blanked: email columns / JSON fields become "",
 *     and any address inside other text is removed (`@aliens.local`
 *     placeholders stay: the app already treats them as "no mailbox");
 *   - sign-in sessions, reset tokens, lock-outs and the BATCH-3 plain-text
 *     password backup tables are removed; old backup copies are thinned to
 *     the newest few (and sanitised like everything else).
 *
 * Env: APMS_STAGE_URL, APMS_STAGE_DB (must equal current_database()),
 *      APMS_STAGE_PASSWORD, APMS_LIVE_USER (the staging login must differ),
 *      APMS_PG_FROM (a folder whose node_modules has `pg`),
 *      APMS_KEEP_BACKUP_COPIES (default 3).
 * Exits non-zero, with nothing half-done (one transaction), on any problem.
 */
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Same format as src/lib/apms-password.ts (`scrypt$N$r$p$salt$key`).
export function stagingHash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const PASSWORD_KEY =
  /^(password|password_?hash|temp_?password|preview_?password|new_?password|plain_?password)$/i;
const EMAIL_KEY = /e-?mail/i;
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const KEEP_EMAIL = /@aliens\.local$/i;

export function scrubText(s) {
  if (typeof s !== "string" || !s.includes("@")) return s;
  return s.replace(EMAIL_RE, (m) => (KEEP_EMAIL.test(m) ? m : ""));
}

/**
 * Returns the sanitised copy of a JSON value (same reference when unchanged).
 * `inPeople`: the value is an element of a `people` array — give it the hash.
 */
export function scrubJson(value, hash, inPeople = false) {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = scrubJson(v, hash, inPeople);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? out : value;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    let n = v;
    if (PASSWORD_KEY.test(k)) {
      if (typeof v === "string" && v) n = hash;
    } else if (EMAIL_KEY.test(k) && typeof v === "string") {
      n = KEEP_EMAIL.test(v.trim()) ? v : "";
    } else if (k === "people" && Array.isArray(v)) {
      n = scrubJson(v, hash, true);
    } else {
      n = scrubJson(v, hash, false);
    }
    if (n !== v) changed = true;
    out[k] = n;
  }
  if (inPeople && typeof out.id === "string" && out.id && out.password !== hash) {
    out.password = hash;
    changed = true;
  }
  return changed ? out : value;
}

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function main() {
  const url = process.env.APMS_STAGE_URL;
  const wantDb = process.env.APMS_STAGE_DB;
  const password = process.env.APMS_STAGE_PASSWORD || "";
  const liveUser = process.env.APMS_LIVE_USER || "";
  const keepCopies = Math.max(0, Number(process.env.APMS_KEEP_BACKUP_COPIES ?? 3) || 0);
  if (!url || !wantDb) throw new Error("APMS_STAGE_URL and APMS_STAGE_DB are required");
  if (password.length < 8) throw new Error("staging password must be at least 8 characters");

  const require = createRequire(join(process.env.APMS_PG_FROM || process.cwd(), "package.json"));
  const pg = require("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = (text, params) => client.query(text, params);

  const who = (await q("select current_database() as db, current_user as usr")).rows[0];
  if (who.db !== wantDb) throw new Error(`connected to ${who.db}, expected ${wantDb} — refusing`);
  if (liveUser && who.usr === liveUser)
    throw new Error(`staging is using the live login ${who.usr} — refusing`);

  const hash = stagingHash(password);
  const stats = { tables: 0, rowsChanged: 0, people: 0 };
  await q("begin");
  try {
    // 1. Things staging must not have at all.
    const pwBackups = await q(
      `select tablename from pg_tables where schemaname = 'public' and tablename ilike 'apms\\_password\\_backup\\_%'`,
    );
    for (const r of pwBackups.rows) await q(`drop table if exists ${ident(r.tablename)} cascade`);
    for (const t of [
      "apms_sessions",
      "session",
      "verification",
      "password_resets",
      "apms_signin_failures",
    ]) {
      if ((await q("select to_regclass($1) as r", [`public.${ident(t)}`])).rows[0].r)
        await q(`delete from ${ident(t)}`);
    }
    if ((await q("select to_regclass('public.company_backups') as r")).rows[0].r) {
      await q(
        `delete from company_backups where id not in (select id from company_backups order by created_at desc limit $1)`,
        [keepCopies],
      );
    }

    // 2. Walk every text / json column of every table.
    const cols = (
      await q(`
        select c.table_name, c.column_name, c.data_type, c.is_nullable = 'YES' as nullable,
               exists (
                 select 1 from pg_index i
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                 where i.indrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
                   and i.indisunique and a.attname = c.column_name
               ) as is_unique
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.data_type in ('text', 'character varying', 'json', 'jsonb')
        order by c.table_name, c.ordinal_position`)
    ).rows;
    const byTable = new Map();
    for (const c of cols) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
      byTable.get(c.table_name).push(c);
    }

    for (const [table, tcols] of byTable) {
      stats.tables++;
      const T = ident(table);
      // Column-level: password / email columns in one statement each.
      for (const c of tcols) {
        const C = ident(c.column_name);
        if (c.data_type.startsWith("json")) continue;
        if (PASSWORD_KEY.test(c.column_name)) {
          await q(`update ${T} set ${C} = $1 where ${C} is not null and ${C} <> ''`, [hash]);
        } else if (EMAIL_KEY.test(c.column_name)) {
          const blank = c.is_unique
            ? `'blank-' || md5(${C}) || '@aliens.local'`
            : c.nullable
              ? "null"
              : "''";
          await q(
            `update ${T} set ${C} = ${blank} where ${C} is not null and ${C} <> '' and ${C} !~* '@aliens\\.local$'`,
          );
        }
      }
      // Row-level: JSON documents and free text that mention an address.
      const scan = tcols.filter(
        (c) =>
          c.data_type.startsWith("json") ||
          !(PASSWORD_KEY.test(c.column_name) || EMAIL_KEY.test(c.column_name)),
      );
      if (!scan.length) continue;
      const sel = scan
        .map((c) => `${ident(c.column_name)}::text as ${ident(c.column_name)}`)
        .join(", ");
      const where = scan
        .map((c) => {
          const C = `${ident(c.column_name)}::text`;
          return table === "people" && c.column_name === "payload"
            ? "true"
            : `(${C} like '%@%' or ${C} ~* '"(password|password_?hash|temp_?password|preview_?password|new_?password|plain_?password)"')`;
        })
        .join(" or ");
      await q(
        `declare scan_cur no scroll cursor for select ctid::text as _ctid, ${sel} from ${T} where ${where}`,
      );
      for (;;) {
        const batch = (await q("fetch 200 from scan_cur")).rows;
        if (!batch.length) break;
        for (const row of batch) {
          const sets = [];
          const params = [];
          for (const c of scan) {
            const raw = row[c.column_name];
            if (raw === null || raw === undefined) continue;
            let next = raw;
            const isJson = c.data_type.startsWith("json");
            const looksJson = isJson || /^\s*[[{]/.test(raw);
            let parsed;
            if (looksJson) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = undefined;
              }
            }
            if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
              let doc = scrubJson(parsed, hash);
              if (
                table === "people" &&
                c.column_name === "payload" &&
                !Array.isArray(doc) &&
                doc.password !== hash
              ) {
                doc = { ...doc, password: hash };
              }
              if (doc !== parsed) next = JSON.stringify(doc);
            } else if (!isJson) {
              next = scrubText(raw);
            }
            if (next !== raw) {
              params.push(next);
              sets.push(
                `${ident(c.column_name)} = $${params.length}::${isJson ? c.data_type : "text"}`,
              );
            }
          }
          if (sets.length) {
            params.push(row._ctid);
            await q(
              `update ${T} set ${sets.join(", ")} where ctid = $${params.length}::tid`,
              params,
            );
            stats.rowsChanged++;
          }
        }
      }
      await q("close scan_cur");
    }

    // 3. Prove it: no address left anywhere, every person has the staging hash.
    let left = 0;
    for (const [table, tcols] of byTable) {
      for (const c of tcols) {
        const C = `${ident(c.column_name)}::text`;
        const r = await q(
          `select count(*)::int as n from ${ident(table)} where ${C} ~* '[A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}' and ${C} !~* '^[^@]*(@aliens\\.local[^@]*)*$'`,
        );
        if (r.rows[0].n) {
          left += r.rows[0].n;
          console.error(
            `[sanitize] ${table}.${c.column_name}: ${r.rows[0].n} row(s) still mention an email address`,
          );
        }
      }
    }
    if (left) throw new Error(`${left} row(s) still hold an email address — nothing was changed`);
    if ((await q("select to_regclass('public.people') as r")).rows[0].r) {
      const r = await q(
        `select count(*)::int as n from people where coalesce(payload->>'password', '') <> $1`,
        [hash],
      );
      if (r.rows[0].n)
        throw new Error(
          `${r.rows[0].n} person row(s) without the staging password — nothing was changed`,
        );
      stats.people = (await q("select count(*)::int as n from people")).rows[0].n;
    }
    await q("commit");
  } catch (err) {
    await q("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
  console.log(
    `[sanitize] ${who.db}: ${stats.tables} tables scanned, ${stats.rowsChanged} rows rewritten, ` +
      `all ${stats.people} people now sign in with the staging password only; emails blanked, sessions cleared`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(`[sanitize] FAILED: ${err?.message || err}`);
    process.exit(1);
  });
}
