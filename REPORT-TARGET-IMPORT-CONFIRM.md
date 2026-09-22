# REPORT-TARGET-IMPORT-CONFIRM

**When:** 20 Sep 2026 13:00 IST  
**Stamp:** routes **p0as55** (sync still **p0as51**)  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Targets Import must not stop the whole file when some Rewards unlocks would stay unmapped.

Previously (p0as51): if a month replace dropped a studio someone was still unlocked against, import **aborted**, returned the original state, and said `this would unmap N rewards`. Nothing imported.

Now:

- Import **always applies** the rows that can apply (even one studio).
- Pointers that can remap (same name + SBU + metric) still remap.
- Pointers that cannot remap are **listed**, not dropped silently, and not used as a reason to abort.
- The sheet asks **Apply anyway** or **Cancel**, showing person/role · month · studio for each unmapped unlock.
- Cancel leaves the book unchanged (dialog closes without save).
- Apply anyway writes the new month layout; unmapped Rewards keep their old `targetNodeId` so they can be fixed with Mass update.
- Restore is unchanged: it still writes the backup’s node/cell ids. Import is not restore.

## Files

- `src/lib/targets-import.ts` — `unmappedRows`, `needsConfirm`, `aborted: false`, `describeUnmapped`
- `src/lib/targets-import.test.ts` — unmapped still applies Goa; list has person/studio/month
- `src/lib/target-mass.test.ts` — SPA copy is Apply anyway / unmappedRows, not `this would unmap`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- HTML `routes-…p0ar.js?v=p0as55`

## Tests

| Case | Result |
|---|---|
| Reimport same studios | ids reused, `unmapped: 0` |
| Import Goa while a Rewards row is unlocked against Mumbai | `aborted: false`, `needsConfirm: true`, `unmapped: 1` (Mumbai), Goa cell exists, Mumbai month cell gone, pointer still Mumbai |
| describeUnmapped | `Arjun · 2026-04 · Mumbai` |
| Remap by identity | pointer rewritten |
| SPA copy | `Apply anyway`, `unmappedRows`, `needsConfirm`; no `this would unmap` |
| Mass 5 + stale 409 | still green |
| `fallbackPost` | absent |
| Dummy template apply | still green |

16/16 pass.

## Smoke after Eng cut

1. Hard refresh so `routes-…p0ar.js?v=p0as55` loads.
2. Import a sheet that drops a studio someone is unlocked against.
3. Amber list of those people/roles. Buttons: **Apply anyway** / **Cancel**.
4. Cancel → month unchanged. Apply anyway → the rest of the sheet is in; listed unlocks stay on the old studio until Mass update.

## Not touched

G9 hops, roster, restore, Step 8, Remix, OT/CRDT, deploy, `POST /api/company` (still 410 except restore), mass-update OCC.

## HANDOFF

Tree stamp **p0as55**. Live still **p0as39 / p0as14**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Do not start roster. Do not start Step 8.
