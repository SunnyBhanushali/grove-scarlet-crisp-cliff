# Load run before-u50

50 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T16:10:05.807Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 24 | 5070 | 7522 | 8246 | 8246 |
| company load (ms) | 50 | 299 | 884 | 1017 | 1017 |
| tick (ms) | 7711 | 438 | 1022 | 2715 | 5899 |
| save (ms) | 343 | 1445 | 3465 | 3814 | 4198 |
| others see a save (ms) | 6118 | 0 | 680 | 1074 | 11600 |
| server CPU % of one core (1 s samples) | 167 | 96.3 | 98.8 | 99.4 | 99.6 |
| Postgres CPU % | 172 | 40 | 63 | 68 | 76 |

errors 3, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 284, others-see < 1 s 0.9848
read-after-write: {"row":{"n":284,"bad":0,"why":{}},"wire":{"n":37,"bad":11,"why":{}},"wire+replay":{"n":37,"bad":0,"why":{}}}
event-loop lag: {"p99Max":608.7,"max":608.7,"p50Avg":19}; RSS MB {"n":167,"avg":944,"p50":949,"p95":1081,"p99":1146,"max":1158}; pg connections {"max":13,"activeMax":8}; runner loop lag max 2682 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| changes | 17890 | 366 | 1091 | 1522 | 5581 | 4984 | {"200":17890} |
| tick | 3866 | 436 | 1022 | 2715 | 5570 | 1596 | {"200":3866} |
| tick-since | 3845 | 441 | 1022 | 2715 | 5899 | 122 | {"200":3845} |
| people-list | 731 | 325 | 1020 | 1397 | 2715 | 117590 | {"200":731} |
| static | 600 | 253 | 5221 | 5586 | 5743 | 136468 | {"200":600} |
| rewards-month | 573 | 371 | 998 | 1883 | 5441 | 853351 | {"200":573} |
| apms-person | 527 | 321 | 1274 | 1915 | 2715 | 14274 | {"200":527} |
| apms-month | 462 | 503 | 1157 | 1639 | 5891 | 1142233 | {"200":462} |
| raw-row | 284 | 364 | 941 | 1653 | 1795 | 7009 | {"200":284} |
| row-read | 202 | 341 | 914 | 1699 | 2717 | 6422 | {"200":202} |
| save-month | 73 | 1739 | 3566 | 3781 | 3781 | 14831 | {"200":73} |
| save-target-history | 66 | 1201 | 3280 | 3814 | 3814 | 528 | {"200":66} |
| keepalive-retry | 65 | 0 | 0 | 0 | 0 | 0 | {"0":65} |
| save-notices | 56 | 673 | 2866 | 3637 | 3637 | 165 | {"200":28,"409":28} |
| save-reward | 55 | 1629 | 3397 | 3943 | 3943 | 8998 | {"200":55} |
| signin | 50 | 1824 | 6431 | 6451 | 6451 | 487 | {"200":50} |
| html | 50 | 224 | 983 | 1122 | 1122 | 4196 | {"200":50} |
| get-session | 50 | 1048 | 2614 | 2614 | 2614 | 487 | {"200":50} |
| company | 50 | 273 | 854 | 986 | 986 | 348258 | {"200":50} |
| company-load | 50 | 299 | 884 | 1017 | 1017 | 348258 | {"200":50} |
| page-open-http | 50 | 4465 | 8152 | 8192 | 8192 | 0 | {"200":50} |
| sse-connect | 50 | 110 | 362 | 684 | 684 | 0 | {"200":50} |
| raw-company | 37 | 71 | 824 | 896 | 896 | 354618 | {"200":37} |
| save-people | 33 | 1292 | 3511 | 3670 | 3670 | 1634 | {"200":33} |
| person | 31 | 422 | 909 | 2060 | 2060 | 1563 | {"200":31} |
| org-kind | 23 | 794 | 1554 | 1912 | 1912 | 19049 | {"200":23} |
| save-people-shared | 16 | 1936 | 4158 | 4158 | 4158 | 1540 | {"200":15,"409":1} |
| save-month-shared | 15 | 1207 | 4198 | 4198 | 4198 | 14478 | {"200":15} |
| save-kpi-master-shared | 13 | 1584 | 2529 | 2529 | 2529 | 425 | {"200":12,"409":1} |
| raw-replay | 11 | 331 | 774 | 774 | 774 | 228827 | {"200":11} |
| save-cell-shared | 9 | 1926 | 3634 | 3634 | 3634 | 635 | {"200":8,"409":1} |
| save-reward-shared | 7 | 1714 | 3581 | 3581 | 3581 | 13140 | {"200":7} |
| save-409 | 3 | 0 | 0 | 0 | 0 | 0 | {"409":3} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 677 | 79071 | 116.8 | 2708 | select book, snapshot_json, content_hash from company_books |
| 615 | 36056 | 58.63 | 615 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 442 | 34936 | 79.04 | 80444 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 564 | 23865 | 42.31 | 74448 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 194 | 13047 | 67.25 | 194 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 36 | 2889 | 80.26 | 8640 | select person_id, period, payload from month_records where deleted_at is null |
| 17671 | 2422 | 0.14 | 14715 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 36 | 1826 | 50.73 | 6480 | select person_id, period, payload from reward_records where deleted_at is null |
| 681 | 1729 | 2.54 | 122580 | select id, payload, rev from people where deleted_at is null |
| 54 | 1002 | 18.56 | 97042 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 819 | 312 | 0.38 | 819 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 12408 | 186 | 0.01 | 12408 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 10096 | 149 | 0.01 | 10096 | select max(seq) as seq from entity_log |
| 492 | 86 | 0.18 | 492 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 36 | 73 | 2.03 | 6480 | select id, payload from people where deleted_at is null |
