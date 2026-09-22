-- Generic entity rows for every collection that still lived in the four books.
-- One row per (kind, id); k1/k2 hold the key parts for two-level maps.
-- rev is the compare-and-set token: PATCH must carry the rev it loaded.
-- No hard deletes: deleted_at is set, the row stays so stale clients cannot
-- resurrect it (see entity_log for the change feed).

create table if not exists entities (
  kind        text not null,
  id          text not null,
  k1          text,
  k2          text,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz,
  primary key (kind, id)
);

create index if not exists entities_kind_live on entities (kind) where deleted_at is null;
create index if not exists entities_kind_k1 on entities (kind, k1);
create index if not exists entities_updated on entities (updated_at desc);

-- Append-only change feed. seq is what clients hold as their cursor; a client
-- asking for `since=seq` gets exactly the rows that changed after it saw them.
create table if not exists entity_log (
  seq         bigserial primary key,
  kind        text not null,
  id          text not null,
  k1          text,
  k2          text,
  rev         integer not null,
  deleted     boolean not null default false,
  updated_by  text not null default '',
  at          timestamptz not null default now()
);

create index if not exists entity_log_at on entity_log (at desc);
