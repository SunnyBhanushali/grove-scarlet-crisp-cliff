# REPORT-MASS-UNLOCK

**When:** 20 Sep 2026 13:15 IST  
**Stamp:** routes **p0as58**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Mass update **Unlock against** is that month’s Targets list, nothing else.

- Cells for this month (`nodeId::month` or `cell.month`)
- Members / root order for this month
- Same Groups / Studios / Other metrics grouping as the person-month Unlock against picker
- Other months’ studios are not listed
- Empty month: “No targets for {month} yet”

SBU and Held role stay as separate fields. Apply still PATCHes `targetNodeId` per row.

## Files

- `src/lib/target-mass.ts` — `monthUnlockNodes`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- `src/lib/target-mass.test.ts`

## HANDOFF

Tree stamp **p0as58**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server`. Do not start Step 8.
