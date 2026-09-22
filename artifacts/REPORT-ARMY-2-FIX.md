# REPORT-ARMY-2-FIX

## Status
done in this tree. 21 Sep 2026 08:40 IST. Stamp **p0as76** (`apms-sync.js?v=p0as76`). Routes still **p0as72** (not hand-edited). Server wire **p0aw1** (PERF-SPIKE) unchanged. **Not deployed.**

Product host is **https://apms.alienstattoo.in**. Not staging. Not Step 8. Not Org/Awards/Settings. Do not undo p0aw1 SWR or Plans 200/409.

## Live 20 Sep 2026 19:49 IST (p0as75 / routes p0as72)

| Probe | Result |
|---|---|
| G0 stamp | **PASS** |
| G1 PERF | **PASS** (max 742ms). Kept. |
| G2 Plans | **PASS** |
| G3 People/Rewards list | **FAIL** People listHits=0. Rewards listHits=1. Idle company=0 both (keep). |
| G4 G9 two-session | **FAIL** B entityGets=0 LIVE_SEES 0 **via=init**. A PATCH 200. |
| G5 OCC | data intact; same person+month **200+200** (want **200+409**). Different people same month both 200. |

## Why People listHits was 0

List routes already 200:

- `GET /api/people?limit=80`
- `GET /api/reward-records/:period?limit=80`

`maybeScreenRead` keyed `lastScreenKey = view + month + …` and returned if the key matched.

1. **ORG-PEOPLE-DEFAULT.** After login the session is already `org-people`. Navigate-to-People is a no-op because `lastScreenKey` was already that view.
2. **Pre-login 401.** The 400ms screen-read watch ran while still logged out. `openPeopleScreen` 401'd, but `lastScreenKey` was set anyway. Hydrate later saw the same key and skipped the list GET.
3. Rewards listHits=1 because the view *changed* to `rewards` after login, so the key was new.

Idle `/api/company` stayed 0 (wrapFetch local `{unchanged:true}`). Keep that.

### Fix
- People (`org-people` / `people`) and Rewards fire **after `everLoaded`**, with a 2s throttle (not once-per-key forever).
- `noteLoaded` resets `lastScreenKey` + fetch-at and calls `maybeScreenRead()`.
- Pre-login (`!everLoaded`) returns without pinning `lastScreenKey`.
- Navigate to People → `GET /api/people?limit=`. Rewards month → `GET /api/reward-records/:period?limit=`. Idle company stays 0.

## Fix 1 — G9 via=init entityGets=0

Live failure shape: **entityGets=0 via=init**.

Four stacked misses:

1. `handleLiveEvent` queued hints but `scheduleLivePull` required `liveHooks`. wrapFetch tick ran **before** routes `setLiveHooks`.
2. `hat <= lastPulledAt` dropped a replayed hint.
3. SSE first frame sent **empty** `entities` (`first ? []`).
4. PM2 SSE is in-process only; worker B needed tick JSON / 2s poll.

### Exact hint JSON B sees

After A `PATCH people` + A `PATCH reward-records`, B `GET /api/company-tick?since=0`:

```json
{
  "at": 1789911658991,
  "bookGens": { "org": 1, "plans": 0, "months": 1, "targets": 0 },
  "entities": [
    { "type": "people", "id": "p-hire", "at": 1789911658988 },
    { "type": "reward-records", "id": "p-hire", "period": "2026-09", "at": 1789911658991 }
  ]
}
```

SSE first frame is the same payload (`data: {…}`), not `entities: []`.

| hint | url |
|---|---|
| `{ type: "people", id: "p-hire" }` | `/api/people/p-hire` |
| `{ type: "reward-records", id: "p-hire", period: "2026-09" }` | `/api/reward-records/2026-09/p-hire` |

### Fix
- `fetchHintNow(url)` GETs the entity **immediately**, even without `liveHooks`. via=init wrapFetch-before-hooks still `entityGets>0`.
- Do **not** drop `hat <= lastPulledAt` in `handleLiveEvent`.
- SSE first frame sends `currentLiveEntities()` (hydrate from `live-tick` row, then send). 2s poll of `readLiveAt` for PM2 worker B.
- `startLiveWatch`: EventSource `/api/company-live` `withCredentials` + 2500ms `/api/company-tick` poll. Idempotent. Document only.

