# REPORT-RESTORE-FIX

## Status
done in this tree. **Not deployed.** Not Contabo. Not Step 8.

## Why Targets was empty
Settings restore posted the file, persistBooks(`replace`) wrote whatever was in it, then `importHotTables` upserted `target_cells` and **soft-deleted every live cell not in the file**.

The 2026-09-19 backup lists 6 target months (`targetMonthStatus`) and 963 reward rows pointing at 23 `targetNodeId`s, but **`targetNodes` and `targetCells` in that file are empty**. Restore “succeeded” and blanked live Targets. Users then ran Targets Import, which minted **new** node ids and broke Rewards plan ↔ node links.

Targets Import is not part of restore. It must not run here.

## After
| Case | Result |
|------|--------|
| File has people + rewardRecords + targetNodes + targetCells | persist targets book (same ids) + import hot rows; GET assemble uses those cells |
| File lists target months and nodes/cells are empty | **400** — `This backup has target months but no target cells. Restore cancelled.` Live graph not replaced |
| File has no targets graph at all | do not blank stored interiors |
| Targets Import | not called |

## Tests
| File | result |
|------|--------|
| src/lib/company-restore-targets.test.ts | pass |
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| src/lib/load-rows-cutover.test.ts | pass |
| src/lib/company-live-visibility.test.ts | pass |
| src/lib/company-perf.test.ts | pass |

**111 + 25 pass / 0 fail** (overlapping restore tests in the second batch). fallbackPost absent. POST `/api/company` 410 except restore flags.

## Known broken
- The Sept 19 backup **cannot** restore Targets — the graph is not in the file. Need a copy that actually contains `targetNodes` + `targetCells` (hourly/manual backup from before the wipe).
- Live apms. not cut from this agent.

## HANDOFF
- RESTORE-FIX **done in this tree**
- LOCK: restore writes books + hot rows including full targets graph; never uses targets-import; empty-targets file is an error not a success
- Next: Eng cut when asked. Do not start Step 8.
