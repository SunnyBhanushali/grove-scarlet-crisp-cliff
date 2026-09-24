# REPORT-BATCH-2 — Org, People, Me, Home, Settings with three real users, plus security

Branch `batch-2` (from `rows-v2`, live stamp p0as80 at branch time), stamp
**p0as81** (routes `routes-e2g7y5q8-13m-p0as81.js`, login-view / apms-sync /
apms-collections / apms-dnd-engine `?v=p0as81`), server the same branch.
Built with `NITRO_PRESET=node-server npm run build:app`, run on the built
output (`.output/server/index.mjs`) against a fresh local PostgreSQL 16
database (`aliens_apms_test`, seed import, 180 people), three Chromium
browsers signed in as three admins:
A = `sunny.b` (super admin), B = `floyd.dsil` (super admin), C = `ronlind.mene` (admin).
A plain employee, `nikhil.pati`, is the non-admin in the security checks and
the fourth user on Me.

Tests (all in the repo):

- `scripts/e2e/batch2-three-users.mjs` — Org / People / Me / Home / Settings × six checks
  (libs `scripts/e2e/lib/screens-org.mjs`, `screens-people.mjs`, `screens-me-home.mjs`,
  `screens-settings.mjs` + `org-page.mjs`, `people-page.mjs`, `settings-page.mjs`,
  same harness as batch 1).
- `scripts/e2e/security-batch2.mjs` — every `/api/*` route × every token a client
  could make up, login writes as anonymous / non-admin / admin, admin-only writes.
- `scripts/e2e/rows-v2-three-users.mjs` — batch 1 (APMS, Rewards, Targets + module smoke), unchanged.
- `scripts/e2e/fresh-server.sh` (fresh DB + built server), `scripts/e2e/seed-logins.mjs`
  (B / C / non-admin test passwords), `scripts/e2e/report-batch2-tables.mjs` (the tables below).
- Unit: `src/lib/batch2-security.test.ts` (sessions, login-row rule, people write
  guard, sibling order), `access-views.test.ts` (stamp p0as81), `apms-dnd.test.ts`
  (drag-left at the end of a subtree). `npm test` 196 + 391 pass; `npm run typecheck` clean.

The six checks per screen (same as `REPORT-THREE-USERS.md`):

1. A and B edit **different records** at the same time → both persist.
2. A and B edit **different fields of the same record** at the same time → both persist.
3. C, idle on the screen, sees A's and B's changes **within 5 s** without reloading.
4. A **deletes** a record; B's live feed is held so B's screen is provably stale;
   B still sees it, edits and saves → it **stays deleted**, after reload too.
5. After everyone **reloads**, the screens and the database agree.
6. No refresh / conflict banner, **no writes on sign-in or on opening the screen**, no 5xx.

Final run (step 5 "from scratch"): one build, then batch 2, security and
batch 1, each on its own **fresh database**, in that order.

**Result: PASS** — batch 2 every screen × every check pass (n/a only where
listed with the reason), both special cases pass, security 43/43, batch 1
green (same as `REPORT-THREE-USERS.md`). Reports of the final run:
`docs/e2e/batch-2/` — `e2e-batch2.json`, `e2e-security.json`,
`e2e-batch1.json` and the three console logs (the batch-2 JSON also keeps
every write / 5xx request per browser).

## 1. Screens and save actions (Org, People, Me, Home, Settings)

Every page, tab, view, dialog and button that saves data in these areas, and
the scenario that covers it. "Not reached" says why. (Exported as `SCREENS`
by the four `scripts/e2e/lib/screens-*.mjs` files.)

