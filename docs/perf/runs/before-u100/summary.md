# Load run before-u100

100 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-25T00:31:09.663Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 20 | 4751 | 8046 | 8046 | 8046 |
|   employee (own filtered company) | 12 | 4753 | 6826 | 6826 | 6826 |
|   editor (whole company) | 8 | 4044 | 8046 | 8046 | 8046 |
| company load (ms) | 100 | 1048 | 2177 | 2860 | 2860 |
| tick (ms) | 15158 | 772 | 2600 | 4838 | 7761 |
| save (ms) | 584 | 3500 | 10311 | 12620 | 16799 |
| others see a save (ms) | 4399 | 0 | 1357 | 11642 | 163562 |
| server CPU % of one core (1 s samples) | 170 | 98.3 | 99.6 | 99.9 | 99.9 |
| Postgres CPU % | 172 | 41 | 62 | 72 | 74 |

errors 13, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 531, others-see < 1 s 0.9225
read-after-write: {"row":{"n":531,"bad":0,"why":{}},"wire":{"n":14,"bad":1,"why":{}},"wire+replay":{"n":14,"bad":0,"why":{}}}
event-loop lag: {"p99Max":472.9,"max":472.9,"p50Avg":17.4}; RSS MB {"n":170,"avg":943,"p50":939,"p95":1063,"p99":1117,"max":1128}; pg connections {"max":13,"activeMax":6}; runner loop lag max 2135 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 21037 | 721 | 1958 | 3033 | 8490 | 29410 | {"200":21037} |
| hint-get | 10968 | 1076 | 4074 | 5889 | 8338 | 11114 | {"0":3,"200":10965} |
| tick | 7602 | 772 | 2603 | 5024 | 7761 | 1701 | {"0":25,"200":7577} |
| tick-since | 7556 | 773 | 2586 | 4643 | 7446 | 252 | {"0":25,"200":7531} |
| static | 1200 | 156 | 3689 | 4799 | 5235 | 136468 | {"200":1200} |
| rewards-month | 1001 | 712 | 2185 | 3766 | 6989 | 852809 | {"200":1001} |
| people-list | 965 | 659 | 1987 | 3170 | 6638 | 117128 | {"0":1,"200":964} |
| apms-person | 950 | 715 | 3255 | 5085 | 6976 | 14233 | {"0":1,"200":949} |
| apms-month | 742 | 780 | 3011 | 4769 | 6682 | 1143022 | {"200":742} |
| raw-row | 531 | 803 | 2826 | 4768 | 6180 | 12406 | {"200":531} |
| keepalive-retry | 388 | 0 | 0 | 0 | 0 | 0 | {"0":388} |
| save-month | 357 | 3563 | 10595 | 12502 | 13400 | 14306 | {"200":353,"409":4} |
| row-read | 231 | 841 | 3674 | 5665 | 6342 | 10434 | {"200":231} |
| signin | 100 | 3244 | 9953 | 10475 | 10475 | 492 | {"200":100} |
| html | 100 | 135 | 1019 | 1308 | 1308 | 4196 | {"200":100} |
| get-session | 100 | 2676 | 4619 | 4730 | 4730 | 492 | {"200":100} |
| company | 100 | 1025 | 2156 | 2836 | 2836 | 337785 | {"200":100} |
| company-load | 100 | 1048 | 2177 | 2860 | 2860 | 337785 | {"200":100} |
| page-open-http | 100 | 8207 | 11818 | 12653 | 12653 | 0 | {"200":100} |
| sse-connect | 100 | 34 | 512 | 1202 | 1202 | 0 | {"200":100} |
| book-patch | 95 | 7874 | 10336 | 11035 | 11035 | 621153 | {"200":7,"409":88} |
| save-reward | 74 | 4014 | 10985 | 13629 | 13629 | 12728 | {"200":74} |
| org-kind | 43 | 1532 | 3921 | 8869 | 8869 | 31247 | {"200":43} |
| person | 40 | 659 | 4498 | 7392 | 7392 | 1477 | {"200":40} |
| save-month-shared | 31 | 3631 | 7057 | 7398 | 7398 | 14480 | {"200":22,"409":9} |
| save-409 | 29 | 0 | 0 | 0 | 0 | 0 | {"409":29} |
| save-people-shared | 27 | 3685 | 8470 | 9004 | 9004 | 1542 | {"200":21,"409":6} |
| save-notices | 24 | 1352 | 4234 | 4723 | 4723 | 166 | {"200":12,"409":12} |
| save-kpi-master-shared | 21 | 2129 | 9992 | 12448 | 12448 | 420 | {"200":18,"409":3} |
| save-reward-shared | 21 | 3253 | 7103 | 8545 | 8545 | 13178 | {"200":19,"409":2} |
| save-cell-shared | 19 | 3298 | 16799 | 16799 | 16799 | 618 | {"200":14,"409":5} |
| raw-company | 14 | 161 | 712 | 712 | 712 | 343362 | {"200":14} |
| save-target-history | 6 | 2743 | 11875 | 11875 | 11875 | 531 | {"200":6} |
| save-people | 4 | 3487 | 5514 | 5514 | 5514 | 1587 | {"200":4} |
| raw-replay | 1 | 514 | 514 | 514 | 514 | 1542209 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 538 | 54461 | 101.23 | 2152 | select book, snapshot_json, content_hash from company_books |
| 723 | 43399 | 60.03 | 131586 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 948 | 31333 | 33.05 | 125136 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 736 | 21469 | 29.17 | 736 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 20809 | 8693 | 0.42 | 52441 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 117 | 8312 | 71.05 | 117 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 918 | 1843 | 2.01 | 165240 | select id, payload, rev from people where deleted_at is null |
| 7392 | 1459 | 0.2 | 7392 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 15 | 942 | 62.81 | 3600 | select person_id, period, payload from month_records where deleted_at is null |
| 54 | 935 | 17.32 | 97047 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 4165 | 586 | 0.14 | 4165 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 15 | 569 | 37.93 | 2700 | select person_id, period, payload from reward_records where deleted_at is null |
| 496 | 290 | 0.58 | 496 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 23639 | 244 | 0.01 | 23639 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 362 | 184 | 0.51 | 362 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
