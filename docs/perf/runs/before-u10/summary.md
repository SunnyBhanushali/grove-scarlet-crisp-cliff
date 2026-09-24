# Load run before-u10

10 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T17:05:49.742Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 23 | 4581 | 5728 | 6240 | 6240 |
|   employee (own filtered company) | 15 | 4611 | 6240 | 6240 | 6240 |
|   editor (whole company) | 8 | 4336 | 5657 | 5657 | 5657 |
| company load (ms) | 10 | 47 | 52 | 52 | 52 |
| tick (ms) | 1540 | 5 | 204 | 429 | 1218 |
| save (ms) | 69 | 37 | 678 | 879 | 879 |
| others see a save (ms) | 118 | 5 | 220 | 378 | 481 |
| server CPU % of one core (1 s samples) | 176 | 17 | 80.1 | 85.2 | 91.2 |
| Postgres CPU % | 177 | 6 | 40 | 45 | 48 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 65, others-see < 1 s 1
read-after-write: {"row":{"n":65,"bad":0,"why":{}},"wire":{"n":5,"bad":0,"why":{}},"wire+replay":{"n":5,"bad":0,"why":{}}}
event-loop lag: {"p99Max":423.9,"max":423.9,"p50Avg":10.1}; RSS MB {"n":176,"avg":656,"p50":655,"p95":776,"p99":799,"max":799}; pg connections {"max":13,"activeMax":2}; runner loop lag max 882 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 1929 | 29 | 305 | 870 | 942 | 4532 | {"200":1929} |
| tick | 773 | 6 | 215 | 628 | 1218 | 1129 | {"200":773} |
| tick-since | 767 | 5 | 200 | 412 | 942 | 88 | {"200":767} |
| hint-get | 165 | 35 | 403 | 871 | 871 | 8178 | {"200":165} |
| people-list | 154 | 7 | 171 | 770 | 1218 | 117242 | {"200":154} |
| apms-person | 128 | 3 | 163 | 325 | 1218 | 15230 | {"200":128} |
| rewards-month | 126 | 26 | 300 | 425 | 459 | 852347 | {"200":126} |
| static | 120 | 5 | 104 | 107 | 107 | 136468 | {"200":120} |
| raw-row | 65 | 17 | 261 | 481 | 481 | 13257 | {"200":65} |
| save-month | 55 | 38 | 377 | 854 | 854 | 15070 | {"200":55} |
| apms-month | 45 | 49 | 310 | 691 | 691 | 1141357 | {"200":45} |
| row-read | 19 | 4 | 192 | 192 | 192 | 9952 | {"200":19} |
| signin | 10 | 147 | 383 | 383 | 383 | 481 | {"200":10} |
| html | 10 | 1 | 42 | 42 | 42 | 4196 | {"200":10} |
| get-session | 10 | 144 | 237 | 237 | 237 | 481 | {"200":10} |
| company | 10 | 16 | 22 | 22 | 22 | 348238 | {"200":10} |
| company-load | 10 | 47 | 52 | 52 | 52 | 348238 | {"200":10} |
| page-open-http | 10 | 285 | 456 | 456 | 456 | 0 | {"200":10} |
| sse-connect | 10 | 2 | 8 | 8 | 8 | 0 | {"200":10} |
| keepalive-retry | 7 | 0 | 0 | 0 | 0 | 0 | {"0":7} |
| person | 6 | 15 | 484 | 484 | 484 | 1407 | {"200":6} |
| org-kind | 6 | 116 | 623 | 623 | 623 | 18261 | {"200":6} |
| raw-company | 5 | 136 | 275 | 275 | 275 | 348930 | {"200":5} |
| save-people | 5 | 17 | 341 | 341 | 341 | 1630 | {"200":5} |
| save-notices | 4 | 99 | 879 | 879 | 879 | 163 | {"200":2,"409":2} |
| save-kpi-master-shared | 2 | 88 | 88 | 88 | 88 | 363 | {"200":2} |
| save-reward-shared | 1 | 24 | 24 | 24 | 24 | 13089 | {"200":1} |
| save-target-history | 1 | 701 | 701 | 701 | 701 | 521 | {"200":1} |
| save-month-shared | 1 | 28 | 28 | 28 | 28 | 14440 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 236 | 10154 | 43.03 | 944 | select book, snapshot_json, content_hash from company_books |
| 186 | 7638 | 41.06 | 186 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 63 | 6027 | 95.66 | 63 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 126 | 1846 | 14.65 | 16632 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 33 | 1042 | 31.57 | 6006 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 2179 | 642 | 0.29 | 803 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 141 | 300 | 2.12 | 25380 | select id, payload, rev from people where deleted_at is null |
| 4 | 162 | 40.41 | 960 | select person_id, period, payload from month_records where deleted_at is null |
| 4 | 100 | 25.06 | 720 | select person_id, period, payload from reward_records where deleted_at is null |
| 349 | 99 | 0.28 | 349 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 9 | 86 | 9.55 | 16174 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 2871 | 49 | 0.02 | 2871 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 60 | 26 | 0.44 | 60 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 55 | 26 | 0.47 | 55 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 1419 | 21 | 0.01 | 1419 | select max(seq) as seq from entity_log |
