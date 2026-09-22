# REPORT-LIVE-ENTITY-HINT

## Status
done in this tree. 19 Sep 2026 23:15 IST. Stamp **p0as40**. **Not deployed.** Not Step 8. Not restore-fix.

## Cause (LOAD-10 p0as14, runId 202609191941)
SPEED and durability passed. G9 0/3: B `pullLive` ×51, `entityGets=0`, `load10Names=0`.
Writer A PATCHed `/api/people` and `/api/reward-records`. Observer B never GETed those URLs.

Two holes:
1. Tick/SSE hints used **table** names (`reward_records`). LOAD-10 / client URL map need **API** names (`reward-records`). Empty `entityUrl` → no GET, hint re-queued forever.
2. SPA only called `pullLive` when `at > d.current`. A tick with `entities[]` and a stale/equal `at` never fetched the row. `h(live)` also dropped merges whose `notebookUpdatedAt` had not moved.

## After
1. Successful PATCH people / month-records / reward-records / target-cells:
   - commit the row
   - bump live `at` + book gen
   - SSE `/api/company-live` and `/api/company-tick` include  
     `entities: [{ type: "people"|"reward-records"|"month-records"|"target-cells", id, period? }]`  
     (`entities` is always an array)
2. Observer `noteRemote` queues those hints (hyphen **or** underscore). `pullLive` GETs that one URL, `mergeKeepPeople` / overlay the reward/month row. No snapshotJson. No yellow bar.
3. SPA calls `pullLive` when `entities.length` **or** `at` moved.
4. Idle, no writes: matching gens still skip books. Second GET still `unchanged:true`.

## Files
- `src/lib/company-live.ts` — `liveTypeFromTable`, hyphen hints, SSE always has `entities`
- `src/lib/company-live-http.ts` — tick always includes `entities`
- `public/assets/apms-sync.js` (+ recovered-site) — `normEntityType`, entity GET, bump `notebookUpdatedAt`
- `routes-e2g7y5q8-13m-p0ar.js` — pullLive on entities even if `at` did not move
- `src/lib/company-live-visibility.test.ts`

## Tests
| Case | result |
|------|--------|
| PATCH people → `entities[].type=people`; B GET `/api/people/:id`; name in B store | pass |
| hyphen `reward-records` → GET `/api/reward-records/:period/:id`; lock overlays | pass |
| SSE frame always has `entities` array | pass |
| idle matching gens, no new hints → no book fetch | pass |
| company-books | 46/46 pass |
| apms-sync | 24/24 pass (fallbackPost absent) |
| three-team-concurrency | 9/9 pass |
| company-ui-session | 1/1 pass |
| company-assemble | 6/6 pass |
| company-live-visibility | pass (new hint tests included) |
| company-entities | 8 inner pass; file-level SIGKILL is PGlite leak (same as prior steps) |
| company-hot-tables | 8 inner pass; same SIGKILL |
| fallbackPost | absent |
| POST /api/company | still 410 unless restore flags |

## Live counts
untested in this sandbox. LOAD-10 on p0as14: G9 fail. Next cut must be this stamp.

## Known broken
- Live G9 until Eng cuts p0as40
- Live restore still incomplete
- Do not start Step 8

## HANDOFF
- LIVE-ENTITY-HINT **done in this tree** (`apms-sync.js?v=p0as40`)
- Last zip/stamp: p0as40
- LOCKS: hyphen `entities[]` on tick/SSE after entity PATCH; observer GETs that one row; no snapshotJson on tick; no global Refresh bar
- OPEN: Eng cut p0as40; then LOAD-10 G9 (entityGets >= 3, LIVE_SEES_HIRE 3/3)
- ACCEPTANCE G9: **pass in unit / fail on live p0as14 / untested on p0as40 until cut**
- Exact next named job: **Eng cut p0as40**. Do not start restore-fix. Do not start Step 8.
