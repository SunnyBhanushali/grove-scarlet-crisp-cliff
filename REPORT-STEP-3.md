# REPORT-STEP-3

## Status
done

## Zip / preview
- output zip id or filename: `artifacts/apms-step-3.zip` (this conversation). No Drive zip.
- preview URL if any: Grok App Builder live preview (this conversation). No Drive / Contabo URL.
- migration filename (e.g. 0005_hot_rows.sql): `migrations/0005_hot_tables.sql` (unchanged; no new migration)

## Tables created
No new tables this step. Same as Step 2:
- `people` — PK `id`
- `month_records` — PK / unique `(person_id, period)`
- `reward_records` — PK / unique `(person_id, period)`
- `target_cells` — PK `id` (book map key)
- `tombstones` — PK `(field, key)`
- `write_ids` — PK `client_op_id`

Shared columns: `payload jsonb`, `rev int default 1`, `updated_at`, `updated_by`, `deleted_at`. No hard deletes.

## Importer
- command to run it: no CLI. Step 2 `importHotTables(sql, snapshot)` still exists for backfill.
- dual-write: `dualWriteAfterPatch` in `src/lib/company-hot-tables.ts`, called from `patchCompanyBooks` **after** `persistBooks` commits applied books.
- idempotent? write_ids: same `clientOpId` skips (rev unchanged). Payload-equal upsert does not bump rev.
- wired into deploy:migrate? schema yes (0005). importer no. dual-write is on PATCH, not migrate.
- fire-and-forget `fillHotTables` after persist / GET load: **removed**.

## Counts
Source: `src/lib/company-seed.json` via importer tests (re-ran with this drop). Not the live 175-person preview notebook.

| Collection | Books | Rows | Match? |
|------------|------:|-----:|--------|
| people | 180 | 180 | yes (seed importer) |
| records (month_records) | 53 | 53 | yes (seed importer) |
| rewardRecords | 49 | 49 | yes (seed importer) |
| targetCells | 114 | 114 | yes (seed importer) |

Live preview row counts: **untested**. `DATABASE_URL` unset (in-process PGLite). Did not query the Vite process DB; did not run the importer against the live notebook.

## Tests
Re-ran together just now (2026-09-19 ~14:00 IST):

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass (importer + dual-write) |
| PATCH one reward person-month → rev=1; again → rev=2 | pass |
| 409 book apply → row rev unchanged | pass |
| retry same clientOpId → rev unchanged | pass |

Actual summary line: `# tests 83 # pass 83 # fail 0`

## Step 1 locks still held
- fallbackPost gone? yes (0 hits in `apms-sync.js`)
- POST 410? yes in `src/routes/api/company.ts` unless restore flags. This-run unsigned GET/POST = **401** (auth before 410).
- pullLive dirty-skip? yes (tests this run)
- UI keys out of DB? yes (`currentMonth` only in `SESSION_KEYS` / tombstone-skip, not org `BOOK_FIELDS`)
- person-month-conflict? yes (client + SyncBar)
- Lock copy? yes (“Record missing or lost to sync — refresh” in `routes-…-p0ar.js`)

## Known broken / not done
- No Drive output zip (sandbox pack: `artifacts/apms-step-3.zip`)
- Live 175-person notebook was not imported / counted into hot tables
- GET / persist no longer backfills hot tables (`fillHotTables` removed). Rows fill on successful PATCH only (or a manual `importHotTables` call)
- Admin restore POST still writes books only; does not dual-write
- Same-month different-people still share one months `gen` (row-level writes are later)
- Dual-write failure is logged and does not fail PATCH (books stay source of truth)
- `scripts/migration-plan.test.mjs` still assumes no app SQL
- `nitro-preset.test.mjs` vs Grok `vercel` inject
- Step 4 not started
- Not deployed

## HANDOFF
- Step 3 status: done (dual-write after successful book PATCH only)
- Last zip id: none on Drive; sandbox pack `artifacts/apms-step-3.zip`
- LOCKS new this step: dual-write only after book PATCH commits; 409 / auth fail / no commit → zero hot rows; same `clientOpId` does not bump rev; missing PATCH keys are not deletes (tombstones only); books stay source of truth; no entity HTTP APIs; no SPA rewrite
- OPEN still unfinished: Step 4 (not started). 50-VU soak. Contabo cut. Live notebook → hot-table counts.
- ACCEPTANCE: dual-write tests pass; Step 1 suites pass; live notebook counts untested; no Drive zip
- Exact next step: Step 4 only when instructed. Do not start Step 4. Do not rewrite the SPA onto rows. Do not add `/api/people` or `/api/reward-records`. Do not deploy.
