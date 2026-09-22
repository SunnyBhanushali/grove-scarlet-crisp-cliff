# REPORT-STEP-2

## Status
done

## Zip / preview
- output zip id or filename: `artifacts/apms-step-2.zip` (this conversation). No Drive zip. Workspace had no `60zu1HuCrXUTkWbw` zip to unpack; work stayed in the live tree from Step 1.
- preview URL if any: Grok App Builder live preview (this conversation). No Drive / Contabo URL.
- migration filename (e.g. 0005_hot_rows.sql): `migrations/0005_hot_tables.sql`

## Tables created
- `people` — PK `id`
- `month_records` — PK / unique `(person_id, period)`
- `reward_records` — PK / unique `(person_id, period)`
- `target_cells` — PK `id` (book map key)
- `tombstones` — PK `(field, key)`
- `write_ids` — PK `client_op_id`

Shared columns on each: `payload jsonb`, `rev int default 1`, `updated_at`, `updated_by`, `deleted_at`. No hard deletes.

## Importer
- command to run it: no CLI. `importHotTables(sql, snapshot)` in `src/lib/company-hot-tables.ts`. Runtime hook: `fillHotTables` after book persist / live load (fire-and-forget; cannot fail PATCH).
- idempotent? yes (seed re-import this run: same live counts, rev stays 1 when payload unchanged)
- wired into deploy:migrate? schema yes (`deploy:migrate` / `db:migrate` applies `migrations/*.sql` including 0005). importer no — migrate does not run the importer.

## Counts
Source: `src/lib/company-seed.json` via `src/lib/company-hot-tables.test.ts` (re-ran 2026-09-19 13:54 IST). Not the live 175-person preview notebook.

| Collection | Books | Rows | Match? |
|------------|------:|-----:|--------|
| people | 180 | 180 | yes |
| records (month_records) | 53 | 53 | yes |
| rewardRecords | 49 | 49 | yes |
| targetCells | 114 | 114 | yes |

Live preview row counts: untested (did not query PGLite `people` / `month_records` after sign-in).

## Tests
Re-ran together just now (2026-09-19 13:54 IST):

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| importer / migration tests | pass (`src/lib/company-hot-tables.test.ts`) |

Actual summary line: `# tests 80 # pass 80 # fail 0`

## Step 1 locks still held
- fallbackPost gone? yes (`fallbackPost` count 0 in `apms-sync.js`)
- POST 410? yes in `src/routes/api/company.ts` unless restore flags. This-run unsigned POST = **401** (auth before 410).
- pullLive dirty-skip? yes (early-return when `isBlocked`; tests this run)
- UI keys out of DB? yes (`currentMonth` not in org `BOOK_FIELDS`; `SESSION_KEYS` stripped)
- person-month-conflict? yes (client + SyncBar)
- Lock copy? yes (`Nothing open.` absent from `routes-…-p0ar.js`; “Record missing or lost to sync — refresh” present)

## Known broken / not done
- No Drive output zip for this step (sandbox pack: `artifacts/apms-step-2.zip`)
- Importer is not a CLI and is not invoked by `deploy:migrate` (schema is)
- Live 175-person notebook was not counted into hot tables
- Same-month different-people still share one months `gen` (row-level writes are Step 3+)
- `scripts/migration-plan.test.mjs` still assumes no app SQL (0002–0005 exist)
- `nitro-preset.test.mjs` vs Grok `vercel` inject (Contabo uses `build:app`)
- Step 3 dual-write not started
- Not deployed

## HANDOFF
- Step 2 status: done (schema + importer only)
- Last zip id: none on Drive; sandbox pack `artifacts/apms-step-2.zip`. Instructed Step 1 zip `60zu1HuCrXUTkWbw` was not in the workspace.
- LOCKS new this step: hot tables exist; books stay the source of truth until a later step. Do not rewrite the SPA onto rows. Do not add client entity PATCH. Do not stop writing books.
- OPEN still unfinished: Step 3 dual-write (books still canonical; fill hot tables on PATCH). 50-VU soak. Contabo cut.
- ACCEPTANCE: seed importer match pass; Step 1 suites pass; live notebook counts untested; no Drive zip
- Exact next step (must be Step 3 dual-write only): on successful book PATCH, upsert the corresponding hot rows (`people` / `month_records` / `reward_records` / `target_cells` / `tombstones` / `write_ids`) without changing the SPA or replacing books as source of truth. Do not add client entity PATCH. Do not deploy.
