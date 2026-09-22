# REPORT-ACCESS-MONTH

## Status
done in this tree. 20 Sep 2026 ~15:40 IST. Stamp **p0as63**. Not deployed.

## Zip / preview
- tree stamp **p0as63** (`routes-…p0ar.js?v=p0as63`, login-view `?v=p0as63`)
- live still **p0as39 / p0as14** https://apms.alienstattoo.in
- no new migration

## What changed

On Rewards / APMS person-month (the Month-end actuals page):

1. **Achieved** is no longer a dead input when you cannot write. Without write access it paints like Target / Floor — a plain number (or —). Input only if Extra flag `month_actuals` is on **and** existing scorer rules still pass (not scoring your own row; month not frozen unless `frozen_edit`).
2. **Fill monthly actuals**, **See change log**, **Lock & close · Rewards**, **Lock & close · APMS** are Extra flags on Create / Edit access role.
3. **Self comments** — the person can type while their plan is open or locked. It used to require Closed, so clicking did nothing. Viewers who cannot write see the text, not a disabled textarea. Same for Manager notes.
4. **Change log** icon (and Targets Change log) is hidden without `changelog`. Managers / employees default off.
5. **Lock plan / Close plan** on Rewards / APMS require `lock_rewards` / `lock_apms`.

| Flag | What it shows |
|---|---|
| `month_actuals` | Achieved as an input (Month-end actuals) |
| `changelog` | Change log on the month page (and Targets) |
| `lock_rewards` | Lock plan / Close plan on Rewards |
| `lock_apms` | Lock plan / Close plan on APMS |

Defaults so nothing disappears until an editor unchecks:

- **super_admin / admin / hr**: all four on
- **function_head / manager**: actuals + both lock/close on; changelog **off**
- **employee**: all off
- Saved custom roles inherit the base pack for **missing** keys (`overlayPack`).

## Files
- `public/assets/login-view-f2j6t0x4-11a3-p0ar.js` — `ACCESS_FLAGS`, `packForBase`, `Qp` scores gate
- `public/assets/routes-e2g7y5q8-13m-p0ar.js` — Create/Edit Extra list; Achieved cell; changelog; lock/close; Self comments
- HTML `?v=p0as63` (public / recovered-site / dist / scripts)
- `src/lib/access-views.test.ts`

## Tests
| File | result |
| src/lib/access-views.test.ts | **pass** |
| src/lib/access-roles-list.test.ts | pass |
| src/lib/target-mass.test.ts | pass |
| src/lib/company-perf-tab.test.ts | pass |
| src/lib/g9-two-client.test.ts | pass |
| `node --check` login-view + routes | pass |

Paste: **39 pass / 0 fail**. fallbackPost absent.

## Step 1 locks still held
fallbackPost gone? **yes**. POST 410? unchanged. UI keys out of DB? yes. No deploy. Not Step 8. Not roster.

## Known broken / not done
- Live still p0as39 until Eng cuts this tree. Hard refresh must load `?v=p0as63`.
- G9 live-see still fail on production until cut.
- Restore targets still incomplete on live.

## HANDOFF
- Step: ACCESS-MONTH **done in tree**
- Stamp / host: **p0as63** / live p0as39
- LOCKS new this step: `month_actuals` / `changelog` / `lock_rewards` / `lock_apms` Extra flags; Achieved is a value without write; Self comments on open/locked
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass**; live **untested**
- Exact next step: Eng cut p0as63. Do not start Step 8.
