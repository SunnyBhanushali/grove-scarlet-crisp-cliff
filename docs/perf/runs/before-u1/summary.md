# Load run before-u1

1 simulated users, 180s steady window, server on CPU 0, Postgres on CPU 1. 2026-09-24T17:02:07.331Z

| metric | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| page open (browser reload, ms) | 25 | 3547 | 3786 | 3850 | 3850 |
|   employee (own filtered company) | 17 | 3411 | 3740 | 3740 | 3740 |
|   editor (whole company) | 8 | 3717 | 3850 | 3850 | 3850 |
| company load (ms) | 1 | 41 | 41 | 41 | 41 |
| tick (ms) | 158 | 3 | 14 | 129 | 232 |
| save (ms) | 6 | 26 | 77 | 77 | 77 |
| others see a save (ms) | 0 |  |  |  |  |
| server CPU % of one core (1 s samples) | 179 | 2.1 | 36.1 | 74.3 | 76.3 |
| Postgres CPU % | 179 | 0 | 6 | 29 | 37 |

errors 0, lost saves 0, resurrected deletes 0, bad delete replies 0, saves acked 6, others-see < 1 s null
read-after-write: {"row":{"n":6,"bad":0,"why":{}}}
event-loop lag: {"p99Max":415.2,"max":415.2,"p50Avg":10.1}; RSS MB {"n":179,"avg":329,"p50":315,"p95":434,"p99":436,"max":436}; pg connections {"max":8,"activeMax":1}; runner loop lag max 302 ms

| route | n | p50 | p95 | p99 | max | avg bytes | status |
|---|---|---|---|---|---|---|---|
| tick | 79 | 3 | 74 | 129 | 129 | 161 | {"200":79} |
| tick-since | 79 | 3 | 10 | 232 | 232 | 84 | {"200":79} |
| people-list | 38 | 7 | 99 | 124 | 124 | 117224 | {"200":38} |
| apms-person | 29 | 3 | 8 | 49 | 49 | 11789 | {"200":29} |
| rewards-month | 24 | 23 | 34 | 36 | 36 | 852333 | {"200":24} |
| changes | 19 | 27 | 276 | 276 | 276 | 3789 | {"200":19} |
| static | 12 | 10 | 16 | 16 | 16 | 136468 | {"200":12} |
| save-month | 6 | 26 | 77 | 77 | 77 | 11851 | {"200":6} |
| raw-row | 6 | 15 | 231 | 231 | 231 | 11789 | {"200":6} |
| signin | 1 | 288 | 288 | 288 | 288 | 480 | {"200":1} |
| html | 1 | 2 | 2 | 2 | 2 | 4196 | {"200":1} |
| get-session | 1 | 162 | 162 | 162 | 162 | 480 | {"200":1} |
| company | 1 | 18 | 18 | 18 | 18 | 320798 | {"200":1} |
| company-load | 1 | 41 | 41 | 41 | 41 | 320798 | {"200":1} |
| page-open-http | 1 | 298 | 298 | 298 | 298 | 0 | {"200":1} |
| sse-connect | 1 | 9 | 9 | 9 | 9 | 0 | {"200":1} |
| row-read | 1 | 9 | 9 | 9 | 9 | 11775 | {"200":1} |
| hint-get | 1 | 2 | 2 | 2 | 2 | 11789 | {"200":1} |
| org-kind | 1 | 145 | 145 | 145 | 145 | 298 | {"200":1} |

Top Postgres statements (steady window):

| calls | total ms | mean ms | rows | query |
|---|---|---|---|---|
| 54 | 2038 | 37.74 | 216 | select book, snapshot_json, content_hash from company_books |
| 16 | 606 | 37.87 | 16 | insert into company_notebook (id, snapshot_json, updated_at) values ($1, $2, now()) on conflict (id) do update set snapshot_json = excluded.snapshot_json, updat |
| 5 | 513 | 102.63 | 5 | insert into company_books (book, snapshot_json, content_hash, updated_at) values ($1, $2, $3, now()) on conflict (book) do update set snapshot_json = excluded.s |
| 24 | 287 | 11.96 | 3168 | select person_id, payload, rev from reward_records where deleted_at is null and period = $1 |
| 29 | 49 | 1.7 | 5220 | select id, payload, rev from people where deleted_at is null |
| 104 | 29 | 0.28 | 21 | with c as ( select seq, kind, id, k1, k2, rev, deleted, at, payload as log_payload from entity_log where seq > $1 order by seq asc limit $2 ), latest as ( selec |
| 787 | 20 | 0.03 | 787 | select snapshot_json from company_notebook where id = $1 limit $2 |
| 45 | 10 | 0.22 | 45 | select payload, rev, deleted_at from month_records where person_id = $1 and period = $2 |
| 1 | 6 | 6.26 | 1797 | select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc |
| 37 | 4 | 0.12 | 37 | select count(*)::int n, count(*) filter (where state = $2)::int active from pg_stat_activity where datname = $1 |
| 32 | 3 | 0.09 | 5632 | select username, person_id, password from issued_logins |
| 113 | 3 | 0.02 | 113 | select max(seq) as seq from entity_log |
| 5 | 3 | 0.51 | 5 | insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at) values ($1, $2, $3::jsonb, $4, now(), $5, $7) on conflict (perso |
| 86 | 2 | 0.03 | 86 | select person_id, expires_at from apms_sessions where token_hash = $1 and expires_at > now() |
| 5 | 2 | 0.45 | 5 | insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by, payload) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning seq |
