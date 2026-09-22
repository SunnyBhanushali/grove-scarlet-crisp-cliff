# REPORT-RESTORE-EMPTY-OK

## Status
done in this tree. 20 Sep 2026 07:12 IST. Stamp **p0as41**. **Not deployed.** Not Step 8.

## What happened
Settings restore showed:

> This backup has target months but no target cells. Restore cancelled.

That 400 was from RESTORE-FIX. It treated “months listed, cells empty” as a corrupt file.

Sunny: if the backup **really has no targets**, that is valid. Do not block restore.

## After
| File | Restore |
|------|---------|
| Has people + targetNodes + targetCells | persist + import those ids (unchanged) |
| Lists target months, zero cells/nodes | **200**. Empty targets is OK |
| File has no graph; live already has interiors | keep live nodes/cells (do not wipe) |
| File **had** cells that did not assemble | still 400 |

Never calls Targets Import.

## Tests
| File | result |
|------|--------|
| src/lib/company-restore-targets.test.ts | 5/5 pass |

## Known broken
- Not cut to Contabo. Live still shows the old 400 until Eng rebuilds the server.

## HANDOFF
- RESTORE-EMPTY-OK **done in tree** (p0as41)
- Next: Eng cut p0as41. Do not start Step 8.
