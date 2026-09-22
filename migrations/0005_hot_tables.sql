-- Hot row tables projected from company_books.
-- Books (org / plans / months / targets) stay the source of truth until a later step.
-- No hard deletes: missing entities get deleted_at, never DROP/DELETE of live rows.

create table if not exists people (
  id          text primary key,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz
);

create table if not exists month_records (
  person_id   text not null,
  period      text not null,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz,
  primary key (person_id, period)
);

create table if not exists reward_records (
  person_id   text not null,
  period      text not null,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz,
  primary key (person_id, period)
);

create table if not exists target_cells (
  id          text primary key,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz
);

create table if not exists tombstones (
  field       text not null,
  key         text not null,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz,
  primary key (field, key)
);

create table if not exists write_ids (
  client_op_id text primary key,
  payload      jsonb not null default '{}'::jsonb,
  rev          integer not null default 1,
  updated_at   timestamptz not null default now(),
  updated_by   text not null default '',
  deleted_at   timestamptz
);

create index if not exists month_records_period on month_records (period);
create index if not exists reward_records_period on reward_records (period);
create index if not exists people_live on people (id) where deleted_at is null;
create index if not exists month_records_live on month_records (person_id, period) where deleted_at is null;
create index if not exists reward_records_live on reward_records (person_id, period) where deleted_at is null;
