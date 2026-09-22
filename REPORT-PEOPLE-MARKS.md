# REPORT-PEOPLE-MARKS

## Status
done in this tree. 19 Sep 2026 22:10 IST. Stamp **p0as30**. Not deployed.

## Rule (p0as30)
**MR** = this person **reports to more than one manager**. That is the only case.

Arjun Sood is the example: **MR** + blue square Vishal Kumar + orange circle Avnish Chollera.

Sunny, Vishal, Ami, Fawaz, etc. with a team and **one** boss: **no MR**, no chips.

Having many reportees is not multi-reporting.

## Files
- `routes-e2g7y5q8-13m-p0ar.js` — `MrHint` returns null unless `isDualPerson`. `hasManyReports` removed.
- cache-bust `?v=p0as30`

## Tests
people-marks + access-roles-list **10/10 pass**
`node --check` routes **pass**

## HANDOFF
MR-DUAL-ONLY done in tree (p0as30). Hard-refresh. Not Step 8.
