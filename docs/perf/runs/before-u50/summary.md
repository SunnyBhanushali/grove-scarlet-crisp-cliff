# Load run before-u50

50 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T17:10:05.390Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 16 | 6264 | 10957 | 10957 | 10957 |
|   employee (own filtered company) | 11 | 5635 | 10957 | 10957 | 10957 |
|   editor (whole company) | 5 | 6264 | 7708 | 7708 | 7708 |
| company load (ms) | 50 | 424 | 2469 | 2670 | 2670 |
| tick (ms) | 7528 | 438 | 1670 | 2092 | 6345 |
| save (ms) | 323 | 885 | 2512 | 3466 | 3777 |
| others see a save (ms) | 3960 | 181 | 1058 | 13255 | 50179 |
| server CPU % of one core (1 s samples) | 168 | 94.4 | 98.7 | 99.2 | 99.6 |
| Postgres CPU % | 163 | 40 | 57 | 64 | 78 |

errors 2, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 300, others-see < 1 s 0.9437
read-after-write: {"row":{"n":300,"bad":0,"why":{}},"wire":{"n":25,"bad":3,"why":{}},"wire+replay":{"n":25,"bad":0,"why":{}}}
event-loop lag: {"p99Max":493.4,"max":493.4,"p50Avg":14.6}; RSS MB {"n":168,"avg":851,"p50":848,"p95":963,"p99":1029,"max":1054}; pg connections {"max":13,"activeMax":8}; runner loop lag max 1949 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 18528 | 320 | 1142 | 1825 | 5828 | 9812 | {"200":18528} |
| tick | 3777 | 438 | 1670 | 2089 | 6345 | 1683 | {"200":3777} |
| tick-since | 3751 | 439 | 1666 | 2137 | 5829 | 125 | {"200":3751} |
| hint-get | 2658 | 539 | 1662 | 2340 | 5826 | 10163 | {"200":2658} |
| rewards-month | 655 | 372 | 1329 | 1904 | 5393 | 851110 | {"0":1,"200":654} |
| static | 600 | 200 | 4704 | 5812 | 5914 | 136468 | {"200":600} |
| people-list | 529 | 273 | 1252 | 1911 | 5844 | 117224 | {"200":529} |
| apms-person | 405 | 351 | 1171 | 2132 | 4474 | 14563 | {"200":405} |
| apms-month | 367 | 498 | 1669 | 2458 | 6341 | 1142104 | {"200":367} |
| raw-row | 300 | 422 | 1281 | 2189 | 2407 | 12548 | {"200":300} |
| save-month | 233 | 906 | 2586 | 3466 | 3777 | 14224 | {"0":1,"200":232} |
| row-read | 100 | 411 | 1667 | 2838 | 2838 | 10634 | {"200":100} |
| keepalive-retry | 58 | 0 | 0 | 0 | 0 | 0 | {"0":58} |
| signin | 50 | 2055 | 5733 | 6083 | 6083 | 490 | {"200":50} |
| html | 50 | 283 | 1927 | 1927 | 1927 | 4196 | {"200":50} |
| get-session | 50 | 1215 | 3751 | 3760 | 3760 | 490 | {"200":50} |
| company | 50 | 393 | 2424 | 2639 | 2639 | 348252 | {"200":50} |
| company-load | 50 | 424 | 2469 | 2670 | 2670 | 348252 | {"200":50} |
| page-open-http | 50 | 5751 | 8814 | 8866 | 8866 | 0 | {"200":50} |
| sse-connect | 50 | 84 | 428 | 552 | 552 | 0 | {"200":50} |
| raw-company | 25 | 121 | 837 | 1320 | 1320 | 352016 | {"200":25} |
| person | 24 | 269 | 1366 | 2996 | 2996 | 1444 | {"200":24} |
| org-kind | 22 | 669 | 2196 | 5989 | 5989 | 19755 | {"200":22} |
| save-notices | 20 | 734 | 1946 | 1946 | 1946 | 165 | {"200":10,"409":10} |
| save-people-shared | 15 | 885 | 3540 | 3540 | 3540 | 1503 | {"200":14,"409":1} |
| save-month-shared | 13 | 1049 | 2211 | 2211 | 2211 | 14464 | {"200":13} |
| save-reward-shared | 13 | 664 | 1886 | 1886 | 1886 | 13129 | {"200":12,"409":1} |
| save-kpi-master-shared | 9 | 497 | 1745 | 1745 | 1745 | 393 | {"200":9} |
| save-reward | 8 | 1040 | 2436 | 2436 | 2436 | 11162 | {"200":8} |
| save-cell-shared | 6 | 1366 | 1422 | 1422 | 1422 | 604 | {"200":6} |
| save-people | 3 | 1340 | 1939 | 1939 | 1939 | 1560 | {"200":3} |
| save-target-history | 3 | 2212 | 2688 | 2688 | 2688 | 508 | {"200":3} |
| raw-replay | 3 | 228 | 1629 | 1629 | 1629 | 558388 | {"200":3} |
| save-409 | 2 | 0 | 0 | 0 | 0 | 0 | {"409":2} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 518 | 41483 | 80.08 | 2072 | select book, snapshot_json, content_hash from company_books |
| 645 | 30021 | 46.54 | 85140 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 344 | 26637 | 77.43 | 62608 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 587 | 24356 | 41.49 | 587 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 151 | 17523 | 116.05 | 151 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 18676 | 4117 | 0.22 | 15608 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 518 | 1435 | 2.77 | 93240 | select id, payload, rev from people where deleted_at is null |
| 14 | 1156 | 82.56 | 3360 | select person_id, period, payload from month_records where deleted_at is null |
| 14 | 680 | 48.59 | 2520 | select person_id, period, payload from reward_records where deleted_at is null |
| 2654 | 631 | 0.24 | 2654 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 35 | 487 | 13.91 | 62895 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 10011 | 169 | 0.02 | 10011 | select max(seq) as seq from entity_log |
| 241 | 156 | 0.65 | 241 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 12443 | 150 | 0.01 | 12443 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 284 | 131 | 0.46 | 284 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
