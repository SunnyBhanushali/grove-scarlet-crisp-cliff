# REPORT-STEP-7

## Status
done

## Zip / preview
- output zip id or filename: none required (reports only). No Drive zip. No deploy.
- preview URL if any: Grok App Builder live preview (this conversation). No Contabo.
- See also [LOAD-ROWS-CUTOVER.md](/workspace/LOAD-ROWS-CUTOVER.md)

## What was proven

Row path (entity PATCH + GET assemble from rows) holds under concurrent edits in isolated PGLite. Book PATCH still ignores people/records/rewardRecords/targetCells. No new tables, no route changes, no catalog/role rewrite.

## Tests
Re-ran together just now:

| File | pass/fail/not run |
|------|-------------------|
| src/lib/company-books.test.ts | pass |
| src/lib/apms-sync.test.ts | pass |
| src/lib/three-team-concurrency.test.ts | pass |
| src/lib/company-ui-session.test.ts | pass |
| src/lib/company-hot-tables.test.ts | pass |
| src/lib/company-entities.test.ts | pass |
| src/lib/company-assemble.test.ts | pass |
| src/lib/load-rows-cutover.test.ts | pass |

Actual summary line: `# tests 111 # pass 111 # fail 0`

`fallbackPost` still absent (0 hits).

## A1–A7

| ID | Result |
|----|--------|
| A1 | **pass** (row-path parallel hire + lock; both survive assemble) |
| A2 | **pass** (two people same month 200; stale same person 409) |
| A3 | **pass** |
| A4 | **pass** (unit + live unsigned POST 401, signed 410) |
| A5 | **pass** |
| A6 | **pass** (seed 180, live GET 180) |
| A7 | **pass** |
| Two-browser hire+lock | **untested** (signed in both contexts; did not invent UI clicks) |

## Live People count
Signed GET `/api/company`: **180**. UI “TEAM SIZE 175” is scoped-team, not GET. Not empty.

## Step 1 locks still held
- fallbackPost gone? yes
- POST 410? yes (unsigned 401 first)
- pullLive dirty-skip? yes
- UI keys out of DB? yes
- person-month-conflict? yes
- Lock copy? yes
- GET from rows? yes
- Book PATCH ignores the four collections? yes

## Known broken / not done
- Two-browser concurrent hire/lock smoke **untested**
- 50-VU soak **untested**
- This preview GET is 180 (seed), not Contabo 175
- No Drive zip
- Not deployed
- Step 8 (catalogs/roles into rows) **not started**

## HANDOFF
- Step 7 status: done (cutover proof; no feature work)
- Last zip id: none
- LOCKS new this step: none (proof only)
- OPEN still unfinished: 50-VU soak. Contabo cut (Sunny’s call). Two-browser UI smoke.
- ACCEPTANCE: A1–A7 pass in tests + live GET/POST; browser concurrent UI untested
- Exact next step: Eng staging cut is Sunny’s call. Do not start Step 8. Do not deploy from this agent.
- **Ready for Eng staging cut?** Yes, with caveats listed above. Not a Contabo production cut from here.
