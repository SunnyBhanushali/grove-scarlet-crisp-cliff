# Load run before-u250

250 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T16:25:00.347Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 10 | 18137 | 25847 | 25847 | 25847 |
| company load (ms) | 239 | 8712 | 39939 | 40602 | 40772 |
| tick (ms) | 28998 | 7562 | 61458 | 72803 | 84743 |
| save (ms) | 487 | 23658 | 61513 | 77795 | 84678 |
| others see a save (ms) | 7329 | 0 | 30420 | 102732 | 129522 |
| server CPU % of one core (1 s samples) | 162 | 98.6 | 99.7 | 99.9 | 100 |
| Postgres CPU % | 178 | 25 | 50 | 55 | 72 |

errors 239, lost saves 0, resurrected deletes 0, bad delete replies 2, saves acked 310, others-see < 1 s 0.772
read-after-write: {"row":{"n":298,"bad":0,"why":{}},"wire":{"n":13,"bad":3,"why":{}},"wire+replay":{"n":13,"bad":0,"why":{}},"row-failed":{"n":8,"bad":8,"why":{"status 0":8}}}
event-loop lag: {"p99Max":1711.3,"max":1711.3,"p50Avg":70.8}; RSS MB {"n":162,"avg":1818,"p50":1711,"p95":2512,"p99":2668,"max":2693}; pg connections {"max":12,"activeMax":8}; runner loop lag max 6392 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| tick | 14565 | 7561 | 61488 | 73132 | 82279 | 1620 | {"0":2,"200":14563} |
| tick-since | 14433 | 7566 | 61365 | 72489 | 84743 | 1244 | {"0":2,"200":14431} |
| changes | 5954 | 4133 | 18839 | 56361 | 76059 | 100888 | {"0":3,"200":5951} |
| static | 2868 | 438 | 12843 | 17925 | 19845 | 136468 | {"200":2868} |
| keepalive-retry | 1513 | 0 | 0 | 0 | 0 | 0 | {"0":1513} |
| rewards-month | 787 | 4171 | 24859 | 60654 | 77173 | 853299 | {"200":787} |
| apms-person | 655 | 5475 | 31688 | 70030 | 87155 | 13916 | {"0":11,"200":644} |
| people-list | 526 | 4737 | 28121 | 61373 | 74475 | 117805 | {"200":526} |
| row-read | 417 | 4886 | 70175 | 85503 | 97148 | 7411 | {"0":6,"200":411} |
| apms-month | 413 | 4802 | 23498 | 56610 | 72857 | 1141958 | {"200":413} |
| raw-row | 299 | 6915 | 28363 | 69918 | 75118 | 7405 | {"0":1,"200":298} |
| signin | 250 | 18462 | 59959 | 60001 | 60002 | 472 | {"0":11,"200":239} |
| html | 239 | 300 | 1159 | 2289 | 2788 | 4196 | {"200":239} |
| get-session | 239 | 13796 | 40386 | 42989 | 43006 | 494 | {"200":239} |
| company | 239 | 8647 | 39859 | 40509 | 40747 | 348671 | {"200":239} |
| company-load | 239 | 8712 | 39939 | 40602 | 40772 | 348671 | {"200":239} |
| page-open-http | 239 | 33051 | 81452 | 84631 | 85962 | 0 | {"200":239} |
| sse-connect | 239 | 3377 | 14948 | 31634 | 31770 | 0 | {"200":239} |
| save-month | 110 | 23964 | 60361 | 67964 | 72864 | 13207 | {"0":7,"200":93,"409":10} |
| save-notices | 95 | 17306 | 60002 | 82438 | 82438 | 172 | {"0":1,"200":53,"409":41} |
| org-kind | 91 | 10129 | 61309 | 72395 | 72395 | 34251 | {"200":91} |
| save-target-history | 90 | 20734 | 57171 | 64446 | 64446 | 517 | {"0":2,"200":88} |
| person | 87 | 7872 | 69854 | 81311 | 81311 | 1499 | {"0":4,"200":83} |
| save-reward | 71 | 23658 | 55906 | 66330 | 66330 | 10290 | {"0":2,"200":68,"409":1} |
| save-409 | 60 | 0 | 0 | 0 | 0 | 0 | {"409":60} |
| save-people | 49 | 27187 | 64871 | 76518 | 76518 | 1587 | {"0":3,"200":41,"409":5} |
| save-month-shared | 22 | 40946 | 78438 | 84678 | 84678 | 13779 | {"0":1,"200":7,"409":14} |
| save-kpi-master-shared | 16 | 54518 | 77795 | 77795 | 77795 | 347 | {"0":1,"200":3,"409":12} |
| save-reward-shared | 13 | 49894 | 75048 | 75048 | 75048 | 12106 | {"0":1,"200":5,"409":7} |
| save-people-shared | 13 | 60000 | 72508 | 72508 | 72508 | 907 | {"0":5,"200":2,"409":6} |
| raw-company | 13 | 2968 | 17840 | 17840 | 17840 | 350691 | {"200":13} |
| save-cell-shared | 8 | 36030 | 38457 | 38457 | 38457 | 596 | {"200":3,"409":5} |
| raw-replay | 3 | 5077 | 18470 | 18470 | 18470 | 1166797 | {"200":3} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 450 | 51874 | 115.28 | 1800 | select book, snapshot_json, content_hash from company_books |
| 401 | 14279 | 35.61 | 72982 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 686 | 13580 | 19.8 | 90552 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 5550 | 11268 | 2.03 | 101214 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 512 | 8629 | 16.85 | 512 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 47 | 2369 | 50.41 | 47 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 100 | 1405 | 14.05 | 180286 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 539 | 1264 | 2.34 | 97020 | select id, payload, rev from people where deleted_at is null |
| 45801 | 520 | 0.01 | 45801 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 6 | 468 | 77.95 | 1440 | select person_id, period, payload from month_records where deleted_at is null |
| 6 | 326 | 54.36 | 1080 | select person_id, period, payload from reward_records where deleted_at is null |
| 1125 | 306 | 0.27 | 1125 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 17267 | 266 | 0.02 | 17267 | select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now() |
| 262 | 115 | 0.44 | 262 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 442 | 86 | 0.2 | 442 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
