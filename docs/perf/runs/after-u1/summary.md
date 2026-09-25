# Load run after-u1

1 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T23:02:01.835Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 28 | 2480 | 3442 | 3663 | 3663 |
|   employee (own filtered company) | 19 | 2045 | 2666 | 2666 | 2666 |
|   editor (whole company) | 9 | 3248 | 3663 | 3663 | 3663 |
| company load (ms) | 1 | 39 | 39 | 39 | 39 |
| tick (ms) | 39 | 3 | 126 | 133 | 133 |
| save (ms) | 7 | 16 | 28 | 28 | 28 |
| others see a save (ms) | 0 |  |  |  |  |
| server CPU % of one core (1 s samples) | 179 | 1.6 | 17.6 | 22 | 35.4 |
| Postgres CPU % | 180 | 0 | 5 | 19 | 19 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 7, others-see < 1 s null
read-after-write: {"row":{"n":7,"bad":0,"why":{}},"wire":{"n":1,"bad":0,"why":{}},"wire+replay":{"n":1,"bad":0,"why":{}}}
event-loop lag: {"p99Max":96,"max":184.3,"p50Avg":10.1}; RSS MB {"n":179,"avg":244,"p50":244,"p95":301,"p99":309,"max":309}; pg connections {"max":9,"activeMax":2}; runner loop lag max 373 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| tick-since | 20 | 3 | 133 | 133 | 133 | 90 | {"200":20} |
| tick | 19 | 3 | 10 | 10 | 10 | 173 | {"200":19} |
| static | 12 | 8 | 14 | 14 | 14 | 138782 | {"200":12} |
| save-month | 7 | 16 | 28 | 28 | 28 | 11851 | {"200":7} |
| raw-row | 7 | 3 | 8 | 8 | 8 | 11789 | {"200":7} |
| pushed-page | 7 | 0 | 0 | 0 | 0 | 0 | {"200":7} |
| apms-month | 3 | 41 | 41 | 41 | 41 | 7829 | {"200":3} |
| apms-person | 3 | 4 | 4 | 4 | 4 | 11789 | {"200":3} |
| signin | 1 | 19 | 19 | 19 | 19 | 480 | {"200":1} |
| html | 1 | 2 | 2 | 2 | 2 | 4196 | {"200":1} |
| get-session | 1 | 2 | 2 | 2 | 2 | 480 | {"200":1} |
| company | 1 | 35 | 35 | 35 | 35 | 151170 | {"200":1} |
| company-load | 1 | 39 | 39 | 39 | 39 | 151170 | {"200":1} |
| changes | 1 | 7 | 7 | 7 | 7 | 165 | {"200":1} |
| page-open-http | 1 | 80 | 80 | 80 | 80 | 0 | {"200":1} |
| sse-connect | 1 | 8 | 8 | 8 | 8 | 0 | {"200":1} |
| row-read | 1 | 9 | 9 | 9 | 9 | 11775 | {"200":1} |
| raw-company | 1 | 28 | 28 | 28 | 28 | 151184 | {"200":1} |
| person | 1 | 7 | 7 | 7 | 7 | 1467 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 7 | 765 | 109.27 | 7 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 77 | 162 | 2.1 | 13860 | select id, jsonb_build_object( $1, id, $2, payload->$3, $4, payload->$5, $6, payload->$7, $8, payload->$9, $10, payload->$11, $12, payload->$13, $14, payload->$ |
| 15 | 119 | 7.96 | 15 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 3 | 66 | 21.95 | 546 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 13 | 28 | 2.13 | 2340 | select id, payload from people where deleted_at is null |
| 77 | 8 | 0.1 | 1078 | select kind, payload from entities where kind in ($1, $2, $3) and deleted_at is null |
| 35 | 8 | 0.22 | 9 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 32 | 6 | 0.2 | 32 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 37 | 4 | 0.12 | 37 | select count(*)::int n, count(*) filter (where state = $2)::int active from pg_stat_activity where datname = $1 |
| 160 | 4 | 0.03 | 160 | select kind, id, k1, k2, payload, rev, deleted_at, updated_at from entities where kind = $1 and id = $2 |
| 7 | 4 | 0.6 | 7 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 7 | 4 | 0.53 | 7 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 132 | 3 | 0.03 | 131 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 57 | 2 | 0.03 | 57 | select max(seq) as seq from entity_log |
| 13 | 1 | 0.1 | 2288 | select username, person_id, password from issued_logins |
