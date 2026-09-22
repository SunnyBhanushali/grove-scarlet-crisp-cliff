# REPORT-ROSTER-R1

## Status
done in this tree. 20 Sep 2026 ~08:15 IST. Stamp **p0as43**. **Not deployed.** Not Step 8. Not G9. Not R2 split-day.

## Why
Artists change SBU/team every month. Past APMS and Rewards stay keyed by `(personId, period)` and must not move when the person transfers. Current Org reads the current roster. HR locks a month after Rewards close.

## What R1 is
Roster is a **new assignment table**, not a second People database.

| Surface | Role |
|---|---|
| `people` / `/api/people` | identity (id, name, role, login, status flags) |
| `roster_assignments` | SBU / manager / function / brand / company **for a period** |
| `roster_periods` | draft \| current \| locked per `YYYY-MM` |
| Current Org | overlay of roster for the current (or on-screen) period |
| Rewards / APMS team lists | overlay of roster for the month on screen |
| Historical month_records / reward_records | **never rewritten** on transfer |

GET `/api/company` does **not** overlay roster onto `people`. Identity on the wire stays identity.

## Tables (`migrations/0006_roster.sql`)

**roster_periods**
- `period` text PK (`YYYY-MM`)
- `status` draft \| current \| locked
- `locked_at`, `locked_by`, `copied_from`, `updated_at`, `updated_by`, `rev`

**roster_assignments**
- `id` PK
- `period`, `person_id`
- `sbu_id`, `brand_id`, `company_id`, `function_id`, `manager_id` (nullable text)
- `line` solid \| dotted (default solid)
- `status` active \| left \| paused \| joining
- `start_date`, `end_date` (R1 = full month; schema ready for R2)
- `allocation_pct` default 100
- `reason`, `payload` jsonb
- `rev`, `updated_at`, `updated_by`, `deleted_at`

**Unique live key (documented):**
1. one **solid** assignment per `(period, person_id)` — `roster_assignments_primary_solid`
2. `(period, person_id, coalesce(sbu_id,''), start_date)` on live rows — `roster_assignments_period_person_sbu_start`

No hard deletes. Indexes on `(period)`, `(person_id, period)`.

## Seed
`ensureRosterSeeded` (idempotent, first GET/PATCH):
- period rows for current calendar month + last 3 + months already in `month_records` / `reward_records`
- copies live people team fields (`buId`, `brandId`, `companyId`, `functionId`, `managerId`) into the **current** period at 100% solid, full month
- skips `status=left`
- does **not** wipe people / month_records / reward_records / target_cells
- does **not** dual-write `people.sbu`

## APIs (same auth as `/api/company` — anon **401**)

| Method | Path | Who |
|---|---|---|
| GET | `/api/roster/:period` | any signed-in |
| PATCH | `/api/roster/:period` `{ baseRev, clientOpId, assignments, status? }` | HR / admin / super_admin |
| POST | `/api/roster/:period/lock` | HR / admin / super_admin |
| POST | `/api/roster/:period/unlock` | HR if Rewards not locked; **admin only** if Rewards `plan_locked` for that period (logged) |
| POST | `/api/roster/:period/copy-from/:fromPeriod` | HR / admin / super_admin |

OCC on `roster_periods.rev`. Stale → **409 + current**. Same `clientOpId` → no rev bump. Missing assignment key is **not** a delete. Soft-delete only. Locked period PATCH / copy-over → **409** `roster-locked`. Copy-from writes **new assignment ids**; source period untouched.

Roster writes do **not** `publishEntityWrite` (G9 / live-notify untouched). Do **not** dual-write people.

## Overlay
`overlayOrgPeople(people, assignments)` is a projection. Missing roster row keeps person fields and `rosterSet=false`. Banner: **"Roster not set for this month."**

SPA: `window.__apmsRoster` cache. `apms-org-scope-p0ao.js` wraps `personSbuIds` / `scopedTeam` / People trees so Current Org, Rewards team list, and APMS team list filter by the month on screen.

## UI
Nav item **Roster** (HR / admin / super_admin). Not a Remix pill. Not buried in Settings.

- Month picker (same prev/next style as Rewards)
- Table: person, SBU, manager, function, brand, status, line, start/end, %, reason, missing-row flag
- Save → PATCH
- Lock roster / Unlock / Copy to next month (only if next is missing or draft; locked target refused)
- Locked banner: **"Locked. Past APMS and Rewards for this month use this roster."**

Files: `public/assets/apms-roster.js` + `apms-roster.css` (copied to `recovered-site/`). Host `#apms-roster-root` in `routes-e2g7y5q8-13m-p0ar.js`. `canNav` in login-view.

## Tests (11/11 roster)

| Case | result |
|---|---|
| Seed current period assignments count = active people (skips left) | **pass** |
| Transfer P SBU-A → SBU-B in 2026-10 only; 2026-09 assignment SBU-A; 2026-09 reward_record still exists; people identity buId still SBU-A | **pass** |
| Lock period → further PATCH assignments → 409 `roster-locked` | **pass** |
| Stale baseRev → 409 + current | **pass** |
| Same clientOpId → no rev bump | **pass** |
| Copy 2026-09 → 2026-10 draft; lock 2026-09 untouched; copy onto locked → 409 | **pass** |
| Unlock: HR 403 when Rewards plan_locked; admin 200 | **pass** |
| Anon GET `/api/roster/2026-09` → 401 | **pass** |
| Missing PATCH key is not a delete; overlay fallback + banner | **pass** |
| GET `/api/company` assemble people identity not overlaid | **pass** |
| SPA Roster nav + view + canNav + overlay helper; fallbackPost absent | **pass** |

Existing suites green (143 together): company-books, apms-sync, three-team-concurrency, company-ui-session, company-hot-tables, company-entities, company-assemble, apms-org-scope.

`fallbackPost` absent. POST `/api/company` still 410 unless restore.

## Files
- `migrations/0006_roster.sql`
- `src/lib/company-roster.ts` / `company-roster-http.ts` / `company-roster.test.ts`
- `src/routes/api/roster.$period.ts` (+ lock / unlock / copy-from)
- `public/assets/apms-roster.js` + `apms-roster.css`
- SPA: `routes-e2g7y5q8-13m-p0ar.js` (nav + view + host), `login-view-…-p0ar.js` (`canNav`), `apms-org-scope-p0ao.js` (overlay), `apms.html` stamp p0as43
- recovered-site copies of the same

## Not in R1
- Split-month UI (10 days SBU A / rest SBU B) — schema has start/end/pct for R2
- Dual-write people.sbu
- Overlay on GET `/api/company`
- G9 live notify
- Step 8 catalogs-as-rows
- Deploy / Contabo cut

## HANDOFF

- Stamp / host: **tree p0as43**, **live p0as12 / LOAD-10 p0as14** https://apms.alienstattoo.in
- What passed: roster seed / transfer isolation / OCC / clientOpId / lock / copy-from / overlay / anon 401; existing books/sync/three-team/ui-session/hot-tables/entities/assemble green; fallbackPost absent
- What is still broken: **live G9 until Eng cuts p0as42** (this step did not touch live notify); two-browser smoke untested here; restore targets still a separate hole; split-month not in R1
- Exact next named job: **Eng cut** when Sunny says (`NITRO_PRESET=node-server`). Do not start R2 split-day. Do not start Step 8. G9 only if the G9 prompt is sent.
