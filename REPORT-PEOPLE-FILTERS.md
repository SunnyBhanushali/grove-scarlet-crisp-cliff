# REPORT-PEOPLE-FILTERS

## Status
done in this tree. 19 Sep 2026 22:00 IST. Stamp **p0as28**. Not deployed.

## What changed
People filter **grid** (brands / SBUs / functions / roles / status / state / sort) starts **collapsed** for everyone except **admin** and **super admin**.

**Always visible** (even when filters are collapsed):
- Search
- Filters / Hide filters toggle
- **List / My team / Company / SBU / Function / Summary**

Those view tabs are no longer inside the collapsible block.

## Files
- `routes-e2g7y5q8-13m-p0ar.js` — tabs sibling of `filtOpen ? grid : null`
- `src/lib/apms-nav-ui.ts` + `public/assets/apms-nav-ui.js` — `peopleFiltersStartOpen` only true for admin/super_admin
- cache-bust `?v=p0as28`

## Tests
| File | result |
| peopleFiltersStartOpen (hr/manager/employee false, admin/super_admin true) | **pass** |
| bundle: tabs after `:null,` not inside filtOpen wrapper | **pass** |
| `node --check` routes | pass |

## HANDOFF
PEOPLE-FILTER-TABS done in tree (p0as28). Hard-refresh. Not Step 8.
