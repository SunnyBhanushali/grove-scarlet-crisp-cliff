# REPORT-ROLE-HOOK

**When:** 20 Sep 2026 12:55 IST  
**Stamp:** routes `p0as54`  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What failed

Clicking **Role** on an employee file (after creating a role) painted the black “Could not open Aliens APMS” screen.

React **#318** — *Should have a queue. You are likely calling Hooks conditionally.*

Stack: `$o` in `routes-…p0ar.js` → `useState`.

`$o` is the FY rewards year cards on the person file. It did:

1. `if (!person) return null`
2. `ge(...)` — if that is null, `return null`
3. **then** `useState`

Opening Role re-renders the person file. `ge()` can flip (no role → new role, or throw). Hook count changed. Error boundary.

The role **did save**. After login it showed. This was render-only.

## Fix

- `useState` is the first thing `$o` does.
- `ge()` is in try/catch; missing `quarters` returns null **after** the hook.
- Role picker (`Pc`) uses `String(name||"")` so a brand-new role with no name does not throw on search.

## Files

- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` (+ public / dist)
- HTML `?v=p0as54`
- `src/lib/role-picker-hook.test.ts`

## HANDOFF

Tree stamp **p0as54**. Eng rebuilds `NITRO_PRESET=node-server` and cuts https://apms.alienstattoo.in. Hard refresh after cut. Do not start Step 8.
