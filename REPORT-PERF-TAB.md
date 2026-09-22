# REPORT-PERF-TAB

**When:** 20 Sep 2026 13:50 IST  
**Stamp:** sync **p0as60**, routes `?v=p0as60`  
**Host:** https://apms.alienstattoo.in (production). **Not deployed.** Not Step 8. Not roster. Not restore.

## What froze

4 idle tabs on live locked Chrome. Server was fine:

| Path | Live (before) |
|------|----------------|
| GET `/api/company` gzip | 0.5–0.7s |
| Idle If-None-Match | ~176 bytes `{ unchanged: true }` |
| GET `/api/company-tick` | ~5KB with a **long** `entities[]` of people ids |

Every tab replayed that whole `entities[]` on tick/SSE, GET each person, and remounted 180+ People/Rewards rows. Main thread 3–7s. G9 (entity tick → handleLiveEvent → `/api/people/:id`) stayed in tree; the ring was unbounded.

## What was capped (tree p0as60)

1. **Tick / SSE `entities[]`** — only ids newer than the caller’s seen `at`, **max 20**, newest last. `pushLiveEntities` stamps `at`. Persist/read of the tick row is capped 20. SSE **first frame is empty**; later frames are this write’s hints, not the full history. Idle `since=` when `at` is unchanged → `entities: []`.
2. **Client `handleLiveEvent` / `pullLive`** — drop hints with `hint.at <= max(lastPulledAt, lastWireAt)`; queue/GET **≤20**; never `JSON.parse snapshotJson` on tick; **in-place** `mergeKeepPeopleClient` splice when the incoming id already exists (other row object identity kept). New G9 hint **without** `.at` still queues (hat=0 skips the age filter).
3. **Virtualize** People list, Org/company people, Rewards+APMS month tables (`Virt`, visible rows + buffer 8, `data-virt`). Lists ≤24 still mount in full.
4. **After first hydrate** — `delete loaded.snapshotJson` and `body.snapshotJson = null` in wrapFetch.
5. **Idle GET `/api/company`** — still `{ unchanged: true }` on If-None-Match / matching `at`. Body **does not replay** `lastEntities` (tick/SSE is the live path). No interval GET `/api/company`. No yellow global bar.

G9 path kept: A PATCH people 200 → B still GETs that one `/api/people/:id` when the hint is new.

## Files

- `src/lib/company-live.ts` — `LIVE_ENTITY_CAP=20`, `entitiesSince(since, cap)`, stamp `at`, emit this write only
- `src/lib/company-live-http.ts` — tick uses `entitiesSince`; SSE first frame `[]`
- `src/lib/company-wire-http.ts` — unchanged GET `entities: []`, tiny JSON
- `recovered-site/assets/apms-sync.js` (+ public/dist) — stamp **p0as60**
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` — `function Virt`
- HTML `?v=p0as60` (recovered-site, public, dist, scripts)
- `src/lib/company-perf-tab.test.ts`

## Tests

| Check | result |
|-------|--------|
| Server tick, 200 old ids → ≤20 | pass |
| Idle tick `since` past last write → `entities: []`, body <500B | pass |
| Client 200 hints → ≤20 entity GETs, no `/api/company` | pass |
| Older-than-seen hints → 0 GETs | pass |
| G9 new people hint (no `.at`) → GET `/api/people/:id` | pass |
| In-place people merge keeps other row identity | pass |
| Second GET no writes → `unchanged:true` / tiny, no entity flood | pass |
| Virt + p0as60 + `fallbackPost` absent | pass |
| g9-two-client, company-live, apms-sync, target-mass, visibility | pass |
| books, ui-session, company-perf, company-wire | pass |

**123 pass / 0 fail** (`node --experimental-strip-types --test` on the files above).  
`fallbackPost` absent. POST `/api/company` 410 unless restore.  
`node --check` apms-sync + routes pass.

## Honest target (not 0ms)

- Typing / click / change month should feel instant on device once cut
- Home after login still 1–2s (cold GET assemble)
- Idle tick typical = `{ at, bookGens, entities: [] }` (not 5KB of people ids)
- One other user’s hire: ≤20s, one `/api/people/:id`, no freeze
- 200 mostly-readers + ~20 writers must not remount 180 rows per tab per poll

## Known broken

- **Live still p0as39 / p0as14.** This tree is **p0as60**. Eng cut (`NITRO_PRESET=node-server`). Hard refresh `apms-sync.js?v=p0as60` + `routes-…p0ar.js?v=p0as60`.
- Live G9 still 0/3 until that cut. Do not claim 3/3 from this sandbox.
- Two-browser Playwright untested here (no signed-in live session).
- Virt is windowed DOM, not a windowed store — Zustand still holds the full people array.

## HANDOFF

Tree stamp **p0as60**. Live **p0as39 / LOAD-10 p0as14** https://apms.alienstattoo.in  
What passed: tick/SSE cap 20, in-place merge, Virt lists, drop snapshotJson, idle unchanged tiny, G9 entity GET still wired.  
What is still broken: **live freeze until Eng cuts p0as60**.  
Exact next named job: **Eng cut** when Sunny says. Do not start roster / mass-update / awards extract / restore / Step 8.
