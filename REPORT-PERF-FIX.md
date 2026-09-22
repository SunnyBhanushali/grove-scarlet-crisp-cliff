# REPORT-PERF-FIX

## Status
done in this tree. **Not deployed.** Not Contabo. Not Step 8.

## Zip / preview
- stamp `apms-sync.js?v=p0as12`
- production host remains [https://apms.alienstattoo.in](https://apms.alienstattoo.in) (still p0as10/p0as11 until Eng cuts)

## Why it felt stuck
GET `/api/company` rebuilt ~5MB of people + month + reward rows on **every** request:
1. `assembleForGet` could run `importHotTables` (row-by-row upserts) whenever counts looked empty.
2. `loadRequestedBooks` (`?books=` used by pullLive) re-assembled the whole company instead of using the wire cache.
3. Wire `at` / ETag mixed `currentLiveAt()` on rebuild, so If-None-Match missed and returned a **new** body.
4. Idle SSE/tick with a newer `at` pulled org+months+targets even when gens were unchanged.
5. Hourly backup ran on the GET request path.

Tick itself was already small. The UI froze because every tab re-downloaded the company.

## After
| Path | Before | After |
|------|--------|--------|
| GET `/api/company` | rebuild + possible import + gzip every time | in-memory wire cache; same `at` → `{ unchanged: true, snapshotJson: null }` |
| GET `?books=` | full assemble | slice from cached wire |
| importHotTables on GET | could run every miss | **once** if tables empty, then stop |
| Idle 2 tabs, gens unchanged | pullLive GET books | **no GET** |
| at-only tick (no gens) | pull (LIVE-FIX) | still pull |
| Entity PATCH | invalidate + silent merge | unchanged |
| POST `/api/company` | 410 | 410 |
| Hourly backup | on every GET 200 | scheduler only |

Cold GET is still one assemble (must be, first paint). Second GET with the same ETag is tiny JSON, no snapshot.

## Tests

| File | result |
|------|--------|
| src/lib/company-perf.test.ts | pass |
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| src/lib/company-live-visibility.test.ts | pass |

**121 pass / 0 fail.** fallbackPost absent. POST `/api/company` 410.

## Known broken / remaining debt
- First login still pays one assemble/gzip. Not 50% smaller payload yet (that is a later slim/hot-only GET).
- Live apms. still old stamp until Eng cuts this tree (`NITRO_PRESET=node-server`, keep `.env` + `aliens_apms`).
- Two-browser idle 60s smoke untested from this agent.

## HANDOFF
- PERF-FIX **done in this tree** (`p0as12`)
- LOCK: GET is read-only; ETag/at change only after a real write; idle clients do not refetch 5MB
- Next: Eng rebuild + cut [apms.alienstattoo.in](https://apms.alienstattoo.in). Do not start Step 8. Do not deploy from this agent.
