# REPORT-G9-LIVE

## Status
done in this tree. 20 Sep 2026 10:15 IST. Stamp **p0as47** (`apms-sync.js?v=p0as47`, routes `?v=p0as47`). **Not deployed.** Not Step 8. Not roster. Not restore.

Product host is **https://apms.alienstattoo.in** (production). Not staging.

## Before (live LOAD-10)
Live still serves routes **p0as39** + sync **p0as14**.
Durability / G8 / G10 / Speed **PASS**. G9 **FAIL 0/3**.

| Run | B pulls | B entityGets | load10Names |
|---|---|---|---|
| 19 Sep p0as14 | 51 | 0 | 0 |
| 20 Sep morning | 0 | 0 | 0 |

Writer PATCH `/api/people/:id` or `/api/reward-records/:period/:personId` is not an observer GET. B never showed the new name or lock without refresh.

## Which hops were broken
Proved against live p0as14/p0as39 **and** a two-client test that uses the real SSE/tick payload (not a hand `pullLive`).

1. **Hop A (notify → observer pull) — morning `pulls=0`.**
   Live routes only called `pullLive` when `tick.at > d.current`. `entities[]` was ignored. EventSource had no `withCredentials`. `wrapFetch` on `/api/company-tick` only `noteRemote` and did not pull. If `at` did not beat B’s `notebookUpdatedAt`, pending hints sat forever. `setLiveHooks` ran after wrapFetch, so the first tick could queue hints with no hooks.

2. **Hop B (pull → entity GET) — night `pulls=51 entityGets=0`.**
   Live `entityUrl()` only matched underscore table names (`reward_records`). Server / LOAD-10 emit hyphen API names (`reward-records`). Empty URL → no GET. Unit tests that called `pullLive()` by hand hid this.

3. **Hop C (GET → Zustand) — would still fail after hops A+B.**
   Routes `apply` is `if (Ft(t)) return false` where `Ft(t) === people.length`. Every live company has people, so B could GET the row and still drop the merge. `h(t,'live')` also short-circuits on `Ft`. Tests that mocked `apply` never saw this. LOAD-10 `entityGets=0` stopped before this hop; after A+B it would have been `entityGets>0` and `load10Names=0`.

SSE is in-process only (PM2). Other workers see the persisted tick row via `/api/company-tick`.

## After (this tree, p0as47)
1. Successful PATCH people / reward-records / month-records / target-cells `publishEntityWrite` → `{ at, bookGens, entities: [{ type, id, period? }] }` on SSE and tick. Types are API names (`reward-records`).
2. **`handleLiveEvent(tick)`** is the observer driver: `noteRemote` then schedule `pullLive` if `entities[]` **or** pending **or** `at` moved — even when `at <=` B’s `notebookUpdatedAt`.
3. `wrapFetch` on GET `/api/company-tick` calls `handleLiveEvent`. Routes EventSource + tick poll `setLiveHooks` then `handleLiveEvent`. EventSource `{ withCredentials: true }`.
4. **`setLiveHooks` flushes** pending entity GETs and a moved remote `at`. wrapFetch-before-hooks race no longer drops hints.
5. Hyphen **and** underscore types map to `/api/people/:id` and `/api/reward-records/:period/:id`. Merge via `mergeKeepPeople` / month overlay. No snapshotJson.
6. **`apply(snap, 'live-entity')`** overlays people / rewardRecords / records / targetCells on Zustand. Idle `Ft(people.length)` no longer swallows the row. No global yellow bar.
7. Matching gens + empty entities → no book fetch. Idle If-None-Match still `unchanged:true`.
8. `scripts/apms-spa.html` + recovered/public index stamped p0as47 so the cut loads the new sync and routes.

## Tests
| Case | result |
|---|---|
| SSE payload with `entities` → B `handleLiveEvent` (no hand `pullLive`) → GET `/api/people/:id` → name in B store; apply reason `live-entity` (Ft-style apply would reject without it) | **pass** |
| Tick GET wrapFetch **before** `setLiveHooks` → hooks attach → GET `/api/reward-records/...` → lock overlays | **pass** |
| `publishEntityWrite('reward_records')` → live channel type is hyphen `reward-records` | **pass** |
| idle matching gens + empty entities → 0 book / snapshotJson fetches | **pass** |
| routes bundle has `handleLiveEvent` + `setLiveHooks` + EventSource credentials + `reason==='live-entity'` setState overlay | **pass** |
| company-books / apms-sync / three-team / ui-session / hot-tables / entities / assemble / live-visibility / nav / perf | **pass** |
| fallbackPost | **absent** |

## Two-browser smoke (Eng after cut)
Tab A hire + lock. Tab B idle, no refresh. Within 20s B People / Rewards show both.
B network: ≥1 GET `/api/people/:id` and ≥1 GET `/api/reward-records/:period/:id`.
No yellow bar. Idle two tabs 30s: still `unchanged:true`, no multi-MB company GET.

## Live counts
untested until Eng cuts **p0as47**. Expected next LOAD-10: LIVE_SEES_HIRE 3/3, LIVE_SEES_LOCK 3/3, B entityGets > 0, Speed still PASS.

## Files
- `public/assets/apms-sync.js` + `recovered-site/assets/apms-sync.js`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` + `public/assets/…`
- `scripts/apms-spa.html`, `recovered-site/index.html`, `recovered-site/apms.html`, `public/index.html`
- `src/lib/company-live.ts` / `company-live-http.ts` / `company-entities.ts`
- `src/lib/g9-two-client.test.ts`, `src/lib/company-live-visibility.test.ts`

## Known broken
- Live still p0as14 / p0as39 until Eng rebuilds `.output` and cuts https://apms.alienstattoo.in
- Playwright two-context smoke untested in this sandbox
- Restore targets interiors still open
- Roster R1 pack is separate. Not this chat.

## HANDOFF
```
G9-LIVE done in tree. Stamp apms-sync.js?v=p0as47 + routes?v=p0as47.
Zip: artifacts/aliens-apms-g9-p0as47.zip
Hops: A entities ignored unless at moved; B underscore entityUrl; C Ft(people.length) dropped apply after GET.
Next: Eng rebuild NITRO_PRESET=node-server and cut https://apms.alienstattoo.in
Then LOAD-10. Pass only if LIVE_SEES_HIRE 3/3 and LIVE_SEES_LOCK 3/3 and B entityGets > 0 and Speed PASS.
Do not deploy from this agent. Do not start Step 8. Do not start roster. Do not change restore.
```
