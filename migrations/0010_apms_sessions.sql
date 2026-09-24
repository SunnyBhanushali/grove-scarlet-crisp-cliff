-- BATCH-2: server-issued sign-in sessions (only the SHA-256 of the token is kept).
-- apms-sessions.ts also creates this at runtime, because live does not apply
-- migration files on boot.
create table if not exists apms_sessions (
  token_hash text primary key,
  person_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists apms_sessions_person on apms_sessions (person_id);
