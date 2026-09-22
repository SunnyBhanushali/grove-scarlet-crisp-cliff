# REPORT-DND-LIFT

## Status
done in this tree. 19 Sep 2026 21:20 IST. Stamp **p0as22**. Not deployed.

## What was wrong
Video 1: inverted dark native-looking bar + empty list. Cause: ghost cloned the whole `[data-drop]` (parent + kids), CSS collapsed `height:0; overflow:hidden` on the parent so the **entire tree vanished**, ghost fallback background was `#1a1612`.

## What it does now (videos 2–3)
- Handle lifts **only the person/row chrome** as a cream card with shadow; follows the pointer.
- Nested people stay on screen.
- Hover between rows → gap the height of the card.
- Hover on a row → nest highlight.
- No inverted screenshot ghost.

## Files
- `apms-dnd.css`
- `routes-e2g7y5q8-13m-p0ar.js` (`$s`, `ec`, ghost clone, pad, `data-dnd-row`)

## Tests
`node --check` routes: **pass**. people-marks: **3 pass**. Pointer feel untested in this sandbox.

## HANDOFF
DND-LIFT-2 done. Hard-refresh after p0as22 cut. Not Step 8.
