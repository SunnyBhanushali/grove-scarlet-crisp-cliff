# Load run before-u10

10 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-25T00:27:08.044Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 25 | 3874 | 6245 | 6404 | 6404 |
|   employee (own filtered company) | 17 | 3874 | 6245 | 6245 | 6245 |
|   editor (whole company) | 8 | 3957 | 6404 | 6404 | 6404 |
| company load (ms) | 10 | 38 | 41 | 41 | 41 |
| tick (ms) | 1556 | 4 | 200 | 454 | 790 |
| save (ms) | 63 | 32 | 408 | 528 | 528 |
| others see a save (ms) | 112 | 1 | 164 | 315 | 356 |
| server CPU % of one core (1 s samples) | 177 | 14.5 | 79.7 | 92.2 | 97.3 |
| Postgres CPU % | 179 | 7 | 37 | 51 | 53 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 63, others-see < 1 s 1
read-after-write: {"row":{"n":63,"bad":0,"why":{}},"wire":{"n":4,"bad":0,"why":{}},"wire+replay":{"n":4,"bad":0,"why":{}}}
event-loop lag: {"p99Max":362.5,"max":373,"p50Avg":10.2}; RSS MB {"n":177,"avg":585,"p50":586,"p95":697,"p99":763,"max":777}; pg connections {"max":13,"activeMax":2}; runner loop lag max 1138 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 1834 | 25 | 288 | 475 | 602 | 4745 | {"200":1834} |
| tick | 780 | 4 | 209 | 455 | 790 | 1069 | {"200":780} |
| tick-since | 776 | 4 | 176 | 454 | 790 | 87 | {"200":776} |
| apms-person | 196 | 3 | 135 | 409 | 448 | 14293 | {"200":196} |
| apms-month | 152 | 36 | 249 | 476 | 538 | 1141458 | {"200":152} |
| hint-get | 147 | 23 | 247 | 588 | 597 | 11790 | {"200":147} |
| rewards-month | 128 | 24 | 316 | 623 | 1148 | 852347 | {"200":128} |
| static | 120 | 3 | 15 | 19 | 19 | 136468 | {"200":120} |
| people-list | 84 | 7 | 202 | 294 | 294 | 117224 | {"200":84} |
| raw-row | 63 | 29 | 315 | 438 | 438 | 13626 | {"200":63} |
| save-month | 50 | 32 | 408 | 528 | 528 | 15197 | {"200":50} |
| row-read | 17 | 3 | 169 | 169 | 169 | 11304 | {"200":17} |
| person | 11 | 2 | 284 | 284 | 284 | 1382 | {"200":11} |
| signin | 10 | 133 | 242 | 242 | 242 | 481 | {"200":10} |
| html | 10 | 1 | 2 | 2 | 2 | 4196 | {"200":10} |
| get-session | 10 | 122 | 191 | 191 | 191 | 481 | {"200":10} |
| company | 10 | 14 | 18 | 18 | 18 | 342073 | {"200":10} |
| company-load | 10 | 38 | 41 | 41 | 41 | 342073 | {"200":10} |
| page-open-http | 10 | 212 | 287 | 287 | 287 | 0 | {"200":10} |
| sse-connect | 10 | 1 | 3 | 3 | 3 | 0 | {"200":10} |
| save-month-shared | 5 | 140 | 408 | 408 | 408 | 14442 | {"200":5} |
| org-kind | 4 | 117 | 393 | 393 | 393 | 1909 | {"200":4} |
| raw-company | 4 | 149 | 158 | 158 | 158 | 349001 | {"200":4} |
| book-patch | 4 | 702 | 779 | 779 | 779 | 335300 | {"200":2,"409":2} |
| save-cell-shared | 4 | 94 | 108 | 108 | 108 | 597 | {"200":4} |
| keepalive-retry | 2 | 0 | 0 | 0 | 0 | 0 | {"0":2} |
| save-reward-shared | 1 | 14 | 14 | 14 | 14 | 13089 | {"200":1} |
| save-reward | 1 | 69 | 69 | 69 | 69 | 13043 | {"200":1} |
| save-people-shared | 1 | 28 | 28 | 28 | 28 | 1474 | {"200":1} |
| save-kpi-master-shared | 1 | 27 | 27 | 27 | 27 | 363 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 212 | 9458 | 44.61 | 848 | select book, snapshot_json, content_hash from company_books |
| 171 | 6352 | 37.15 | 171 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 57 | 4860 | 85.26 | 57 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 132 | 3303 | 25.02 | 24024 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 128 | 1925 | 15.04 | 16896 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 2036 | 507 | 0.25 | 732 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 84 | 164 | 1.96 | 15120 | select id, payload, rev from people where deleted_at is null |
| 3 | 111 | 36.9 | 720 | select person_id, period, payload from month_records where deleted_at is null |
| 406 | 91 | 0.23 | 406 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 3 | 64 | 21.23 | 540 | select person_id, period, payload from reward_records where deleted_at is null |
| 6 | 57 | 9.52 | 10782 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 2897 | 40 | 0.01 | 2897 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 51 | 24 | 0.47 | 51 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 57 | 22 | 0.38 | 57 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 1366 | 19 | 0.01 | 1366 | select max(seq) as seq from entity_log |
