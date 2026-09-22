# REPORT-SBU-VIEW

## Status
done in this tree. 19 Sep 2026 22:25 IST. Stamp **p0as31**. Not deployed.

## What was wrong
Allan (function head) has **no personal SBU**. `sbuUnitsForViewer` then returned **[]**, so SBU view showed **No people match** even though 82 people were on the team. The three names sat in **Unassigned**.

## What you should see now
```
Allan Gois
  ├── (studios of people under him)
  │     └── people in that studio
  └── Unassigned  — only team members with no studio
```

- No empty **No people match** card when the team has people
- Allan is the header, not listed again under Unassigned

## Files
- `apms-org-scope-p0ao.js` — `sbuUnitsForViewer` = SBUs of the **people pool**
- `routes-e2g7y5q8-13m-p0ar.js` — `ViewerSbu` wrapper
- cache-bust `?v=p0as31`

## Tests
src/lib/apms-sbu-view.test.ts **2/2 pass**

## HANDOFF
SBU-VIEW done in tree (p0as31). Hard-refresh. Not Step 8.
