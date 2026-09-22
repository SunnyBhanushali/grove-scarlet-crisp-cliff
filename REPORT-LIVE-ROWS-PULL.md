# REPORT-LIVE-ROWS-PULL

## Status
done in this tree. **Not deployed.** Stamp `apms-sync.js?v=p0as14`. Not Step 8.

## Cause
LOAD-10 G9: durability held (hires/locks on rows) but B never saw them.
Entity PATCH writes hot rows. pullLive still fetched `?books=org|months`. Those books no longer own `people` / `rewardRecords`. ETag `unchanged:true` then hid a stale assembled GET.

## After
1. Successful PATCH `/api/people` or `/api/reward-records` bumps live `at` + org/months gen, invalidates the GET wire cache, and records `entities: [{ type, id, period }]`.
2. SSE `/api/company-live` and `/api/company-tick` send `{ at, bookGens, entities }`. Tick stays small. No snapshotJson.
3. Non-dirty B pullLive GETs that one entity (`/api/people/:id` or `/api/reward-records/:period/:personId`), `mergeKeepPeople` / month overlay into Zustand. No yellow bar. No full company download.
4. Idle tabs with the same gens and no new entity hints still fetch nothing. Second GET with no writes remains `unchanged:true`.

## Tests
| Case | result |
|------|--------|
| PATCH people 200 → B pullLive sees id, entity GET not books | pass |
| PATCH reward-record lock → B pullLive sees lock | pass |
| matching gens, no entities → 0 book fetches | pass |
| company-books, apms-sync, three-team, ui-session, hot-tables, entities, assemble | pass |
| fallbackPost | absent |

**132 pass / 0 fail** in the LIVE-ROWS-PULL run.

## Known broken
- Live [apms.alienstattoo.in](https://apms.alienstattoo.in) is not this stamp until Eng cuts.
- Browser two-context smoke untested here.

## HANDOFF
- LIVE-ROWS-PULL **done in this tree** (`p0as14`)
- Next: Eng cut when asked. Do not start Step 8.