| Module | Screen / dialog / button | What it saves | Scenario | Reached |
|---|---|---|---|---|
| Org | Overview (counts) | nothing (read-only) | org-overview | yes |
| Org | Brands & SBUs: Add company (inline) | companies row | org-units | yes |
| Org | Brands & SBUs: company rename by double-click | companies.name | org-units | yes |
| Org | Brands & SBUs: Add brand (top button / company +) | brands row |  | yes |
| Org | Brands & SBUs: Add SBU (top button / brand + / Add SBU under this / Add group SBU) | sbus row | org-units | yes |
| Org | Brands & SBUs: brand / SBU rename by double-click | brands.name / sbus.name | org-units | yes |
| Org | Brands & SBUs: Make group SBU / Ungroup buttons | sbus.isGroup (+ sbu-members) | org-units | yes |
| Org | Brands & SBUs: drag to nest / un-nest SBU | sbus.parentId + sbu-members rows | org-units-drag | yes |
| Org | Brands & SBUs: drag to reorder SBU siblings | sbus.sortKey on the siblings (BATCH-2; before: nothing was saved) | org-units-drag | yes |
| Org | Brands & SBUs: drag brand to another company / SBU to another brand | brands.companyId / sbus.brandId |  | **not reached** — not driven (same engine as nest; time) |
| Org | Brands & SBUs: Delete company / brand / SBU / group (confirm dialog) | row deleted + trash row | org-units | yes |
| Org | SBU page → Edit (Name, Brand, Group SBU, Parent group) → Save | sbus row | org-units | yes |
| Org | Group SBU page: SBUs in this group (Add SBU… / Remove) | sbu-members rows + member sbus.parentId | org-sbu-members | yes |
| Org | SBU page: Mapped functions (Map function… / Unmap) | functions.buIds / brandIds / shared | org-sbu-members | yes |
| Org | SBU page: People → Assign people (inline picker) | people.buId / buIds |  | **not reached** — people assignment belongs to the People screens (other agent); only opened |
| Org | Functions: Add function dialog | functions row | org-functions | yes |
| Org | Functions: row + → Sub-function dialog | functions row with parentId | org-functions | yes |
| Org | Functions: row + → Role / SBU / Add to group | roles / functions |  | **not reached** — not driven (Role = Create role dialog, covered in org-roles) |
| Org | Functions: rename by double-click | functions.name | org-functions | yes |
| Org | Function Edit page (Name, Description, Head, Brand, SBU) → Save | functions row (+ its sub-functions) | org-functions | yes |
| Org | Functions: drag to move sub-function out / nest / reorder | functions.parentId | org-functions | yes |
| Org | Functions: Delete function (confirm) | row deleted + trash row | org-functions | yes |
| Org | Roles: Create role dialog (name, function, reports to, roles under) | roles row | org-roles | yes |
| Org | Roles: List / Nested / People views | nothing (view choice is session state) | org-roles | yes |
| Org | Roles: Nested view drag (reportsTo / reorder) | roles.reportsToRoleId(s) |  | **not reached** — not driven (same engine; time) |
| Org | Roles: Delete role (row) | row deleted + trash row | org-roles | yes |
| Org | Role page: Place this role → Edit → Save placement (title, reports to, SBU, function, brand, people) | roles row (+ people roleId) | org-roles | yes |
| Org | Role page: KROC tab (KRAs, responsibilities, outcomes, weights) → Save draft / Publish KROC | roles.kras, krocStatus | org-roles-kroc | yes |
| Org | Role page: AGS tab (factor buttons, autosave) | roles.ags / band | org-roles | yes |
| Org | Role page: Competencies tab (add, weight, delete) | roles.competencies | org-roles-kroc | yes |
| Org | Role page: Upload KROC / Download KROC / Template | roles.kras (upload) |  | **not reached** — file upload not driven |
| Org | Roles: Bulk upload dialog (Import CSV) | roles / functions / sbus | org-roles-kroc | yes |
| Org | People reporting tree: drag nest / un-nest | people.managerId | org-chart-drag | yes |
| Org | People reporting tree: drag reorder siblings | people.sortKey on the siblings (BATCH-2; before: nothing was saved) | org-chart-drag | yes |
| Org | People reporting tree: Reports to dialog / Add person under this / Delete | people.managerId / people row | org-chart-drag | yes |
| Org | People — List / My team / Company / SBU / Function / Summary views | nothing (view choice in sessionStorage) | people-views | yes |
| Org | People — filter grid (brand, SBU, function, role, status, plan state, sort) + search + Hide filters | nothing (sessionStorage apms-ui-people-list-v1) | people-views | yes |
| Org | People → Add person dialog (Create person) | people row + logins entity (+ company book PATCH) | people-hire | yes |
| Org | People row → + Add person under this | people row with managerId preset |  | **not reached** — same Add person dialog/handler as the header button (Gs with defaultManagerId); the hire path is covered by people-hire |
| Org | Person file → Edit form: first/last name, work email, employee ID, date of birth, mobile, location, join date, employment, access, fixed CTC, rewards annual + Compute, M1–M5 | people row (PATCH /api/people/:id) | people-edit | yes |
| Org | Person file → Edit form: Role / Brand / SBU / Function pickers | people row (immediate PATCH on pick) | people-edit | yes |
| Org | Person file → Core role select (details card) | people roleId/title | people-edit | yes |
| Org | Person file → Edit form: Reports to (primary + dotted line) | people managerId + dottedLine (immediate) | people-managers | yes |
| Org | Person file → Edit form: Direct reportees | other people's managerId / dottedLine | people-managers | yes |
| Org | People row → Reports to dialog (tick reportees) | reportees' managerId / dottedLine | people-managers | yes |
| Org | People list MR marks / manager chips | nothing (derived from managerId + dottedLine) | people-managers | yes |
| Org | Person file → Edit form: Status Active / Paused / Exited | people status (left = Exited) | people-status | yes |
| Org | People row → Delete (move to trash) | people deleted_at + trash entity + tombstone | people-trash-restore | yes |
| Settings | Settings → Trash → Restore (person) | people row live again, trash entity removed | people-trash-restore | yes |
| Settings | Settings → Trash → Delete forever (person) | trash entity removed | people-trash-restore | yes |
| Settings | Settings → Trash → Empty trash | all trash entities removed |  | **not reached** — destructive for every other scenario's trash rows in a shared run; same per-row write as Delete forever |
| Org | People → Mass update → Update dialog (role, function, extra function, brand/SBU, reporting manager, access, gate access, inherit APMS, employment, status, location, join date, CTC + rewards) | people rows (one PATCH per ticked person) | people-mass-update | yes |
| Org | People → Mass update → Delete | people deleted_at + trash | people-mass-update | yes |
| Org | People → Import (bulk people sheet) | people rows in bulk |  | **not reached** — needs a filled xlsx template upload; not driven in this pass |
| Org | People reporting tree drag / nest (also listed under Org) | managerId / sortKey | org-chart-drag | yes |
| Org | Person file → Change role (role-change case) | roleCases entity |  | **not reached** — multi-step promotion/transfer workflow (case, approvals); not driven in this pass |
| Org | Person file → Edit KROC | role (KROC) entity |  | **not reached** — edits the job role, not the person — belongs to Org → Roles |
| Org | Person file → Add review (quarterly review) | quarter review |  | **not reached** — covered by APMS apmsQuarterReview (screens-apms-eo.mjs) |
| Org | Person file → APMS / Rewards Add existing / Create new | month-records / reward-records |  | **not reached** — covered by the APMS / Rewards month scenarios |
| Me | Me → Edit (own profile form; super admin sees the full person form, an employee sees first/last name, work email, mobile) | own people row | me-profile | yes |
| Me | Me → Password → New password → Update | own people row password + POST /api/issued-logins own row | me-password | yes |
| Me | First sign-in → Set a new password (forced, mustResetPassword) | issued_logins + people password/mustResetPassword + /api/auth/change-password | me-password | yes |
| Me | Me → Core role select | own roleId |  | **not reached** — same select and handler as the person file's Core role (people-edit); changing the super admin's own role would change the rest of the run |
| Me | Me → Change role | roleCases |  | **not reached** — role-change case workflow; not driven (see People SCREENS) |
| Me | Me → Edit KROC / View KROC | role (KROC) |  | **not reached** — edits the job role — Org → Roles |
| Me | Me → Add review (quarterly self review) | quarter review |  | **not reached** — covered by APMS apmsQuarterReview (screens-apms-eo.mjs) |
| Me | Account page (gm, /account) password form | same changeOwnPassword |  | **not reached** — no nav entry reaches it in this build (Me carries the Password section); same handler as Me → Password |
| Home | Home → Alerts → Done (company alerts: People without role/login/APMS/Rewards, overdue to close) | settings/dismissedAlertIds (one shared row) | home-alerts | yes |
| Home | Home → Alerts → Done (own plan notices: N days to lock / is late / Close month) | notices row (status done, doneIds) | home-alerts | yes |
| Home | Home → Alerts → Open | nothing (navigation) |  | yes |
| Home | Notification bell (tray open / glance) | nothing in the DB (localStorage apms-glanced-v1) | home-notice-badge | yes |
| Home | Home period tabs (Last month / QTD / YTD), KPI tiles, Awards won, Your EOs | nothing |  | yes |
| Home | View as (impersonate a person) | nothing (session view) |  | **not reached** — view switch only; not driven |
| Settings | Settings → Access roles list (Edit / Delete per row) | access-roles rows (delete; optional move of people) | settings-access-roles | yes |
| Settings | Create access role dialog (Name, Start from, Scope, Note, module grants grid, Extra flags) → Create | new access-roles row | settings-access-roles | yes |
| Settings | Edit access role dialog → Save | access-roles row: name, base, note, scope, grants, flags (+ people.access when the base changes) | settings-access-roles | yes |
| Settings | Delete access role dialog (Move N people to …) | access-roles row deleted; people re-pointed when a target is picked | settings-access-roles | yes |
| Settings | Assign people → per-row Access role select | people.accessRoleId / access | settings-assign | yes |
| Settings | Setup → Access → Assign in bulk dialog (Give <role> to N) | people.accessRoleId / access for the ticked people + setupDone 'access' | settings-assign | yes |
| Settings | Assign people → Reset / Create access (row) + one-time login dialog (Email login / Download / Done) | people.username/password/mustResetPassword, issued_logins, /api/provision-logins | settings-logins | yes |
| Settings | Assign people → Issue remaining → Issue logins in bulk (missing / everyone) | people logins + issued_logins for every person without a real login; CSV download | settings-logins | yes |
| Settings | Assign people → Upload logins (CSV email, username, password, access) | people.accessRoleId / username / password / mustResetPassword | settings-logins | yes |
| Settings | Assign people → Download sheet | nothing (CSV download) | settings-logins | yes |
| Settings | Assign people → Password reset requests → Issue new password | as Reset |  | **not reached** — needs an open password_reset notice; the sign-in page does not raise one in this build (forgot password goes to /api/password-reset) |
| Sign-in | First sign-in: Set a new password (mustResetPassword) | people.password / mustResetPassword=false, issued_logins (own row) | settings-logins | yes |
| Sign-in | Forgot password → Email me a password → Contact HR / Check your email | nothing unless the temp password was emailed (no mail in this sandbox) | forgot-password | yes |
| Sign-in | Reset link ?reset=<token> → Set a new password | password via /api/password-reset/apply |  | **not reached** — a token only exists after a mailed reset (no mail configured, APMS_RESET_PREVIEW off) |
| Settings | Setup → step Done (Company/brands/SBUs, Functions, Roles, People, Access) | settings/setupDone | settings-setup | yes |
| Settings | Setup → step Import (CSV upload dialog) | functions / roles / SBUs / people / access rows + setupDone | settings-setup | yes |
| Settings | Setup → step Template | nothing (CSV download) | settings-setup | yes |
| Settings | Setup complete → Show setup again | settings/setupDone = [] | settings-setup | yes |
| Settings | Trash → Restore (row) | trash row removed, item re-created | settings-trash | yes |
| Settings | Trash → Delete forever (row) + confirm | trash row deleted | settings-trash | yes |
| Settings | Trash → Empty trash + confirm | every trash row deleted | settings-restore | yes |
| Settings | Backup → Back up now | company_backups row (manual) | settings-backup | yes |
| Settings | Backup → copy → Download | nothing (JSON download) | settings-backup | yes |
| Settings | Backup → copy → Restore → Restore this copy | whole company replaced from the server copy (+ 'Before restore' copy) | settings-restore | yes |
| Settings | Backup → Restore (file) → progress overlay → Reload | whole company replaced from the file (/api/company-restore) | settings-backup | yes |
| Settings | Backup → Date filter | nothing (list filter) | settings-backup | yes |
| Settings | Backup → Testing → Purge all data + confirm | wipes the company (POST /api/company allowEmpty) |  | **not reached** — destructive for every other scenario sharing this server; cannot be proven safe in a shared pass |

