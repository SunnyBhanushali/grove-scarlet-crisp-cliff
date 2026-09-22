# REPORT-BUILD-FIX

## Status
done in this tree. 19 Sep 2026 19:37 IST. Stamp unchanged **p0as14**. Not deployed.

## What broke
`npm run build` / publish failed:

```
[builtin:vite-transform] Expected `}` but found `EOF`
src/lib/company-restore-http.ts:101
Opened at restoreCompanyFromUpload (`}> {` line 39)
```

`restoreCompanyFromUpload` lost its closing brace when RESTORE-FIX added the try/catch. SSR vite build stopped; client build had already succeeded.

## Fix
Closed the function. Return type now includes `targetNodes` / `targetCellKeys` / `targetNodeIds` optional counts.

File: `src/lib/company-restore-http.ts`

## Tests
- `npm run build` — **pass** in this sandbox (vite client + ssr + nitro; `db:migrate` skipped, no DATABASE_URL)
- Live publish — **untested** (this agent does not cut Contabo)

## HANDOFF
- BUILD-FIX done. Next named job: Eng cut p0as14. Not Step 8.
