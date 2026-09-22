# REPORT-REFRESH-VIEW

## Status
done in this tree. 19 Sep 2026 21:30 IST. Stamp **p0as24**. Not deployed.

## Bug
Browser refresh always landed on Home. Screen location (`view`, selected person/month/role, nav history) is client-only — persist `partialize` is `kp()` which omits it, and company GET must not write it. The store still inits `view:"home"`. Zustand persist then **async-rehydrates** from `localStorage` (`aliens-apms-complete-v38`) with `set(merged, true)` replace. Legacy blobs still carry `view:"home"`, so hydrate wiped People / Rewards / a person after `loadSession()` had already restored them. A subscriber that saved that Home into `sessionStorage` could poison the next refresh too.

## Fix
- Screen location lives in `sessionStorage` key `apms-ui-session-v1`. Never books / DB.
- First read this page-load is frozen (`bootSession`) so a later Home write cannot win.
- Persist `merge` runs `applySession` so company hydrate cannot replace the screen.
- `onFinishHydration` reapplies it. Subscribe does not `saveSession` until persist `hasHydrated()`.
- `login-view` cache-bust `?v=p0as24` (was p0as19).

Sign-in still starts at Home. Logout still Home.

## Files
- `src/lib/apms-nav-ui.ts` — `loadSession` / `saveSession` / `applySession` / `bootSession`
- `recovered-site/assets/apms-nav-ui.js` (copied to public + dist)
- `login-view-f2j6t0x4-11a3-p0ar.js` persist merge + hydrate
- `routes-e2g7y5q8-13m-p0ar.js` mapDeps `?v=p0as24`
- `index.html` / `apms.html` / `scripts/apms-spa.html`

## Tests
| File | result |
|------|--------|
| src/lib/apms-nav-ui.test.ts | **6 pass** |
| src/lib/company-ui-session.test.ts | **pass** |
| `node --check` login-view + routes + nav-ui | **pass** |

Browser refresh click-through untested here. Live still p0as12.

## HANDOFF
REFRESH-VIEW done in tree (p0as24). Hard-refresh after cut. Not Step 8. Do not deploy from this agent.
