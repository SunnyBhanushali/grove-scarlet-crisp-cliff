# REPORT-APMS-FY

## Status
done in this tree. 20 Sep 2026 11:20 IST. Stamp **p0as48**. **Not deployed.**

Product host is **https://apms.alienstattoo.in**. Not staging.

## Change
APMS month lists started the year in **January** (calendar Q1 Jan-Mar). Rewards already uses the company year **April → March**. Both now use that year.

| | before | after |
|---|---|---|
| APMS year | Jan–Dec 2026 | FY26 = Apr 2026–Mar 2027 |
| APMS Q1 | Jan-Mar | Apr-Jun |
| APMS Q4 | Oct-Dec | Jan-Mar |
| Rewards | Apr→Mar | unchanged |

Jan / Feb / Mar still exist as months; they sit in the previous FY (Q4), same as Rewards.

## Files
- `src/lib/apms-fy.ts`, `src/lib/apms-fy.test.ts`
- `recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js` + public copy (`ApmsMonths`, `Uo`, `monthQ`)
- `login-view-…p0ar.js`: `gc` Apr→Mar, `hc` FY quarters, Lo fallback `2026-04`

## Tests
`apms-fy` 4/4. G9 two-client still green. `fallbackPost` absent.

## HANDOFF
```
APMS-FY-APRIL done in tree. Stamp routes?v=p0as48 + login-view?v=p0as48.
APMS months now start April, same year as Rewards.
Next: Eng cut when asked. Do not deploy from this agent.
```
