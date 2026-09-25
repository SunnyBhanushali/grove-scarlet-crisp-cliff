# Load run after-u250

250 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T23:18:43.720Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 22 | 2993 | 13532 | 15800 | 15800 |
|   employee (own filtered company) | 16 | 2765 | 4452 | 4452 | 4452 |
|   editor (whole company) | 6 | 7322 | 15800 | 15800 | 15800 |
| company load (ms) | 252 | 32 | 156 | 179 | 233 |
| tick (ms) | 11137 | 7 | 166 | 413 | 1169 |
| save (ms) | 2545 | 14 | 280 | 604 | 1125 |
| others see a save (ms) | 44205 | 52 | 292 | 780 | 32285 |
| server CPU % of one core (1 s samples) | 179 | 39.3 | 64.9 | 72.7 | 79.9 |
| Postgres CPU % | 174 | 9 | 22 | 25 | 28 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 1847, others-see < 1 s 0.9961
read-after-write: {"row":{"n":1847,"bad":0,"why":{}},"wire":{"n":70,"bad":0,"why":{}},"wire+replay":{"n":70,"bad":0,"why":{}}}
event-loop lag: {"p99Max":132.5,"max":215.1,"p50Avg":10.1}; RSS MB {"n":179,"avg":782,"p50":785,"p95":861,"p99":876,"max":880}; pg connections {"max":14,"activeMax":3}; runner loop lag max 1532 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| pushed-page | 276812 | 0 | 0 | 0 | 0 | 0 | {"200":276812} |
| tick-since | 5635 | 6 | 151 | 406 | 1169 | 120 | {"200":5635} |
| tick | 5502 | 7 | 174 | 421 | 1169 | 723 | {"200":5502} |
| changes | 3746 | 19 | 238 | 599 | 1304 | 5972 | {"200":3746} |
| static | 3000 | 5 | 49 | 141 | 215 | 138782 | {"200":3000} |
| raw-row | 1847 | 2 | 98 | 419 | 1374 | 12090 | {"200":1847} |
| save-month | 1634 | 14 | 280 | 604 | 1031 | 14320 | {"200":1110,"409":524} |
| row-read | 676 | 5 | 122 | 420 | 1275 | 10318 | {"200":676} |
| hint-get | 607 | 7 | 57 | 113 | 131 | 6013 | {"200":607} |
| save-409 | 578 | 0 | 0 | 0 | 0 | 0 | {"409":578} |
| people-list | 502 | 13 | 182 | 340 | 1213 | 12643 | {"200":502} |
| apms-person | 425 | 7 | 161 | 597 | 1097 | 14557 | {"200":425} |
| rewards-month | 408 | 24 | 262 | 634 | 1213 | 9914 | {"200":408} |
| save-reward | 391 | 13 | 291 | 667 | 1125 | 11251 | {"200":346,"409":45} |
| apms-month | 324 | 43 | 262 | 637 | 1104 | 18897 | {"200":324} |
| html | 252 | 2 | 70 | 141 | 236 | 4196 | {"200":252} |
| get-session | 252 | 2 | 28 | 118 | 182 | 495 | {"200":252} |
| company | 252 | 25 | 131 | 150 | 213 | 203357 | {"200":252} |
| company-load | 252 | 32 | 156 | 179 | 233 | 203357 | {"200":252} |
| page-open-http | 252 | 111 | 319 | 526 | 564 | 0 | {"200":252} |
| sse-connect | 252 | 1 | 22 | 48 | 126 | 0 | {"200":252} |
| signin | 250 | 14 | 139 | 173 | 244 | 496 | {"200":250} |
| book-patch | 163 | 159 | 692 | 1186 | 1376 | 170 | {"200":163} |
| person | 126 | 10 | 128 | 265 | 282 | 1520 | {"200":126} |
| org-kind | 123 | 27 | 282 | 601 | 625 | 26837 | {"200":123} |
| save-notices | 120 | 9 | 334 | 611 | 666 | 167 | {"200":60,"409":60} |
| save-month-shared | 105 | 15 | 329 | 430 | 451 | 14681 | {"200":102,"409":3} |
| raw-company | 70 | 27 | 281 | 629 | 629 | 202929 | {"200":70} |
| save-reward-shared | 68 | 22 | 369 | 544 | 544 | 13390 | {"200":67,"409":1} |
| save-people-shared | 66 | 11 | 117 | 342 | 342 | 1701 | {"200":65,"409":1} |
| save-cell-shared | 62 | 20 | 396 | 771 | 771 | 806 | {"200":59,"409":3} |
| save-kpi-master-shared | 55 | 16 | 179 | 216 | 216 | 558 | {"200":54,"409":1} |
| save-target-history | 28 | 12 | 101 | 160 | 160 | 502 | {"200":28} |
| save-people | 16 | 11 | 87 | 87 | 87 | 1708 | {"200":16} |
| keepalive-retry | 1 | 0 | 0 | 0 | 0 | 0 | {"0":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 245 | 5847 | 23.86 | 44590 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 208 | 4641 | 22.31 | 208 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 294 | 3930 | 13.37 | 38808 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 5536 | 1071 | 0.19 | 5536 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 93 | 741 | 7.97 | 167124 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 36 | 645 | 17.91 | 36 | select book, snapshot_json, content_hash from company_books where book = any($1) |
| 1465 | 516 | 0.35 | 1465 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 294 | 512 | 1.74 | 52920 | select id, payload, rev from people where deleted_at is null |
| 1395 | 455 | 0.33 | 3433 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 1005 | 414 | 0.41 | 1005 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 1653 | 250 | 0.15 | 1653 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 134 | 228 | 1.7 | 24120 | select id, jsonb_build_object( $1, id, $2, payload->$3, $4, payload->$5, $6, payload->$7, $8, payload->$9, $10, payload->$11, $12, payload->$13, $14, payload->$ |
| 1727 | 166 | 0.1 | 1727 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 139 | 142 | 1.02 | 57854 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind = any($1::text[]) order by updated_at asc, id asc |
| 346 | 112 | 0.32 | 346 | insert into reward_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (pers |
