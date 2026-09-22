# REPORT-PLANS-FILTERS

**When:** 20 Sep 2026 11:40 IST  
**Stamp:** routes `p0as50`  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

APMS Plans and Rewards Plans share `hs()`. The search bar under "Add APMS" / "Add Reward Plan" is now:

| Field | Before | After |
|---|---|---|
| Brands | single `<select>` | multi `McList` |
| SBUs | missing | multi `McList` |
| Functions | single `<select>` | multi `McSimple` |
| Months | year + month, two fields | one field, `September 2026` rows from `e.months` |
| Roles | single `<select>` | multi `McSimple` |
| Bands | All / Below 4 / Above 4 / 1–6 / 4 and below / … | Band 1–6 only, multi |
| States | single `<select>` | multi `McSimple` |

Empty selection = all (same as the old "All …" option). Matching is OR within a field, AND across fields.

## Files

- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public copy)
- `McSimple` added next to existing `McList` / `Sc` picker
- `AwBandSel` options stripped to Band 1–6 (awards team picker too)
- HTML stamps `routes-e2g7y5q8-13m-p0ar.js?v=p0as50`

## Not touched

G9, roster, restore, POST /api/company, fallbackPost, OT/CRDT, deploy.

## Smoke after Eng cut

1. APMS → Plans and Rewards → Plans.
2. Each filter opens a checkbox list; picking two brands or two bands narrows the list.
3. Bands show only Band 1 … Band 6.
4. One Months control (no separate Years).
5. All SBUs is present and filters people on that SBU.

## HANDOFF

Tree stamp **p0as50**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Hard refresh after cut.
