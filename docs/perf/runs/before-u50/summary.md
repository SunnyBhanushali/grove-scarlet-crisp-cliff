# Load run before-u50

50 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T22:39:16.288Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 16 | 6098 | 7842 | 7842 | 7842 |
|   employee (own filtered company) | 12 | 6038 | 7842 | 7842 | 7842 |
|   editor (whole company) | 4 | 7473 | 7580 | 7580 | 7580 |
| company load (ms) | 50 | 956 | 2498 | 2648 | 2648 |
| tick (ms) | 7310 | 353 | 1465 | 2650 | 7188 |
| save (ms) | 319 | 1004 | 2643 | 3473 | 3737 |
| others see a save (ms) | 3918 | 158 | 1124 | 5874 | 42617 |
| server CPU % of one core (1 s samples) | 168 | 95.8 | 99.1 | 99.5 | 99.8 |
| Postgres CPU % | 165 | 39 | 59 | 63 | 66 |

errors 3, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 298, others-see < 1 s 0.9456
read-after-write: {"row":{"n":297,"bad":0,"why":{}},"wire":{"n":25,"bad":1,"why":{}},"wire+replay":{"n":25,"bad":0,"why":{}},"row-failed":{"n":1,"bad":1,"why":{"status 0":1}}}
event-loop lag: {"p99Max":576.2,"max":576.2,"p50Avg":15.7}; RSS MB {"n":168,"avg":956,"p50":946,"p95":1087,"p99":1111,"max":1113}; pg connections {"max":13,"activeMax":10}; runner loop lag max 1924 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 17503 | 329 | 1137 | 1928 | 5152 | 10874 | {"200":17503} |
| tick | 3664 | 350 | 1467 | 2722 | 7188 | 1679 | {"200":3664} |
| tick-since | 3646 | 357 | 1455 | 2486 | 5791 | 125 | {"200":3646} |
| hint-get | 2537 | 627 | 1841 | 2265 | 3450 | 11160 | {"200":2537} |
| apms-person | 603 | 314 | 1010 | 1779 | 3571 | 14804 | {"200":603} |
| static | 600 | 238 | 3890 | 4266 | 4280 | 136468 | {"200":600} |
| people-list | 571 | 279 | 948 | 2210 | 5578 | 117247 | {"200":571} |
| apms-month | 435 | 458 | 1303 | 2168 | 4549 | 1142231 | {"200":435} |
| rewards-month | 369 | 352 | 1209 | 3487 | 5707 | 852421 | {"200":369} |
| raw-row | 297 | 420 | 1504 | 2079 | 3132 | 13299 | {"200":297} |
| save-month | 230 | 995 | 2643 | 3424 | 3568 | 14432 | {"200":230} |
| keepalive-retry | 137 | 0 | 0 | 0 | 0 | 0 | {"0":137} |
| row-read | 101 | 487 | 2018 | 2171 | 2249 | 11569 | {"200":101} |
| signin | 50 | 2860 | 4501 | 4724 | 4724 | 490 | {"200":50} |
| html | 50 | 319 | 838 | 914 | 914 | 4196 | {"200":50} |
| get-session | 50 | 3267 | 4795 | 4821 | 4821 | 490 | {"200":50} |
| company | 50 | 916 | 2471 | 2621 | 2621 | 320118 | {"200":50} |
| company-load | 50 | 956 | 2498 | 2648 | 2648 | 320118 | {"200":50} |
| page-open-http | 50 | 5916 | 10801 | 11019 | 11019 | 0 | {"200":50} |
| sse-connect | 50 | 185 | 747 | 888 | 888 | 0 | {"200":50} |
| book-patch | 42 | 2413 | 4494 | 5213 | 5213 | 415126 | {"200":16,"409":26} |
| person | 35 | 403 | 1138 | 5581 | 5581 | 1476 | {"200":35} |
| save-month-shared | 31 | 1197 | 2578 | 2887 | 2887 | 14488 | {"200":28,"409":3} |
| raw-company | 25 | 232 | 931 | 1365 | 1365 | 351127 | {"200":25} |
| org-kind | 23 | 890 | 2045 | 4443 | 4443 | 23175 | {"200":23} |
| save-notices | 16 | 787 | 2518 | 2518 | 2518 | 165 | {"200":8,"409":8} |
| save-reward-shared | 10 | 1132 | 2513 | 2513 | 2513 | 13123 | {"200":10} |
| save-people-shared | 10 | 1536 | 3737 | 3737 | 3737 | 1485 | {"200":8,"409":2} |
| save-reward | 9 | 1118 | 2889 | 2889 | 2889 | 11272 | {"200":9} |
| save-kpi-master-shared | 9 | 1009 | 1989 | 1989 | 1989 | 394 | {"200":9} |
| save-409 | 5 | 0 | 0 | 0 | 0 | 0 | {"409":5} |
| save-people | 3 | 1004 | 1794 | 1794 | 1794 | 1750 | {"200":3} |
| raw-replay | 1 | 732 | 732 | 732 | 732 | 629237 | {"200":1} |
| save-target-history | 1 | 186 | 186 | 186 | 186 | 478 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 538 | 44347 | 82.43 | 2152 | select book, snapshot_json, content_hash from company_books |
| 429 | 35717 | 83.26 | 78078 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 577 | 23987 | 41.57 | 577 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 146 | 16705 | 114.41 | 146 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 347 | 15699 | 45.24 | 45804 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 17697 | 4158 | 0.23 | 15367 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 26 | 1962 | 75.48 | 6240 | select person_id, period, payload from month_records where deleted_at is null |
| 560 | 1558 | 2.78 | 100800 | select id, payload, rev from people where deleted_at is null |
| 26 | 1204 | 46.33 | 4680 | select person_id, period, payload from reward_records where deleted_at is null |
| 3036 | 817 | 0.27 | 3036 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 48 | 711 | 14.81 | 86256 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 254 | 242 | 0.95 | 254 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 9564 | 173 | 0.02 | 9564 | select max(seq) as seq from entity_log |
| 12151 | 152 | 0.01 | 12151 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 283 | 148 | 0.52 | 283 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
