# Load run before-u1

1 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T22:31:47.311Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 26 | 3354 | 3967 | 4090 | 4090 |
|   employee (own filtered company) | 18 | 3461 | 3967 | 3967 | 3967 |
|   editor (whole company) | 8 | 3191 | 4090 | 4090 | 4090 |
| company load (ms) | 1 | 50 | 50 | 50 | 50 |
| tick (ms) | 158 | 3 | 17 | 185 | 275 |
| save (ms) | 6 | 59 | 302 | 302 | 302 |
| others see a save (ms) | 0 |  |  |  |  |
| server CPU % of one core (1 s samples) | 180 | 2.9 | 32.6 | 69.7 | 83.8 |
| Postgres CPU % | 180 | 1 | 13 | 32 | 32 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 6, others-see < 1 s null
read-after-write: {"row":{"n":6,"bad":0,"why":{}}}
event-loop lag: {"p99Max":388,"max":388,"p50Avg":10.1}; RSS MB {"n":180,"avg":317,"p50":319,"p95":513,"p99":540,"max":540}; pg connections {"max":8,"activeMax":1}; runner loop lag max 449 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| tick | 79 | 3 | 73 | 275 | 275 | 156 | {"200":79} |
| tick-since | 79 | 3 | 17 | 185 | 185 | 82 | {"200":79} |
| apms-month | 54 | 37 | 118 | 148 | 148 | 1141242 | {"200":54} |
| apms-person | 29 | 4 | 14 | 127 | 127 | 11789 | {"200":29} |
| changes | 19 | 42 | 550 | 550 | 550 | 3789 | {"200":19} |
| static | 12 | 10 | 20 | 20 | 20 | 136468 | {"200":12} |
| save-month | 6 | 59 | 302 | 302 | 302 | 11851 | {"200":6} |
| raw-row | 6 | 203 | 307 | 307 | 307 | 11789 | {"200":6} |
| signin | 1 | 176 | 176 | 176 | 176 | 480 | {"200":1} |
| html | 1 | 3 | 3 | 3 | 3 | 4196 | {"200":1} |
| get-session | 1 | 152 | 152 | 152 | 152 | 480 | {"200":1} |
| company | 1 | 22 | 22 | 22 | 22 | 348215 | {"200":1} |
| company-load | 1 | 50 | 50 | 50 | 50 | 348215 | {"200":1} |
| page-open-http | 1 | 300 | 300 | 300 | 300 | 0 | {"200":1} |
| sse-connect | 1 | 6 | 6 | 6 | 6 | 0 | {"200":1} |
| row-read | 1 | 9 | 9 | 9 | 9 | 11775 | {"200":1} |
| hint-get | 1 | 209 | 209 | 209 | 209 | 11789 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 54 | 1858 | 34.4 | 216 | select book, snapshot_json, content_hash from company_books |
| 44 | 979 | 22.26 | 8008 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 18 | 754 | 41.87 | 18 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 6 | 621 | 103.47 | 6 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 104 | 31 | 0.3 | 23 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 791 | 21 | 0.03 | 779 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 49 | 13 | 0.26 | 49 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 37 | 4 | 0.12 | 37 | select count(*)::int n, count(*) filter (where state = $2)::int active from pg_stat_activity where datname = $1 |
| 34 | 4 | 0.12 | 5984 | select username, person_id, password from issued_logins |
| 6 | 3 | 0.56 | 6 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 6 | 3 | 0.51 | 6 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 87 | 3 | 0.03 | 87 | select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now() |
| 112 | 3 | 0.02 | 112 | select max(seq) as seq from entity_log |
| 3 | 1 | 0.17 | 3 | select count(*)::int as n from target_cells where deleted_at is null |
| 3 | 0 | 0.15 | 3 | select count(*)::int as n from people where deleted_at is null |
