# REPORT-MASS-CHECK

**When:** 20 Sep 2026 13:05 IST  
**Stamp:** routes **p0as56**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Rewards + APMS month lists (`vs`) showed a checkbox on every person and a Select-all box in the month header. Those boxes stay **hidden** until **Mass update** is clicked.

Flow:

1. Default: no row checkboxes, no Select all. Mass update is enabled.
2. Click **Mass update** → checkboxes appear for that month. Mass update is disabled until someone is selected.
3. Select people (or Select all) → Mass update enabled. Click again → same Mass update dialog as before.
4. After a clean apply (no 409s) checkboxes hide again. Stale 409 rows stay selected.

Same control for Rewards Plans and APMS Plans.

## Files

- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- HTML `?v=p0as56`
- `src/lib/target-mass.test.ts` — asserts `canMass:t&&massOn===r`

## Not touched

G9, import remap, restore, roster, Step 8, mass PATCH OCC, `fallbackPost`.

## HANDOFF

Tree stamp **p0as56**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Do not start Step 8.
