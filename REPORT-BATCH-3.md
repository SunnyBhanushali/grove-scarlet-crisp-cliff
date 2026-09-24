# REPORT-BATCH-3 — security hardening + Targets / Rewards broken links

Branch **`batch-3`** (from `batch-2`, p0as81), stamp **p0as82**
(`scripts/stamp-p0as82-batch3.mjs` + `scripts/stamp-p0as82-targets.mjs`:
routes `routes-e2g7y5q8-13m-p0as82.js` built from p0as81, login-view
`login-view-f2j6t0x4-11a3-p0ar.js` edited in place, apms-sync /
apms-collections / login-view `?v=p0as82`). Not merged to `main`.

Pack: **`aliens-apms-p0as82.zip`** — the same source layout as p0as81 **plus
the pre-built server in `.output/`** (Nitro `node-server`, dependencies
bundled): deployable with **no `npm install` and no build**
(`node .output/server/index.mjs`, env as in `docs/self-host-deploy.md`).

Note: `ROADMAP.md` is not in the repository (not on `batch-2`, `rows-v2` or
`main`); ROADMAP #3 / #4 were taken from Part C of the brief.

## 1. Results — the final gate (all pass)

One build of this branch (commit b7849f4, the build inside the zip), each suite on its own fresh database, one at a time, built node-server:

| Suite | Result |
|---|---|
| `npm test` | 196 + 447 pass, 0 fail |
| `npm run typecheck` | clean |
| Security batch 3 (every route: read / write / secrets / sign-in limits / anonymous) | **176 / 176** |
| Security batch 2 (rerun) | **43 / 43** |
| Batch 3 — four browsers (admins A / B / C + low-permission employee D, plus a restricted editor F), real sign-in limits | **PASS** — 11 screens, 52 pass, 0 fail, 9 n/a |
| Batch 1 (rerun in full) | **PASS** — 32 screens, 147 pass, 0 fail, 3 n/a |
| Batch 2 (rerun in full) × 3 | **PASS ×3** — 28 screens each, 148 pass, 0 fail, 24 n/a |