## 2. Screens × checks (final run, fresh database)

| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 | C saw it after |
|---|---|---|---|---|---|---|---|---|
| All | sign-in | — | — | — | — | — | pass |  |
| Org | org-overview | n/a | n/a | pass | n/a | pass | pass | 0.5 s |
| Org | org-units | pass | pass | pass | pass | pass | pass | 0.0 s / 0.5 s |
| Org | org-units-drag | pass | pass | pass | pass | pass | pass | 0.9 s / 0.0 s / 0.7 s |
| Org | org-sbu-members | pass | pass | pass | pass | pass | pass | 0.4 s / 0.2 s |
| Org | org-functions | pass | pass | pass | pass | pass | pass | 0.7 s / 0.5 s |
| Org | org-roles | pass | pass | pass | pass | pass | pass | 0.5 s / 0.0 s |
| Org | org-roles-kroc | pass | pass | pass | pass | pass | pass | 0.0 s / 0.2 s |
| Org | org-chart-drag | pass | pass | pass | pass | pass | pass | 0.6 s / 1.1 s |
| Org | people-views | n/a | n/a | pass | n/a | pass | pass | 0.1 s / 3.5 s |
| Org | people-hire | pass | pass | pass | pass | pass | pass | 0.7 s |
| Org | people-edit | pass | pass | pass | pass | pass | pass | 0.6 s |
| Org | people-managers | pass | pass | pass | pass | pass | pass | 0.1 s / 3.6 s |
| Org | people-status | pass | pass | pass | pass | pass | pass | 0.4 s |
| Org | people-mass-update | pass | pass | pass | pass | pass | pass | 0.4 s |
| Org | people-trash-restore | pass | n/a | pass | pass | pass | pass | 1.5 s |
| Home | home-notice-badge | n/a | n/a | n/a | n/a | pass | pass |  |
| Home | home-alerts | pass | pass | pass | pass | pass | pass | 1.5 s |
| Me | me-password | pass | pass | pass | n/a | pass | pass | 2.2 s |
| Me | me-profile | pass | pass | pass | pass | pass | pass | 0.4 s |
| Settings | settings-access-roles | pass | pass | pass | pass | pass | pass | 2.1 s / 1.0 s |
| Settings | settings-assign | pass | pass | pass | n/a | pass | pass | 1.8 s / 1.3 s |
| Settings | settings-logins | pass | pass | pass | n/a | pass | pass | 2.1 s / 3.7 s / 2.2 s |
| Sign-in | forgot-password | n/a | n/a | n/a | n/a | n/a | pass |  |
| Settings | settings-setup | pass | n/a | pass | n/a | pass | pass | 1.4 s |
| Settings | settings-trash | pass | n/a | pass | pass | pass | pass | 1.4 s |
| Settings | settings-backup | pass | n/a | pass | n/a | pass | pass | 1.8 s |
| Settings | settings-restore | pass | pass | pass | pass | pass | pass | 1.9 s / 3.4 s / 1.2 s |

