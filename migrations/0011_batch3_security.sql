-- BATCH-3 security. For the record only: live does not apply migration files
-- on boot; the server creates / converts all of this at runtime
-- (src/lib/apms-signin-guard.ts, src/lib/apms-password-migrate.ts,
-- src/lib/issued-logins.ts).

-- Failed sign-in counters and lock-outs (5 / username, 30 / IP per 15 min).
create table if not exists apms_signin_failures (
  key          text primary key,              -- 'u:<username>' or 'ip:<address>'
  fails        integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- Issued logins (created at runtime since BATCH-2; listed here for the record).
-- BATCH-3: `password` holds an scrypt hash: scrypt$N$r$p$<salt>$<key>.
create table if not exists issued_logins (
  username   text primary key,
  person_id  text,
  password   text not null,
  updated_at timestamptz not null default now()
);

-- One-time conversion of plain-text passwords (runs at server start, idempotent):
-- every plain value found is first copied to apms_password_backup_<yyyymmddhhmmss>
-- (source, ref, password, saved_at), revoked from PUBLIC and owned by the admin
-- role (APMS_PW_BACKUP_OWNER, default postgres). After sign-in is confirmed:
--   DROP TABLE apms_password_backup_<stamp>;
--   DROP TABLE IF EXISTS apms_password_backup_<stamp>_copies;
