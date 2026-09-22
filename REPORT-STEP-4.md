# REPORT-STEP-4

## Status
done

## Zip / preview
- output zip id or filename: `artifacts/apms-step-4.zip` (this conversation). No Drive zip.
- preview URL if any: Grok App Builder live preview (this conversation). No Drive / Contabo URL.
- migration filename: `migrations/0005_hot_tables.sql` (unchanged; no new migration)

## Routes
Same auth as `/api/company` (anon 401). SPA / hire / Lock / KPI / trash still use book PATCH.

| Method | Path | OCC |
|--------|------|-----|
| GET, PATCH | `/api/people/:id` | `baseRev === stored.rev` |
| GET, PATCH | `/api/month-records/:period/:personId` | same |
| GET, PATCH | `/api/reward-records/:period/:personId` | same |
| GET, PATCH | `/api/target-cells/:id` | same |

PATCH body: `{ payload, baseRev, clientOpId }`. Soft-delete: `{ deleted: true }` sets `deleted_at`. Never hard-delete.
Same `clientOpId` → 200, rev unchanged. Book merge on success; book 409 → row rev unchanged.

## Tables created
No new tables. Same as Step 2: `people`, `month_records`, `reward_records`, `target_cells`, `tombstones` PK `(field, key)`, `write_ids` PK `client_op_id`.

## Importer
- Empty hot tables + books have people → `importHotTables` once on entity GET/PATCH (logged `[hot-tables] empty tables; importHotTables from books`).
- Missing row → hydrate that one slice from the current book, then OCC. Do not 404 the whole company.
- Admin restore POST → `importHotTablesAfterCommit` after snapshot write.
- Dual-write after book PATCH still in place (Step 3). Entity PATCH updates the one row itself (no second dual-write).

## Counts
Seed importer (from Step 2/3 tests, still green): people 180 / records 53 / rewardRecords 49 / targetCells 114.

| Collection | Books | Rows | Match? |
|------------|------:|-----:|--------|
| people | 180 | 180 | yes (seed importer) |
| records (month_records) | 53 | 53 | yes (seed importer) |
| rewardRecords | 49 | 49 | yes (seed importer) |
| targetCells | 114 | 114 | yes (seed importer) |

Live preview row counts: **untested**. `DATABASE_URL` unset (in-process PGLite). Did not query the Vite process DB.

## Tests
Re-ran together just now (2026-09-19 ~15:00 IST):

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| 200 first PATCH rev=1; second rev=2 | pass |
| stale baseRev → 409 + current row | pass |
| same clientOpId → no rev bump | pass |
| anon → 401 | pass (unit + live unsigned GET/PATCH) |

Actual summary line: `# tests 91 # pass 91 # fail 0`

Live unsigned GET/PATCH on all four entity routes this run: **401**.

## Step 1 locks still held
- fallbackPost gone? yes
- POST 410? yes (unsigned still 401 first)
- pullLive dirty-skip? yes
- UI keys out of DB? yes
- person-month-conflict? yes
- Lock copy? yes
- SPA still book PATCH for hire / Lock / KPI / trash? yes (`apms-sync.js` has no entity URLs)

## Known broken / not done
- No Drive output zip (sandbox pack: `artifacts/apms-step-4.zip`)
- Live 175-person notebook hot-table counts untested
- Entity PATCH still 409s if the **book** gen moved (row OCC + book gen). Row-level book writes are later.
- SPA does not call these routes yet (intentional)
- `scripts/migration-plan.test.mjs` still assumes no app SQL
- `nitro-preset.test.mjs` vs Grok `vercel` inject
- Step 5 not started
- Not deployed

## HANDOFF
- Step 4 status: done (entity GET/PATCH with row OCC; books stay source of truth)
- Last zip id: none on Drive; sandbox pack `artifacts/apms-step-4.zip`
- LOCKS new this step: `/api/people/:id`, `/api/month-records/:period/:personId`, `/api/reward-records/:period/:personId`, `/api/target-cells/:id` exist; anon 401; row OCC `baseRev`; same `clientOpId` no rev bump; book merge on success / book 409 does not bump row; empty tables import from books; restore imports; SPA must not switch hire/Lock/KPI/trash to these routes yet
- OPEN still unfinished: Step 5 (not started). 50-VU soak. Contabo cut. Live notebook counts.
- ACCEPTANCE: entity OCC tests pass; Step 1–3 suites pass; live unsigned 401; live row counts untested; no Drive zip
- Exact next step: Step 5 only when instructed. Do not rewrite the SPA. Do not deploy.