"C saw it after" = seconds from the save (or the drop) until C's idle screen
showed it, per sub-step of check 3.

`n/a` cases (each with its reason):

- **org-overview, check 1** — read-only screen: counts only, nothing to edit on Overview (edits are made on Brands & SBUs / Functions, covered there)
- **org-overview, check 2** — read-only screen: no fields to edit
- **org-overview, check 4** — read-only screen: no delete control on Overview
- **people-views, check 1** — views, filters and search are per-browser sessionStorage state (apms-ui-people-list-v1), not records; the hires used here are checked in people-hire
- **people-views, check 2** — same: nothing in a view is a record field; field edits are checked in people-edit
- **people-views, check 4** — a view has no edit control of its own; delete vs a stale edit is checked in people-hire / people-edit / people-status
- **people-trash-restore, check 2** — a trashed person has no fields to edit; the trash row's only actions are Restore / Delete forever (one action per record)
- **home-notice-badge, check 1** — the badge is per-browser state (NOTICE-GLANCE: localStorage apms-glanced-v1:<person>), no record to edit
- **home-notice-badge, check 2** — same: nothing in the DB; marking a notice Done is checked in home-alerts
- **home-notice-badge, check 3** — another user never sees this browser's glance state by design; live notice changes are checked in home-alerts
- **home-notice-badge, check 4** — a badge has nothing to delete (Done on a notice is home-alerts check 1)
- **me-password, check 4** — a password has no delete; deleting the person while he is on Me is checked in me-profile check 4
- **settings-assign, check 4** — Assign people has no delete; a person is deleted under Org → People (not this area). The stale edit of a deleted access role is check 4 of settings-access-roles
- **settings-logins, check 4** — logins cannot be deleted from Settings (no delete control); Reset replaces the password
- **forgot-password, check 1** — anonymous single-person request on the sign-in page; it saves nothing another user edits, shares or deletes
- **forgot-password, check 2** — anonymous single-person request on the sign-in page; it saves nothing another user edits, shares or deletes
- **forgot-password, check 3** — nothing changes, so there is nothing for an idle admin to see
- **forgot-password, check 4** — anonymous single-person request on the sign-in page; it saves nothing another user edits, shares or deletes
- **forgot-password, check 5** — anonymous single-person request on the sign-in page; it saves nothing another user edits, shares or deletes
- **settings-setup, check 2** — the Setup marks are one list value (settings/setupDone); the two concurrent marks in check 1 are the same row
- **settings-setup, check 4** — setup marks have no delete (only 'Show setup again', which clears the whole list; used in the clean-up)
- **settings-trash, check 2** — a trash item has no editable fields; Restore and Delete forever act on the whole item (check 1 has the two actions at once)
- **settings-backup, check 2** — a backup copy is immutable (no fields to edit)
- **settings-backup, check 4** — copies cannot be deleted from the UI (they expire after 30 days)

## 3. Special cases

