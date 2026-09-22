# REPORT-MY-REWARDS-ONE

## Status
done in this tree. 20 Sep 2026 ~15:55 IST. Stamp **p0as66**. Not deployed.

## Zip / preview
- tree stamp **p0as66** (`routes-…p0ar.js?v=p0as66`)
- sync still **p0as65**
- live still **p0as39 / p0as14**

## What was wrong
Two pages for the same person’s Rewards:

1. Sidebar **My Rewards** (`rewards-me` / `Km`) — Your performance + year cards
2. Plan editor → breadcrumb name / All Rewards (`rewards-person` / `Os`) — name header + year cards + month table

`setSelectedPerson` always set `view` to `rewards-person`, so opening yourself from a plan never used My Rewards.

## What changed
- `setSelectedPerson(self)` → `rewards-me` / `apms-me`
- `setSelectedPerson(someone else)` → still `rewards-person` (manager looking at a report)
- Os: if the person is you, render My Rewards
- Dropped leftover `setView('rewards-person')` after `setSelectedPerson`
- Employees bounced from Targets go to My Rewards

## Files
- `public/assets/login-view-f2j6t0x4-11a3-p0ar.js`
- `public/assets/routes-e2g7y5q8-13m-p0ar.js`
- `src/lib/my-rewards-one.test.ts`

## Tests
| File | result |
| src/lib/my-rewards-one.test.ts | **3 pass** |
| src/lib/access-views.test.ts | pass |
| src/lib/iu-black.test.ts | pass |
| `node --check` routes + login-view | pass |

Paste: **29 pass / 0 fail**. fallbackPost absent.

## Step 1 locks still held
fallbackPost gone? **yes**. POST 410? unchanged. UI keys out of DB? yes. No deploy. Not Step 8.

## Known broken / not done
- Live still p0as39 until Eng cuts.
- Other people’s year page is kept (All Rewards on a report).

## HANDOFF
- Step: MY-REWARDS-ONE **done in tree**
- Stamp / host: **p0as66** / live p0as39
- LOCKS new this step: self Rewards is My Rewards only
- OPEN still unfinished: Eng cut; live G9; live restore
- ACCEPTANCE: tree **pass**; live **untested**
- Exact next step: Eng cut p0as66. Do not start Step 8.
