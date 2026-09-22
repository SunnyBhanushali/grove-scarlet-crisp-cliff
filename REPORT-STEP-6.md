# REPORT-STEP-6

## Status
done

## Zip / preview
- output zip id or filename: `artifacts/apms-step-6.zip` (this conversation). No Drive zip.
- preview URL if any: Grok App Builder live preview (this conversation). No Drive / Contabo URL.

## What GET now sources from rows vs books

| Collection | GET `/api/company` source |
|------------|---------------------------|
| people | **hot rows** (`people` where `deleted_at` is null, minus tombstones). Row wins over a stale book slice. |
| records | **hot rows** (`month_records`) if any live rows; else book |
| rewardRecords | **hot rows** (`reward_records`) if any live rows; else book |
| targetCells | **hot rows** (`target_cells`) if any live rows; else book |
| roles, logins, trash, notices, catalogs, kpiMaster, plans, awards, targetNodes, … | **books** |

Empty hot people table + books have people → `importHotTables` once, then assemble. If assembled people would be empty while books have people → fall back to books (never ship an empty People UI) and mark ACCEPTANCE fail.

`PATCH /api/company` strips `people` / `records` / `rewardRecords` / `targetCells` (prepareBookPatch keeps stored maps so a targets/months book PATCH cannot tombstone them). Those writes stay on entity routes. Admin restore still writes the snapshot then `importHotTables`.

## Counts
Seed importer / assemble tests: people 180 / records 53 / rewardRecords 49 / targetCells 114.

Live signed GET `/api/company` this run (cookie `apms-preview-sunny`, 2026-09-19):

| Collection | Count |
|------------|------:|
| people | 180 |
| records | 53 |
| rewardRecords | 49 |
| targetCells | 114 |

Preview People list is **not empty**. Did not revert the assemble path.

## Tests
Re-ran together just now:

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| GET assembled people count matches rows | pass (seed 180) |
| entity-deleted person stays gone on GET | pass |
| fallbackPost absent | pass (0 hits) |

Actual summary line: `# tests 104 # pass 104 # fail 0`

## Step 1 locks still held
- fallbackPost gone? yes
- POST 410? yes (unsigned GET still 401 first)
- pullLive dirty-skip? yes
- UI keys out of DB? yes
- person-month-conflict? yes
- Lock copy? yes
- Empty-trash cannot resurrect via org book PATCH? yes (people ignored; GET overlays rows)

## Known broken / not done
- No Drive output zip (sandbox pack: `artifacts/apms-step-6.zip`)
- Live preview count is 180 (this sandbox notebook / seed), not the production 175 figure from earlier reports
- Book merge after entity win is still best-effort; GET now prefers the row
- `scripts/migration-plan.test.mjs` still assumes no app SQL
- `nitro-preset.test.mjs` vs Grok `vercel` inject
- Step 7 not started
- Not deployed

## HANDOFF
- Step 6 status: done (GET assembles people/records/rewardRecords/targetCells from rows; books keep catalogs/plans/roles; book PATCH ignores those four)
- Last zip id: none on Drive; sandbox pack `artifacts/apms-step-6.zip`
- LOCKS new this step: GET those four from rows (row wins); empty tables import then assemble; empty assembled people + books have people → books fallback, never ship empty UI; PATCH /api/company ignores those four; entity routes only for those writes
- OPEN still unfinished: Step 7 (not started). 50-VU soak. Contabo cut.
- ACCEPTANCE: assemble tests pass; live GET people **180** (not empty); fallbackPost absent; live production-175 not verified on Contabo
- Exact next step: Step 7 only when instructed. Do not start Step 7. Do not deploy.
