# Load run before-u1

1 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T16:02:35.290Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 26 | 2357 | 2739 | 2770 | 2770 |
| company load (ms) | 1 | 48 | 48 | 48 | 48 |
| tick (ms) | 158 | 3 | 72 | 192 | 207 |
| save (ms) | 8 | 21 | 109 | 109 | 109 |
| others see a save (ms) | 0 |  |  |  |  |
| server CPU % of one core (1 s samples) | 179 | 1.9 | 36.1 | 63.8 | 70.3 |
| Postgres CPU % | 180 | 0 | 7 | 28 | 29 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 8, others-see < 1 s null
read-after-write: {"row":{"n":8,"bad":0,"why":{}},"wire":{"n":1,"bad":0,"why":{}},"wire+replay":{"n":1,"bad":0,"why":{}}}
event-loop lag: {"p99Max":269.5,"max":323.7,"p50Avg":10.1}; RSS MB {"n":179,"avg":370,"p50":363,"p95":543,"p99":594,"max":594}; pg connections {"max":8,"activeMax":2}; runner loop lag max 195 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| tick | 79 | 3 | 52 | 207 | 207 | 348 | {"200":79} |
| tick-since | 79 | 3 | 89 | 157 | 157 | 87 | {"200":79} |
| changes | 23 | 19 | 274 | 784 | 784 | 4285 | {"200":23} |
| rewards-month | 23 | 24 | 76 | 79 | 79 | 852345 | {"200":23} |
| apms-person | 16 | 4 | 13 | 13 | 13 | 18556 | {"200":16} |
| static | 12 | 6 | 16 | 16 | 16 | 136468 | {"200":12} |
| people-list | 12 | 7 | 12 | 12 | 12 | 117362 | {"200":12} |
| raw-row | 8 | 8 | 533 | 533 | 533 | 12130 | {"200":8} |
| row-read | 4 | 7 | 18 | 18 | 18 | 11570 | {"200":4} |
| save-month | 3 | 22 | 28 | 28 | 28 | 18618 | {"200":3} |
| save-reward | 2 | 18 | 18 | 18 | 18 | 13116 | {"200":2} |
| save-target-history | 2 | 18 | 18 | 18 | 18 | 505 | {"200":2} |
| signin | 1 | 208 | 208 | 208 | 208 | 480 | {"200":1} |
| html | 1 | 2 | 2 | 2 | 2 | 4196 | {"200":1} |
| get-session | 1 | 141 | 141 | 141 | 141 | 480 | {"200":1} |
| company | 1 | 23 | 23 | 23 | 23 | 348848 | {"200":1} |
| company-load | 1 | 48 | 48 | 48 | 48 | 348848 | {"200":1} |
| page-open-http | 1 | 277 | 277 | 277 | 277 | 0 | {"200":1} |
| sse-connect | 1 | 4 | 4 | 4 | 4 | 0 | {"200":1} |
| save-month-shared | 1 | 109 | 109 | 109 | 109 | 14445 | {"200":1} |
| raw-company | 1 | 60 | 60 | 60 | 60 | 348957 | {"200":1} |
| person | 1 | 3 | 3 | 3 | 3 | 1770 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 63 | 2300 | 36.5 | 252 | select book, snapshot_json, content_hash from company_books |
| 19 | 819 | 43.12 | 19 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 7 | 505 | 72.07 | 7 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 14 | 166 | 11.85 | 1848 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 1 | 43 | 43.39 | 240 | select person_id, period, payload from month_records where deleted_at is null |
| 115 | 26 | 0.22 | 24 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 1 | 25 | 24.83 | 180 | select person_id, period, payload from reward_records where deleted_at is null |
| 12 | 23 | 1.88 | 2160 | select id, payload, rev from people where deleted_at is null |
| 812 | 21 | 0.03 | 812 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 1 | 10 | 9.51 | 1797 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 35 | 9 | 0.25 | 35 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 26 | 8 | 0.3 | 26 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 37 | 4 | 0.12 | 37 | select count(*)::int n, count(*) filter (where state = $2)::int active from pg_stat_activity where datname = $1 |
| 5 | 3 | 0.66 | 5 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 34 | 3 | 0.09 | 5984 | select username, person_id, password from issued_logins |
