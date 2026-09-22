# REPORT-ARMY-FIX

## Status
done in this tree. 20 Sep 2026 18:50 IST. Stamp **p0as75** (`apms-sync.js?v=p0as75`). Routes still **p0as72** (not hand-edited). Server wire **p0aw1** (PERF-SPIKE) unchanged. **Not deployed.**

Product host is **https://apms.alienstattoo.in**. Not staging. Not Step 8. Not Org/Awards/Settings. Do not undo p0aw1 SWR.

## Live 18:05 IST (p0as71 / p0as72 / p0aw1)

| Probe | Result |
|---|---|
| PERF | **PASS** (full GET max 600ms). Kept. |
| Plans PATCH `/api/company` `books.plans` | **500** `{error:"patch-failed"}` |
| G9 | **FAIL** B `via=init` pulls=0 **entityGets=0**. No GET `/api/people/:id` |
| SCREEN-READ | **FAIL** list APIs 200; UI never called them. People/Rewards idle 35s: company GETs, list hits=0 |

## Fix A — Plans 500

### Stack
`PATCH /api/company` catch-all returned `{error:"patch-failed"}` with no message. Two ways that 500 fired:

1. **Auth assembled the wire.** PATCH called `getCompanyWire()` (full gzip assemble) before applying `books.plans`. A concurrent reward/month entity write was assembling or patching the same cache → the book PATCH threw and became 500.
2. **`persistBooks` `writeCombined` raced the entity writer.** Combined-notebook write failure aborted the whole plans persist even after the plans book row had committed.
3. Stale `baseGen` from `applyBookPatches` is already a conflict. The HTTP catch mapped that throw to **500**, not 409.

### Fix
- PATCH auth is **session-token only**. No `getCompanyWire()` on the PATCH path.
- Catch logs the real stack: `[api/company PATCH] patch-failed` + `err.stack`.
- `/stale|baseGen|conflict/` → **409**. Else 500 with `message`.
- Book persist uses `softInvalidateCompanyWire()` (SWR, never hard-null gzip mid-GET).
- `writeCombined` is try/catch so a combined-row race does not fail the book write.

Valid plans PATCH → **200** and the marker is in the next GET. Stale `baseGen` → **409**. Concurrent with a reward/month entity write must not 500.

## Fix C — why list APIs were unused

List routes already 200:

- `GET /api/people?limit=80`
- `GET /api/reward-records/:period?limit=80`

The UI never called them.

**Cause:** `K.getState().exportSnapshot()` is `kp(state)` and **strips `view`**. Screen location lives in `sessionStorage` `apms-ui-session-v1` (`window.__apmsNavUi.loadSession()`), not the persist snapshot. `maybeScreenRead` used to require live-hooks snapshot `view` — it was always empty after hydrate — so People/Rewards never opened the list URLs.

Idle/tick/focus still hit the company file two ways:

1. `GET /api/company`
2. login-view fallback `GET /_serverFn/5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5`

`wrapFetch` only guarded `/api/company`, so the LOAD hash bypassed the idle block.

### Fix
- `uiView()` reads `__apmsNavUi.loadSession().view` first, then snapshot.
- `maybeScreenRead` on People → `GET /api/people?limit=80`. Rewards month → `GET /api/reward-records/:period?limit=80`.
- `isCompanyFileGet` is `/api/company` **or** that LOAD hash. After `everLoaded`, both return local `{unchanged:true}` (no network).
- Home idle (`view === "home"`) does not pull the company file. **Empty view is not Home** — first-paint / unit pullLive still hydrates a clean org book.
- Do not hand-edit minified routes (that caused the black screen).

## Fix B — G9 two-session entityGets

Live failure shape: **entityGets=0**. p0as14 `entityUrl({type:"reward-records"})` was `""`. Tick on the other PM2 worker used in-memory `lastEntities` (empty) and `since>0 && at<=since ? []`, so B got no hints and never GET the row.

### Exact hint JSON B gets

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

SSE frame is the same payload (`data: {…}`).

| hint | url |
|---|---|
| `{ type: "people", id: "p-hire" }` | `/api/people/p-hire` |
| `{ type: "reward-records", id: "p-hire", period: "2026-09" }` | `/api/reward-records/2026-09/p-hire` |

