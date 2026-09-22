# REPORT-PERF-SPIKE

## Status
done in this tree. 20 Sep 2026 ~16:25 IST. Server stamp **p0aw1**. SPA **p0as68**. Not deployed.

## Zip / preview
- server **p0aw1** (`src/lib/company-wire-cache.ts`, notebook, live, assemble)
- SPA **p0as68** / sync **p0as65**
- live still **p0as39 / p0as14** https://apms.alienstattoo.in — spikes remain until Eng cuts

## Root cause
Every entity PATCH called `publishEntityWrite` → `invalidateCompanyWire()` which set `wireCache = null` **and** `wireInflight = null`.

Then N concurrent `GET /api/company` each missed cache and ran `loadCompanySnapshot` + `assembleForGet` + `JSON.stringify` + `gzipSync` (~5.8MB). Invalidating mid-flight cancelled single-flight coalescing → rebuild stampede.

LOAD-10 SPEED (20 Sep 2026 ~15:21 IST, live apms p0as51):

| Probe | Result |
| Cold gzip TTFB | **1.53s** (p0as14 baseline **0.25s**) |
| During 10 users | spikes **4.38s** and **8.58s** |
| INM unchanged | tiny 469–599B when etag stable |
| 5xx | 0 |

## What changed

1. **Stale-while-revalidate** — entity writes do **not** null `wireCache`. GET keeps serving the last gzip body. Dirty flag + at most one rebuild; one extra if writes arrived during it (never N parallel assembles). Never cancel inflight.
2. **Patch-in-place** — warm cache + people / reward-records / month-records / target-cells PATCH merges that row into `slim`, re-gzip, skips `assembleForGet` / hot-table reread.
3. **`publishEntityWrite`** still emits tick/SSE `entities[]` (cap 20). Then patch-in-place, else `softInvalidateCompanyWire()`. Hard `invalidateCompanyWire()` only restore / book-wide PATCH.
4. **Cold path** — `loadHotSlices` runs the five hot-table reads in `Promise.all`. gzip level **5**. Boot `warmCompanyWire()` so the first user is not the cold assemble. `importHotTables` on GET is once-if-empty, then locked.

## Files
- `src/lib/company-wire-cache.ts`
- `src/lib/company-notebook.ts`
- `src/lib/company-live.ts`
- `src/lib/company-entities.ts`
- `src/lib/company-assemble.ts`
- `server/middleware/02-apms-serverfn.ts`
- `src/lib/company-perf-spike.test.ts`

## Tests
| File | result |
| src/lib/company-perf-spike.test.ts | **5 pass** (stampede ≤2 builds, in-place assemble=0, cold gzip 5) |
| src/lib/company-perf.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-live-visibility.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-books.test.ts | pass |

Suite this run: **128/128**. fallbackPost absent.

## Soak (this sandbox, 20 Sep 16:25 IST)

10 entity PATCH + 10 soft-invalidate + 20 GET `/api/company` (warm cache):

| | Live LOAD-10 15:21 | This tree |
|---|---|---|
| GET max TTFB | **8.58s** | **0 ms** (served stale gzip; never waited on null cache) |
| GET p95 | (spikes 4.38s / 8.58s) | **0 ms** |
| Full assemble/gzip | stampede (N) | **2** (cap ≤2) |
| Warm people PATCH | full assemble | **assembleForGet not called** |

Cold gzip of a 1.30 MB JSON envelope (level 5): **15 ms** encode in-process (15 KB gzip). Not Contabo HTTP. Live cold was **1.53s**; gate after cut is **≤ 0.5s** or ≥50% faster than 1.53s. During 10-writer soak on Contabo: **p95 ≤ 1.5s**, **max ≤ 2.5s**.

## Step 1 locks still held
fallbackPost gone? **yes**. POST 410? unchanged. UI keys out of DB? yes. LIVE_ENTITY_CAP=20 left. No deploy. Not Step 8. Not G9. Not roster.

## Known broken / not done
- Live still p0as39 until Eng cuts — testers still see 4–8s hangs.
- G9 live-see still fail on production (out of scope).

## HANDOFF
- Step: PERF-SPIKE **done in tree**
- Stamp / host: **server p0aw1** / SPA **p0as68** / live p0as39
- LOCKS new this step: SWR wire; patch-in-place; hard invalidate only restore/book PATCH
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass** (max 0 ms / p95 0 ms / ≤2 assemble vs live 4.38s/8.58s); live **fail until cut**
- Exact next step: Eng rebuild `NITRO_PRESET=node-server` and cut apms. Re-run LOAD-10 SPEED. Do not start Step 8 / G9 / roster.
