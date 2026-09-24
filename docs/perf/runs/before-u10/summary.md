# Load run before-u10

10 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T16:06:13.779Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 23 | 3034 | 4445 | 6053 | 6053 |
| company load (ms) | 10 | 40 | 68 | 68 | 68 |
| tick (ms) | 1543 | 3 | 165 | 280 | 903 |
| save (ms) | 68 | 34 | 217 | 464 | 464 |
| others see a save (ms) | 268 | 0 | 237 | 294 | 437 |
| server CPU % of one core (1 s samples) | 177 | 15 | 86.1 | 92.2 | 95.8 |
| Postgres CPU % | 180 | 7 | 38 | 47 | 50 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 60, others-see < 1 s 1
read-after-write: {"row":{"n":60,"bad":0,"why":{}},"wire":{"n":6,"bad":1,"why":{}},"wire+replay":{"n":6,"bad":0,"why":{}}}
event-loop lag: {"p99Max":358.4,"max":358.4,"p50Avg":10.2}; RSS MB {"n":177,"avg":600,"p50":601,"p95":716,"p99":777,"max":824}; pg connections {"max":13,"activeMax":3}; runner loop lag max 705 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 1716 | 22 | 277 | 388 | 1202 | 3640 | {"200":1716} |
| tick | 774 | 3 | 182 | 294 | 903 | 1436 | {"200":774} |
| tick-since | 769 | 3 | 159 | 252 | 879 | 88 | {"200":769} |
| rewards-month | 201 | 22 | 252 | 314 | 515 | 852649 | {"200":201} |
| people-list | 180 | 6 | 291 | 487 | 826 | 117362 | {"200":180} |
| apms-month | 140 | 39 | 262 | 400 | 429 | 1141564 | {"200":140} |
| apms-person | 131 | 3 | 244 | 836 | 890 | 13806 | {"200":131} |
| static | 120 | 4 | 11 | 13 | 14 | 136468 | {"200":120} |
| raw-row | 60 | 7 | 261 | 355 | 355 | 10234 | {"200":60} |
| row-read | 38 | 3 | 124 | 132 | 132 | 9084 | {"200":38} |
| save-month | 21 | 34 | 316 | 396 | 396 | 15331 | {"200":21} |
| save-reward | 15 | 50 | 217 | 217 | 217 | 13148 | {"200":15} |
| keepalive-retry | 13 | 0 | 0 | 0 | 0 | 0 | {"0":13} |
| signin | 10 | 148 | 279 | 279 | 279 | 483 | {"200":10} |
| html | 10 | 1 | 10 | 10 | 10 | 4196 | {"200":10} |
| get-session | 10 | 143 | 215 | 215 | 215 | 483 | {"200":10} |
| company | 10 | 15 | 42 | 42 | 42 | 320336 | {"200":10} |
| company-load | 10 | 40 | 68 | 68 | 68 | 320336 | {"200":10} |
| page-open-http | 10 | 239 | 367 | 367 | 367 | 0 | {"200":10} |
| sse-connect | 10 | 2 | 7 | 7 | 7 | 0 | {"200":10} |
| save-target-history | 9 | 26 | 166 | 166 | 166 | 529 | {"200":9} |
| save-notices | 8 | 137 | 464 | 464 | 464 | 162 | {"200":4,"409":4} |
| raw-company | 6 | 113 | 147 | 147 | 147 | 348922 | {"200":6} |
| person | 5 | 3 | 6 | 6 | 6 | 1491 | {"200":5} |
| org-kind | 5 | 104 | 430 | 430 | 430 | 21217 | {"200":5} |
| save-people-shared | 4 | 65 | 149 | 149 | 149 | 1503 | {"200":4} |
| save-month-shared | 3 | 23 | 24 | 24 | 24 | 14451 | {"200":3} |
| save-people | 3 | 92 | 113 | 113 | 113 | 1472 | {"200":3} |
| save-reward-shared | 3 | 35 | 68 | 68 | 68 | 13121 | {"200":3} |
| save-kpi-master-shared | 2 | 58 | 58 | 58 | 58 | 385 | {"200":2} |
| raw-replay | 1 | 69 | 69 | 69 | 69 | 63060 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 225 | 11373 | 50.55 | 900 | select book, snapshot_json, content_hash from company_books |
| 159 | 6688 | 42.06 | 159 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 56 | 4174 | 74.53 | 56 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 124 | 3544 | 28.58 | 22568 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 201 | 2997 | 14.91 | 26532 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 12 | 566 | 47.19 | 2880 | select person_id, period, payload from month_records where deleted_at is null |
| 1905 | 562 | 0.3 | 732 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 12 | 343 | 28.57 | 2160 | select person_id, period, payload from reward_records where deleted_at is null |
| 150 | 285 | 1.9 | 27000 | select id, payload, rev from people where deleted_at is null |
| 17 | 146 | 8.58 | 30549 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 2914 | 51 | 0.02 | 2914 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 202 | 49 | 0.24 | 202 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 215 | 41 | 0.19 | 215 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 47 | 18 | 0.38 | 47 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 1234 | 17 | 0.01 | 1234 | select max(seq) as seq from entity_log |
