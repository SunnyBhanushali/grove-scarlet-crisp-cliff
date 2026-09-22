-- Monthly roster. People stay identity. Assignments are per period.
-- No hard deletes.
-- Unique live key R1: one solid assignment per (period, person_id)
--   (index roster_assignments_primary_solid).
-- Also unique (period, person_id, coalesce(sbu_id,''), start_date) on live rows
--   so R2 can add split-days without colliding.

create table if not exists roster_periods (
  period      text primary key,
  status      text not null default 'draft',
  locked_at   timestamptz,
  locked_by   text not null default '',
  copied_from text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  rev         integer not null default 1
);

create table if not exists roster_assignments (
  id              text primary key,
  period          text not null,
  person_id       text not null,
  sbu_id          text,
  brand_id        text,
  company_id      text,
  function_id     text,
  manager_id      text,
  line            text not null default 'solid',
  status          text not null default 'active',
  start_date      date,
  end_date        date,
  allocation_pct  numeric not null default 100,
  reason          text not null default '',
  payload         jsonb not null default '{}'::jsonb,
  rev             integer not null default 1,
  updated_at      timestamptz not null default now(),
  updated_by      text not null default '',
  deleted_at      timestamptz
);

create unique index if not exists roster_assignments_period_person_sbu_start
  on roster_assignments (period, person_id, coalesce(sbu_id, ''), start_date)
  where deleted_at is null;

create unique index if not exists roster_assignments_primary_solid
  on roster_assignments (period, person_id)
  where deleted_at is null and line = 'solid';

create index if not exists roster_assignments_period on roster_assignments (period);
create index if not exists roster_assignments_person_period on roster_assignments (person_id, period);
create index if not exists roster_assignments_live on roster_assignments (period, person_id) where deleted_at is null;
