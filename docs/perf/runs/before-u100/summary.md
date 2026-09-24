# Load run before-u100

100 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T17:16:04.558Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 17 | 7623 | 9926 | 9926 | 9926 |
|   employee (own filtered company) | 11 | 7457 | 9550 | 9550 | 9550 |
|   editor (whole company) | 6 | 7869 | 9926 | 9926 | 9926 |
| company load (ms) | 100 | 1034 | 2053 | 2488 | 2488 |
| tick (ms) | 13579 | 1325 | 4700 | 8986 | 14260 |
| save (ms) | 527 | 5622 | 12585 | 14879 | 23220 |
| others see a save (ms) | 3839 | 0 | 1997 | 7434 | 66470 |
| server CPU % of one core (1 s samples) | 168 | 97.4 | 99.3 | 99.7 | 99.9 |
| Postgres CPU % | 149 | 35 | 57 | 69 | 78 |

errors 18, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 458, others-see < 1 s 0.8656
read-after-write: {"row":{"n":447,"bad":0,"why":{}},"wire":{"n":13,"bad":0,"why":{}},"wire+replay":{"n":13,"bad":0,"why":{}},"row-failed":{"n":9,"bad":9,"why":{"status 0":9}}}
event-loop lag: {"p99Max":595.1,"max":595.1,"p50Avg":20.4}; RSS MB {"n":168,"avg":961,"p50":952,"p95":1062,"p99":1189,"max":1195}; pg connections {"max":13,"activeMax":5}; runner loop lag max 4492 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 12156 | 1238 | 3304 | 5717 | 13875 | 45116 | {"200":12156} |
| hint-get | 9928 | 1932 | 7602 | 11083 | 16143 | 10918 | {"0":35,"200":9893} |
| tick | 6815 | 1332 | 4874 | 9319 | 14040 | 1676 | {"0":27,"200":6788} |
| tick-since | 6764 | 1323 | 4501 | 8802 | 14260 | 355 | {"0":22,"200":6742} |
| static | 1200 | 318 | 7785 | 8636 | 9807 | 136468 | {"200":1200} |
| people-list | 840 | 1146 | 3265 | 7557 | 10094 | 117253 | {"200":840} |
| rewards-month | 689 | 1171 | 3513 | 5698 | 10254 | 851679 | {"0":1,"200":688} |
| apms-person | 658 | 1362 | 5652 | 9940 | 14525 | 14932 | {"200":658} |
| keepalive-retry | 595 | 0 | 0 | 0 | 0 | 0 | {"0":595} |
| raw-row | 447 | 1296 | 4627 | 6693 | 10480 | 12356 | {"200":447} |
| apms-month | 443 | 1402 | 4961 | 8333 | 8983 | 1140195 | {"0":1,"200":442} |
| save-month | 297 | 5637 | 12409 | 12983 | 15520 | 14376 | {"0":1,"200":289,"409":7} |
| row-read | 206 | 1554 | 5489 | 10367 | 10487 | 10624 | {"200":206} |
| signin | 100 | 4576 | 14027 | 14238 | 14238 | 492 | {"200":100} |
| html | 100 | 201 | 1031 | 1234 | 1234 | 4196 | {"200":100} |
| get-session | 100 | 3070 | 3847 | 4326 | 4326 | 492 | {"200":100} |
| company | 100 | 1013 | 2030 | 2451 | 2451 | 348202 | {"200":100} |
| company-load | 100 | 1034 | 2053 | 2488 | 2488 | 348202 | {"200":100} |
| page-open-http | 100 | 10116 | 15640 | 18175 | 18175 | 0 | {"200":100} |
| sse-connect | 100 | 112 | 1261 | 1557 | 1557 | 0 | {"200":100} |
| save-reward | 69 | 5859 | 12871 | 14879 | 14879 | 12239 | {"200":68,"409":1} |
| person | 52 | 1710 | 7446 | 8789 | 8789 | 1442 | {"200":52} |
| org-kind | 50 | 2173 | 7226 | 9647 | 9647 | 29200 | {"200":50} |
| save-409 | 48 | 0 | 0 | 0 | 0 | 0 | {"409":48} |
| save-month-shared | 43 | 6596 | 11650 | 13630 | 13630 | 14487 | {"200":27,"409":16} |
| save-reward-shared | 31 | 6258 | 20310 | 23220 | 23220 | 13144 | {"200":18,"409":13} |
| save-people-shared | 23 | 4412 | 13573 | 14615 | 14615 | 1508 | {"200":16,"409":7} |
| save-cell-shared | 20 | 5049 | 8572 | 8572 | 8572 | 640 | {"200":17,"409":3} |
| save-notices | 20 | 3331 | 10652 | 10652 | 10652 | 166 | {"200":10,"409":10} |
| save-kpi-master-shared | 15 | 5281 | 13387 | 13387 | 13387 | 408 | {"200":14,"409":1} |
| raw-company | 13 | 385 | 5591 | 5591 | 5591 | 349166 | {"200":13} |
| save-people | 6 | 4280 | 15546 | 15546 | 15546 | 1701 | {"200":6} |
| save-target-history | 3 | 2589 | 5762 | 5762 | 5762 | 522 | {"200":3} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 428 | 47685 | 111.41 | 1712 | select book, snapshot_json, content_hash from company_books |
| 419 | 29816 | 71.16 | 76258 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 675 | 26252 | 38.89 | 89100 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 654 | 20321 | 31.07 | 654 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 11980 | 11144 | 0.93 | 46758 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 100 | 7977 | 79.77 | 100 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 829 | 2253 | 2.72 | 149220 | select id, payload, rev from people where deleted_at is null |
| 6294 | 1655 | 0.26 | 6294 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 58 | 1283 | 22.12 | 104233 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 11 | 833 | 75.74 | 2640 | select person_id, period, payload from month_records where deleted_at is null |
| 4394 | 800 | 0.18 | 4394 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 11 | 479 | 43.5 | 1980 | select person_id, period, payload from reward_records where deleted_at is null |
| 22239 | 291 | 0.01 | 22239 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 452 | 282 | 0.62 | 452 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 323 | 234 | 0.73 | 323 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
