-- Four company books (org / plans / months / targets).
-- The app still loads one assembled snapshot; saves write only the books that
-- actually changed. Stale replicas of a book are ignored via hash history.
create table if not exists company_books (
  book          text primary key,
  snapshot_json text not null,
  content_hash  text not null default '',
  updated_at    timestamptz not null default now()
);

create table if not exists company_book_hashes (
  book          text not null,
  content_hash  text not null,
  seen_at       timestamptz not null default now(),
  primary key (book, content_hash)
);

create index if not exists company_book_hashes_seen
  on company_book_hashes (book, seen_at desc);
