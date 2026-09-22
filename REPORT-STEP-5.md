# REPORT-STEP-5

## Status
done

## Zip / preview
- output zip id or filename: `artifacts/apms-step-5.zip` (this conversation). No Drive zip.
- preview URL if any: Grok App Builder live preview (this conversation). No Drive / Contabo URL.
- stamp: `apms-sync.js?v=p0as5` (routes preload `routes-…-p0ar.js?v=p0as5`)

## Which UI actions hit which route

Zustand still holds the assembled company view. `GET /api/company` still bootstraps from books. `save()` diffs against last-acked books and PATCHes entities for these slices; everything else stays `PATCH /api/company`.

| UI action | Route |
|-----------|--------|
| Hire / add / edit person | `PATCH /api/people/:id` |
| Trash person (and restore via re-add) | `PATCH /api/people/:id` with `deleted: true` (restore: `deleted` omitted, payload back) |
| Empty trash | people already entity-deleted; remaining org `trash: []` may still book-PATCH if other org fields dirty |
| Lock / unlock / Rewards month fields | `PATCH /api/reward-records/:period/:personId` |
| APMS month KPI actual / records | `PATCH /api/month-records/:period/:personId` |
| Target cell edit / delete | `PATCH /api/target-cells/:id` |
| KPI master, plans, roles, notices, … | `PATCH /api/company` (unchanged) |

OCC: row `baseRev` only. Two different personIds in the same period both 200. Same person + same period + stale rev → 409 + current row → client `person-month-conflict` / Refresh. Book merge is union (`mergeKeepPeople` / `mergeKeepMonthMaps`); book gen mismatch does **not** 409 the entity write; row win stands and merge retries.

## Tests
Re-ran together just now (2026-09-19 ~15:20 IST):

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| two entity PATCHes, same month, different people → both persist | pass |
| same person + same month stale rev → 409 | pass |
| fallbackPost absent | pass |

Actual summary line: `# tests 99 # pass 99 # fail 0`

Live unsigned GET `/api/people/:id` this run: **401**.

## Step 1 locks still held
- fallbackPost gone? yes (0 hits)
- POST 410? yes (unsigned still 401 first)
- pullLive dirty-skip? yes
- UI keys out of DB? yes
- person-month-conflict? yes (now also on stale entity rev)
- Lock copy? yes (“Record missing or lost to sync — refresh” in `routes-…-p0ar.js`; never “Nothing open.”)
- GET /api/company still from books? yes (Step 6 not started)

## Known broken / not done
- No Drive output zip (sandbox pack: `artifacts/apms-step-5.zip`)
- Live 175-person notebook hot-table counts untested
- Book merge after entity win is best-effort retry; a failed merge leaves the row ahead of the book until the next write
- Empty-trash of already-deleted people still may book-PATCH org `trash`
- `scripts/migration-plan.test.mjs` still assumes no app SQL
- `nitro-preset.test.mjs` vs Grok `vercel` inject
- Step 6 not started (GET /api/company must not assemble from rows yet)
- Not deployed

## HANDOFF
- Step 5 status: done (hire / Lock / KPI actual / target-cell / trash call entity APIs; OCC is row-rev only)
- Last zip id: none on Drive; sandbox pack `artifacts/apms-step-5.zip`
- LOCKS new this step: entity PATCH wins/loses on row rev only; two personIds same period both 200; stale same-person rev → 409 + person-month-conflict; book merge is union/retry and must not roll back a row win; SPA save() routes hire/Lock/KPI/target/trash to entity URLs; other saves stay PATCH /api/company; GET /api/company still books
- OPEN still unfinished: Step 6 (not started). 50-VU soak. Contabo cut. Live notebook counts.
- ACCEPTANCE: entity + sync tests pass; Step 1–4 suites pass; fallbackPost absent; live unsigned 401; live row counts untested; no Drive zip
- Exact next step: Step 6 only when instructed (GET /api/company assemble from rows). Do not start Step 6. Do not deploy.
