# REPORT-TARGET-MASS

**When:** 20 Sep 2026 ~12:15 IST  
**Stamp:** routes + sync **p0as51**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Two jobs, this tree only.

### 1) Targets Import must not orphan Rewards

Spreadsheet import upserts target nodes by **(kind, name, sbuId, metric)**. Existing `targetNodes.id` is reused when that identity matches (unique name+kind is the fallback for old sheets).

After a month replace:

- Pointers on `reward_records.targetNodeId` and `rewardRoleMonths` for the wiped months are remapped by the same identity **before** the new layout is kept.
- If a mapped id would drop and cannot remap, import **aborts**, returns the original state, and reports `this would unmap N rewards`.
- Restore is unchanged: it still writes the backup’s node/cell ids. Import is not restore. No admin remap endpoint.

### 2) Mass update on Rewards and APMS

Month view (`vs`): checkbox per person who has a plan, Select all in the current month list, **N selected**, **Mass update** (disabled when none selected).

Dialog: one field, one value, Confirm with count.

| Kind | Fields this step |
|---|---|
| Rewards | `targetNodeId` (studio/node for that month, also writes `targetSbuId` / `targetMetric` like Unlock against), `targetSbuId`, `heldRoleId` |
| APMS | `heldRoleId` (plan template). No KPI/KRA/lock/status mass-edit |

OCC: each selected row is **one** entity PATCH with that row’s `baseRev`. Result: `N updated, M stale (409), K failed.` 409 rows stay selected. No overwrite-retry. No `POST /api/company`. Entity PATCH still publishes `entities[]` so G9 merge works.

## Files

- `src/lib/targets-import.ts` + `.test.ts` — reuse, remap, abort
- `src/lib/target-mass.ts` + `.test.ts` — allowed fields, payload, OCC
- `recovered-site/assets/apms-sync.js` — `massPatch` (one-shot, 409 not retried)
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` — inlined import + `MassDlg` / `vs` checkboxes
- public copies + HTML `?v=p0as51`

## Tests

| Case | Result |
|---|---|
| Reimport same studios | `targetNodeId` still maps; ids reused |
| Import that would drop a mapped id | aborted, original state, `this would unmap 1 rewards` |
| Remap when identity matches a new id | pointer rewritten |
| Mass 5 people `targetNodeId` | GET shows new id |
| One stale rev | 4 updated, 1 409, stale row unchanged |
| Select none | action disabled |
| `massPatch` 409 | one PATCH, no retry |
| `fallbackPost` | absent |
| Dummy template apply | still green |

## Not touched

G9 hops, roster, restore, Step 8, Remix, OT/CRDT, deploy, `POST /api/company` (still 410 except restore).

## Smoke after Eng cut

1. Hard refresh so `routes-…p0ar.js?v=p0as51` and `apms-sync.js?v=p0as51` load.
2. Import the same Targets sheet twice for a month that already has Rewards unlocks — pointers stay.
3. Import a sheet that drops a studio someone is unlocked against — abort, no silent unmap.
4. Rewards → Plans, month open: select 5 people, Mass update → Unlock against a studio. Other tab sees the new node (G9). If one row was edited elsewhere, it stays selected as stale.

## HANDOFF

Tree stamp **p0as51**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Do not start roster. Do not start Step 8.
