# REPORT-G9-LIVE-2

## Status
done in this tree. 20 Sep 2026 16:30 IST. Stamp **p0as69** (`apms-sync.js?v=p0as69`). SPA routes still **p0as68**. Server wire **p0aw1** (PERF-SPIKE) unchanged. **Not deployed.**

Product host is **https://apms.alienstattoo.in**. Not staging. Not Step 8. Not roster. Not screen-list APIs.

## Live still (before this tree is cut)
B `pulls=55`, `entityGets=0`. B never GET `/api/people/:id` or `/api/reward-records/`. A hire/lock does not show on B without refresh.

## Which hop was dead
**Hop B (hint → entity URL → GET that row).** Hop A (tick/SSE → `handleLiveEvent` → `pullLive`) was firing — that is why pulls=55. Hop C (apply `live-entity`) never ran because there was no GET.

Two bugs stacked:

1. **`hat <= lastWireAt` drop.** B’s company GET / patch-in-place wire uses `Date.now()` as `at`. Tick hints with `at` ≤ that were thrown away. `pendingEntities` stayed empty. `pullLive` then fetched books (the company file).
2. **p0as14 `entityUrl` underscore-only.** Tick types are hyphen (`reward-records`). Empty URL = no GET, hint re-queued forever. People still died because of (1).

Empty `entityUrl(hint)` is the bug. This tree logs every hint URL on `lastLiveTrace()`.

## Tick / SSE JSON B receives (two-session proof)

After A `PATCH people` + A `PATCH reward-records`, B `GET /api/company-tick?since=0`:

```json
{
  "at": 1789902310335,
  "bookGens": { "org": 1, "plans": 0, "months": 1, "targets": 0 },
  "entities": [
    { "type": "people", "id": "p-hire", "at": 1789902310333 },
    { "type": "reward-records", "id": "p-hire", "period": "2026-09", "at": 1789902310335 }
  ]
}
```

SSE frame is the same payload (`data: {…}`).

`entityUrl` for each hint (empty = hop B dead):

| hint | url |
|---|---|
| `{ type: "people", id: "p-hire" }` | `/api/people/p-hire` |
| `{ type: "reward-records", id: "p-hire", period: "2026-09" }` | `/api/reward-records/2026-09/p-hire` |

B network: ≥1 GET `/api/people/p-hire` and ≥1 GET `/api/reward-records/2026-09/p-hire`. No `/api/company`. Name **Ada Hire** and lock **plan_locked** land on B with `apply` reason `live-entity`. No yellow bar.

## What changed
1. Client no longer drops hints against `lastWireAt`. Only `lastPulledAt` (already applied).
2. Tick `entities[]` still capped at 20. Idle matching gens + empty entities still no fetch. `unchanged:true` kept.
3. `pullLive` with entity hints does **not** fall through to a company/books GET.
4. Server stamps hint `at` with the emitted live `at` (`lastAt+1`), not a raw `Date.now()` that can sit behind the wire etag.
5. Soft wire cache (PERF-SPIKE p0aw1) left alone.

## Tests
| Case | result |
|---|---|
| Live failure shape: lastWireAt drop + hyphen URL → pulls>0, entityGets=0 | **pass** (documents the bug) |
| Two sessions: A PATCH people + reward-records → B tick JSON → both entity GETs, name+lock, no company GET, no yellow bar | **pass** |
| B with high lastWireAt still GETs `/api/people/:id` | **pass** |
| g9-two-client / perf-tab cap 20 / idle unchanged / apms-sync | **pass** |

## Files
- `public/assets/apms-sync.js` + recovered-site + dist (stamp p0as69)
- `src/lib/company-live.ts`
- `src/lib/g9-live-2.test.ts`
- HTML `apms-sync.js?v=p0as69`

## Known broken
- Live still p0as14 / p0as39 until Eng cuts. Testers still see pulls=55 / entityGets=0 until then.
- Playwright two-browser on Contabo untested here.

## HANDOFF
```
G9-LIVE-2 done in tree. Stamp apms-sync.js?v=p0as69. Routes p0as68. Wire p0aw1.
Dead hop: B — lastWireAt drop + hyphen entityUrl empty → company GET (pulls) not row GET (entityGets=0).
Hint JSON: people p-hire → /api/people/p-hire; reward-records 2026-09/p-hire → /api/reward-records/2026-09/p-hire.
Next: Eng cut NITRO_PRESET=node-server. Re-run LOAD-10: entityGets>=1 people + >=1 reward-records, LIVE_SEES_HIRE/LOCK 3/3. Do not start Step 8 / roster / screen-list.
```
