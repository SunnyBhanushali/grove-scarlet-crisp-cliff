# REPORT-MOD-APMS

## Status
done in this tree. 21 Sep 2026 10:40 IST. Stamp **p0as77** (`apms-sync.js?v=p0as77`). Routes still **p0as72** (not hand-edited). Server wire **p0aw1** unchanged. **Not deployed.**

Does not undo Plans 200/409, p0aw1 SWR, idle company GET=0 on People/Rewards, or ARMY-2 via=init / OCC.

Product host is **https://apms.alienstattoo.in**. Not staging. Not Org extras / Rewards extras / Targets / Plans studio / Awards / Settings. Stage 4 of 9 — APMS only. Fetch on access.

## Job
Stage 4 of 9 — APMS screens fetch month-records on access, not the company file.

## Screens

| Screen | GET |
|---|---|
| APMS month index (`apms`) | `/api/month-records/:period?limit=80` |
| Expand person on that index | also `/api/month-records/:period/:personId` |
| Scorecard (`apms-person`, `apms-me`, `scorecard`) | `/api/month-records/:period/:personId` |
| Plan / KROC (`apms-plan`, `kroc`) | same person row |
| Execution (EOs) | same person row |
| Values tab | same person row |
| Save | PATCH `/api/month-records/:period/:personId` |

No GET `/api/company` on those pages after login. Home / People / Rewards fetch nothing APMS.

## Fetch on access
`exportSnapshot` strips `view`. Screen location is `sessionStorage` `apms-ui-session-v1`. `maybeScreenRead` reads `__apmsNavUi.loadSession()`.

APMS month + person fire **after `everLoaded`**, 2s throttle (not once-per-key forever). `noteLoaded` resets the keys. Expand person on the month index GETs that row.

People → `GET /api/people?limit=80` every open. Rewards month → `GET /api/reward-records/:period?limit=80` every open. Idle company stays 0.

## Live
Month-records hints are fetched only while an APMS view is open (`apmsViewOpen()`). A saves P1; B on Home GETs nothing APMS; B opens P1 and GETs `/api/month-records/:period/P1`.

## OCC
Same person+month concurrent PATCH → **200 + 409** (SQL `WHERE rev=baseRev RETURNING` + per-key enqueue from p0as76). Different people same month → both **200**.

## Tests
| Case | result |
|---|---|
| Scorecard Network is month-records, not company | **pass** |
| APMS month index GET `/api/month-records/:period?limit=` from nav session | **pass** |
| plan / execution / values / kroc GET person row | **pass** |
| Expand person on month index GETs that row | **pass** |
| A saves P1; B on Home fetches nothing APMS; B opens P1 and sees it | **pass** |
| People/Rewards do not fetch month-records on APMS ticks | **pass** |
| Concurrent same person+month 200+409; different people both 200 | **pass** |
| People listHits≥1, Rewards listHits≥1; idle company 0 | **pass** |
| `fallbackPost` | **absent** |
| routes not hand-edited | **pass** |

## Stamps

| piece | stamp |
|---|---|
| `apms-sync.js` | **p0as77** |
| routes | **p0as72** (untouched) |
| login-view | p0as68 |
| server wire | **p0aw1** |
| live (Contabo) | p0as39 / LOAD-10 p0as14 |

HTML `apms-sync.js?v=p0as77` (public, recovered-site, dist, `scripts/apms-spa.html`).

## Kept
People list + Rewards month off `/api/company` after first login. Soft wire cache (p0aw1). Tick cap 20. `unchanged:true`. POST 410 unless restore. `fallbackPost` absent. Plans PATCH 200/409. ARMY-2 via=init entity GET + OCC.

## Files
- `recovered-site/assets/apms-sync.js` (+ public + dist) — APMS fetch-on-access, nav session, expand person
- `src/lib/mod-apms.test.ts`
- `src/lib/company-entities.ts` — OCC already p0as76 (month-records same path)

## Known broken
- Live still p0as14 / p0as39 until Eng cuts. Testers still GET `/api/company` on APMS until then.
- Playwright two-browser on Contabo untested here.
- Do not start Org extras / Rewards extras / Targets / Plans studio / Awards / Settings / Step 8.

## HANDOFF
```
MOD-APMS done in tree. Stamp apms-sync.js?v=p0as77. Routes p0as72. Wire p0aw1.
APMS month → GET /api/month-records/:period?limit=80. Scorecard/plan/execution/values → GET /api/month-records/:period/:personId.
Save PATCH that row. Concurrent same person+month 200+409. Different people both 200.
Home/People/Rewards fetch nothing APMS. B sees P1 when B opens P1.
People listHits≥1, Rewards listHits≥1. Idle company 0. Plans 200/409 kept.
Next: Eng cut NITRO_PRESET=node-server. Do not deploy from this sandbox. Do not start Org extras / Awards / Settings.
```
