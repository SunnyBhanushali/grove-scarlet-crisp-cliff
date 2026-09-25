# Load run after-u100

100 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T23:13:33.151Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 24 | 2527 | 3891 | 6123 | 6123 |
|   employee (own filtered company) | 16 | 2233 | 3740 | 3740 | 3740 |
|   editor (whole company) | 8 | 3525 | 6123 | 6123 | 6123 |
| company load (ms) | 100 | 30 | 151 | 189 | 189 |
| tick (ms) | 4048 | 1 | 50 | 114 | 583 |
| save (ms) | 717 | 10 | 95 | 244 | 588 |
| others see a save (ms) | 5860 | 44 | 126 | 311 | 697 |
| server CPU % of one core (1 s samples) | 180 | 17.8 | 39.9 | 59.2 | 65.9 |
| Postgres CPU % | 179 | 5 | 17 | 22 | 25 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 662, others-see < 1 s 1
read-after-write: {"row":{"n":662,"bad":0,"why":{}},"wire":{"n":19,"bad":1,"why":{"status 0":1}},"wire+replay":{"n":18,"bad":0,"why":{}}}
event-loop lag: {"p99Max":164.2,"max":164.2,"p50Avg":10.1}; RSS MB {"n":180,"avg":635,"p50":638,"p95":713,"p99":728,"max":734}; pg connections {"max":13,"activeMax":2}; runner loop lag max 521 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| pushed-page | 57272 | 0 | 0 | 0 | 0 | 0 | {"200":57272} |
| tick-since | 2051 | 1 | 50 | 114 | 583 | 103 | {"200":2051} |
| tick | 1997 | 1 | 50 | 114 | 508 | 711 | {"200":1997} |
| static | 1200 | 5 | 26 | 122 | 133 | 138782 | {"200":1200} |
| raw-row | 662 | 2 | 47 | 107 | 358 | 12210 | {"200":662} |
| changes | 567 | 3 | 61 | 193 | 358 | 3389 | {"200":567} |
| save-month | 408 | 11 | 84 | 244 | 588 | 14319 | {"200":400,"409":8} |
| row-read | 251 | 3 | 62 | 97 | 468 | 10175 | {"200":251} |
| apms-person | 167 | 3 | 47 | 205 | 360 | 14035 | {"200":167} |
| people-list | 157 | 7 | 61 | 178 | 279 | 12624 | {"200":157} |
| rewards-month | 141 | 18 | 59 | 123 | 142 | 9124 | {"200":141} |
| save-reward | 114 | 10 | 112 | 158 | 275 | 12621 | {"200":112,"409":2} |
| signin | 100 | 11 | 34 | 153 | 153 | 492 | {"200":100} |
| html | 100 | 2 | 20 | 26 | 26 | 4196 | {"200":100} |
| get-session | 100 | 1 | 8 | 58 | 58 | 492 | {"200":100} |
| company | 100 | 23 | 124 | 163 | 163 | 199821 | {"200":100} |
| company-load | 100 | 30 | 151 | 189 | 189 | 199821 | {"200":100} |
| page-open-http | 100 | 81 | 266 | 308 | 308 | 0 | {"200":100} |
| sse-connect | 100 | 1 | 6 | 9 | 9 | 0 | {"200":100} |
| apms-month | 89 | 29 | 59 | 160 | 160 | 16031 | {"200":89} |
| book-patch | 75 | 143 | 399 | 702 | 702 | 170 | {"200":75} |
| hint-get | 72 | 3 | 44 | 84 | 84 | 1983 | {"200":72} |
| org-kind | 55 | 16 | 217 | 287 | 287 | 26054 | {"200":55} |
| save-notices | 44 | 8 | 85 | 284 | 284 | 165 | {"200":22,"409":22} |
| person | 41 | 2 | 32 | 105 | 105 | 1469 | {"200":41} |
| save-month-shared | 41 | 10 | 48 | 167 | 167 | 14527 | {"200":41} |
| save-people-shared | 27 | 8 | 58 | 283 | 283 | 1565 | {"200":27} |
| save-kpi-master-shared | 25 | 8 | 102 | 116 | 116 | 439 | {"200":24,"409":1} |
| save-reward-shared | 23 | 9 | 126 | 142 | 142 | 13181 | {"200":23} |
| raw-company | 18 | 43 | 322 | 322 | 322 | 221850 | {"200":18} |
| save-people | 13 | 7 | 19 | 19 | 19 | 1674 | {"200":13} |
| save-target-history | 12 | 11 | 30 | 30 | 30 | 530 | {"200":12} |
| save-409 | 11 | 0 | 0 | 0 | 0 | 0 | {"409":11} |
| save-cell-shared | 10 | 8 | 31 | 31 | 31 | 629 | {"200":10} |
| keepalive-retry | 4 | 0 | 0 | 0 | 0 | 0 | {"0":4} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 124 | 4035 | 32.54 | 124 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 969 | 1987 | 2.05 | 16894 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 71 | 1477 | 20.8 | 12922 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 114 | 1305 | 11.44 | 15048 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 1861 | 369 | 0.2 | 1861 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 22 | 316 | 14.38 | 22 | select book, snapshot_json, content_hash from company_books where book = any($1) |
| 41 | 283 | 6.91 | 73677 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 576 | 214 | 0.37 | 576 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 111 | 204 | 1.84 | 19980 | select id, jsonb_build_object( $1, id, $2, payload->$3, $4, payload->$5, $6, payload->$7, $8, payload->$9, $10, payload->$11, $12, payload->$13, $14, payload->$ |
| 111 | 176 | 1.58 | 19980 | select id, payload, rev from people where deleted_at is null |
| 404 | 173 | 0.43 | 404 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 573 | 105 | 0.18 | 573 | select payload, rev, deleted_at from reward_records where person_id = $1 and period = $2 |
| 65 | 79 | 1.22 | 25955 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind = any($1::text[]) order by updated_at asc, id asc |
| 124 | 47 | 0.38 | 124 | insert into reward_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (pers |
| 721 | 39 | 0.05 | 721 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
