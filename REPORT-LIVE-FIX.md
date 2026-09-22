# REPORT-LIVE-FIX

## Status
done (this tree). Not deployed. Not Contabo. Not Step 8.

## Cause
Entity PATCH wrote the row (durability OK) but:
1. GET `/api/company` could keep a pre-hire wire cache / `unchanged:true` ETag (`wire.at` was only book `notebookUpdatedAt`).
2. Recovered preview SSE sent `encodeSse(at)` **without bookGens**. `noteRemote` ignored at-only ticks, so `pullLive` had an empty `toPull` and never merged the new person / lock onto B.

LOAD-25: 22/22 hires and 21/21 locks survived. Visibility failed (G8 2/5, G9 0/3).

## Fix
1. After a successful entity row commit (`PATCH` people / month-records / reward-records / target-cells):
   - `publishEntityWrite` bumps SSE/tick gens for org or months or targets
   - `invalidateCompanyWire()` so the next GET cannot return the pre-hire gzip / `unchanged:true`
   - GET `at` is `max(book notebookUpdatedAt, currentLiveAt())`
   - do not return 200 until `assembleForGet` / hot slices on this process include that person or lock (one retry)
2. Recovered `/api/company-live` now `encodeSse(at, currentLiveGens())`.
3. `pullLive`: if tick `at` moved and gens were missing, still pull org+months+targets on a **non-dirty** client and `mergeKeepPeople` / month-map overlay that id. No whole-company replace.
4. Stamp `apms-sync.js?v=p0as6`.

## Tests
Re-ran together:

| File | result |
|------|--------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| src/lib/company-live-visibility.test.ts | pass |
| PATCH people 200 → immediate assemble includes id ×5 | pass |
| A PATCH people → B pullLive sees id (no full reload) | pass |
| same for one reward-record lock | pass |
| at-only SSE tick still pulls people/lock | pass |
| fallbackPost absent | pass (0 hits) |
| POST /api/company | unsigned **401**, signed no-restore **410** |

Actual summary line (required suites + visibility): `# tests 109 # pass 109 # fail 0`

LOAD-25 on apms8.grok.me was **not re-run** from this agent (do not deploy).

## Known broken
- This preview process must be running the new plugin/SSE for G9 to work on grok.me; apms8 still has the old drop until Sunny cuts.
- `publishEntityWrite` tick persist uses `getSql()`; unit tests may log `Cannot find module './db'` and still emit in-process.
- 50-VU / LOAD-25 visibility on apms8 not re-proved here.
- Step 8 not started.

## HANDOFF
- Status: visibility fix in this tree
- Ready for Eng staging re-cut of LOAD-25: **yes, after this tree is on the preview host**. Not a Contabo cut.
- Do not start Step 8. Do not deploy from this agent.
