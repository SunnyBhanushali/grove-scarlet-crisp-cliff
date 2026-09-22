# REPORT-ROSTER-LOCK

## Status
done in this tree. 20 Sep 2026 08:13 IST. Stamp **p0as44**. **Not deployed.** Not Step 8. Not G9. Not R2 split-day.

## Why
R1 overlays the month on screen. Super-admin later editing Current Org (or people identity) must not make a past Rewards / APMS month / award read the current roster. Each of those stores a `rosterId` pointer. Reads use that roster’s assignments only. Changing the pointer is an explicit admin rebind with audit.

## What this is
| Surface | Stores `rosterId` | Read overlay |
|---|---|---|
| Rewards month | `roster_binds` kind=`rewards` subject=`YYYY-MM` | assignments for that roster only |
| APMS month | `roster_binds` kind=`apms` subject=`YYYY-MM` | same |
| Award instance | `roster_binds` kind=`award` subject=`awardId` | award.period as default, then the stored pointer |
| Current Org | no pointer (uses current period roster) | R1 overlay unchanged |
| GET `/api/company` | not overlaid | people identity stays identity |

Default when unbound = **the subject’s own period** (award = `award.period`). **Never current Org.**

First GET `/api/roster-bind/...` writes the initial bind if missing (`source=initial-bind`). That is bind-once, not rebind. `ensureRosterBound` with a different rosterId does **not** move an existing pointer.

## Tables (`migrations/0007_roster_binds.sql`)

**roster_binds**
- PK `(kind, subject_id)`
- `roster_id` text (period of `roster_periods`)
- `bound_at`, `bound_by`, `rev`, `payload`, `updated_at`, `updated_by`, `deleted_at`
- no hard deletes

**roster_bind_audit**
- `id` PK
- `kind`, `subject_id`, `from_roster_id`, `to_roster_id`, `reason`, `by`, `at`, `client_op_id`

Wired into existing migrate (`migrations/*.sql` glob + `deploy:migrate`).

## APIs (same auth as `/api/company` — anon **401**)

| Method | Path | Who |
|---|---|---|
| GET | `/api/roster-bind/:kind/:subjectId` | any signed-in. Persist initial bind if missing. Returns roster assignments for the **bound** `rosterId`. |
| POST | `/api/roster-bind/:kind/:subjectId/rebind` `{ rosterId, reason, clientOpId }` | **admin / super_admin only**. Reason required. Same `clientOpId` → 200, rev unchanged. Writes audit. |

HR rebind → **403** `admin-only`. Missing reason → **400** `reason-required`.

People PATCH / Org roster PATCH / Rewards lock **do not** call rebind.

## Overlay
`apms-roster.js` tick:
- Rewards / APMS / award views → `GET /api/roster-bind/...` then `window.__apmsRoster` = that roster’s assignments
- Org / Roster editor still `GET /api/roster/:period` for the month on screen
- Bound rosterId ≠ subject month → banner “Using roster YYYY-MM.”
- Cache key is `(kind, subject)`, so a rebound pointer does not thrash every 700ms

## Tests (6/6 bind + 11/11 R1)

| Case | result |
|---|---|
| defaultRosterId never returns current Org | **pass** |
| Rewards 2026-04 bound to 2026-04; Org 2026-09 transfer P → SBU-B; overlay 2026-04 still SBU-A | **pass** |
| APMS month + award instance store rosterId; people payload edit does not rebind | **pass** |
| HR rebind 403; no reason 400; admin rebind + audit; same clientOpId no pointer move | **pass** |
| ensureBound twice with a different id does not move pointer; GET assemble identity | **pass** |
| anon GET/POST bind 401; SPA `loadBind` + `/api/roster-bind/` | **pass** |
| R1 suite still 11/11 | **pass** |

Existing suites green: company-books, apms-sync, three-team-concurrency, company-ui-session, company-hot-tables, company-entities, company-assemble, company-live-visibility.

`fallbackPost` absent. POST `/api/company` still 410 unless restore.

## Files
- `migrations/0007_roster_binds.sql`
- `src/lib/company-roster-bind.ts` / `company-roster-bind-http.ts` / `company-roster-bind.test.ts`
- `src/routes/api/roster-bind.$kind.$subjectId.ts` (+ `.rebind`)
- `public/assets/apms-roster.js` + recovered-site copy
- `public/apms.html` / `recovered-site/apms.html` stamp **p0as44**
- `package.json` test script includes the new file

## Not in this step
- Frozen snapshot of assignments (pointer to a period, not a copy-on-write clone)
- Split-month R2
- Rebind UI form (API + audit; overlay consumes the pointer)
- Dual-write people.sbu
- Overlay on GET `/api/company`
- Step 8 catalogs-as-rows
- Deploy / Contabo cut

## HANDOFF

- Stamp / host: **tree p0as44**, **live p0as12 / LOAD-10 p0as14** https://apms.alienstattoo.in
- What passed: bind stores rosterId for rewards/apms/award; Org transfer does not switch pointer; admin rebind + audit; clientOpId replay; anon 401; R1 11/11; existing books/sync/three-team/ui-session/hot-tables/entities/assemble/live-visibility green; fallbackPost absent
- What is still broken: **live G9 until Eng cuts p0as42**; roster R1/lock not on live until p0as43/p0as44 cut; two-browser smoke untested here; split-month not in R1
- Exact next named job: **Eng cut** when Sunny says (`NITRO_PRESET=node-server`). Do not start R2 split-day. Do not start Step 8. G9 only if the G9 prompt is sent.