Part D: the batch-2 "one hire by B not saved within 20 s" intermittent was reproduced, its cause found and fixed (§5 #18). In the three final batch-2 runs every hire was saved; C saw both concurrent hires 1.1 / 0.7 / 0.4 s after the saves (people-views) and 0.6 / 0.1 / 0.4 s (people-hire). The committed `docs/e2e/batch-3/` holds the evidence of the previous gate run (before the Part D fix); the final run's reports / logs carry the test sign-in passwords in their request logs and were not committed (kept with the build, available on request).

### Batch 3 — four browsers (checks 1–6 per screen)

| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| All | sign-in | — | — | — | — | — | pass |
| Sign-in | signin-lockout | pass | pass | pass | n/a | pass | pass |
| Settings | session-ended | pass | pass | pass | n/a | pass | pass |
| All | employee-d | pass | pass | pass | pass | pass | pass |
| Org | restricted-editor | pass | pass | pass | n/a | pass | pass |
| Targets | targets-link-guard | pass | pass | pass | pass | pass | pass |
| Rewards | targets-link-broken | pass | pass | pass | n/a | pass | pass |
| Targets | targets-link-relink | pass | pass | pass | pass | pass | pass |
| Targets | targets-second-group | pass | n/a | pass | n/a | pass | pass |
| Targets | targets-import-blank | pass | pass | pass | n/a | pass | pass |
| Sign-in | default-pin | pass | pass | pass | n/a | n/a | pass |

### Batch 2 — rerun (run 1 shown; runs 2 and 3 identical: all pass)


| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 | C saw it after |
|---|---|---|---|---|---|---|---|---|
| All | sign-in | — | — | — | — | — | pass |  |
| Org | org-overview | n/a | n/a | pass | n/a | pass | pass | 0.4 s |
| Org | org-units | pass | pass | pass | pass | pass | pass | 0.0 s / 0.5 s |
| Org | org-units-drag | pass | pass | pass | pass | pass | pass | 0.9 s / 0.0 s / 0.6 s |
| Org | org-sbu-members | pass | pass | pass | pass | pass | pass | 0.5 s / 0.1 s |
| Org | org-functions | pass | pass | pass | pass | pass | pass | 0.5 s / 0.7 s |
| Org | org-roles | pass | pass | pass | pass | pass | pass | 0.4 s / 0.0 s |
| Org | org-roles-kroc | pass | pass | pass | pass | pass | pass | 0.1 s / 0.3 s |
| Org | org-chart-drag | pass | pass | pass | pass | pass | pass | 0.6 s / 1.0 s / 0.9 s |
| Org | people-views | n/a | n/a | pass | n/a | pass | pass | 1.1 s / 4.8 s |
| Org | people-hire | pass | pass | pass | pass | pass | pass | 0.6 s |
| Org | people-edit | pass | pass | pass | pass | pass | pass | 0.5 s |
| Org | people-managers | pass | pass | pass | pass | pass | pass | 0.3 s / 3.8 s |
| Org | people-status | pass | pass | pass | pass | pass | pass | 0.6 s |
| Org | people-mass-update | pass | pass | pass | pass | pass | pass | 0.3 s |
| Org | people-trash-restore | pass | n/a | pass | pass | pass | pass | 0.7 s |
| Home | home-notice-badge | n/a | n/a | n/a | n/a | pass | pass |  |
| Home | home-alerts | pass | pass | pass | pass | pass | pass | 1.5 s |
| Me | me-password | pass | pass | pass | n/a | pass | pass | 1.8 s |
| Me | me-profile | pass | pass | pass | pass | pass | pass | 0.6 s |
| Settings | settings-access-roles | pass | pass | pass | pass | pass | pass | 2.0 s / 1.2 s |
| Settings | settings-assign | pass | pass | pass | n/a | pass | pass | 1.7 s / 1.0 s |
| Settings | settings-logins | pass | pass | pass | n/a | pass | pass | 2.0 s / 3.3 s / 2.1 s |
| Sign-in | forgot-password | n/a | n/a | n/a | n/a | n/a | pass |  |
| Settings | settings-setup | pass | n/a | pass | n/a | pass | pass | 1.4 s |
| Settings | settings-trash | pass | n/a | pass | pass | pass | pass | 1.4 s |
| Settings | settings-backup | pass | n/a | pass | n/a | pass | pass | 2.0 s |
| Settings | settings-restore | pass | pass | pass | pass | pass | pass | 2.0 s / 3.4 s / 1.2 s |


| Screen | Special check | Result | Detail |
|---|---|---|---|
| settings-logins | must-reset | pass | Kiran Kumar Nayaka signed in with the temporary password: set a new password, app opened; DB mustResetPassword false, issued = new true; sign-in new 200 / temporary 401; C dropped "Must set password" 3.3 s after |
| settings-logins | special | pass | A reset B (floyd.dsil): old password → 401 (want 401), browser sign-in with the old password → refused; new password → 200. B's open session after the reset: get-session gone (revoked), B's screen showed the sign-in page 0.0 s after the reset. B then signed in with the new password → set a new passw |
| settings-logins | security | pass | anonymous POST /api/issued-logins 401 (want 401); employee POST another person's row 403 (want 403), POST /api/provision-logins 403 (want 403), own row 200 (want 200); Kiran Kumar Nayaka's password unchanged: sign-in 200 |
| settings-logins | issue-remaining | pass | Issue remaining (166): message "Issued 166 logins. The sheet downloaded — share each row privately."; CSV rows 166; issued_logins 6 → 171, CSV rows whose issued password differs 0; sample vishal.kuma signs in with its CSV password 200, with 0000 401; put back nikhil.pati (200); B/C/A/nikhil still si |
| forgot-password | needHr | pass | aaynar.kuma (@aliens.local): screen "Contact HR / Contact HR to reset this password."; request POST /api/password-reset 200 {"ok":true,"needHr":true,"message":"Contact HR to reset this password."}; password / mustReset / reset tokens unchanged true |
| forgot-password | public-email | pass | ronlind.mene (public email, no mail server): screen "Contact HR / Contact HR to reset this password."; response {"ok":true,"needHr":true,"message":"Contact HR to reset this password."}; password unchanged true, Ronlind-e2e-1 still signs in 200 |
| settings-backup | restore-file | pass | overlay "Restored: Restored 180 people. Closed months stayed as stored. 53 month records. 49 reward records. Reload to see it." after 2.2 s (button Reload); DB: "E2E bk fn mufskbcd14" live rows 0 (want 0), people 180; B dropped it 5.5 s, C 5.6 s after the file was picked (without reload) |
| settings-backup | restore-empty-targets | pass | file with targetCells {} and targetNodes []: overlay "Restored: Restored 180 people. Closed months stayed as stored. 53 month records. 49 reward records. Reload to see it."; live targets before {"cells":114,"nodes":23,"members":94} → after {"cells":114,"nodes":23,"members":94} (contract: restore pro |
| settings-restore | special | pass | restore: "Restored. A marked copy of what was live is in the list if you need to go back." after 2.0 s; C dropped the after-backup function 2.0 s after; B's open form then held "E2E B unsaved mufskbcd15", B pressed Tab + Save; B's Functions list without the function 15.3 s after the restore; DB: aft |

### Batch 1 — rerun


| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 | C saw it after |
|---|---|---|---|---|---|---|---|---|
| All | sign-in | — | — | — | — | — | pass |  |
| APMS | apms-month-list | pass | pass | pass | pass | pass | pass | 0.7 s |
| APMS | apms-plan-open | pass | pass | pass | pass | pass | pass | 2.5 s |
| APMS | apms-plan-locked | pass | pass | pass | pass | pass | pass | 2.2 s |
| APMS | apms-plan-drag | pass | pass | pass | pass | pass | pass | 0.7 s |
| APMS | apms-self-comments | pass | pass | pass | pass | pass | pass | 1.0 s |
| APMS | apms-eo | pass | pass | pass | pass | pass | pass | 2.6 s / 1.9 s |
| APMS | apms-quarter-review | pass | pass | pass | n/a | pass | pass | 1.0 s |
| APMS | apms-lock-close | pass | pass | pass | pass | pass | pass | 2.1 s |
| Targets | targets-delete-recreate | pass | pass | pass | pass | pass | pass | 3.5 s / 1.2 s |
| Rewards | rewards-month-list | pass | pass | pass | pass | pass | pass | 0.7 s |
| Rewards | rewards-plan-open | pass | pass | pass | pass | pass | pass | 2.3 s |
| Rewards | rewards-mass-update | pass | pass | pass | pass | pass | pass | 0.1 s |
| Rewards | rewards-my-rewards | pass | pass | pass | pass | pass | pass | 1.1 s |
| Rewards | rewards-lock-close | pass | pass | pass | pass | pass | pass | 2.0 s |
| Targets | targets-cells | pass | pass | pass | pass | pass | pass | 1.5 s |
| Targets | targets-groups | pass | pass | pass | pass | pass | pass | 0.8 s |
| Targets | targets-drag | pass | pass | pass | pass | pass | pass | 0.9 s |
| Targets | targets-month-list | pass | pass | pass | pass | pass | pass | 3.9 s |
| Targets | targets-copy-month | pass | pass | pass | pass | pass | pass | 1.2 s |
| Targets | targets-import | pass | pass | pass | pass | pass | pass | 1.6 s |
| Targets | targets-target-tab | pass | pass | pass | pass | pass | pass | 1.4 s / 1.2 s |
| Targets | targets-month-status | pass | pass | pass | pass | pass | pass | 2.9 s |
| Home | smoke-home | — | — | — | — | n/a | pass |  |
| Me | smoke-me | — | — | — | — | pass | pass |  |
| Org | smoke-org | — | — | — | — | pass | pass |  |
| KPI | smoke-kpi | — | — | — | — | pass | pass |  |
| Awards | smoke-awards | — | — | — | — | pass | pass |  |
| MIS | smoke-mis | — | — | — | — | pass | pass |  |
| Settings | smoke-settings | — | — | — | — | pass | pass |  |
| Improve | smoke-improve | — | — | — | — | pass | pass |  |
| Roster | smoke-roster | — | — | — | — | — | n/a |  |

FAILS:
None.

## 2. Permission mapping (LOCK "PERMISSIONS")

Where the grants live: every person has `access` (base role) and
`accessRoleId`; the access role is a row of kind `access-roles`
(`{ id, base, scope, grants: { <module>: {view, create, edit, delete} }, flags: {…} }`).
Built-in bases (`packForBase` in the login-view chunk) fill what a row does
not set: `super_admin` / `admin` everything; `hr` company scope, pay +
personal, most modules create/edit; `function_head` function scope; `manager`
team scope; `employee` own scope, APMS + Reward plans view only. The SPA's
screens unlock by the same grants (e.g. Org · People view shows Org → People,
Targets view shows Targets, Settings · * show the Settings tabs, flag `pay`
shows compensation, `lock_rewards` shows Lock / Close on Rewards). The server
now uses the identical code (`src/lib/apms-permissions.ts`).

**Scope** (people a role reaches for person-owned rows): own = self · team =
self + reports (line, dotted, function seat), recursively · function = team +
everyone in the holder's function subtree · company = everyone. A module the
role cannot view reaches **self only**. Admin = base admin / super_admin.

| Kind / field | Readable by | Writable by |
|---|---|---|
| **people** — directory fields (name, title, role, manager, studio, status, …) | every signed-in person | create: Org·People create · edit: Org·People edit + scope · delete: Org·People delete + scope (never self) · self (Me): `firstName`, `lastName`, `name`, `preferredName`, `email`, `phone`, `phoneCountry`, `password`, `mustResetPassword`, `photo` |
| people — **pay**: `salary`, `bandMidpoint`, `rewardsSlabs`, `ctc`, `fixedCtc`, `rewardsAnnual`, `annualRewards`, `variablePay`, `bonus`, `payHistory` | flag `pay`, or own row | flag `pay` + People edit + scope (kept from storage otherwise) |
| people — **personal**: `dob`, `phone`, `phoneCountry`, `personalEmail`, `address`, `emergencyContact`, `bloodGroup`, `pan`, `aadhaar`, `bankAccount`, `ifsc`, `gender`, `maritalStatus` | flag `personal`, or own row | People edit + scope (kept from storage when hidden); own phone via Me |
| people — `access`, `accessRoleId` | everyone | admin only |
| people — `password`, `passwordHash` | **nobody** (never sent) | own row; admin for others |
| people — `apmsPlanId`, `inheritRoleApms` | everyone | also APMS edit + scope |
| people — `targetNodeId`, `targetMetric`, `targetSbuId`, `gateUnitId` | everyone | also Reward plans edit + scope |
| **month-records** (APMS plans) | own, or APMS view + scope | create / edit / delete = APMS grant + scope; `status` change also `lock_apms` or `unlock`; own plan without edit: `self*` keys only (self comments / self scores) |
| **reward-records** (Reward plans) | own, or Reward plans view + scope | same with Reward plans grant and `lock_rewards` |
| **target-cells**, target-nodes, target-members, target-month-status, target-root-order, target-history, sbu-targets | Targets or Reward plans or APMS view | Targets create / edit / delete (members, order, month status, history = edit) |
| companies, brands, sbus, sbu-members | everyone | Org · Brands & SBUs |
| functions, sub-functions | everyone | Org · Functions |
| roles, role-krocs | everyone; role `slabs` / `salaryFrom` / `salaryTo` need `pay` | Org · Roles (hidden role pay kept) |
| ags-months, ags-reviews | `pay` or Org · Roles edit | Org · Roles edit |
| access-roles | everyone | admin |
| logins | own row, or Settings · Assign people view (never the password) | own row, admin |
| custom-reports, report-folders | MIS view | MIS |
| values-catalog, kpi-master | everyone | KPI |
| apms-plans, apms-months, role-months | everyone | APMS |
| period-reviews (quarterly reviews) | own, or APMS view + scope | APMS create / edit + scope; the person: own self fields + status |
| award-instances, award-measures, award-prizes | everyone | Awards |
| gate-units, gate-months, reward-role-months | everyone | Reward plans |
| trash | Settings · Trash view (pay / personal of people inside hidden) | file a row: anyone (every delete files one); restore / delete forever: Settings · Trash edit |
| notices | everyone | everyone |
| app-requests, role-cases | People view, or rows that name the reader | everyone (open — see §6) |
| settings `dismissedAlertIds` | everyone | People view or Assign people view |
| settings `setupDone` | everyone | Settings · Access roles / Assign people edit |
| settings `companyFactor`, `seedGeneration` | everyone | admin |
| settings `pendingRoleDeletes` / `months` / `awardBandShares` / `rewardYearSeed` | everyone | Roles edit / APMS·Rewards·Targets create / Awards edit / Rewards edit |
| backups, restore, legacy snapshot save / backup | admin (HR too is refused) | admin |
| issued / provision logins, login locks | — | admin (own row on issued-logins) |

**Paths.** Reads: GET `/api/company` (per-viewer wire: admins + roles that
read everything share the one cached full wire; everyone else gets it
filtered for them, cached per viewer and wire version), `?books=`, legacy
`/_serverFn` LOAD, `/api/people`, `/api/people/:id`, `/api/month-records/*`,
`/api/reward-records/*`, `/api/target-cells/:id`, `/api/e/*`, `/api/org*`,
`/api/changes` (with and without `payload=1`; the cursor still moves past a
dropped row), tick / SSE hints, book PATCH 409 replies, backups. Writes:
`/api/people/:id`, `/api/month-records/*`, `/api/reward-records/*`,
`/api/target-cells/*`, `/api/e/*`, `/api/org/:kind/:id`, book PATCH
tombstones, imports (they write through these rows), restore. Refusal:
**403 `{ ok:false, error:"forbidden", kind, field?, message }`**.

**Hidden fields are preserved.** On a restricted user's write the stored
value is kept for every field they cannot see; a placeholder (`0`, `""`,
`[]`, `{}`, all-zero slabs — what the forms send) is replaced silently, a
real different value is 403 with that `field`. Missing / null / "" / [] / {}
compare as one "nothing". A 409 row is filtered the same way, so the
client's `merge3` never sees a hidden field and cannot delete one (tested:
an admin raises a salary while a function head's form is open; the function
head saves, the admin's salary stands).

**Live updates** still reach everyone through the same change feed, filtered
per person: employee D saw an allowed change in **0.28 s** (admin C
**0.40 s**).

## 3. Passwords and sign-in

- **Hashing.** scrypt (node:crypto, N=16384 r=8 p=1, 16-byte salt, 32-byte
  key) — `scrypt$N$r$p$<salt>$<key>`. Every write path hashes: issued-logins,
  provision-logins, the people row, logins rows, password reset, restore.
  Re-sending the current password is not a change.
- **One-time conversion** at server start, before the first query
  (`src/lib/apms-password-migrate.ts` from `db.ts`, Postgres advisory lock):
  plain values in `issued_logins`, `people`, `entities` (logins), `entity_log`,
  `company_books`, `company_notebook` are first copied to
  `apms_password_backup_<yyyymmddhhmmss>` (source, ref, password), then
  hashed; the log prints the count. Old backup copies (`company_backups`)
  follow in the background (`…_copies` table). The backup tables are revoked
  from PUBLIC and handed to `APMS_PW_BACKUP_OWNER` (default `postgres`).
  Second start: `converted: 0`. **Drop them** once sign-in is confirmed:
  `DROP TABLE apms_password_backup_<stamp>; DROP TABLE IF EXISTS apms_password_backup_<stamp>_copies;`
- **Nothing returns a password or a hash** to any client (wire, rows, feed,
  backup download — which now carries no secrets; restoring such a file keeps
  the stored passwords — 409 replies, restore reply).
- **Issue logins** (Settings → Assign people → Issue remaining / Reset /
  Create access): the temporary password is shown once, in the dialog and the
  CSV downloaded at issue time; **Download sheet** is now usernames only; the
  person must set a new password at first sign-in (`mustResetPassword`).
- **`APMS_DEFAULT_PIN=on|off`** (default **on**, left on). Off: `0000` never
  signs anyone in (not `sunny.b`, not people without a password, not a stored
  `0000`) — 401 `DEFAULT_PIN_OFF`, the sign-in screen says "The starter
  password 0000 is switched off…". Tested both states.
- **Lock-out.** 5 wrong passwords per username in 15 min → locked 15 min (the
  right password is refused too); 30 wrong per IP → that IP locked 15 min.
  `apms_signin_failures`, survives restarts. The sign-in screen shows "Too
  many wrong passwords for this username. Sign-in is locked for N minutes…".
  Admin: Settings → Assign people → **Locked sign-ins** → **Unlock**
  (`/api/login-locks`). The sign-in form now sends one request per Continue
  (it sent two, so each wrong password counted twice).
- **Sessions end** when a password changes: an admin reset ends all of that
  person's sessions; changing your own password ends your other sessions and
  keeps this browser. Open tabs land on the sign-in page with "You were
  signed out because your password was changed…" within ~2 s (the sync
  checks `get-session` after any 401; session cache is 2 s).

## 4. Part C — Targets / Rewards broken links

- **Delete guard**: deleting a target (month page row, Target / Group tab,
  or a whole month on the Targets list) that rewards unlock against shows the
  count and "Person · Month" list, **Cancel / Delete anyway**. Rewards keep
  their `targetNodeId`.
- **`targetLinkBroken`** is computed in the SPA at render time (never stored):
  the linked node is gone or has no cell in the reward's month. Rewards month
  list: orange warning icon with a tooltip. Reward page: orange banner with
  **Re-link** → a picker of that month's targets → saved through the normal
  Unlock against path (entity PATCH). On a locked plan the banner says to
  unlock first (same rule as the select).
- **Auto-relink offer**: re-creating a target with the same name in that
  month offers "N rewards were linked to a deleted target named X — relink
  them?" **Relink / Not now** (never forced). Found: a target that still has
  other months keeps its node, so the same-name re-create reuses the id and
  the links are whole again with no offer; a one-month target loses its node,
  the re-create gets a new id, and that is when the offer appears.
- **Second group**: re-verified, no bug; regression tests (unit on the shipped
  store actions + e2e with two admins adding groups at the same moment).
- **Targets import**: a blank cell keeps the stored value, an explicit value
  (including 0) changes it; before Apply a summary "X changed, Y unchanged,
  Z blank-kept (+ targets that leave)" with Apply / Cancel. A value another
  user types during an import now survives when the file's cell is blank.
  Also fixed: the preview line ended with a stray `}`; the report's
  `updated` count was always 0.

## 5. Every failure found, its cause and the fix

| # | Found by | Failure | Cause | Fix | Where |
|---|---|---|---|---|---|
| 1 | reading the build | **Two whole-company dumps were served to anyone without sign-in**: `/aliens-apms-restore-2026-09-19.json` (184 people, salaries, `logins{}` with 10 plain-text passwords, `uat.*` test admins) and `/aliens-apms-merged-2026-09-07.json` (170 salaries) | files in `public/` are copied to the static root | removed from `public/` (no code used them); security suite checks both URLs are 404. **Git history still holds them** (see §6) | `public/` |
| 2 | Part D | `uat.*` / `p-uat-*` test people were re-added by every org save | `mergePreserveUatFixtures` kept them alive | pass-through; live clean-up is the deploy bot's | `company-notebook.ts` |
| 3 | API review | any signed-in person could **delete every APMS / Rewards record of a month** with one book PATCH (`tombstones.records["2026-09"]`) or trash any person | book PATCH applied all tombstones for anyone | tombstones the caller may not apply are dropped (logged); a whole-month tombstone is admin only | `routes/api/company.ts`, `apms-permissions.ts` `filterTombstones` |
| 4 | API review | a book PATCH **409 reply carried the whole stored org book** (every salary, password hashes) | `ackFromPatch` returns the stored books on conflict | reply books slimmed (no secrets) and filtered for the caller | `routes/api/company.ts` |
| 5 | security suite | backup **download** (`?id=`) carried the snapshot with passwords (admin) and `item.snapshotJson` | row returned whole | download and restore replies carry no password / hash; a restored file without passwords keeps the stored ones | `company-backups-http.ts`, `apms-restore-secrets.ts` |
| 6 | API review | `POST /api/company` restore replied with the full snapshot incl. secrets | reply passed through | slimmed | `routes/api/company.ts` |
| 7 | API review | `PATCH /api/org/:kind/:id` checked nothing and recorded no author (`org-patch`) | predates BATCH-2 | module grant checked; author = the person | `company-org-read.ts` |
| 8 | employee browser (D) | **Me → Edit → Save never saved for a non-admin** (`ReferenceError: Cannot access 'e' before initialization`) | in the SPA, the Me branch read `e.id` while a `let e` later in the same handler shadowed the person prop | stamp: the id is taken once at the top of the form (`__selfPid`) | stamp p0as82 |
| 9 | batch-3 e2e (employee-d) | after an admin reset someone's login, **the admin's next edit of that person (e.g. Location) sent the old temporary password again**: the person's own new password was replaced and (now) their sessions ended | the sync remembered the accepted password only for the "is it dirty" check, not for the payload of a later save of the same row | an accepted password is no longer sent with later edits (people and generic rows) | `apms-sync.js` |
| 10 | batch-3 e2e (employee-d) | an employee's Me save was 403 on `brands` | the SPA fills empty defaults (`brands: []`) the server row does not have; the permission check counted them as edits | missing / null / "" / [] / {} compare as the same "nothing" | `apms-permissions.ts` |
| 11 | regression run | on a **fresh database** the months / targets books came up empty | the two server module copies seed the books at once; one saw a half-written set and "filled" the missing books with `{}` | a partial set on first load waits for the other writer | `company-notebook.ts` |
| 12 | regression run | on a fresh database the first cached wire had **53 of 180 people** (APMS list empty for everyone) | a GET assembled while another request was importing people row by row | first hot-table import is one statement (data-modifying CTEs) | `company-hot-tables.ts` `importHotTablesAtomic` |
| 13 | sign-in review | one wrong password counted twice toward the lock-out | the sign-in form tried username, then email, per click | one request per Continue (email only when an @ was typed); lock / PIN-off messages shown as sent | stamp p0as82 |
| 14 | Part B | "Download sheet" repeated every temporary password issued in the browser session | built from the local store | usernames only | stamp p0as82 |
| 15 | Part C | Targets import preview ended with a stray `}`; `updated` count always 0 | SPA bundle | fixed with the import rework | stamp p0as82, `targets-import.ts` |
| 16 | test harness | batch-2 tests compared `issued_logins.password` with plain text; the admin-reset special case expected the old session to live; security-batch2 reused a token an admin reset had ended | tests encoded the old behaviour | compare with the scrypt hash (`pwEq`); expect the sign-in page / sign in again | `scripts/e2e/lib/*`, `security-batch2.mjs` |
| 17 | test harness | batch-1 `targets-*` and batch-2 `settings-setup` "C saw it after 5.5–8 s" in one run | three suites and a build shared a 4-core box | rerun alone: pass (1.4 s); the final gate runs suites one at a time | — |
| 18 | Part D (batch-2 reruns, diagnostics added) | **"one hire by B not saved within 20 s" — reproduced and fixed.** B's new person stayed on B's screen only; no request was ever sent for it, not even with B's later saves, and every later page load re-created its login | after a **reload**, the SPA asks for the company file with `?at=<its cached stamp>`. When the server answered "unchanged", the sync never learned what the page had loaded; the **first save after the reload** then took the whole screen — including the edit just made — as "already saved" and sent nothing. It showed up in batch 2 because `org-chart-drag` reloads every browser right before `peopleViews` hires | while the sync has no baseline it asks for the whole file (drops `?at=`), so the page goes through the normal load path and the first edit is sent. Unit test `batch3-hire-after-reload` (fails on the old sync, passes now); e2e `org-chart-drag` → `peopleViews` loop: 4 of 15 runs lost the hire before the fix (same signature each time: hire in the sync baseline, nothing pending, nothing sent), 0 of 7 after; plus the final batch-2 runs (§1) | `apms-sync.js` |
| 19 | test harness | `org-chart-drag` setup "T3 … not saved" once in the verification loop | the test typed a random employee ID; the form keeps four digits and it hit a seeded person's ID (ALN0647 — "already exists", dialog stayed open and blocked the next scenario) | e2e employee IDs now ALN8000–9999 (seeded IDs end at ALN7706) | `scripts/e2e/lib/screens-org.mjs`, `screens-people.mjs` |


## 6. Decisions taken (safest option) and still open for Sunny

Taken without stopping (safest option that never loses data or locks Sunny out):

1. **The directory stays readable by everyone** (names, titles, roles, managers, studios): every screen is built on it. Only pay / personal fields are hidden.
2. **Targets are readable** by anyone with Targets, Reward plans or APMS view (so, by default, everyone): rewards unlock against targets and KPIs link target actuals; hiding them would break My rewards. *Decide:* hide target numbers from employees?
3. **Notices, app requests and role-change cases** can be written by any signed-in person (alerts / requests); the role-change approval steps are still enforced only in the SPA. *Decide* whether to lock role cases to People edit.
4. **HR cannot restore or download backups** (admin only, as in BATCH-2), although the HR pack has Settings · Backup and the `restore` flag. *Decide* whether HR should.
5. Flags **`month_actuals`, `changelog`, `approve`, `frozen_edit`** are still enforced only in the SPA; the server enforces the module grants, scope and the lock flags. *Decide* if any of these must be server-side too.
6. **Book PATCH**: a tombstone the caller may not apply is dropped and logged, not answered with 403 (the book carries every tombstone the client knows; a 403 would wedge that client's saves).
7. **Lock-out also applies to `sunny.b`**: anyone who knows the username can lock it for 15 minutes; another admin (e.g. floyd.dsil) can unlock it from Assign people. *Decide:* exempt it, or rely on the unlock.
8. **Per-IP limit (30 / 15 min)** is shared by everyone behind one studio router. *Decide* if 30 is right; it relies on nginx appending the real IP to `X-Forwarded-For`.
9. **`APMS_DEFAULT_PIN` is left on.** Recommended order: issue logins to everyone still on 0000 (Assign people → Issue remaining), give `sunny.b` its own password, then set `APMS_DEFAULT_PIN=off`.
10. A **downloaded backup no longer contains passwords**. Restoring it keeps everyone's current password; a person who exists only in the file comes back without one (0000 while the PIN is on) — issue them a login.
11. **Old backup copies were rewritten with hashes** after their plain values were copied to the `…_copies` backup table.
12. **An admin password reset signs that person out everywhere at once**, and so does changing your own password (except the browser you did it in).
13. `targetLinkBroken` is computed in the browser only (not added to reward reads).
14. Targets import still replaces each month's list of targets (targets missing from the file leave that month; the summary counts them); only blank *cells* keep their value.
15. The Vite **dev** server (`scripts/recovered-apms-plugin.mjs`) hashes passwords through the same module but has no lock-out; only the built server is deployed.
16. **Git history** still contains the two removed public dumps and the seed's plain-text logins (`src/lib/company-seed.json`, 9 logins; hashed when loaded). Removing them from history needs a force-push — your call.


## 7. What the deploy bot must know

- **Artifact**: `aliens-apms-p0as82.zip` → run `node .output/server/index.mjs` (no install, no build). Env as before + optional `APMS_DEFAULT_PIN` (default **on — leave it**), `APMS_PW_BACKUP_OWNER` (default `postgres`). Keep the app behind nginx (the IP limit trusts the last `X-Forwarded-For`).
- **Runtime-created tables** (live does not apply migration files; `migrations/0011_batch3_security.sql` is the record): `apms_signin_failures`; `apms_password_backup_<stamp>` and `apms_password_backup_<stamp>_copies` (conversion backups); `issued_logins`, `apms_sessions` as in p0as81.
- **One-time password conversion** on first start: log line `[apms-passwords] plain-text passwords converted: N (backup table apms_password_backup_…)`, then a background line for backup copies. Next start: `converted: 0`. If the log says the backup table could not be handed to the admin role, run `ALTER TABLE … OWNER TO postgres; REVOKE ALL ON … FROM <app role>;`. After Sunny confirms sign-in works: `DROP TABLE apms_password_backup_<stamp>; DROP TABLE IF EXISTS apms_password_backup_<stamp>_copies;`.
- **Who is signed out**: live is still pre-p0as81, so **every browser signs in once** after this cut (server-issued sessions since p0as81). Afterwards a person is signed out when an admin resets their password or they change it in another browser.
- **Clean up on live**: delete the `uat.*` / `p-uat-*` people and logins (code no longer re-adds them); if `aliens-apms-*.json` dumps exist in the live static folder, delete them (they were readable without sign-in).
- Sign-in lock-outs are visible and clearable in Settings → Assign people → Locked sign-ins (admins).