| Screen | Special check | Result | Detail |
|---|---|---|---|
| settings-logins | must-reset | pass | Kiran Kumar Nayaka signed in with the temporary password: set a new password, app opened; DB mustResetPassword false, issued = new true; sign-in new 200 / temporary 401; C dropped "Must set password" 3.7 s after |
| settings-logins | special | pass | A reset B (floyd.dsil): old password → 401 (want 401), browser sign-in with the old password → refused; new password → 200. B's open session after the reset: get-session still valid (not revoked), B's screen showed the first-sign-in 'Set a new password' screen. B then signed in with the new password |
| settings-logins | security | pass | anonymous POST /api/issued-logins 401 (want 401); employee POST another person's row 403 (want 403), POST /api/provision-logins 403 (want 403), own row 200 (want 200); Kiran Kumar Nayaka's password unchanged: sign-in 200 |
| settings-logins | issue-remaining | pass | Issue remaining (166): message "Issued 166 logins. The sheet downloaded — share each row privately."; CSV rows 166; issued_logins 6 → 171, CSV rows whose issued password differs 0; sample vishal.kuma signs in with its CSV password 200, with 0000 401; put back nikhil.pati (200); B/C/A/nikhil still si |
| forgot-password | needHr | pass | aaynar.kuma (@aliens.local): screen "Contact HR / Contact HR to reset this password."; request POST /api/password-reset 200 {"ok":true,"needHr":true,"message":"Contact HR to reset this password."}; password / mustReset / reset tokens unchanged true |
| forgot-password | public-email | pass | ronlind.mene (public email, no mail server): screen "Contact HR / Contact HR to reset this password."; response {"ok":true,"needHr":true,"message":"Contact HR to reset this password."}; password unchanged true, Ronlind-e2e-1 still signs in 200 |
| settings-backup | restore-file | pass | overlay "Restored: Restored 180 people. Closed months stayed as stored. 53 month records. 49 reward records. Reload to see it." after 1.9 s (button Reload); DB: "E2E bk fn muf74tuo14" live rows 0 (want 0), people 180; B dropped it 5.3 s, C 5.2 s after the file was picked (without reload) |
| settings-backup | restore-empty-targets | pass | file with targetCells {} and targetNodes []: overlay "Restored: Restored 180 people. Closed months stayed as stored. 53 month records. 49 reward records. Reload to see it."; live targets before {"cells":114,"nodes":23,"members":94} → after {"cells":114,"nodes":23,"members":94} (contract: restore pro |
| settings-restore | special | pass | restore: "Restored. A marked copy of what was live is in the list if you need to go back." after 1.8 s; C dropped the after-backup function 1.9 s after; B's open form then held "E2E B unsaved muf74tuo15", B pressed Tab + Save; B's Functions list without the function 15.6 s after the restore; DB: aft |

- **Restore while B has unsaved edits** (`settings-restore` special): A
  restores a server copy while B has an Org → Functions edit form open with
  typed, unsaved text. The restore wins: C's idle screen switched to the
  restored data **1.9 s** after the restore, without a reload; B's list
  switched after B left the field and pressed Save (15.6 s in this run — the
  time B took, the test waits for B's own actions); B's unsaved text was
  **not** written over the restored data (DB checked after B's Save and
  after reload), and nothing from before the restore came back. Restore from
  a **file** (`settings-backup` restore-file): B and C dropped the
  post-backup function 5.3 s / 5.2 s after the file was picked, no reload.
  A file with **empty** target cells / nodes restores (RESTORE-EMPTY-OK) and
  leaves the live targets graph as it was.
- **Password changes** (`settings-logins` special, `me-password`): after A
  resets B's password, B's **old password → 401** (API and browser sign-in)
  and the **new one → 200**; the forced "Set a new password" flow works
  (temporary 401 afterwards). Me → Password: old fails, new works, a
  concurrent edit of the same person by A does not bring the old password
  back. Observed: B's already open session is **not** revoked by the reset
  (see §4, open).

## 4. Security — findings and fixes

`scripts/e2e/security-batch2.mjs` on the built server, fresh database:
**43 / 43 pass**. Unit: `src/lib/batch2-security.test.ts`.

### (a) `POST /api/issued-logins` and `POST /api/provision-logins`

Before: no session check at all — anyone on the internet could set any
person's password (including a super admin's) with one request.

Now (one rule, `src/lib/apms-admin-auth.ts` `authorizeLoginWrite`, applied in
the Nitro middleware `server/middleware/01-apms-auth.ts` **and** in both route
files, and in the Vite dev plugin):

| Caller | `/api/issued-logins` | `/api/provision-logins` |
|---|---|---|
| anonymous | **401** | **401** |
| signed-in non-admin, someone else's row | **403** | **403** |
| signed-in non-admin, **own** row only | 200 (see note) | **403** |
| admin (access role base `admin` / `super_admin`) | 200 | 200 |

Note — the SPA's own "change my password" (Me → Password, and the forced
first-sign-in "Set a new password") posts the person's **own** row to
`/api/issued-logins`. Refusing that would lock every non-admin out of changing
their own password, so a row is accepted from a non-admin only when every row
names the caller (username and personId). Tested both ways.

### (b) Session tokens

Before: `hasSessionToken` accepted **any bearer longer than 8 characters**,
and `apms-login.<personId>` / `apms-preview-sunny` were the session tokens —
anyone who knew (or guessed) a person id was signed in as that person.

Now: sign-in issues a random token (`apms-s.` + 32 random bytes); only its
SHA-256 is stored (`apms_sessions`, migration `0010_apms_sessions.sql`, also
created at runtime). Every `/api/*` route and `/_serverFn/*` call resolves the
bearer or the (now **HttpOnly**) `better-auth.session_token` cookie against
that table (`src/lib/apms-sessions.ts`, `apms-request-auth.ts`
`sessionFromHeaders`): one gate in the middleware plus the check in each
handler. Sign-out deletes the row. Tested on **44 routes** × 7 forged tokens
(none, random bearer, hand-written `apms-login.<admin id>` as bearer and as
cookie, `apms-preview-sunny`, a well-formed never-issued `apms-s.…`, the real
admin token with one character changed) → **401 everywhere**; the issued
token is accepted on every route; a signed-out token is 401.

Public on purpose: `/api/auth/*` (sign-in / get-session / sign-out),
`/api/password-reset*`, the `companyIsEmpty` server fn (a boolean the sign-in
page reads), and `/api/company-backups?daily=1|hourly=1` from loopback (the VPS
cron).

After the cut every browser signs in once (old `apms-login.*` tokens are 401).

### (c) Every other `/api/*` route — what was found

