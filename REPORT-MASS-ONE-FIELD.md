# REPORT-MASS-ONE-FIELD

**When:** 20 Sep 2026 13:26 IST  
**Stamp:** routes **p0as59**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Mass update is **Unlock against** only.

- No Field dropdown
- No SBU
- No Held role
- Dropdown = that month’s Targets (Groups / Studios / Other metrics)
- Mass update button is on Rewards month lists only
- Update stays disabled until a target is picked

## Files

- `src/lib/target-mass.ts` — `MASS_FIELDS_REWARDS = [targetNodeId]`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js`
- `src/lib/target-mass.test.ts`

## HANDOFF

Tree stamp **p0as59**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server`. Do not start Step 8.
