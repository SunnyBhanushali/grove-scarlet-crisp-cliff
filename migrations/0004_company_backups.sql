-- Rolling 30-day company snapshots (daily, manual, and pre-restore).
create table if not exists company_backups (
  id             text primary key,
  kind           text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  created_by     text not null default '',
  label          text not null default '',
  people_count   integer not null default 0,
  bytes          integer not null default 0,
  snapshot_json  text not null,
  restored_at    timestamptz,
  restored_by    text not null default '',
  restore_of     text not null default ''
);

create index if not exists company_backups_created
  on company_backups (created_at desc);

create index if not exists company_backups_expires
  on company_backups (expires_at);