| Route / area | Hole | Status |
|---|---|---|
| all routes | forged / guessable tokens accepted (b) | **fixed** |
| `/api/password-reset` (anonymous) | a reset request **overwrote the person's password at once** (any account could be locked out by anyone), and off the live host (`BETTER_AUTH_URL` not containing alienstattoo.in) the **temporary password was returned in the response** — full take-over of any account, admins included | **fixed**: the password changes only after the temporary one was actually emailed to the person's own mailbox; nothing is ever returned (`APMS_RESET_PREVIEW=1` shows it for local testing only). `needHr` unchanged. |
| `POST /api/company-restore`, `POST /api/company` (restore / allowEmpty / adminRestore), `/_serverFn` legacy snapshot save + backup | any signed-in employee could replace the whole company | **fixed**: admin only (403) |
| `/api/company-backups` (list / download / save / restore) | any signed-in employee could download a whole-company copy (salaries, personal data) or restore | **fixed**: admin only (403); loopback cron unchanged |
| `PATCH /api/people/:id` | any signed-in person could raise their **own access role** to super_admin, or set **another person's password** | **fixed**: 403 unless admin (`src/lib/apms-write-guard.ts`); own profile edits and own password still work |
| `PATCH /api/e/access-roles/*` | any signed-in person could rewrite what a role may do | **fixed**: admin only |
| `PATCH /api/e/logins/*` | any signed-in person could re-point someone else's login | **fixed**: admin, or own row |
| session cookie | readable by page scripts | **fixed**: HttpOnly (the SPA never reads it) |
| Vite dev plugin (`scripts/recovered-apms-plugin.mjs`) | minted the old guessable tokens | **fixed**: same sessions + same login rule |
| every GET (`/api/company`, `/api/people`, `/api/changes?payload=1`, `/api/e/*`, month/reward records) | any signed-in employee can read the whole company (salaries, CTC, phone, DOB) — the server does not scope reads by access role; the SPA hides it | **open — design decision** (server-side read scoping per access role) |
| other entity writes (`/api/e/*`, `/api/org/*`, month / reward records, target cells) | any signed-in person can write any row; permissions (grants) are enforced only in the SPA | **open — design decision** (mirror the access-role grants on the server) |
| roster lock / unlock / copy / rebind | already HR / admin checked on the server | ok |
| passwords at rest | `issued_logins.password` and `people.payload.password` are **plain text** (never sent to browsers since NO-SECRETS-WIRE) | **open** — hash them (needs a one-time migration) |
| sign-in | no rate limit / lock-out on failed attempts | **open** |
| password reset by an admin | the person's existing sessions are **not** revoked (the old password stops working at once, an already signed-in browser stays signed in) | **open — your call** (revoking also signs out any browser they have open) |

### Pending your decision (not changed, as instructed)

- **`sunny.b` / `0000`** — `apms-credentials.ts` `verifyLogin`: `sunny.b` (or `sunny`)
  with `0000` always signs in as super admin, whatever password is stored.
- **`0000` default** — any person with **no stored password** signs in with `0000`.
  On the seed that is **167 of 176 active people** (Settings → Assign people
  "still need a first login"), including managers and function heads.
  Combined with no rate limit, anyone who knows a username can sign in as them.
  Recommendation: issue everyone a login (Settings → Assign people → Issue
  remaining) and then remove both, in one release.

## 5. What failed, why, and the fix

Every failure below was found by the batch-2 scenarios on a fresh database,
recorded with the steps, the requests (`ctx.net` in the JSON reports) and the
root cause, then fixed in the server or the sync layer — the SPA bundle is
stamped (p0as81, `scripts/stamp-p0as81-batch2.mjs`, every change an exact
string replacement asserted to match) only where the bug was in the SPA itself.
The ROWS-V2 design is unchanged: rows with their own rev, 409 = field merge,
tombstones stand, change feed for followers, no refresh bar.

