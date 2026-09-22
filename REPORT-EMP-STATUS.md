# REPORT-EMP-STATUS

**When:** 20 Sep 2026 12:50 IST  
**Stamp:** routes `p0as53`  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Employee status is now only:

- **Active** (stored `active`; `joining` still counts as active in filters)
- **Paused** (stored `paused`)
- **Exited** (stored `left` — same key as before, so org-scope / `$i` / left_ytd keep working)

Places:

| Surface | Change |
|---|---|
| APMS + Rewards Plans “All states” | Active / Paused / Exited (multi). Empty = all. Filters `person.status`. |
| People list status | Active / Paused / Exited / All |
| Hire form + person file | same three. Exit date still only when Exited. Label **Exited on**. |
| Name badges | **Exited** or **Paused** |

Did not change plan-cycle `zo()` on People (Plan open / locked / closed). Did not rewrite roster schema. `left` is not renamed in the database.

## Files

- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- HTML `routes-…p0ar.js?v=p0as53`
- `src/lib/emp-status-ui.test.ts`

## HANDOFF

Tree stamp **p0as53**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Hard refresh after cut. Do not start Step 8. Do not start roster.
