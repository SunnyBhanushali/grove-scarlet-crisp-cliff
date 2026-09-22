# REPORT-BOOT-PAREN

## Status
done in this tree. 20 Sep 2026 08:19 IST. Stamp **p0as45**. **Not deployed.** Not Step 8.

## Bug
Preview showed **Could not open Aliens APMS** / `SyntaxError: Unexpected token ')'`.

Cause: G9-LIVE patched EventSource + `/api/company-tick` in `routes-e2g7y5q8-13m-p0ar.js` to call `handleLiveEvent`, and left an extra `)` after `i()`:

`...(n.entities.length)&&i())}catch{`

Acorn: line 1151 col 7666. That is the module the SPA imports, so the whole app died.

Secondary: `apms-roster.js` `esc()` had HTML entities decoded to `.replace(/"/g, """);` which also would not parse. Fixed while here.

## Fix
- Removed the extra `)` on both EventSource and tick sites. `handleLiveEvent` / `setLiveHooks` / `withCredentials` still present.
- `esc()` now concatenates `"&" + "quot;"` so entities cannot decode into broken JS.
- Hard-refresh stamp **p0as45**.

## Tests
| File | result |
|---|---|
| node --check routes + login-view + apms-roster | **pass** |
| company-roster.test.ts (includes parse check) | **pass** |
| company-roster-bind.test.ts | **pass** 6/6 |
| company-live-visibility.test.ts (hop A still wired, no `&&i())`) | **pass** |

`fallbackPost` absent. POST `/api/company` still 410 unless restore.

## Files
- `public/assets/routes-e2g7y5q8-13m-p0ar.js` (+ recovered-site, dist, .output)
- `public/assets/apms-roster.js` (+ recovered-site)
- `public/apms.html` stamp p0as45
- `src/lib/company-roster.test.ts`, `src/lib/company-live-visibility.test.ts`

## HANDOFF

- Stamp / host: **tree p0as45**, **live p0as12 / LOAD-10 p0as14** https://apms.alienstattoo.in
- What passed: SPA parses (`node --check`); Unexpected token ')' gone; roster lock tests still 6/6; G9 hop A string still in routes
- What is still broken: **live G9 until Eng cuts p0as42**; this boot fix is preview/tree only until cut; roster lock not on live
- Exact next named job: **Eng cut** when Sunny says (`NITRO_PRESET=node-server`). Hard refresh must load `routes-…p0ar.js?v=p0as45`. Do not start Step 8.
