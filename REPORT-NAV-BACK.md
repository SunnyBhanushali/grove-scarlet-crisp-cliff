# REPORT-NAV-BACK

## Status
done in this tree. 19 Sep 2026 20:40 IST. Stamp **p0as15**. Not deployed.

## Bug
Breadcrumbs were fine. The small back arrow called `goBack()` (or `setView('org-people')` from “All people”). People list search / SBU / function / role / status lived in React `useState` inside `kl()`, so remounting the list after a person edit wiped the filters.

## Fix
- Cache People list chrome in `sessionStorage` key `apms-ui-people-list-v1` (client-only, never books/DB).
- `kl()` hydrates from that cache on mount and writes on change.
- `goBack()` still pops `navHistory`; if empty, lands on `org-people` without wiping the cache.
- “All people” uses `goBack()` when history exists.

Files: `src/lib/apms-nav-ui.ts`, `recovered-site/assets/apms-nav-ui.js`, routes + login-view p0ar, `index.html` script tag.

## Tests
| File | result |
|------|--------|
| src/lib/apms-nav-ui.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |

Browser click-through **untested** here. Live still p0as12.

## HANDOFF
- NAV-BACK done in tree (p0as15)
- Next: Eng cut p0as15. Not Step 8.
