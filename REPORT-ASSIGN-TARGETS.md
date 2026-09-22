# REPORT-ASSIGN-TARGETS

## Status
done in this tree. 19 Sep 2026 21:17 IST. Stamp **p0as21**. Not deployed.

## Change
Settings → **Assign people** no longer has a **Targets** column (Yes / — / Can edit checkbox on `person.gateAccess`).

Who can open or edit Targets is the **Targets** module on the access role (Settings → Access roles), via `canAccess(person, 'targets', view|edit)`. The old `gateAccess` person flag is ignored for that check.

## Files
- `routes-e2g7y5q8-13m-p0ar.js` — table header + cell removed
- `login-view-f2j6t0x4-11a3-p0ar.js` — `hl()` no longer ORs `gateAccess`

## Tests
`node --check` routes + login-view: **pass**.

## HANDOFF
ASSIGN-TARGETS done. Hard-refresh after p0as21 cut. Not Step 8.
