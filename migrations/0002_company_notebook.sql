-- Shared company snapshot for Aliens APMS (one notebook for the whole org).
create table if not exists company_notebook (
  id            text primary key,
  snapshot_json text not null,
  updated_at    timestamptz not null default now()
);