B network within 20s: ≥1 GET `/api/people/:id` and ≥1 GET `/api/reward-records/:period/:id`. No `/api/company`. Test starts from **via=init + entityGets=0** then passes.

Tick `entities[]` still persist across PM2 via `company_notebook` id=`live-tick`.

## Fix 3 — OCC 200+200

Entity PATCH is row-rev only. Live same person+month both 200 because:

1. JS `if (parsed.baseRev !== stored.rev)` raced — both reads saw the same rev.
2. `writeRow` upserted blindly (no `WHERE rev = baseRev`).

### Change
- `writeRow` is `INSERT … ON CONFLICT DO UPDATE … WHERE table.rev = $baseRev RETURNING rev`. Zero rows → 409 + current row.
- Per-key `enqueueEntityPatch` so same person+month serializes in-process.
- Concurrent PATCH same `period+personId` → **200 + 409**.
- Different people same month → **both 200**.

## Stamps

| piece | stamp |
|---|---|
| `apms-sync.js` | **p0as76** |
| routes | **p0as72** (untouched) |
| login-view | p0as68 |
| server wire | **p0aw1** |
| live (Contabo) | p0as39 / LOAD-10 p0as14 |

HTML `apms-sync.js?v=p0as76` (public, recovered-site, dist, `scripts/apms-spa.html`).

## Kept
People list + Rewards month off `/api/company` after first login. Soft wire cache (p0aw1). Tick cap 20. `unchanged:true`. POST 410 unless restore. `fallbackPost` absent. Plans PATCH 200/409.

## Tests
| Case | result |
|---|---|
| Live via=init entityGets=0 then wrapFetch-before-hooks GET people + reward-records | **pass** |
| Hint JSON people p-hire + reward-records 2026-09/p-hire; B GET those URLs; no company | **pass** |
| People listHits after hydrate when already org-people / after 401 lastScreenKey | **pass** |
| Rewards month list URL; idle company 0 | **pass** |
| Concurrent same person+month 200+409; different people both 200 | **pass** |
| Tick entities persist after empty-memory hydrate | **pass** |
| Stamp p0as76; fallbackPost absent; routes not hand-edited; OCC SQL | **pass** |

## Files
- `src/lib/company-entities.ts` — SQL OCC `WHERE rev=baseRev RETURNING`; per-key enqueue
- `src/lib/company-live-http.ts` — SSE first frame = current entities; 2s `readLiveAt` poll
- `public/assets/apms-sync.js` + recovered-site + dist (stamp p0as76) — `fetchHintNow`, People/Rewards 2s-after-everLoaded, `startLiveWatch`
- `src/lib/mod-army-2-fix.test.ts`

## Known broken
- Live still p0as14 / p0as39 until Eng cuts. Testers still see People listHits=0, entityGets=0 via=init, OCC 200+200 until then.
- Playwright two-browser on Contabo untested here.
- Do not start Org extras / Awards / Settings / Step 8.

## HANDOFF
```
ARMY-2-FIX done in tree. Stamp apms-sync.js?v=p0as76. Routes p0as72. Wire p0aw1.
Fix 1 G9: hint JSON people p-hire → /api/people/p-hire; reward-records 2026-09/p-hire → /api/reward-records/2026-09/p-hire. fetchHintNow GETs even without liveHooks (via=init). SSE first frame sends entities. Test fails on via=init entityGets=0 then passes.
Fix 2 People: listHits was 0 because lastScreenKey skipped already-on-org-people / pre-login 401. maybeScreenRead after everLoaded, 2s throttle, noteLoaded reset.
Fix 3 OCC: SQL WHERE rev=baseRev RETURNING + per-key enqueue. Concurrent same person+month 200+409. Different people both 200.
Next: Eng cut NITRO_PRESET=node-server. Do not deploy from this sandbox. Do not start Org/Awards/Settings. Do not undo p0aw1.
```
