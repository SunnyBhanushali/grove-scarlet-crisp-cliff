# Load run before-u250

250 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T17:20:51.746Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 0 |  |  |  |  |
|   employee (own filtered company) | 0 |  |  |  |  |
|   editor (whole company) | 0 |  |  |  |  |
| company load (ms) | 143 | 8596 | 60000 | 60001 | 60002 |
| tick (ms) | 18379 | 7370 | 69998 | 80672 | 97333 |
| save (ms) | 376 | 16369 | 65411 | 86338 | 91205 |
| others see a save (ms) | 3056 | 0 | 17189 | 92909 | 132349 |
| server CPU % of one core (1 s samples) | 153 | 98.5 | 99.7 | 99.9 | 99.9 |
| Postgres CPU % | 176 | 23 | 48 | 55 | 67 |

errors 577, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 271, others-see < 1 s 0.6806
read-after-write: {"row":{"n":261,"bad":0,"why":{}},"wire":{"n":9,"bad":0,"why":{}},"wire+replay":{"n":9,"bad":0,"why":{}},"row-failed":{"n":4,"bad":4,"why":{"status 0":4}}}
event-loop lag: {"p99Max":2315.3,"max":2315.3,"p50Avg":79}; RSS MB {"n":153,"avg":2339,"p50":2147,"p95":3517,"p99":3767,"max":3879}; pg connections {"max":12,"activeMax":5}; runner loop lag max 8452 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| hint-get | 13304 | 8690 | 34472 | 71347 | 101784 | 11948 | {"0":61,"200":13243} |
| tick | 9231 | 7368 | 69914 | 80699 | 96327 | 1739 | {"0":61,"200":9170} |
| tick-since | 9148 | 7371 | 70089 | 80583 | 97333 | 1122 | {"0":55,"200":9093} |
| changes | 5263 | 2218 | 14553 | 59890 | 93891 | 99774 | {"0":18,"200":5245} |
| static | 1716 | 511 | 14545 | 16029 | 18017 | 136468 | {"200":1716} |
| keepalive-retry | 886 | 0 | 0 | 0 | 0 | 0 | {"0":886} |
| people-list | 504 | 2253 | 21116 | 73468 | 79770 | 116320 | {"0":4,"200":500} |
| rewards-month | 486 | 2223 | 15864 | 72839 | 82156 | 850955 | {"0":1,"200":485} |
| apms-person | 341 | 6667 | 34344 | 78929 | 85156 | 13884 | {"0":4,"200":337} |
| raw-row | 261 | 4249 | 24072 | 36394 | 84018 | 12946 | {"200":261} |
| signin | 250 | 22323 | 60002 | 60006 | 60007 | 283 | {"0":107,"200":143} |
| apms-month | 218 | 6203 | 31310 | 79087 | 83006 | 1142342 | {"200":218} |
| row-read | 215 | 3409 | 79086 | 89114 | 90654 | 11848 | {"0":6,"200":209} |
| save-month | 210 | 15015 | 62452 | 81833 | 88573 | 13690 | {"0":11,"200":179,"409":20} |
| html | 143 | 236 | 1435 | 1793 | 2600 | 4196 | {"200":143} |
| get-session | 143 | 13136 | 60001 | 60002 | 60005 | 339 | {"0":45,"200":98} |
| company | 143 | 8264 | 60000 | 60001 | 60002 | 328867 | {"0":8,"200":135} |
| company-load | 143 | 8596 | 60000 | 60001 | 60002 | 328867 | {"0":8,"200":135} |
| page-open-http | 143 | 58772 | 98560 | 103896 | 107983 | 0 | {"200":143} |
| sse-connect | 143 | 351 | 8749 | 35957 | 36289 | 0 | {"200":143} |
| save-409 | 78 | 0 | 0 | 0 | 0 | 0 | {"409":78} |
| person | 63 | 4144 | 46482 | 70159 | 70159 | 1456 | {"0":1,"200":62} |
| save-reward | 54 | 21437 | 80679 | 89857 | 89857 | 12533 | {"0":3,"200":50,"409":1} |
| org-kind | 52 | 5413 | 68454 | 75113 | 75113 | 24373 | {"200":52} |
| save-month-shared | 43 | 23879 | 37888 | 91205 | 91205 | 14442 | {"200":13,"409":30} |
| save-reward-shared | 18 | 23610 | 77578 | 77578 | 77578 | 13096 | {"200":6,"409":12} |
| save-cell-shared | 16 | 19972 | 69616 | 69616 | 69616 | 518 | {"0":2,"200":6,"409":8} |
| save-notices | 11 | 10977 | 66672 | 66672 | 66672 | 157 | {"0":1,"200":6,"409":4} |
| save-kpi-master-shared | 10 | 17961 | 43445 | 43445 | 43445 | 349 | {"200":4,"409":6} |
| raw-company | 9 | 1481 | 2481 | 2481 | 2481 | 349537 | {"200":9} |
| save-people-shared | 7 | 16437 | 23416 | 23416 | 23416 | 1492 | {"200":6,"409":1} |
| save-people | 4 | 21072 | 29637 | 29637 | 29637 | 1645 | {"200":4} |
| save-target-history | 3 | 10127 | 12311 | 12311 | 12311 | 536 | {"200":3} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 286 | 38648 | 135.13 | 1144 | select book, snapshot_json, content_hash from company_books |
| 450 | 9181 | 20.4 | 59400 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 4970 | 9005 | 1.81 | 41005 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 347 | 6424 | 18.51 | 347 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 177 | 6077 | 34.34 | 32214 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 38 | 2521 | 66.35 | 38 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 6546 | 1765 | 0.27 | 6546 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 5993 | 1363 | 0.23 | 5993 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 457 | 1097 | 2.4 | 82260 | select id, payload, rev from people where deleted_at is null |
| 54 | 737 | 13.66 | 97111 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 27973 | 363 | 0.01 | 27973 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 4 | 224 | 56.09 | 960 | select person_id, period, payload from month_records where deleted_at is null |
| 274 | 178 | 0.65 | 274 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 10244 | 177 | 0.02 | 10244 | select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now() |
| 4 | 161 | 40.35 | 720 | select person_id, period, payload from reward_records where deleted_at is null |
