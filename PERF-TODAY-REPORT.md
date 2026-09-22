# PERF-TODAY-REPORT

Same drop as `REPORT-PERF-FIX.md`. Stamp **p0as12**. Host: **https://apms.alienstattoo.in** (production).

## Before / after GET
- Before: 30–50s, ~5MB, If-None-Match still 200 + new ETag, idle ticks re-assembled.
- After (this tree): matching `at` → `{ unchanged: true }` no snapshotJson; `?books=` from wire cache; importHotTables on GET at most once; idle gens-equal → no book GET.

## What changed
- `getCompanyWire` returns cache immediately; `at` frozen until `invalidateCompanyWire` (writes only).
- `loadRequestedBooks` uses that cache.
- `assembleForGet` imports empty hot tables once.
- Hourly backup off the GET path.
- Client: If-None-Match on GET; pullLive does not download books when gens match.
- Stamp `apms-sync.js?v=p0as12`.

## Remaining debt
Cold GET still one full assemble. Slim/hot-only first paint not in this drop. Eng must cut Contabo; this agent has no SSH.

Tests: **121 pass / 0 fail.**
