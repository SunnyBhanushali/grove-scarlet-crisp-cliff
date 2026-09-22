# REPORT-PLAN-DND

**When:** 20 Sep 2026 13:10 IST  
**Stamp:** routes **p0as57**, `apms-dnd.css?v=p0as57`  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

1. The overlapping grip icon on KRA/KPI rows is gone. Hold the **title** (grab cursor) and drag — same pointer lift as People. Expand, weight, rename, and delete still ignore the press.
2. While a **KRA** is lifting, every KRA body (KPIs) hides (`apms-rt--dragging-kra` + `.plan-kra-body`). Slot math skips KPI rows. Drop / Esc restores the previous open/closed state. KPI drags do not collapse KRAs.

## Files

- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- `public/assets/apms-dnd.css`
- HTML `?v=p0as57`
- `src/lib/apms-dnd.test.ts`

## Not touched

G9, mass update, import, restore, roster, Step 8, `fallbackPost`.

## HANDOFF

Tree stamp **p0as57**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Do not start Step 8.
