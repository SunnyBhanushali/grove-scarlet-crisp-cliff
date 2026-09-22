# LOAD-ROWS-CUTOVER

Cutover proof that hire / Lock / KPI / trash / GET run on **rows**, not snapshot overwrite. Isolated PGLite + apms-sync + live preview probes. No Contabo. No deploy.

Ran: 2026-09-19 ~15:45 IST.

## Verdict

| Check | Result | How |
|-------|--------|-----|
| A1 HR +5 people vs Rewards lock 10 other records | **pass** | row-path `patchEntity` parallel, then `assembleForGet` |
| A2 different people same month; stale same person | **pass** | both 200; stale `baseRev` → 409 + current row |
| A3 Lock never bare “Nothing open.” | **pass** | `routes-…-p0ar.js` has refresh copy, no “Nothing open.” |
| A4 no successful full-snapshot POST | **pass** | `fallbackPost` absent; wrapFetch 410; live unsigned POST **401**, signed no-restore **410** |
| A5 entity-delete stays gone on GET; UI nav out of DB | **pass** | delete + book PATCH cannot resurrect on GET; session keys stripped |
| A6 GET people not empty (~180) | **pass** | seed assemble **180**; live signed GET **180** |
| A7 month change does not snap another tab | **pass** | `pullLive` / `applyPulledBooks` keep local `currentMonth` |
| Two-browser hire + lock + 15s reload | **untested** | both contexts signed in (cookie); hire/lock UI selectors not a stable contract — did not invent clicks |

Required suites (including this file): **`# tests 111 # pass 111 # fail 0`**.

## A1

HR `PATCH /api/people/:id` ×5 in parallel with Rewards `PATCH /api/reward-records/2026-04/:id` ×10 (other people). After assemble-from-rows: all 5 hires present, all 10 locks `plan_locked`.

(Legacy book-path A1 in `three-team-concurrency.test.ts` still green; it is not the write path anymore.)

## A2

Two entity PATCHes, same month, different people → both persist on GET. Same person + stale rev → 409, payload still the winner’s lock. Client maps that to Refresh / `person-month-conflict`.

## A3

Scorecard bundle: **no** `Nothing open.` **yes** `Record missing or lost to sync — refresh`.

## A4

- `fallbackPost` hits in `apms-sync.js`: **0**
- wrapFetch full POST with snapshot → rewritten to PATCH; empty POST → 410
- Live unsigned POST `/api/company` → **401** `{ error: "Sign in required." }`
- Live signed POST without restore → **410** `{ error: "gone" }`

## A5

Entity-deleted `p-gone` stays absent on `assembleForGet` even when the book snapshot still lists them. `currentMonth` / `view` / `kind` / `selectedPersonId` never in `splitSnapshot` books. Live GET snapshot has no UI nav keys.

## A6

| Probe | people |
|-------|-------:|
| Seed `assembleForGet` | 180 |
| Live signed GET `/api/company` | 180 |

UI chrome “TEAM SIZE 175” is scoped-team, not the GET people array. GET is not empty. Did not revert Step 6.

## A7

Tab local `currentMonth=2026-08` while org gen moves: `pullLive` applies org people and **keeps** `2026-08`. `applyPulledBooks` keeps `2026-09` if that tab already changed month. P0-A: month is client-only.

## Browser two-context smoke

Playwright Chromium, two contexts, cookie `apms-preview-sunny`:

- Both reached signed-in home (“Hey Sunny”, TEAM SIZE 175).
- Did **not** click hire / Lock (no stable selectors; would mutate the shared preview without a cleanup contract).
- Result: **untested**. Do not treat as pass.

## Live HTTP (this preview, not Contabo)

- GET people **180**
- unsigned POST **401**
- signed POST no restore **410**
- `fallbackPost` absent

## Not run

- 50-VU soak
- Contabo / production 175-person notebook
- Two-tab UI hire + lock + 15s reload

## Ready for Eng staging cut?

**Yes, with caveats.** Row path holds under concurrent entity writes in tests. GET assemble is 180 and not empty. POST snapshot is gone. Browser concurrent UI and 50-VU soak are untested. **Contabo cut stays Sunny’s call.** Do not start Step 8 (catalogs/roles into rows).
