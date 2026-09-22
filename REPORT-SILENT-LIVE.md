# REPORT-SILENT-LIVE

## Status
done (this tree). Not deployed. Not Contabo. Not Step 8.

## Zip / preview
- stamp `apms-sync.js?v=p0as11` + `routes-e2g7y5q8-13m-p0ar.js?v=p0as11`
- no Contabo cut

## What was wrong
The yellow bar (`Someone else saved this same person in this month. Refresh to take their version`) painted **site-wide**, including Settings, for idle users.

Two causes:
1. Auto-save before hydrate treated the assembled company as a dirty months/org book and mapped 409 to `person-month-conflict` + global SyncBar.
2. `pullLive` skipped the whole months/org book if any slice was dirty, then the save path nagged everyone to Refresh.

That is not Sheets/Zoho. Other sessions must absorb remote hires/locks silently.

## Fix
1. First save before `noteLoaded` is a no-op (hydrate, not an edit).
2. Entity 409 retries last-write-wins on row rev. Save does **not** return `person-month-conflict` to the SPA.
3. `pullLive` still skips while `isBlocked` (in-flight save). Dirty **plans** still skip. Dirty org/months/targets still **pull** and `mergeKeepPeople` / month overlay.
4. Overlay restores only the dirty personId+period slice. A remote lock on a **different** person still lands.
5. Same personId+period dirty + remote change → `rowConflicts` (record-level). `showGlobalConflictBar()` is always false.
6. SyncBar: never the old Refresh copy. Hidden on Settings / Home / Org. Record-level copy only on `rewards-person` / `apms-person` / `person-month` for that id+period. Dismiss does not come back (`dismissRowConflict`).

## Tests

| Case | result |
|------|--------|
| A PATCH people 200 → B pullLive sees name, banner hidden | pass |
| A PATCH reward-record on X, B idle Settings → no banner, lock in state | pass |
| B dirty on X+month, A saves X+month → keep B draft, row conflict on X only, Y lock merges, no global bar | pass |
| routes has no “Refresh to take their version” copy | pass |
| company-books / apms-sync / three-team-concurrency / company-ui-session / hot-tables / entities / assemble / live-visibility | pass |
| fallbackPost | absent |
| POST /api/company (non-restore) | 410 |

Summary this run: **116 pass / 0 fail**.

## Step 1 locks still held
- fallbackPost gone: **yes**
- POST 410: **yes**
- pullLive dirty-skip: **yes** for in-flight (`isBlocked`) and dirty **plans**; org/months overlay is slice-level
- UI keys out of DB: **yes**
- person-month-conflict global bar: **removed**
- Lock copy “Nothing open.”: still absent

## Known broken / not done
- Not re-run in a two-browser UI (Playwright sign-in untested).
- apms8 / Contabo still old until Sunny cuts this tree.
- LOAD-25 G8/G9 not re-run on a live host.

## HANDOFF
- Step: LIVE-FIX silent merge — **done in this tree**
- Last stamp: `p0as11`
- LOCKS new this step: no global “Refresh to take their version” bar; silent merge for non-overlapping sessions; conflict UI only on dirty same person+month
- OPEN: Contabo cut still Sunny’s call; do not start Step 8
- ACCEPTANCE: unit/integration pass; browser smoke untested
- Exact next step: Eng staging re-cut / LOAD-25 visibility re-run. Do not deploy from this agent. Do not start Step 8.
