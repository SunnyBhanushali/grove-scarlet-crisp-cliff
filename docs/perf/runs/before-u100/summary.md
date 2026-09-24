# Load run before-u100

100 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T16:14:40.107Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 18 | 4457 | 6386 | 6386 | 6386 |
| company load (ms) | 100 | 1203 | 2571 | 3212 | 3212 |
| tick (ms) | 15227 | 799 | 2441 | 5742 | 10364 |
| save (ms) | 636 | 5274 | 10349 | 15158 | 18230 |
| others see a save (ms) | 4109 | 0 | 0 | 3212 | 31109 |
| server CPU % of one core (1 s samples) | 171 | 97.5 | 99.5 | 99.7 | 99.8 |
| Postgres CPU % | 176 | 36 | 64 | 71 | 77 |

errors 19, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 457, others-see < 1 s 0.9869
read-after-write: {"row":{"n":456,"bad":0,"why":{}},"wire":{"n":17,"bad":1,"why":{}},"wire+replay":{"n":17,"bad":0,"why":{}},"row-failed":{"n":1,"bad":1,"why":{"status 0":1}}}
event-loop lag: {"p99Max":557.3,"max":557.3,"p50Avg":18.4}; RSS MB {"n":171,"avg":1049,"p50":1038,"p95":1195,"p99":1322,"max":1329}; pg connections {"max":13,"activeMax":7}; runner loop lag max 731 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 21527 | 771 | 1780 | 2846 | 9760 | 16523 | {"200":21527} |
| tick | 7637 | 796 | 2499 | 5977 | 10364 | 1627 | {"0":5,"200":7632} |
| tick-since | 7590 | 803 | 2368 | 5329 | 9437 | 260 | {"0":8,"200":7582} |
| people-list | 1281 | 763 | 1938 | 4612 | 8060 | 117908 | {"200":1281} |
| static | 1200 | 319 | 5130 | 6026 | 6234 | 136468 | {"200":1200} |
| apms-person | 1085 | 791 | 2939 | 5903 | 8972 | 14455 | {"200":1085} |
| rewards-month | 824 | 784 | 1567 | 3134 | 7267 | 852714 | {"0":1,"200":823} |
| apms-month | 631 | 871 | 1838 | 5698 | 8172 | 1142182 | {"200":631} |
| raw-row | 456 | 813 | 2337 | 5018 | 6286 | 8276 | {"200":456} |
| row-read | 341 | 849 | 3548 | 6087 | 8325 | 7786 | {"200":341} |
| keepalive-retry | 270 | 0 | 0 | 0 | 0 | 0 | {"0":270} |
| save-month | 140 | 5378 | 10769 | 12801 | 15158 | 14392 | {"0":2,"200":138} |
| save-notices | 102 | 2510 | 6360 | 6859 | 7104 | 166 | {"200":52,"409":50} |
| signin | 100 | 5511 | 11512 | 11690 | 11690 | 492 | {"200":100} |
| html | 100 | 200 | 1347 | 1408 | 1408 | 4196 | {"200":100} |
| get-session | 100 | 3548 | 5886 | 6488 | 6488 | 492 | {"200":100} |
| company | 100 | 1175 | 2528 | 3189 | 3189 | 320981 | {"200":100} |
| company-load | 100 | 1203 | 2571 | 3212 | 3212 | 320981 | {"200":100} |
| page-open-http | 100 | 11189 | 15524 | 16987 | 16987 | 0 | {"200":100} |
| sse-connect | 100 | 118 | 892 | 1318 | 1318 | 0 | {"200":100} |
| save-reward | 85 | 5253 | 8817 | 16879 | 16879 | 9653 | {"200":85} |
| save-target-history | 80 | 4463 | 10648 | 15582 | 15582 | 540 | {"200":80} |
| save-409 | 75 | 0 | 0 | 0 | 0 | 0 | {"409":75} |
| save-month-shared | 72 | 6192 | 8279 | 10374 | 10374 | 14501 | {"200":33,"409":39} |
| save-people | 64 | 5947 | 11967 | 18230 | 18230 | 1704 | {"200":64} |
| person | 55 | 936 | 6995 | 7267 | 7267 | 1583 | {"200":55} |
| org-kind | 45 | 1711 | 10370 | 11195 | 11195 | 27761 | {"200":45} |
| save-reward-shared | 37 | 5797 | 10772 | 16360 | 16360 | 13197 | {"200":24,"409":13} |
| save-people-shared | 34 | 6089 | 15151 | 17582 | 17582 | 1540 | {"200":19,"409":15} |
| save-kpi-master-shared | 22 | 6107 | 9413 | 9797 | 9797 | 410 | {"200":14,"409":8} |
| raw-company | 17 | 126 | 679 | 679 | 679 | 323096 | {"200":17} |
| raw-replay | 1 | 1060 | 1060 | 1060 | 1060 | 1134501 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 518 | 56046 | 108.2 | 2072 | select book, snapshot_json, content_hash from company_books |
| 625 | 36961 | 59.14 | 113750 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 814 | 26161 | 32.14 | 107448 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 708 | 23742 | 33.53 | 708 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 134 | 8000 | 59.7 | 134 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 21493 | 6941 | 0.32 | 50529 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 1232 | 3064 | 2.49 | 221760 | select id, payload, rev from people where deleted_at is null |
| 56 | 1259 | 22.48 | 100666 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 15 | 1053 | 70.19 | 3600 | select person_id, period, payload from month_records where deleted_at is null |
| 15 | 657 | 43.8 | 2700 | select person_id, period, payload from reward_records where deleted_at is null |
| 1711 | 486 | 0.28 | 1711 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 24025 | 333 | 0.01 | 24025 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 364 | 185 | 0.51 | 364 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 718 | 143 | 0.2 | 718 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 175 | 134 | 0.77 | 175 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
