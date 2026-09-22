# REPORT-IU-BLACK

## Status
done in this tree. 20 Sep 2026 ~15:50 IST. Stamp **p0as65**. Not deployed.

## Zip / preview
- tree stamp **p0as65** (`routes-…p0ar.js?v=p0as65`, `apms-sync.js?v=p0as65`)
- live still **p0as39 / p0as14** https://apms.alienstattoo.in — **this crash is on live until cut**
- no new migration

## What froze
Rewards / APMS person-month Disqualifiers (`Iu`) walks every `rewardRecords` + `rewardRoleMonths` row in a `useMemo` and does `for…of rec.rewardFlags`.

If a live overlay (10–15s tick, another editor adding a KPI) stores `rewardFlags` as an object (`{0: …}` or `{}`) instead of an array, `for…of` throws:

`TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator))`

React error boundary → black “Could not open Aliens APMS”. Intermittent because it depends on which rows the live merge just wrote.

## What changed
- `asFlagList` — arrays stay arrays; objects become `Object.values`; missing → `[]`
- `Iu` walker skips non-objects; try/catch so one bad row cannot take the page
- Hooks stay first (useMemo then `if (!rec) return null`) — no React #318
- Live entity merge `normalizePlanRec`: `rewardFlags`, `kras`, `kpis`, `children`, `brands` listified on GET overlay

## Files
- `public/assets/routes-e2g7y5q8-13m-p0ar.js` — `asFlagList` + `Iu`
- `public/assets/apms-sync.js` — `listify` / `normalizePlanRec`
- HTML `?v=p0as65`
- `src/lib/iu-black.test.ts`

## Tests
| File | result |
| src/lib/iu-black.test.ts | **4 pass** |
| src/lib/g9-two-client.test.ts | pass |
| src/lib/company-perf-tab.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/access-views.test.ts | pass |
| `node --check` routes + sync | pass |

Paste: **55 pass / 0 fail**. fallbackPost absent.

## Step 1 locks still held
fallbackPost gone? **yes**. POST 410? unchanged. UI keys out of DB? yes. No deploy. Not Step 8. Not roster.

## Known broken / not done
- Live still p0as39 until Eng cuts. Testers will keep hitting the black screen until `?v=p0as65` is on Contabo.
- G9 live-see still fail on production until cut.

## HANDOFF
- Step: IU-BLACK **done in tree**
- Stamp / host: **p0as65** / live p0as39
- LOCKS new this step: rewardFlags/kras/kpis listified; Iu never for-ofs a non-array
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass**; live **fail until cut**
- Exact next step: Eng cut p0as65. Do not start Step 8.
