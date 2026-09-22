# REPORT-ACCESS-ROLES-LIST

## Status
done in this tree. 19 Sep 2026 21:45 IST. Stamp **p0as25**. Not deployed.

## Zip / preview
- tree stamp **p0as25** (`routes-e2g7y5q8-13m-p0ar.js?v=p0as25`)
- live still **p0as12** https://apms.alienstattoo.in
- no new migration

## What changed
Settings → Access roles list was showing two things:
1. The role table (correct)
2. A read-only “What each power set can do” matrix of the five built-in bases (admin / HR / function head / manager / employee)

That matrix is not the control. Create access role / Edit access role already has the real grant grid (Module × View/Create/Edit/Delete plus flags). The list now stops after the role table.

## Files
- `public/assets/routes-e2g7y5q8-13m-p0ar.js` (and recovered-site copy) — removed the section
- `public/index.html`, `public/apms.html` (+ recovered-site) — cache-bust `?v=p0as25`
- `src/lib/access-roles-list.test.ts`
- `package.json` test script

## Tests
| File | result |
| src/lib/access-roles-list.test.ts | **2 pass** |
| src/lib/apms-nav-ui.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| `node --check` routes | pass |

Paste: **2 pass / 0 fail** (access-roles-list). Heading string gone; Create/Edit + Module grant grid still in the bundle.

## Step 1 locks still held
fallbackPost gone? **yes** (no matches in src). POST 410? unchanged. UI keys out of DB? yes. No deploy. Not Step 8.

## Known broken / not done
- Live still p0as12 until Eng cuts this tree.
- G9 live-see still fail on production.
- Restore targets still incomplete on live.

## HANDOFF
- Step: ACCESS-ROLES-LIST **done in tree**
- Stamp / host: **p0as25** / live p0as12
- LOCKS new this step: Access roles list has no power-set cheat sheet; grants live on Create/Edit
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass**; live **untested**
- Exact next step: Eng cut p0as25. Do not start Step 8.
