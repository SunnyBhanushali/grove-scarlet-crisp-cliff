# Load run after-u50

50 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T23:09:34.614Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 28 | 2520 | 3601 | 3667 | 3667 |
|   employee (own filtered company) | 19 | 2296 | 2760 | 2760 | 2760 |
|   editor (whole company) | 9 | 3349 | 3667 | 3667 | 3667 |
| company load (ms) | 50 | 32 | 48 | 148 | 148 |
| tick (ms) | 1975 | 2 | 28 | 219 | 448 |
| save (ms) | 341 | 11 | 66 | 476 | 926 |
| others see a save (ms) | 4388 | 43 | 260 | 463 | 940 |
| server CPU % of one core (1 s samples) | 180 | 11.8 | 32 | 46.5 | 47.1 |
| Postgres CPU % | 179 | 2 | 14 | 18 | 23 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 320, others-see < 1 s 1
read-after-write: {"row":{"n":320,"bad":0,"why":{}},"wire":{"n":44,"bad":0,"why":{}},"wire+replay":{"n":44,"bad":0,"why":{}}}
event-loop lag: {"p99Max":91.2,"max":147.5,"p50Avg":9.9}; RSS MB {"n":180,"avg":507,"p50":502,"p95":670,"p99":713,"max":724}; pg connections {"max":10,"activeMax":2}; runner loop lag max 762 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| pushed-page | 14946 | 0 | 0 | 0 | 0 | 0 | {"200":14946} |
| tick-since | 1001 | 2 | 27 | 219 | 448 | 103 | {"200":1001} |
| tick | 974 | 2 | 28 | 219 | 437 | 715 | {"200":974} |
| static | 600 | 3 | 11 | 24 | 33 | 138782 | {"200":600} |
| raw-row | 320 | 2 | 29 | 89 | 116 | 12806 | {"200":320} |
| save-month | 246 | 12 | 77 | 476 | 926 | 14431 | {"200":246} |
| changes | 185 | 3 | 47 | 62 | 577 | 2749 | {"200":185} |
| row-read | 103 | 3 | 33 | 80 | 94 | 10796 | {"200":103} |
| apms-person | 76 | 3 | 35 | 102 | 102 | 15281 | {"200":76} |
| people-list | 66 | 8 | 57 | 117 | 117 | 12230 | {"200":66} |
| rewards-month | 65 | 17 | 45 | 398 | 398 | 7390 | {"200":65} |
| signin | 50 | 9 | 20 | 34 | 34 | 490 | {"200":50} |
| html | 50 | 1 | 4 | 5 | 5 | 4196 | {"200":50} |
| get-session | 50 | 1 | 3 | 5 | 5 | 490 | {"200":50} |
| company | 50 | 24 | 37 | 126 | 126 | 200042 | {"200":50} |
| company-load | 50 | 32 | 48 | 148 | 148 | 200042 | {"200":50} |
| page-open-http | 50 | 56 | 139 | 202 | 202 | 0 | {"200":50} |
| sse-connect | 50 | 1 | 3 | 11 | 11 | 0 | {"200":50} |
| apms-month | 50 | 35 | 65 | 105 | 105 | 29575 | {"200":50} |
| raw-company | 44 | 29 | 270 | 438 | 438 | 208610 | {"200":44} |
| book-patch | 23 | 154 | 668 | 941 | 941 | 170 | {"200":23} |
| person | 22 | 3 | 36 | 189 | 189 | 1480 | {"200":22} |
| org-kind | 22 | 18 | 127 | 168 | 168 | 32128 | {"200":22} |
| save-notices | 20 | 8 | 37 | 37 | 37 | 165 | {"200":10,"409":10} |
| save-month-shared | 20 | 10 | 60 | 60 | 60 | 14477 | {"200":20} |
| save-reward-shared | 14 | 9 | 479 | 479 | 479 | 13132 | {"200":13,"409":1} |
| save-cell-shared | 11 | 7 | 12 | 12 | 12 | 627 | {"200":11} |
| save-people-shared | 9 | 8 | 32 | 32 | 32 | 1499 | {"200":9} |
| save-kpi-master-shared | 8 | 10 | 142 | 142 | 142 | 389 | {"200":8} |
| save-reward | 7 | 9 | 21 | 21 | 21 | 11523 | {"200":7} |
| save-target-history | 5 | 11 | 49 | 49 | 49 | 494 | {"200":5} |
| hint-get | 1 | 3 | 3 | 3 | 3 | 11789 | {"200":1} |
| save-people | 1 | 12 | 12 | 12 | 12 | 1581 | {"200":1} |
| save-409 | 1 | 0 | 0 | 0 | 0 | 0 | {"409":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 70 | 3438 | 49.12 | 70 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 38 | 804 | 21.16 | 6916 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 14 | 607 | 43.39 | 14 | select book, snapshot_json, content_hash from company_books where book = any($1) |
| 51 | 538 | 10.55 | 6732 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 1139 | 234 | 0.21 | 1139 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 97 | 186 | 1.91 | 17460 | select id, jsonb_build_object( $1, id, $2, payload->$3, $4, payload->$5, $6, payload->$7, $8, payload->$9, $10, payload->$11, $12, payload->$13, $14, payload->$ |
| 20 | 135 | 6.75 | 35940 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 293 | 110 | 0.38 | 293 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 255 | 107 | 0.42 | 255 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 373 | 102 | 0.27 | 416 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 57 | 97 | 1.71 | 10260 | select id, payload, rev from people where deleted_at is null |
| 27 | 28 | 1.02 | 11114 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind = any($1::text[]) order by updated_at asc, id asc |
| 13 | 20 | 1.52 | 2340 | select id, payload from people where deleted_at is null |
| 110 | 19 | 0.17 | 110 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 371 | 14 | 0.04 | 371 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
