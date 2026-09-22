-- Roster lock: Rewards month / APMS month / award instance store rosterId.
-- Reads use that roster's assignments only.
-- Rebind is an explicit admin action with audit. Never implicit.
-- No hard deletes.

create table if not exists roster_binds (
  kind         text not null,
  subject_id   text not null,
  roster_id    text not null,
  bound_at     timestamptz not null default now(),
  bound_by     text not null default '',
  rev          integer not null default 1,
  payload      jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text not null default '',
  deleted_at   timestamptz,
  primary key (kind, subject_id)
);

create index if not exists roster_binds_roster on roster_binds (roster_id) where deleted_at is null;
create index if not exists roster_binds_kind on roster_binds (kind) where deleted_at is null;

create table if not exists roster_bind_audit (
  id              text primary key,
  kind            text not null,
  subject_id      text not null,
  from_roster_id  text not null default '',
  to_roster_id    text not null,
  reason          text not null default '',
  by              text not null default '',
  at              timestamptz not null default now(),
  client_op_id    text not null default '',
  payload         jsonb not null default '{}'::jsonb
);

create index if not exists roster_bind_audit_subject on roster_bind_audit (kind, subject_id, at desc);