B network within 20s: ≥1 GET `/api/people/p-hire` and ≥1 GET `/api/reward-records/2026-09/p-hire`. Name **Ada Hire** and lock on B. No `/api/company`. No yellow bar. Home idle does not pull the company file.

### Persist across PM2
`writeTick` stores `{ at, bookGens, entities }` on `company_notebook` id=`live-tick`. Worker B `handleCompanyTickRequest` → `readLiveAt()` → `hydrateLiveFromTickRow` (merge, skip stale). Tick `entities` = rows with `entity.at > since`, cap 20. Empty in-memory `lastEntities` on the other worker is no longer the source of truth.

Test starts from live failure shape (`entityUrl` empty → entityGets=0) then two-session entity GETs pass.

## Stamps

| piece | stamp |
|---|---|
| `apms-sync.js` | **p0as75** |
| routes | **p0as72** (untouched) |
| login-view | p0as68 |
| server wire | **p0aw1** |
| live (Contabo) | p0as39 / LOAD-10 p0as14 |

HTML `apms-sync.js?v=p0as75` (public, recovered-site, dist, `scripts/apms-spa.html`).

## Kept
People list + Rewards month off `/api/company` after first login. Soft wire cache (p0aw1). Tick cap 20. `unchanged:true`. POST 410 unless restore. `fallbackPost` absent.

## Tests
| Case | result |
|---|---|
| Valid plans apply; stale baseGen 409 not 500 | **pass** |
| PATCH catch logs stack; no `getCompanyWire` on PATCH | **pass** (source) |
| Nav session wires `GET /api/people?limit=` | **pass** |
| Rewards month list URL, no company | **pass** |
| After hydrate, `/api/company` and `_serverFn` LOAD are local unchanged | **pass** |
| Failure shape entityGets=0 then two-session entity GETs | **pass** |
| Tick JSON hydrates on empty-memory worker B | **pass** |
| Home idle does not GET `/api/company` | **pass** |
| pullLive still hydrates a clean org book (empty view ≠ home) | **pass** |
| PERF-SPIKE 10 PATCH + 20 GET ≤2 assemble, max 0 ms | **pass** |
| G9-LIVE-2 two sessions + hyphen URL | **pass** |
| SCREEN-READ / MOD-APMS / MOD-ORG | **pass** |

Suite this run: **85/85**. fallbackPost absent.

## Files
- `src/routes/api/company.ts` — PATCH session-only; log stack; 409 vs 500
- `src/lib/company-notebook.ts` — `softInvalidate` on book PATCH; `writeCombined` try/catch
- `src/lib/company-live.ts` — `hydrateLiveFromTickRow` merge; `persistLiveTick`; tick JSON includes `entities`
- `src/lib/company-live-http.ts` — `readLiveAt()` then filter `entity.at > since`
- `public/assets/apms-sync.js` + recovered-site + dist (stamp p0as75)
- `src/lib/mod-army-fix.test.ts`

## Known broken
- Live still p0as14 / p0as39 until Eng cuts. Testers still see Plans 500, entityGets=0, company GETs on People/Rewards until then.
- Playwright two-browser on Contabo untested here.
- Do not start Org extras / Awards / Settings / Step 8.

## HANDOFF
```
ARMY-FIX done in tree. Stamp apms-sync.js?v=p0as75. Routes p0as72. Wire p0aw1.
Fix A: Plans PATCH logged the real stack; session-only auth; stale → 409; concurrent entity write must not 500.
Fix C: list APIs unused because exportSnapshot strips view. uiView() from __apmsNavUi.loadSession(). wrapFetch blocks /api/company AND _serverFn LOAD after hydrate.
Fix B: hint JSON people p-hire → /api/people/p-hire; reward-records 2026-09/p-hire → /api/reward-records/2026-09/p-hire. Tick entities persist via live-tick row. Test fails on entityGets=0 then passes.
Next: Eng cut NITRO_PRESET=node-server. Do not deploy from this sandbox. Do not start Org/Awards/Settings.
```
