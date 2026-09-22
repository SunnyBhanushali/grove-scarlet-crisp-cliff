# REPORT-ACCESS-VIEWS

## Status
done in this tree. 20 Sep 2026 ~15:20 IST. Stamp **p0as62**. Not deployed.

## Zip / preview
- tree stamp **p0as62** (`routes-…p0ar.js?v=p0as62`, login-view `?v=p0as62`)
- live still **p0as39 / p0as14** https://apms.alienstattoo.in
- no new migration

## What changed
Mass update and People view tabs are access-role **flags** (Extra on Create / Edit access role), not new modules.

| Flag | What it shows |
|---|---|
| `mass_rewards` | **Mass update** on Rewards month lists (still Rewards-only, Unlock against) |
| `mass_people` | **Mass update** on People |
| `people_list` | People · List |
| `people_my` | People · My team |
| `people_company` | People · Company |
| `people_sbu` | People · SBU |
| `people_function` | People · Function |
| `people_summary` | People · Summary |

Super_admin still bypasses every flag. Builtin defaults so nothing disappears until an editor unchecks:

- **admin / hr**: all eight on
- **function_head / manager**: people views + Rewards mass on; People mass off (same as today — only company people-admin had that button)
- **employee**: all off
- Saved custom roles inherit the base pack for **missing** keys (`overlayPack`). Uncheck and Save to hide.

If the current People tab is hidden, the screen falls back to the first allowed tab.

## Files
- `public/assets/login-view-f2j6t0x4-11a3-p0ar.js` — `ACCESS_FLAGS` + `packForBase`
- `public/assets/routes-e2g7y5q8-13m-p0ar.js` — Create/Edit `bp` Extra list; Rewards / People buttons; People tabs
- HTML cache-bust `?v=p0as62` (public / recovered-site / dist / scripts)
- `src/lib/access-views.test.ts`, `access-roles-list.test.ts`, `target-mass.test.ts`, `package.json`

## Tests
| File | result |
| src/lib/access-views.test.ts | **5 pass** |
| src/lib/access-roles-list.test.ts | pass |
| src/lib/target-mass.test.ts | pass |
| src/lib/company-perf-tab.test.ts | pass |
| src/lib/g9-two-client.test.ts | pass |
| `node --check` login-view + routes | pass |

Paste: **35 pass / 0 fail** (access-views + roles + mass + tab-perf + G9). fallbackPost absent.

## Step 1 locks still held
fallbackPost gone? **yes**. POST 410? unchanged. UI keys out of DB? yes. No deploy. Not Step 8. Not roster.

## Known broken / not done
- Live still p0as39 until Eng cuts this tree. Hard refresh must load `?v=p0as62`.
- G9 live-see still fail on production until cut.
- Restore targets still incomplete on live.

## HANDOFF
- Step: ACCESS-VIEWS **done in tree**
- Stamp / host: **p0as62** / live p0as39
- LOCKS new this step: Mass update + People views are Extra flags on Create/Edit access role
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass**; live **untested**
- Exact next step: Eng cut p0as62. Do not start Step 8.
