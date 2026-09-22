# REPORT-PLANS-UX

**When:** 20 Sep 2026 12:40 IST  
**Stamp:** routes **p0as52**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Rewards + APMS **Plans → KPI structure** (shared `du()`).

| Item | Before | After |
|---|---|---|
| Team option | First name’s team (`Nikhil's team`) | Full name’s team (`Nikhil Dsilva's team`) |
| KRA / KPI order | No drag | Same pointer lift as People: grip, sliding slot, drop. Reorder KRAs. Reorder KPIs. Drop a KPI onto another KRA to move it. |
| Weight / target / floor | Clearing the field snaps to `0`, next digits become `020` | Empty stays empty while typing. Commit the number only after a real digit. Blur with empty keeps the previous value. |

## Files

- `src/lib/apms-org-scope.ts` — `teamLabel` uses `person.name`
- `recovered-site/assets/apms-org-scope-p0ao.js` (+ public / dist), stamp `?v=p0as52`
- `src/lib/apms-dnd.ts` — `applyPlanDrop`, `parseWeightPct`, `slotToDrop` uses the target row’s key (mixed `kra:` / `kpi:`), `projectSlot` allows `minFloor:0`
- `recovered-site/assets/apms-dnd-engine.js` (+ public / dist), stamp `?v=p0as52`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` — `rc` `minFloor`, Plans wrap, `__wnum` draft inputs, `Scp` resolves team chips from `scopeId`
- HTML `routes-…p0ar.js?v=p0as52`

## Tests

`apms-dnd.test.ts` + `apms-org-scope.test.ts` + `g9-two-client.test.ts`: **pass**. `node --check` routes: **pass**.

## Not touched

G9, roster, restore, POST /api/company, fallbackPost, OT/CRDT, deploy, awards Parameters (different surface).

## Smoke after Eng cut

1. Rewards → Plans and APMS → Plans, open KPI structure.
2. Applies as → Team. Options read `Full Name's team`. Existing chips restamp from `scopeId`.
3. Drag a KRA by the grip; neighbours slide; drop reorders. Drag a KPI onto another KRA; it moves. No refresh.
4. Clear a weight / target / floor. Field is blank. Type `20` → `20`, not `020`.

## HANDOFF

Tree stamp **p0as52**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Hard refresh after cut. Do not start Step 8. Do not start roster.
