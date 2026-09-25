# Load run before-u250

250 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-25T00:58:59.351Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 12 | 11619 | 25974 | 25974 | 25974 |
|   employee (own filtered company) | 8 | 11619 | 25570 | 25570 | 25570 |
|   editor (whole company) | 4 | 16071 | 25974 | 25974 | 25974 |
| company load (ms) | 250 | 19218 | 33471 | 48366 | 48611 |
| tick (ms) | 21128 | 17527 | 72960 | 91311 | 104380 |
| save (ms) | 333 | 28429 | 60939 | 100994 | 108796 |
| others see a save (ms) | 5026 | 1000 | 28166 | 46769 | 135616 |
| server CPU % of one core (1 s samples) | 162 | 98.9 | 99.8 | 99.9 | 99.9 |
| Postgres CPU % | 175 | 24 | 44 | 49 | 60 |

errors 161, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 233, others-see < 1 s 0.5
read-after-write: {"row":{"n":198,"bad":0,"why":{}},"wire":{"n":8,"bad":0,"why":{}},"wire+replay":{"n":8,"bad":0,"why":{}},"row-failed":{"n":8,"bad":8,"why":{"status 0":8}}}
event-loop lag: {"p99Max":1562.4,"max":1562.4,"p50Avg":26.1}; RSS MB {"n":162,"avg":1929,"p50":1713,"p95":2617,"p99":2760,"max":2835}; pg connections {"max":12,"activeMax":4}; runner loop lag max 11702 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| hint-get | 19401 | 23018 | 58356 | 68967 | 91198 | 11099 | {"0":1,"200":19400} |
| tick | 10643 | 17443 | 72783 | 90976 | 104365 | 1654 | {"0":1,"200":10642} |
| tick-since | 10485 | 17609 | 73024 | 91883 | 104380 | 1440 | {"200":10485} |
| static | 3000 | 214 | 3389 | 6433 | 6788 | 136468 | {"200":3000} |
| changes | 2795 | 6938 | 40813 | 71166 | 93064 | 242306 | {"0":3,"200":2792} |
| keepalive-retry | 1589 | 0 | 0 | 0 | 0 | 0 | {"0":1589} |
| people-list | 325 | 8503 | 38590 | 76486 | 101397 | 117246 | {"200":325} |
| row-read | 297 | 9900 | 90349 | 105419 | 105849 | 11704 | {"0":8,"200":289} |
| rewards-month | 282 | 7463 | 39219 | 79044 | 93953 | 852758 | {"200":282} |
| signin | 250 | 32493 | 49389 | 49987 | 50396 | 496 | {"200":250} |
| html | 250 | 77 | 1708 | 2492 | 2649 | 4196 | {"200":250} |
| get-session | 250 | 20158 | 34971 | 38635 | 39274 | 496 | {"200":250} |
| company | 250 | 18834 | 33407 | 48337 | 48419 | 348266 | {"200":250} |
| company-load | 250 | 19218 | 33471 | 48366 | 48611 | 348266 | {"200":250} |
| page-open-http | 250 | 54361 | 93463 | 95579 | 98739 | 0 | {"200":250} |
| sse-connect | 250 | 422 | 18524 | 32663 | 33650 | 0 | {"200":250} |
| apms-person | 212 | 13742 | 59045 | 82752 | 94990 | 13573 | {"0":2,"200":210} |
| save-month | 202 | 27421 | 58989 | 94786 | 108796 | 14468 | {"0":1,"200":161,"409":40} |
| raw-row | 198 | 15345 | 54631 | 64440 | 68186 | 12611 | {"200":198} |
| apms-month | 172 | 13593 | 52827 | 81170 | 96536 | 1142137 | {"200":172} |
| save-409 | 93 | 0 | 0 | 0 | 0 | 0 | {"409":93} |
| org-kind | 82 | 14488 | 59109 | 84158 | 84158 | 26122 | {"200":82} |
| person | 62 | 11991 | 65452 | 90487 | 90487 | 1488 | {"0":1,"200":61} |
| save-reward | 49 | 25705 | 65674 | 105304 | 105304 | 11102 | {"0":1,"200":46,"409":2} |
| save-month-shared | 20 | 37034 | 100994 | 100994 | 100994 | 14428 | {"200":7,"409":13} |
| save-reward-shared | 15 | 36048 | 65684 | 65684 | 65684 | 13067 | {"200":3,"409":12} |
| save-cell-shared | 13 | 40039 | 67828 | 67828 | 67828 | 569 | {"200":3,"409":10} |
| save-kpi-master-shared | 13 | 27925 | 62932 | 62932 | 62932 | 350 | {"200":4,"409":9} |
| book-patch | 11 | 36897 | 52843 | 52843 | 52843 | 609616 | {"200":1,"409":10} |
| save-people-shared | 10 | 36359 | 45642 | 45642 | 45642 | 1455 | {"200":3,"409":7} |
| raw-company | 8 | 11409 | 33767 | 33767 | 33767 | 350389 | {"200":8} |
| save-notices | 5 | 28331 | 66643 | 66643 | 66643 | 153 | {"0":1,"200":3,"409":1} |
| save-people | 3 | 29303 | 32876 | 32876 | 32876 | 1741 | {"200":3} |
| save-target-history | 3 | 22250 | 27170 | 27170 | 27170 | 507 | {"200":3} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 362 | 38732 | 107 | 1448 | select book, snapshot_json, content_hash from company_books |
| 2752 | 9893 | 3.59 | 56631 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 161 | 5714 | 35.49 | 29302 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 266 | 4550 | 17.11 | 35112 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 280 | 4406 | 15.74 | 280 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 8579 | 1778 | 0.21 | 8579 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 9589 | 1574 | 0.16 | 9589 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 27 | 1487 | 55.07 | 27 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 81 | 807 | 9.96 | 145685 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 324 | 632 | 1.95 | 58320 | select id, payload, rev from people where deleted_at is null |
| 66937 | 543 | 0.01 | 16990 | select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now() |
| 36925 | 342 | 0.01 | 36925 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 240 | 145 | 0.6 | 240 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 191 | 122 | 0.64 | 191 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 3 | 116 | 38.55 | 720 | select person_id, period, payload from month_records where deleted_at is null |
