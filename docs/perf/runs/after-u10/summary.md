# Load run after-u10

10 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T23:05:42.245Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 26 | 2446 | 3412 | 3435 | 3435 |
|   employee (own filtered company) | 18 | 2304 | 2570 | 2570 | 2570 |
|   editor (whole company) | 8 | 3262 | 3435 | 3435 | 3435 |
| company load (ms) | 10 | 33 | 44 | 44 | 44 |
| tick (ms) | 381 | 2 | 11 | 60 | 90 |
| save (ms) | 65 | 13 | 51 | 161 | 161 |
| others see a save (ms) | 116 | 42 | 190 | 500 | 515 |
| server CPU % of one core (1 s samples) | 180 | 3 | 21.2 | 27.1 | 27.5 |
| Postgres CPU % | 180 | 1 | 12 | 14 | 14 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 65, others-see < 1 s 1
read-after-write: {"row":{"n":65,"bad":0,"why":{}},"wire":{"n":7,"bad":0,"why":{}},"wire+replay":{"n":7,"bad":0,"why":{}}}
event-loop lag: {"p99Max":74.1,"max":191,"p50Avg":10.1}; RSS MB {"n":180,"avg":352,"p50":352,"p95":380,"p99":387,"max":390}; pg connections {"max":10,"activeMax":1}; runner loop lag max 477 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| pushed-page | 643 | 0 | 0 | 0 | 0 | 0 | {"200":643} |
| tick-since | 192 | 2 | 9 | 68 | 90 | 97 | {"200":192} |
| tick | 189 | 2 | 12 | 60 | 77 | 553 | {"200":189} |
| static | 120 | 4 | 13 | 14 | 15 | 138782 | {"200":120} |
| raw-row | 65 | 2 | 43 | 179 | 179 | 13714 | {"200":65} |
| save-month | 53 | 13 | 53 | 161 | 161 | 15226 | {"200":53} |
| people-list | 19 | 11 | 45 | 45 | 45 | 12066 | {"200":19} |
| row-read | 19 | 3 | 9 | 9 | 9 | 11820 | {"200":19} |
| apms-person | 17 | 3 | 6 | 6 | 6 | 14258 | {"200":17} |
| changes | 15 | 5 | 175 | 175 | 175 | 341 | {"200":15} |
| rewards-month | 13 | 18 | 45 | 45 | 45 | 7491 | {"200":13} |
| signin | 10 | 12 | 19 | 19 | 19 | 481 | {"200":10} |
| html | 10 | 1 | 2 | 2 | 2 | 4196 | {"200":10} |
| get-session | 10 | 2 | 5 | 5 | 5 | 481 | {"200":10} |
| company | 10 | 26 | 36 | 36 | 36 | 182918 | {"200":10} |
| company-load | 10 | 33 | 44 | 44 | 44 | 182918 | {"200":10} |
| page-open-http | 10 | 66 | 145 | 145 | 145 | 0 | {"200":10} |
| sse-connect | 10 | 2 | 17 | 17 | 17 | 0 | {"200":10} |
| person | 9 | 3 | 35 | 35 | 35 | 1328 | {"200":9} |
| raw-company | 7 | 32 | 313 | 313 | 313 | 171449 | {"200":7} |
| apms-month | 7 | 34 | 53 | 53 | 53 | 18070 | {"200":7} |
| book-patch | 6 | 142 | 181 | 181 | 181 | 170 | {"200":6} |
| save-month-shared | 4 | 11 | 21 | 21 | 21 | 14444 | {"200":4} |
| save-kpi-master-shared | 3 | 11 | 13 | 13 | 13 | 367 | {"200":3} |
| org-kind | 2 | 21 | 21 | 21 | 21 | 48758 | {"200":2} |
| save-people-shared | 2 | 11 | 11 | 11 | 11 | 1474 | {"200":2} |
| save-reward-shared | 2 | 14 | 14 | 14 | 14 | 13095 | {"200":2} |
| save-target-history | 1 | 31 | 31 | 31 | 31 | 518 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 32 | 2502 | 78.2 | 32 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 86 | 179 | 2.08 | 15480 | select id, jsonb_build_object( $1, id, $2, payload->$3, $4, payload->$5, $6, payload->$7, $8, payload->$9, $10, payload->$11, $12, payload->$13, $14, payload->$ |
| 7 | 161 | 22.96 | 1274 | select person_id, payload, rev from month_records where deleted_at is null and period = $1 |
| 11 | 115 | 10.45 | 1452 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 245 | 54 | 0.22 | 245 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 94 | 42 | 0.45 | 78 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 18 | 32 | 1.8 | 3240 | select id, payload, rev from people where deleted_at is null |
| 55 | 29 | 0.52 | 55 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 59 | 27 | 0.46 | 59 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
| 12 | 21 | 1.73 | 2160 | select id, payload from people where deleted_at is null |
| 2 | 14 | 6.76 | 3594 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 253 | 8 | 0.03 | 253 | select kind, id, k1, k2, payload, rev, deleted_at, updated_at from entities where kind = $1 and id = $2 |
| 86 | 7 | 0.08 | 1204 | select kind, payload from entities where kind in ($1, $2, $3) and deleted_at is null |
| 37 | 6 | 0.16 | 37 | select count(*)::int n, count(*) filter (where state = $2)::int active from pg_stat_activity where datname = $1 |
| 6 | 6 | 0.93 | 2085 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind = any($1::text[]) order by updated_at asc, id asc |