| # | Screen (check) | Steps and requests | Root cause | Fix | Where |
|---|---|---|---|---|---|
| 1 | Settings → Backup → Restore, and Restore from a file (3, special) | A: `POST /api/company-backups {action:"restore"}` 200 / `POST /api/company-restore` 200. C idle on Org → Functions and B with an unsaved edit still listed the post-backup function 30–60 s later; C only polled `GET /api/changes`, tick `at` unchanged. | Restore wrote the `*` resync row with **no `pg_notify`**, before the wire was invalidated, and the live tick carried the backup's **old** `notebookUpdatedAt` — idle screens were never told. The client's `*` handling was a normal pull that respects dirty screens. | Server: the `*` row is written **last** (after books, rows, wire invalidation) with `pg_notify`, and the tick carries now. Sync: `*` → `restorePull()` pulls every book and applies with reason `restore`; the SPA's live hook takes it even while a field is being edited (the edit is dropped); row caches (revs, remote deletes) are reset. | `company-entity-store.ts` `logResync`, `company-notebook.ts`, `apms-sync.js`, stamp (apply hook) |
| 2 | Settings → Access roles (2) | B opens Edit on role R; A saves a new note; B ticks one grant and saves → `PATCH /api/e/access-roles/R` 200 with A's old note. | The dialog sent the **whole role as it was when it opened**, and its "initial" values were re-read from the store on every render. | Save sends only the fields changed in the dialog (against the values it opened with, kept once), grants / flags rebased per module on the live role. | stamp (routes `bp`) |
| 3 | Settings → Access roles (4) | B's feed held; A deletes role X; B edits X → 409 deleted; after release B still listed X until reload. | A failed `/api/changes` poll (aborted / network) did not rewind: the tick was marked used before the poll, so B never polled again until a new commit. | A failed poll resets `lastChangesAt` so the next tick polls again. | `apms-sync.js` |
| 4 | Settings → Assign people (2, 3) | A sets X to HR while B clicks Reset on X; entity_log: rev 4 A `hr`, rev 5 **B `manager`** at B's reload. | After a login reset the person / logins rows kept the new `password` locally; the server never echoes passwords (NO-SECRETS-WIRE), so the rows stayed "dirty" forever and B's whole stale row was re-sent on every save / unload. | The sync remembers a password the server accepted and does not count it as a pending change; a new password is still sent. | `apms-sync.js` |
| 5 | Settings → Setup (1, 3, 5) | "Done" on a step: `pendingOps()` shows `settings/setupDone` for 12 s+, nothing sent. | The SPA's save trigger watches a fixed list of store fields; `setupDone` and `companyFactor` were missing. | Both added. | stamp (routes subscribe list) |
| 6 | Settings → Backup (3) | C's list of server copies never showed A's new copy without a reload. | The list was read once when the screen opened. | Re-read every 3 s while the Backup screen is open. | stamp (routes `AwBk`) |
| 7 | Settings → Trash → Restore a function (1) | `PATCH /api/e/trash/<id>` 200, **no** `PATCH /api/e/functions/<fn>`; trace `stale-readd-dropped`. The item was **lost** (trash row gone, function still deleted). | The stale-re-add guard dropped the restore (the id was in `remoteDeletedKeys` from the delete echo), and the server refuses a create over a tombstone. | The trash row's delete is sent first; only if **this** save removed it (200) may its rows re-create over their tombstone (baseRev = tombstone rev — the contract's explicit path). A stale screen (trash row already gone: someone restored it or deleted it forever) gets a 409 and its re-add is dropped. | `apms-sync.js` |
| 8 | People → Trash → Restore a person (5), Me (Nikhil restore) | `PATCH /api/people/<id>` 200 (live), then the whole org book `PATCH /api/company` still carrying `tombstones.people[<id>]` → `people.deleted_at` set again; the DB flipped back and forth; after reload the screens listed X, the DB had it deleted. | `dualWriteHotTables` applied every tombstone in every book save; nothing cleared a person's tombstones on restore. | Server: a people tombstone **older than the row's last write** is dropped from a book save; a live write over a deleted person (the explicit restore) clears that person's tombstones. Sync: fix #7 covers people too (stale restore after "Delete forever" is dropped). | `company-hot-tables.ts`, `company-entities.ts`, `apms-sync.js` |
| 9 | People → person file (1) | Form Save `PATCH /api/people/<id>` 200 (`roleId:null`); Core role picked 0.6 s later went out **35 s** later, only on navigation. | Autosave: the timer found a save in flight and gave up; the save's end then cleared the dirty flag. | The save runs once more when the in-flight save ends. | stamp (routes autosave `g`) |
| 10 | Home → bell badge (5) | Badge 8 → 3 after opening the tray; after reload 5. | Derived reminders ("… 7 days to lock") got a **random id per page load** and are never saved, so the per-browser "seen" list (NOTICE-GLANCE, not in the DB) never matched them after a reload. | Derived reminders (plan due / late / month close) get a stable id from their dedupe key. | stamp (login-view `addNotice`) |
| 11 | Org → Roles → KROC tab (2, 3, 5) | A renames KRA 1 → `PATCH /api/e/roles/K1` 200; **C, only viewing**, 9 s later `PATCH` with the old "New KRA" → 200. A's (and B's) edits lost. | The KROC editor compared its local draft with the live store, so another user's change made an idle editor "dirty", and its 8 s autosave wrote the stale draft back at the current rev. | The editor keeps the KRAs it was seeded from; dirty = differs from the seed; a clean editor re-seeds from the store. | stamp (routes `Pf`) |
| 12 | Org → Brands & SBUs drag (2, 3, 5) | Drag an SBU left out of its group: no request. Reorder D3 above LILA: no request. | Brand / SBU rows were drop targets **beside** their children (every row depth 0 → every drop "inside the row above"); a reorder at the top of a brand became a no-op nest. | Rows wrap their children like People / Functions; root wrapper; "inside brand" = before its first SBU. | stamp (routes `Ud` / `Hd` / `Ld`) |
| 13 | Org → sibling reorder (People tree, SBUs, brands, functions, roles) (3, 5) | A drags T3 above T1: A's screen reorders, **no request**; C keeps its order; reload = storage order. Before any drag, A and C already showed different orders. | Reorder only re-ordered the local array; these rows had no order field; the people hot table has no order (heap order). | Reorder / nest writes `sortKey` 0..n-1 on the moved row's siblings (same manager / parent / brand / company); companies, brands, SBUs, functions, sub-functions and roles are `siblingOrder` collections kept sorted by `sortKey` (server assemble + sync feed apply); people come in the books' order, then `sortKey`. | `apms-collections.js`, `company-assemble.ts`, `apms-sync.js`, stamp (login-view reorder*) |
| 14 | Org → People tree drag (2) | Drag T1 left at the end of T3's reports: `PATCH` sent but manager stays T3. | `slotToDrop` returned "after prev", keeping prev's parent. | Returns "after prev's ancestor at the target depth". | `apms-dnd-engine.js`, `apms-dnd.ts` (+ unit test) |
| 15 | Org → Brands & SBUs rename (note) | Double-click on a brand / SBU name opened its page instead of the inline rename (the page says "Double-click a name to rename"). | The first click opened the page. | A single click opens after 300 ms unless a double-click follows. | stamp (routes) |
| 16 | People → person file (3), Settings → Assign people (2, 3) — found in run 3 | A and B change the same person at the same moment; DB right (both kept), but A's change never showed on B's / C's screens. | A feed person row was placed with the SPA's `updatedAt` rule, so an older local copy won when the row's `updatedAt` came from the user who clicked first but committed last. | The feed row at a newer rev replaces the screen's copy (password kept locally). | `apms-sync.js` `mergeHotRow` / `replacePersonRow` |

## 6. Batch 1 regression (APMS, Rewards, Targets) — final run, fresh database

| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 | C saw it after |
|---|---|---|---|---|---|---|---|---|
| All | sign-in | — | — | — | — | — | pass |  |
| APMS | apms-month-list | pass | pass | pass | pass | pass | pass | 0.7 s |
| APMS | apms-plan-open | pass | pass | pass | pass | pass | pass | 2.4 s |
| APMS | apms-plan-locked | pass | pass | pass | pass | pass | pass | 2.1 s |
| APMS | apms-plan-drag | pass | pass | pass | pass | pass | pass | 1.0 s |
| APMS | apms-self-comments | pass | pass | pass | pass | pass | pass | 3.1 s |
| APMS | apms-eo | pass | pass | pass | pass | pass | pass | 2.2 s / 2.0 s |
| APMS | apms-quarter-review | pass | pass | pass | n/a | pass | pass | 0.9 s |
| APMS | apms-lock-close | pass | pass | pass | pass | pass | pass | 1.9 s |
| Targets | targets-delete-recreate | pass | pass | pass | pass | pass | pass | 3.2 s / 1.2 s |
| Rewards | rewards-month-list | pass | pass | pass | pass | pass | pass | 0.7 s |
| Rewards | rewards-plan-open | pass | pass | pass | pass | pass | pass | 2.3 s |
| Rewards | rewards-mass-update | pass | pass | pass | pass | pass | pass | 0.1 s |
| Rewards | rewards-my-rewards | pass | pass | pass | pass | pass | pass | 1.3 s |
| Rewards | rewards-lock-close | pass | pass | pass | pass | pass | pass | 2.0 s |
| Targets | targets-cells | pass | pass | pass | pass | pass | pass | 1.4 s |
| Targets | targets-groups | pass | pass | pass | pass | pass | pass | 0.8 s |
| Targets | targets-drag | pass | pass | pass | pass | pass | pass | 0.9 s |
| Targets | targets-month-list | pass | pass | pass | pass | pass | pass | 4.1 s |
| Targets | targets-copy-month | pass | pass | pass | pass | pass | pass | 1.1 s |
| Targets | targets-import | pass | n/a | pass | pass | pass | pass | 0.9 s |
| Targets | targets-target-tab | pass | pass | pass | pass | pass | pass | 1.3 s / 1.1 s |
| Targets | targets-month-status | pass | pass | pass | pass | pass | pass | 2.8 s |
| Home | smoke-home | — | — | — | — | n/a | pass |  |
| Me | smoke-me | — | — | — | — | pass | pass |  |
| Org | smoke-org | — | — | — | — | pass | pass |  |
| KPI | smoke-kpi | — | — | — | — | pass | pass |  |
| Awards | smoke-awards | — | — | — | — | pass | pass |  |
| MIS | smoke-mis | — | — | — | — | pass | pass |  |
| Settings | smoke-settings | — | — | — | — | pass | pass |  |
| Improve | smoke-improve | — | — | — | — | pass | pass |  |
| Roster | smoke-roster | — | — | — | — | — | n/a |  |

**Green**, same as `REPORT-THREE-USERS.md`. (The first baseline on the
p0as80 build had `targets-delete-recreate` check 3 fail once — C did not show
the re-created target within 5 s in that full pass; it passed alone and in
every later full pass, including the final one.)

## 7. How the final result was reached, and what is still open

Runs on this branch (each: build, fresh database per suite):

| Run | Build | Batch 2 | Security | Batch 1 |
|---|---|---|---|---|
| baseline | rows-v2 p0as80 | — | — | 1 fail (targets-delete-recreate 3, once) |
| per-area agent runs | p0as80 + security | failures #1–#15 (§5) | — | — |
| run 1 | p0as81 (b7) | 1 stop: `people-views` — B's hire not in the DB after 20 s (**intermittent**, see below) | 43/43 | pass |
| run 2 | b7 | **pass** | — | — |
| run 3 | b7 | `people-edit` 3, `settings-assign` 2/3 | — | stopped (superseded) |
| targeted | b8 (+ fix #16) | `people-edit` + `settings-assign` × 2: pass (one check-6 straggler, below) | — | — |
| **run 4 (final)** | **b8** | **pass** | **43/43** | **pass** |

Fix #16 (from run 3): a person row from the change feed was placed with the
SPA's `updatedAt` rule (`mergeKeepPeopleClient`), so an older local copy won
whenever the row's `updatedAt` came from the user who clicked first but
committed last — A's access-role change never reached B's / C's screens
(DB correct). The feed row at a newer rev now replaces the screen's copy
(fields the wire never carries, like a password just set, are kept).
`apms-sync.js` `mergeHotRow` / `replacePersonRow`.

Test-only change (from the targeted run): the runner now waits until no
browser has written for 3 s between scenarios, so the previous scenario's
last save (the org book carrying the tombstones of the people it trashed at
its end) is not counted as a write on opening the next screen.

Still open / notes:

- **Intermittent (run 1 only):** `people-views` stopped once because B's hire
  was not in the DB 20 s after "Create person". It passed in runs 2 and 4 and
  in every targeted run; the network log was not kept in run 1 (it is kept
  now), so the cause is not established. If it recurs, the JSON report has
  B's requests.
- Security design decisions and `sunny.b` / `0000`: §4.
- Every person edit also sends `PATCH /api/company` with the whole org book
  (~550 KB; book-owned fields only are applied; often after a 409 retry).
  Not a correctness problem, a cost.
- A sibling reorder writes `sortKey` on every sibling (one PATCH per sibling
  row whose position changed).
- Settings → Assign people → Download sheet contains passwords only for logins
  issued in this browser session (the wire carries no passwords), though the
  screen says "it has passwords".
- The seeded super admin cannot save their own Me profile until an Employee
  ID is entered ("Employee ID is required").
- Seen once by hand, not reproduced by a test: changing the Core role select
  on a person file cleared the person's manager.
- Not reached (with reasons) are listed in §1 — mainly destructive actions
  in a shared run (Purge all data, Empty trash), file uploads (People import,
  KROC upload), the role-change case workflow, and the mailed reset link
  (no mail server in the sandbox).
- The test sandbox has no internet: the Google Fonts stylesheet fails to load
  (a note, not an app error).
