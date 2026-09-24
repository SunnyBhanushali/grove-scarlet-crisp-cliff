# Aliens APMS — build contract

Product host is **https://apms.alienstattoo.in** (production SPA). `app.alienstattoo.in` is the older tree. This workspace is Aliens APMS, not a new app. Do not scaffold. Do not invent OT / CRDT / Yjs / Automerge / WebRTC. Do not disable multi-user.

Live cut as of 20 Sep 2026 morning: routes **p0as39** + sync **p0as14**. LOAD-10 G9 still **0/3**. This tree is **p0as80** (ROWS-V2 + HOT-FEED + THREE-USERS: sync p0as80; routes p0as80; login-view p0as80).

## LOCKS

- Remix / `extensions.js` **OFF**. Never re-inject `grok-app-builder`.
- Nitro preset **`node-server`** for Contabo. Ignore `NITRO_PRESET=vercel` (Grok injects it). Real ship is `.output/server/index.mjs`.
- Anon `/api/company` **and entity routes** → **401**. **BATCH-2:** the only accepted session is a token the server issued at sign-in (`apms-s.<random>`, SHA-256 in `apms_sessions`, `src/lib/apms-sessions.ts`), by bearer or the HttpOnly `better-auth.session_token` cookie. `apms-login.<personId>`, `apms-preview-sunny` and "any bearer > 8 chars" are **401** on every `/api/*` and `/_serverFn/*` route (one gate in `server/middleware/01-apms-auth.ts` plus each handler). Public: `/api/auth/*`, `/api/password-reset*`, the `companyIsEmpty` server fn, loopback backup cron.
- **BATCH-2 admin-only (403 for a signed-in non-admin):** `POST /api/issued-logins` (except the caller's own row — own-password change) and `/api/provision-logins`; restore (`/api/company-restore`, `POST /api/company` restore, legacy `/_serverFn` save/backup); `/api/company-backups`; `access-roles` rows; other people's `logins` rows; changing anyone's access role or another person's password through `/api/people/:id`. Admin = access role base `admin` / `super_admin`.
- `POST /api/company` → **410** unless `restore` / `allowEmpty` / `adminRestore`.
- UI nav keys **never** in DB. People list search/SBU filters live in `sessionStorage` (`apms-ui-people-list-v1`), not books.
- Screen location (`view`, selected person/month/role, nav history) lives in `sessionStorage` (`apms-ui-session-v1`), not books, not persist `kp()`. Browser refresh must restore that screen. Persist hydrate must not replace it with `view:"home"`.
- The breadcrumb **back arrow** is `goBack()` (navHistory). It must restore the previous view with that client list state intact. Do not `setView('org-people')` in a way that wipes search/filters.
- `save()` is PATCH-only. **No `fallbackPost`.**
- **GET `/api/company` is read-only** and assembles people / records / rewardRecords / targetCells from hot rows. Catalogs, plans, roles, notices stay in books. Do not bump `at` / bookGens / ETag on GET. Do not `importHotTables` on every GET (once if empty). Do not `publishEntityWrite` from GET.
- **Wire cache:** same If-None-Match / same `at` → `{ unchanged: true }` (no snapshotJson). Entity writes **patch-in-place** or **soft-invalidate** (stale-while-revalidate; never null the gzip body mid-GET). Hard `invalidateCompanyWire()` only for restore / book-wide PATCH / admin wipe.
- **People list** uses GET `/api/people?limit=80` (`q` / `sbu` optional). **Rewards month** uses GET `/api/reward-records/:period?limit=80`. **APMS month index** uses GET `/api/month-records/:period?limit=80`. **APMS scorecard / plan / execution / values** use GET `/api/month-records/:period/:personId`. **Org catalog screens** use GET `/api/org?kind=` / GET `/api/org/:kind/:id`. **org-person** uses GET `/api/people/:id`. **Trash** uses GET `/api/org?kind=trash`. After first hydrate those screens must not GET `/api/company` on focus, tick, or save. Home / People / Rewards must not GET month-records. Home / APMS / Rewards must not GET `/api/org`. Live still GETs the one row from `entities[]` **when that module’s screen is open**. GET `/api/company` is first login / backup / `?books=` / rare full assemble only.
- **PATCH `/api/company` ignores those four collections.** Entity routes only.
- **Entity PATCH OCC is row-rev only.** After a row commit: bump SSE/tick gens, invalidate GET wire / ETag (`at` = max(book, liveAt)), do not return 200 until assemble on this process includes that person/lock.
- **ROWS-V2 (p0as78): every collection is a row.** Everything that is not people / records / rewardRecords / targetCells lives in `entities (kind, id, k1, k2, payload, rev)` — spec in `src/lib/apms-collections.js` (served as `/assets/apms-collections.js`, must load **before** `apms-sync.js`). Writes are `PATCH /api/e/:kind/:k1[/:k2]` with `baseRev`; SQL `where rev = $base returning` → 200 or 409 with the current row. **Book PATCH ignores every entity-owned field.** Row commits mirror into the book (`commitEntityRowToBook`), append to `entity_log`, `pg_notify('apms_entities')`, bump live gens. GET `/api/company` overlays entity rows over books (rows win). Restore re-imports rows from the file with `pruneMissing`. Kill switch `APMS_ENTITY_ROWS=off`.
- **409 is a merge, never a retry-as-is.** Client `saveOneEntity`: base = last acked row, mine = local, theirs = server → `merge3` (field-level; nested objects and id-arrays recurse; only a same-field clash lets the local value win). Server-deleted row → the delete stands (my edit is dropped, screen corrected); never resurrect. A tombstone is re-created only with `baseRev = tombstone rev`; `baseRev 0` on a tombstone is 409.
- **Followers use the change feed.** Any tick/SSE whose `at` moved → `GET /api/changes?since=<seq>&payload=1` → rows overlaid per row; a locally dirty row is 3-way merged and stays dirty. Acks of overlaid rows commit only after the UI took the snapshot (`commitPendingAcks`); a refused apply rewinds the cursor. Hydrate takes the cursor from `GET /api/changes?head=1`. `*` in the feed (restore) → full pull.
- Org node PATCH/GET (`/api/org/:kind/:id`) goes through the row store (was a read-modify-write of the org book outside the lock → lost updates between two admins).
- Stamp `scripts/stamp-p0as78-rows-v2.mjs`: the SPA `live-entity` apply also takes `pickDataFields(t)` (all row-owned fields), not only the four hot ones.
- **pullLive** on a non-dirty client must merge the new person / reward row (`mergeKeepPeople` / month overlay). Dirty **other** person/month: still silent overlay. Dirty **same** personId+period: keep local draft, record-level conflict only. Do not skip the people slice because only an entity gen / live `at` changed. No whole-company replace.
- **No global “Refresh to take their version” bar.** Idle users never see it. Settings / Home / Org never show it. Dismissed row conflict does not reopen on the next tick.
- SSE `/api/company-live` must include `bookGens` and `entities`, not at-only.
- SPA entity writes: hire/trash → people; Lock → reward-records; KPI actual → month-records; target cell → target-cells.
- Tombstones PK `(field, key)`. Soft-delete only.
- **Restore writes books + hot rows including the full targets graph** (`targetNodes`, `targetMembers`, `targetRootOrder`, `targetMonthStatus`, `targetCells`). Same node ids as the file. Never calls targets-import. A backup with **empty** target cells/nodes is **valid** — restore proceeds. Do not blank live interiors if the file has no graph. Fail only if the file **had** cells that did not assemble.
- Nested lists (People, functions, SBUs, targets, roles): **pointer** drag (not HTML5). The row lifts into a floating card that follows the pointer. Other rows **slide** (`translateY`) to open a slot; they do not re-order until drop. Drag **right/left** changes depth (nest / un-nest). Root row is fixed. Esc cancels. Source chrome stays in flow (`visibility: hidden`, never `height: 0`). Subtree hidden while dragging so it is not a target. Dropping on `person:root` is a no-op. Theme stays APMS — do not copy ReportingTree fonts/avatars.
- People list **MR** is only for people who **report to more than one manager** (primary + dotted). Same row: bold blue **MR**, blue square + primary name, orange circle + other manager names. A manager with many reportees and a single boss is a normal row — no MR. Arjun-style dual reporting is the only marked case.
- Settings → Assign people has **no Targets column**. Targets edit is the **Targets** grant on the access role (`canAccess(person, 'targets', …)`), not `person.gateAccess`.
- Settings → **Access roles list** is the role table only (name, scope, people count, Edit/Delete). Do **not** show “What each power set can do” on that list. Module grants and flags are edited on **Create access role / Edit access role**.
- People filters: **only admin and super_admin** start with the filter grid open. Everyone else starts **collapsed**. Search stays visible. **List / My team / Company / SBU / Function / Summary** stay outside the filter grid; each tab (and Mass update on People / Rewards) is an access-role **flag** on Create/Edit. Choice of tab is sessionStorage, not DB.
- Month-end **Achieved** is an input only with Extra flag `month_actuals` (plus existing scorer rules). Without it, Achieved paints like Target / Floor — a plain value, not a disabled field. **Change log** is Extra `changelog` (managers/employees off by default). **Lock plan / Close plan** on Rewards / APMS are Extra `lock_rewards` / `lock_apms`. The person writes **Self comments** while their plan is open or locked; viewers without that right see the text, not a dead textarea.
- People **My team** “Reports to” is **on the same line** as `N people · My team` (same `text-xs`). No separate card. Primary manager name is **blue** (`#2563eb`); additional / dotted names are **orange** (`#E25A3C`). Only who the signed-in user reports to. Hide the phrase if they report to no one. This count + Reports-to line stays on **every People view** (List / My team / Company / SBU / Function / Summary).
- People **SBU** view: current user sits at the **top**. SBUs under them are the studios of **people on their team** (not only the viewer’s own `buId`). People listed under each SBU. Unassigned only for team members with no studio. Never show “No people match” when the team has people. Function head with no personal SBU still sees team studios.
- Do not rewrite catalogs / roles into rows until instructed (Step 8 only if named).
- **Roster lock ≠ Rewards lock ≠ APMS close.** Past APMS/Rewards keyed by `(personId, period)` are never rewritten on transfer. Current Org = roster for the current period. People stay identity.
- **Rewards month, APMS month, and award instance store `rosterId`** (`roster_binds`). Reads for that month use **that roster’s assignments only**. Super-admin edits of Current Org / people identity do **not** switch the pointer. Rebind is `POST /api/roster-bind/:kind/:subjectId/rebind` (admin + reason + audit) — never implicit.

## CHANGELOG

- **Step 1–6** — overwrite closed; hot tables; dual-write; entity APIs; SPA entity writes; GET from rows.
- **Step 7** — cutover proof. See `REPORT-STEP-7.md` / `LOAD-ROWS-CUTOVER.md`.
- **LIVE-FIX** — entity PATCH publishes SSE/tick + invalidates GET. pullLive merges at-only ticks. Stamp `apms-sync.js?v=p0as6`. See `REPORT-LIVE-FIX.md`.
- **PERF-FIX** — 19 Sep 2026 IST. Stamp **p0as12**. GET cache + unchanged ETag; idle ticks no 5MB refetch. Files: `src/lib/company-wire-http.ts`, `src/lib/company-notebook.ts`, `src/lib/company-assemble.ts`, `recovered-site/assets/apms-sync.js`. See `REPORT-PERF-FIX.md` / `PERF-TODAY-REPORT.md`. **Live is this stamp.**
- **RESTORE-FIX** — 19 Sep 2026 ~19:21 IST. In-tree only (not cut). Restore refuses backups that list target months but have no target cells/nodes; persist + import full targets graph; never targets-import. Files: `src/lib/company-restore-targets.ts`, `src/lib/company-restore-http.ts`, `src/lib/company-notebook.ts`, `src/lib/company-hot-tables.ts`, `src/lib/company-restore-targets.test.ts`. See `REPORT-RESTORE-FIX.md`.
- **LIVE-ROWS-PULL** — 19 Sep 2026 ~19:31 IST. Stamp **p0as14** in this tree (not cut). Entity PATCH publishes `{ at, bookGens, entities }`; pullLive GETs that one person/lock row. Files: `src/lib/company-live.ts`, `src/lib/company-live-http.ts`, `src/lib/company-entities.ts`, `recovered-site/assets/apms-sync.js`, `src/lib/company-live-visibility.test.ts`. See `REPORT-LIVE-ROWS-PULL.md`.
- **BUILD-FIX** — 19 Sep 2026 19:37 IST. Stamp still **p0as14**. Missing `}` in `restoreCompanyFromUpload`. See `REPORT-BUILD-FIX.md`.
- **NAV-BACK** — 19 Sep 2026 20:40 IST. Stamp **p0as15**. People back arrow / goBack restores the previous view **and** the People list search/SBU filters (sessionStorage, not DB). See `REPORT-NAV-BACK.md`.
- **DND-LIFT** — 19 Sep 2026 20:55 IST. Stamp **p0as16**. Whole-row ghost follows cursor; nest-at-top. See `REPORT-DND-LIFT.md`.
- **BOOT-FIX** — 19 Sep 2026 21:01 IST. Stamp **p0as17**. `nestSbu` was missing `)` after `nestAtTop(...)` → `SyntaxError: missing ) after argument list`, app would not open. File: `login-view-f2j6t0x4-11a3-p0ar.js`. See `REPORT-BOOT-FIX.md`.
- **PEOPLE-MARKS** — 19 Sep 2026 21:02 IST. Stamp **p0as17**. People rows: MR / blue square / orange circle. See `REPORT-PEOPLE-MARKS.md`.
- **PEOPLE-FILTERS** — 19 Sep 2026 21:06 IST. Stamp **p0as18**. FH + manager People filter card starts collapsed. See `REPORT-PEOPLE-FILTERS.md`.
- **MY-TEAM-MGRS** — 19 Sep 2026 21:10 IST. Stamp **p0as19**. My team header chips. See `REPORT-MY-TEAM-MGRS.md`.
- **PEOPLE-MARKS-MR** — 19 Sep 2026 21:14 IST. Stamp **p0as20**. Marks only on multi-reporting people; MR is bold blue text. See `REPORT-PEOPLE-MARKS.md`.
- **ASSIGN-TARGETS** — 19 Sep 2026 21:17 IST. Stamp **p0as21**. Dropped Targets column from Assign people. See `REPORT-ASSIGN-TARGETS.md`.
- **DND-LIFT-2** — 19 Sep 2026 21:20 IST. Stamp **p0as22**. Ghost is the cream row only. See `REPORT-DND-LIFT.md`.
- **MY-TEAM-BOSSES** — 19 Sep 2026 21:24 IST. Stamp **p0as23**. My team bar = who the signed-in user reports to, not all managers. See `REPORT-MY-TEAM-MGRS.md`.
- **REFRESH-VIEW** — 19 Sep 2026 21:30 IST. Stamp **p0as24**. Browser refresh restores the current screen from `sessionStorage` (`apms-ui-session-v1`). Persist hydrate cannot dump the user on Home. See `REPORT-REFRESH-VIEW.md`.
- **ACCESS-ROLES-LIST** — 19 Sep 2026 21:45 IST. Stamp **p0as25**. Removed the “What each power set can do” matrix from Settings → Access roles list. Create/Edit still owns the grant grid. Files: `routes-e2g7y5q8-13m-p0ar.js`, `src/lib/access-roles-list.test.ts`. See `REPORT-ACCESS-ROLES-LIST.md`.
- **PEOPLE-MARKS-PAINT** — 19 Sep 2026 21:50 IST. Stamp **p0as26**. Marks were invisible: `text-[#2563eb]` / `bg-[#E25A3C]` are not in `styles-cqr6Ayzo.css`. Now inline styles + `apms-people-marks.css`; MR on the name line; MR also if 2+ reportees. See `REPORT-PEOPLE-MARKS.md`.
- **REPORTS-TO-LINE** — 19 Sep 2026 21:55 IST. Stamp **p0as27**. My team “Reports to” moved onto the `82 people · My team` line; primary name blue, extra names orange. No chip card. See `REPORT-MY-TEAM-MGRS.md`.
- **PEOPLE-FILTER-TABS** — 19 Sep 2026 22:00 IST. Stamp **p0as28**. Filter grid collapsed by default except admin/super_admin. View tabs always visible. See `REPORT-PEOPLE-FILTERS.md`.
- **DND-LIFT-3** — 19 Sep 2026 22:05 IST. Stamp **p0as29**. Video still showed blank list + vanished person. Cause: FLIP transform on every row, `height:0` source, and drop on `person:root` unparented. Fixed. See `REPORT-DND.md`.
- **MR-DUAL-ONLY** — 19 Sep 2026 22:10 IST. Stamp **p0as30**. MR + manager chips only when the person reports to more than one manager. Having a team is not MR. See `REPORT-PEOPLE-MARKS.md`.
- **SBU-VIEW** — 19 Sep 2026 22:25 IST. Stamp **p0as31**. People SBU view: viewer at top, team studios under them, no empty-match card. `sbuUnitsForViewer` uses team `buId`s. See `REPORT-SBU-VIEW.md`.
- **DND-SLOT** — 19 Sep 2026 22:35 IST. Stamp **p0as32**. People/function/SBU/target/role trees use ReportingTree **slot physics** (lift, slide gap, indent nest). APMS theme kept. See `REPORT-DND.md`.
- **DND-SLOT-2** — 19 Sep 2026 22:40 IST. Stamp **p0as33**. Video showed the row jumping with no card: React state on drag start tore down the ghost. Drag is now refs-only until drop. See `REPORT-DND.md`.
- **REPORTS-TO-ALL-VIEWS** — 19 Sep 2026 22:42 IST. Stamp **p0as34**. People count + “Reports to” line on List / My team / Company / SBU / Function / Summary. See `REPORT-MY-TEAM-MGRS.md`.
- **DND-NEST-OPEN** — 19 Sep 2026 22:45 IST. Stamp **p0as35**. After a nest drop, the parent People row expands so the nested person is visible. See `REPORT-DND.md`.
- **ORG-PEOPLE-DEFAULT + PERSON-FILE-ID** — 19 Sep 2026 22:48 IST. Stamp **p0as36**. Org click opens People. Opening a teammate from a manager file remounts that person’s form so fields match People search. See `REPORT-ORG-PERSON.md`.
- **NOTICE-GLANCE** — 19 Sep 2026 22:52 IST. Stamp **p0as37**. Bell count drops only for notifications that were actually seen (visible in the tray or clicked). Not in the DB. See `REPORT-NOTICE-GLANCE.md`.
- **BRAND-MARK** — 19 Sep 2026 22:56 IST. Stamp **p0as38**. Sidebar/login: Aliens mark (cropped from wordmark) above **APMS** in Poppins Bold. See `REPORT-BRAND.md`.
- **BRAND-SIZE** — 19 Sep 2026 22:58 IST. Stamp **p0as39**. Header mark capped at 28px so it fits the bar. See `REPORT-BRAND.md`.
- **LIVE-ENTITY-HINT** — 19 Sep 2026 23:15 IST. Stamp **p0as40**. After entity PATCH, SSE/tick always send `entities: [{ type: people|reward-records|month-records|target-cells, id, period? }]`. Observer pullLive GETs that one URL and mergeKeep. Hyphen types (LOAD-10). Pull even if `at` did not move. See `REPORT-LIVE-ENTITY-HINT.md`.
- **RESTORE-EMPTY-OK** — 20 Sep 2026 07:12 IST. Stamp **p0as41**. Empty target cells in a backup is valid; restore is not cancelled. Months listed with no cells no longer 400. Live interiors kept if the file has no graph. Fail only if the file had cells that did not assemble. See `REPORT-RESTORE-EMPTY-OK.md`.
- **G9-LIVE** — 20 Sep 2026 07:25 IST. Stamp **p0as42** (`apms-sync.js?v=p0as42`). Hop A: SSE/tick/`wrapFetch` call `handleLiveEvent` (not a hand `pullLive`). Hop B: that path GETs `/api/people/:id` and `/api/reward-records/...` and mergeKeep. EventSource `withCredentials`. Tick `since=` empty when `at` unchanged. See `REPORT-G9-LIVE.md`.
- **G9-LIVE-P0AS47** — 20 Sep 2026 10:15 IST. Stamp **p0as47**. Hop A: SSE/tick/`wrapFetch` `handleLiveEvent` even when `at` is behind B. Hop B: hyphen+underscore entity GET. Hop C: `apply(snap,'live-entity')` overlays Zustand; live `Ft(people.length)` no longer drops the merge after GET. Two-client tests drive from SSE/tick payload and require apply reason `live-entity`. See `REPORT-G9-LIVE.md`.
- **APMS-FY-APRIL** — 20 Sep 2026 11:20 IST. Stamp **p0as48**. APMS month lists use the same April→March year as Rewards (Q1 Apr-Jun … Q4 Jan-Mar, year label FY26). Do not start APMS years in January. See `REPORT-APMS-FY.md`.
- **NAV-SIGNOUT-ONCE** — 20 Sep 2026 11:25 IST. Stamp **p0as49**. Sign out stays only at the bottom of the nav. Removed the duplicate under the name at the top.
- **PLANS-MULTI-FILTER** — 20 Sep 2026 11:40 IST. Stamp **p0as50**. APMS + Rewards Plans filters are multi-select. Bands = Band 1–6 only. Month+year is one field. SBU filter added. See `REPORT-PLANS-FILTERS.md`.
- **PICKER-BAR** — 20 Sep 2026 11:48 IST. Stamp **form-controls.css?v=p0r2**. Sticky Select all row used `var(--card, #1a1612)` which painted a black bar on cream dropdowns. Now `background: inherit`.
- **TARGET-MASS** — 20 Sep 2026 ~12:15 IST. Stamp **p0as51**. Targets Import upserts by (name, sbuId, metric, kind) and remaps `reward_records.targetNodeId` / `rewardRoleMonths` by that identity, or aborts (`this would unmap N rewards`). Mass update on Rewards + APMS month lists: checkbox / Select all / one field / Confirm; each row is its own entity PATCH with that row’s `baseRev`; 409 stays selected. No remap admin endpoint. No snapshot POST. G9 `entities[]` still published by entity PATCH. See `REPORT-TARGET-MASS.md`.
- **PLANS-UX** — 20 Sep 2026 12:40 IST. Stamp **p0as52**. Team KPI option is full name’s team. KRAs/KPIs drag with People pointer lift (reorder + move KPI across KRAs). Weight/target/floor no longer snap to `0` while typing (`020`). See `REPORT-PLANS-UX.md`.
- **EMP-STATUS** — 20 Sep 2026 12:50 IST. Stamp **p0as53**. Employee status is Active / Paused / Exited only (`left` still stored for Exited). Plans “All states”, People filter, hire form, person file. See `REPORT-EMP-STATUS.md`.
- **ROLE-HOOK** — 20 Sep 2026 12:55 IST. Stamp **p0as54**. Person-file `$o` (FY rewards cards) called `useState` after `if (!person)` / `ge()` null — React #318 black screen when clicking Role. Hook is first now. Role picker null-safe on `name`. See `REPORT-ROLE-HOOK.md`.
- **TARGET-IMPORT-CONFIRM** — 20 Sep 2026 13:00 IST. Stamp **p0as55**. Targets Import no longer aborts when a replace would leave Rewards unmapped. It applies the rest, lists the unmapped people/roles (person · month · studio), and asks **Apply anyway** or **Cancel**. Restore still writes backup ids. See `REPORT-TARGET-IMPORT-CONFIRM.md`.
- **MASS-CHECK** — 20 Sep 2026 13:05 IST. Stamp **p0as56**. Rewards + APMS month lists hide row/select-all checkboxes until **Mass update** is clicked. Second click with a selection opens the dialog. See `REPORT-MASS-CHECK.md`.
- **PLAN-DND** — 20 Sep 2026 13:10 IST. Stamp **p0as57**. KRA/KPI drag has no grip icon — hold the title. Dragging a KRA collapses every KRA body; drop restores the previous open/closed state. See `REPORT-PLAN-DND.md`.
- **MASS-UNLOCK** — 20 Sep 2026 13:15 IST. Stamp **p0as58**. Mass update **Unlock against** is that month’s Targets list only (Groups / Studios / Other metrics). Other months’ nodes are not listed. See `REPORT-MASS-UNLOCK.md`.
- **MASS-ONE-FIELD** — 20 Sep 2026 13:26 IST. Stamp **p0as59**. Mass update has one field: Unlock against. No Field picker, no SBU, no Held role. Rewards only. See `REPORT-MASS-ONE-FIELD.md`.
- **PERF-TAB** — 20 Sep 2026 13:50 IST. Stamp **p0as60**. Tick/SSE `entities[]` = ids newer than caller `at`, max 20. Client GET ≤20, in-place people merge, ignore older hints, drop `snapshotJson` after hydrate. People/Org/Rewards month lists virtualized. Idle If-None-Match stays `{ unchanged: true }` with empty `entities` (no replay). G9 path kept. See `REPORT-PERF-TAB.md`.
- **LOGO** — 20 Sep 2026 15:05 IST. Stamp **p0as61**. Sunny’s lockup (skull \| APMS) on login, sidebar, header; skull-only favicon + 180 icon; cream OG 1200×630. No extra Poppins “APMS” next to the lockup. See `REPORT-LOGO.md`.
- **ACCESS-VIEWS** — 20 Sep 2026 15:20 IST. Stamp **p0as62**. Mass update (Rewards + People) and People views (List / My team / Company / SBU / Function / Summary) are Extra flags on Create/Edit access role. Super_admin always on. Admin/HR default all on; FH/manager get people views + Rewards mass. See `REPORT-ACCESS-VIEWS.md`.
- **ACCESS-MONTH** — 20 Sep 2026 15:40 IST. Stamp **p0as63**. Extra flags: Fill monthly actuals (`month_actuals`), See change log (`changelog`), Lock & close Rewards (`lock_rewards`), Lock & close APMS (`lock_apms`). Achieved without write access looks like Target/Floor. Self comments work for the person while plan is open/locked. See `REPORT-ACCESS-MONTH.md`.
- **PLAN-SELF** — 20 Sep 2026 15:45 IST. Stamp **p0as64**. Searching yourself in Add reward/APMS plan Assign to no longer looks empty. It says you cannot create that plan for yourself; your reporting manager does. See `REPORT-PLAN-SELF.md`.
- **IU-BLACK** — 20 Sep 2026 15:50 IST. Stamp **p0as65**. Rewards edit black screen: `Iu` `useMemo` did `for…of rec.rewardFlags` and a live overlay can make that an object. Walker uses `asFlagList`; live merge listifies kras/kpis/rewardFlags. See `REPORT-IU-BLACK.md`.
- **MY-REWARDS-ONE** — 20 Sep 2026 15:55 IST. Stamp **p0as66**. Opening your own Rewards from a plan / breadcrumb / All Rewards lands on **My Rewards**, not the person-year duplicate. Other people still have the year page. See `REPORT-MY-REWARDS-ONE.md`.
- **PERF-SPIKE** — 20 Sep 2026 16:25 IST. Server **p0aw1** (SPA p0as68). Entity PATCH no longer nulls the gzip wire. Stale-while-revalidate + patch-in-place + coalesced rebuild (≤2 assemble). gzip level 5. Parallel hot-table reads. Boot warms the wire. Soak max **0 ms** / p95 **0 ms** vs live **4.38s / 8.58s**. See `REPORT-PERF-SPIKE.md`.
- **G9-LIVE-2** — 20 Sep 2026 16:30 IST. Stamp **p0as69** (sync). When A saves, B GETs that row (`/api/people/:id`, `/api/reward-records/...`), not the company file. Hints are not dropped against `lastWireAt`. Tick entities still max 20. Soft wire cache kept. See `REPORT-G9-LIVE-2.md`.
- **SCREEN-READ** — 20 Sep 2026 16:50 IST. Stamp **p0as71** then **p0as72** (routes parse fix). People list GET `/api/people?limit=80`. Rewards month GET `/api/reward-records/:period?limit=80`. After first hydrate those screens do not GET `/api/company`. See `REPORT-SCREEN-READ.md`.
- **MOD-APMS** — 21 Sep 2026 10:40 IST. Stamp **p0as77**. APMS month GET `/api/month-records/:period?limit=80`. Scorecard / plan / execution / values GET `/api/month-records/:period/:personId`. Fetch on access (nav session; lastScreenKey no longer once-per-key). Save PATCH that row; concurrent same person+month 200+409. Home/People/Rewards fetch nothing APMS. See `REPORT-MOD-APMS.md`.
- **MOD-ORG** — 20 Sep 2026 17:55 IST. Stamp **p0as74**. Org screens GET `/api/org?kind=` / `/api/org/:kind/:id`. Person GET/PATCH `/api/people/:id`. Trash GET `/api/org?kind=trash`. Home/APMS/Rewards fetch nothing org. See `REPORT-MOD-ORG.md`.
- **ARMY-FIX** — 20 Sep 2026 18:50 IST. Stamp **p0as75**. Plans PATCH logs the real stack; session-only auth; stale baseGen → 409 not 500; concurrent entity write must not 500. People/Rewards list APIs fire from nav session (`exportSnapshot` strips view). wrapFetch blocks `/api/company` and `/_serverFn` LOAD after hydrate. G9: B GET `/api/people/:id` + `/api/reward-records/:period/:id`; tick `entities[]` persist across PM2 via `live-tick` row. See `REPORT-ARMY-FIX.md`.
- **ARMY-2-FIX** — 21 Sep 2026 08:40 IST. Stamp **p0as76**. G9 `fetchHintNow` GETs the row even without liveHooks (live via=init entityGets=0). SSE first frame sends `entities[]`; 2s tick poll for PM2 worker B. People/Rewards list GET after everLoaded (lastScreenKey no longer skips already-on-org-people / pre-login 401). Entity OCC: SQL `WHERE rev=baseRev RETURNING` + per-key enqueue → concurrent same person+month **200+409**. See `REPORT-ARMY-2-FIX.md`.
- **Q-DRAWER** — 20 Sep 2026 16:05 IST. Stamp **p0as67**. My Rewards quarter **Details** opens a drawer under the five cards; Q1/Q3/Q4/YTD no longer stretch with Q2.
- **APMS-LOCK-CLOSE** — 20 Sep 2026 16:15 IST. Stamp **p0as68**. Locked APMS freezes Values pick and EO add (unlock to edit). Close blocked until selected values are rated.
- **ROSTER-R1** — 20 Sep 2026 ~08:15 IST. Stamp **p0as43**. Monthly `roster_assignments` + `roster_periods`. People stay identity. Overlay for Current Org / Rewards / APMS team lists. Seed from people into current period. Copy-from new ids. OCC + clientOpId. Lock HR; unlock admin-only if Rewards plan_locked. No dual-write people.sbu. GET `/api/company` not overlaid. See `REPORT-ROSTER-R1.md`.
- **ROSTER-LOCK** — 20 Sep 2026 08:13 IST. Stamp **p0as44**. Rewards month / APMS month / award instance store `rosterId` on `roster_binds`. Overlay reads that roster only. Org/people edits do not rebind. Admin `POST .../rebind` + audit. Files: `migrations/0007_roster_binds.sql`, `src/lib/company-roster-bind.ts`, `company-roster-bind-http.ts`, `company-roster-bind.test.ts`, `apms-roster.js`. See `REPORT-ROSTER-LOCK.md`.
- **BOOT-PAREN** — 20 Sep 2026 08:19 IST. Stamp **p0as45**. Preview would not open: `SyntaxError: Unexpected token ')'` from an extra `)` after G9 `handleLiveEvent` in `routes-…p0ar.js`. Also repaired `apms-roster.js` `esc()`. See `REPORT-BOOT-PAREN.md`.

- **ROWS-V2** — 22 Sep 2026 IST. Stamp **p0as78** (sync + routes), server **p0aw2**, migration `0008_entities.sql`. Every remaining collection (org catalog, roles, accessRoles, notices, trash, plans, kpiMaster, apmsPlans, awards, gateUnits, roleMonths, rewardRoleMonths, gateMonths, targets graph, settings scalars) is a row with its own rev. Per-row PATCH `/api/e/:kind/:k1[/:k2]`; 409 → 3-way field merge on the client (no blind retry, no whole-row overwrite); tombstones cannot be resurrected; change feed `/api/changes` replaces the 20-hint cap for these kinds. Org node PATCH race fixed. `invalidateCompanyWire` / `getCompanyWire` were used in `company-notebook.ts` without being imported (restore path would throw) — imported. PERF-TAB cap restored (≤20 row GETs per tick; in-flight hints not double-fetched). Tests: `company-entity-store.test.ts` (real Postgres via `scripts/mini-pg.mjs`), `rows-v2-client.test.ts` (client + real store end to end). See `REPORT-ROWS-V2.md`.

- **NO-SECRETS-WIRE** — 23 Sep 2026 IST. Server **p0aw3**. `people[].password`, `people[].passwordHash` and `logins{}.password` are stripped from every read path a browser sees: company wire (`slimForWire`), wire patch-in-place, `/api/people` list, `/api/people/:id`, trash list, `/api/e/logins*`, `/api/changes`. Writes preserve the stored secret when the client sends none (`preservePersonSecrets`; logins rows likewise); a new non-empty password still replaces it. `/api/provision-logins` fills a missing password from `issued_logins` / the person row before hashing. Auth middleware reads the books directly and is unaffected. Test `company-wire-slim.test.ts`.
- **ROWS-V2-VERIFY** — 23 Sep 2026 IST. Stamp still **p0as78** / server **p0aw3**. First build + real-Postgres run + two-browser Playwright (`scripts/e2e/rows-v2-two-browser.mjs`, 16/16 ×3). Fixed without changing the ROWS-V2 design: server crashed on boot (`sideEffects:false` dropped `apms-collections.js`); login rewrote every role and tombstoned all role-krocs (split roles vs whole rows, missing field read as delete; wire `roleKrocs` folded into roles); `/api/org?kind=` served split roles from the book (row merge then deleted kras/ags) — now served from rows; rev learned before the UI took the row, merged rows acked while the UI refused them, shared ack queue across flows, book 409 / book pull putting row-owned values into the baseline (all silent reverts of the other user's field); known/remote-deleted rows re-created; SPA `live` apply left the screen dirty forever and swallowed edits in the 800 ms window (stamp); people re-saved on every load (`rev` / hydrate defaults); `vite.config.ts` hard-coded `preset: "vercel"`. See `REPORT-ROWS-V2-SMOKE.md`.

- **HOT-FEED** — 23 Sep 2026 IST. Stamp **p0as79** (sync), server **p0aw4**. Live p0as78 G9 was RED (B entityGets=0) and three testers lost APMS / Rewards work and saw deleted targets return. (1) people / month-records / reward-records / target-cells commits now append to `entity_log` **with payload** (`appendHotTableChange`), so followers get them from `/api/changes` like every other row; the hint channel is no longer needed for them. Client `mergeHotRow`: clean row → take + ack (in screen shape), dirty row → 3-way merge and stays dirty, deleted → gone; rev learned only when the UI takes it. (2) `merge3` on lists of ids (target root order, …): a removal by either side sticks — this was putting deleted targets back. (3) Assemble drops `targetRootOrder` entries and `targetMembers` rows that point at a deleted target node. (4) `entity_log.payload` column is ensured at runtime (`ensureFeedSchema`), because live does not apply migration files on boot; `0009_entity_log_payload.sql` is the same statement. Tests `rows-v2-hot-feed.test.ts`.
- **THREE-USERS** — 23 Sep 2026 IST. Stamp **p0as80** (sync + routes + login-view `?v=p0as80`). Every APMS / Rewards / Targets screen checked with three admins (different records, same record different fields, idle viewer ≤ 5 s, stale edit of a deleted record, reload = DB, no banner / no writes on open / no 5xx) plus a module smoke — `scripts/e2e/rows-v2-three-users.mjs`. Fixed without changing the ROWS-V2 design: writes on sign-in / open (placeholder reviews and derived reminders are not written); deleted plans / EOs / targets stay deleted (stale re-add, `merge3` id-array removal stands, server refuses members of a deleted cell); stale write-backs; live latency (LISTEN ticks, missed-tick re-poll, SPA dirty flag after a feed apply, one snapshot copy per state, background group-committed book mirror, one SSE stream per tab); focused Targets value wrote a stale copy back (stamp); MIS report folders were never saved (`exportSnapshot` lacked `reportFolders`); LISTEN kept a stopping server alive. **Deviation:** hydrate replays the change feed from the wire's `feedSeq` (not `head=1`) so a reload cannot miss commits made after the wire was cached. See `REPORT-THREE-USERS.md`.

## OPEN

- ROWS-V2: **built (node-server) and two-browser tested on local Postgres (p0as78 / p0aw3) — `REPORT-ROWS-V2-SMOKE.md`. NOT on live.** Next: staging 3010 with `aliens_apms_test`, then live.
- **Live [https://apms.alienstattoo.in](https://apms.alienstattoo.in) is routes p0as39 + sync p0as14.** This tree is **p0as77**. Eng cut when asked (`NITRO_PRESET=node-server`). Keep `.env` + `aliens_apms`. This sandbox has no SSH.
- G9-LIVE: **done in tree / unit tests. FAIL on live until p0as47/p0as51 is cut.**
- LIVE-ROWS-PULL / LIVE-ENTITY-HINT: superseded by G9-LIVE (p0as42).
- RESTORE-FIX / RESTORE-EMPTY-OK: **done in tree.** Empty-targets backup is allowed. Live restore still not cut.
- NAV-BACK: **done in tree** (p0as15).
- DND-LIFT: **done in tree** (p0as16). Browser drag feel untested here.
- BOOT-FIX: **done** (`node --check` login-view + routes pass).
- PEOPLE-MARKS: **done in tree** (p0as17).
- PEOPLE-FILTERS: **done in tree** (p0as18). FH/manager filters collapsed by default.
- MY-TEAM-MGRS: **done in tree** (p0as19).
- PEOPLE-MARKS-MR: **done in tree** (p0as20). Multi-reporting only.
- ASSIGN-TARGETS: **done in tree** (p0as21). Assign people has no Targets column.
- DND-LIFT-2: **done in tree** (p0as22). Browser feel untested here.
- MY-TEAM-BOSSES: **done in tree** (p0as23).
- REFRESH-VIEW: **done in tree** (p0as24). Browser click-through untested here.
- ACCESS-ROLES-LIST: **done in tree** (p0as25). Power-set cheat sheet gone from the list; Create/Edit still has the grant grid.
- PEOPLE-MARKS-PAINT: **done in tree** (p0as26). Colors are inline; hard-refresh needed. Live p0as12 still has no marks.
- REPORTS-TO-LINE: **done in tree** (p0as27). Count line includes Reports to; no separate card.
- PEOPLE-FILTER-TABS: **done in tree** (p0as28). Tabs always visible; filters collapsed except admin/super_admin.
- DND-LIFT-3: **done in tree** (p0as29). Browser feel still untested here; unit tests pass.
- MR-DUAL-ONLY: **done in tree** (p0as30). MR only if the person reports to >1 manager.
- SBU-VIEW: **done in tree** (p0as31). Viewer at top; team SBUs; no empty-match card.
- DND-SLOT: **done in tree** (p0as33). Pointer lift + sliding slot + indent. Ghost no longer killed by a re-render.
- REPORTS-TO-ALL-VIEWS: **done in tree** (p0as34). Count + Reports to on every People tab.
- DND-NEST-OPEN: **done in tree** (p0as35). Nest drop expands the parent list.
- ORG-PEOPLE-DEFAULT / PERSON-FILE-ID: **done in tree** (p0as36).
- NOTICE-GLANCE: **done in tree** (p0as37). Badge = unglanced only.
- BRAND-MARK: **done in tree** (p0as38). Mark + Poppins APMS.
- BRAND-SIZE: **done in tree** (p0as39). Header mark 28px.
- LIVE-ENTITY-HINT: **done in tree** (p0as40). Hyphen `entities[]` + observer entity GET.
- RESTORE-EMPTY-OK: **done in tree** (p0as41). Empty targets in backup is not an error.
- G9-LIVE: **done in tree** (p0as47, stamp now p0as69). Tick/SSE → handleLiveEvent → entity GET (not company file) → `apply(...,'live-entity')`. Two-session test logs tick JSON + entityUrl. Live still 0/3 until cut.
- TARGET-MASS: **done in tree** (p0as51). Import reuses/remaps reward pointers. Mass update is per-row entity PATCH; 409 stays selected. Do not start roster.
- TARGET-IMPORT-CONFIRM: **done in tree** (p0as55). Unmapped rewards are listed; Apply anyway / Cancel; import is not aborted. Restore unchanged.
- MASS-CHECK: **done in tree** (p0as56). Checkboxes hidden until Mass update. Same `vs` for Rewards and APMS.
- PLAN-DND: **done in tree** (p0as57). Title-hold drag; KRA lift collapses other KRA bodies.
- MASS-UNLOCK: **done in tree** (p0as58). Unlock against = this month’s Targets list only.
- MASS-ONE-FIELD: **done in tree** (p0as59). Mass update is Unlock against only (no SBU / Held role / Field picker).
- PERF-TAB: **done in tree** (p0as60). Tick/SSE cap 20; client GET cap 20; Virt lists; drop snapshotJson; idle unchanged tiny. G9 entity GET kept. Live freeze until cut.
- LOGO: **done in tree** (p0as61). Lockup on login/sidebar/header; skull favicon; cream OG. Live still shows the old 3D mark until cut.
- ACCESS-VIEWS: **done in tree** (p0as62). Mass update + People view tabs are Extra flags. Live still ungated until cut.
- ACCESS-MONTH: **done in tree** (p0as63). Actuals / changelog / lock-close are Extra flags. Achieved is a value when you cannot write. Self comments work on open/locked plans. Live until cut.
- PLAN-SELF: **done in tree** (p0as64). Assign-to search for yourself shows “cannot create for yourself”. Live until cut.
- IU-BLACK: **done in tree** (p0as65). Rewards edit no longer blacks out on object `rewardFlags`. Live until cut.
- MY-REWARDS-ONE: **done in tree** (p0as66). Own Rewards is My Rewards only. Live until cut.
- PERF-SPIKE: **done in tree** (server p0aw1). 10 PATCH + 20 GET ≤2 assemble; soak max **0 ms** / p95 **0 ms** vs live **4.38s / 8.58s**. Live until Eng cuts.
- G9-LIVE-2: **done in tree** (p0as69). B GETs the row. Dead hop was B (`lastWireAt` drop + hyphen URL). Live until cut.
- SCREEN-READ: **done in tree** (p0as72). People / Rewards month use list APIs. After hydrate they do not GET `/api/company`. Live until cut.
- MOD-APMS: **done in tree** (p0as77). APMS month/scorecard/plan/execution/values use month-records on access. Home/People/Rewards fetch nothing APMS. Concurrent 200+409. Live until cut.
- MOD-ORG: **done in tree** (p0as74). Org/person/trash use `/api/org` + `/api/people/:id`. Home/APMS/Rewards fetch nothing org. Live until cut.
- ARMY-FIX: **done in tree** (p0as75). Plans PATCH 200/409; People/Rewards list APIs from nav session; wrapFetch blocks company + LOAD hash; G9 entity GETs + tick persist. Live until cut.
- ARMY-2-FIX: **done in tree** (p0as76). via=init entity GET; People list after already-on-org-people / 401 lastScreenKey; OCC 200+409. Live until cut.
- PLANS-UX: **done in tree** (p0as52). Full-name team labels; KRA/KPI pointer dnd; empty weight/target/floor does not pin `0`.
- EMP-STATUS: **done in tree** (p0as53). Active / Paused / Exited only. Stored `left` for Exited.
- ROLE-HOOK: **done in tree** (p0as54). `$o` hooks-first; Role click no longer React #318.
- ROSTER-R1: **done in tree** (p0as43). People identity vs period overlay. Seed / copy-from / lock / OCC / overlay. R2 split-day still open.
- ROSTER-LOCK: **done in tree** (p0as44). Rewards/APMS/award store `rosterId`; reads use that roster; rebind is admin+audit only.
- BOOT-PAREN: **done in tree** (p0as45). Extra `)` in routes G9 patch removed; SPA parses. Hard refresh `?v=p0as45`.
- Do not start Step 8.

## ACCEPTANCE

| Item | tree | live p0as12 |
|------|------|-------------|
| Durability (hires/locks survive) | pass (unit) | **pass** (LOAD-10 15/15, 14/14) |
| G8 immediate GET after hire | pass | **pass** (5/5) |
| PERF idle `unchanged:true` tiny body | pass | **pass** (203 bytes) |
| G9 B pullLive sees A hire/lock, no reload | **pass** (two sessions: tick JSON → `entityUrl` → GET `/api/people/:id` + `/api/reward-records/...` + apply `live-entity`; no company GET) | **fail** on p0as14 LOAD-10 (pulls=55, entityGets=0). Untested on p0as69 until cut. |
| Restore full targets graph; empty-cells file is allowed | **pass** (unit) | **untested** until p0as41 is cut |
| POST `/api/company` 200 count | pass (410 except restore) | **pass** (0) |
| fallbackPost absent | pass | pass |
| People back keeps search/SBU filters | **pass** (unit cache) | untested on live |
| DnD nest-at-top + hit zones | **pass** (unit) | untested on live |
| SPA boot (`node --check` login-view + routes + roster) | **pass** after BOOT-PAREN p0as45 | n/a (preview was `Unexpected token ')'` on p0as43/44) |
| People MR / blue square / orange circle | **pass** (inline #2563eb / #E25A3C on name line) | **fail** (p0as12 has no marks) |
| FH/manager People filters collapsed | **pass** (only admin/super_admin start open; tabs always visible) | untested on live |
| My team Reports-to / Managers chips | **pass** (inline on count line; primary blue, extra orange) | untested on live |
| Browser refresh stays on current screen | **pass** (unit: applySession vs persist home) | untested on live |
| Access roles list has no power-set matrix | **pass** (bundle test) | untested on live |
| People SBU view (viewer top, team studios) | **pass** (unit) | untested on live |
| DnD slot physics (lift / slide / indent) | **pass** (unit) | untested on live |
| Roster R1 (seed / transfer isolation / lock / copy-from / overlay / 401) | **pass** (unit 11/11) | untested until p0as43 is cut |
| Roster lock (rewards/apms/award store rosterId; Org edit does not rebind; admin rebind+audit) | **pass** (unit 6/6) | untested until p0as44 is cut |
| Targets import does not orphan rewards (reuse or remap; unmapped listed + Apply anyway / Cancel, never abort) | **pass** (unit) | untested until p0as55 is cut |
| Mass update 5 people targetNodeId; 4 updated + 1 409; select none disabled | **pass** (unit) | untested until p0as51 is cut |
| Month-list checkboxes hidden until Mass update | **pass** (unit: `canMass:t&&massOn===r`) | untested until p0as56 is cut |
| KRA/KPI title-hold drag; KRA lift collapses bodies | **pass** (unit: no Move KRA grip; `apms-rt--dragging-kra`) | untested until p0as57 is cut |
| Mass Unlock against is that month’s Targets list | **pass** (unit) | untested until p0as58 is cut |
| Mass update is Unlock against only (no SBU / role) | **pass** (unit) | untested until p0as59 is cut |
| Tab perf: tick/SSE ≤20 entities; idle unchanged tiny; Virt lists; G9 one-row GET kept | **pass** (unit 123/123) | **fail** on live p0as14 (long `entities[]`, 4 tabs freeze). Untested on p0as60 until cut. |
| Lockup logo (skull \| APMS) on login, rail, header; skull favicon | **pass** (unit) | **fail** on live until p0as61 is cut |
| Mass update + People views are Extra flags on Create/Edit access role | **pass** (unit) | untested until p0as62 is cut |
| Fill actuals / changelog / lock-close are Extra flags; Achieved is a value without write access | **pass** (unit) | untested until p0as63 is cut |
| Assign-to self shows cannot-create-for-yourself, not empty match | **pass** (unit) | untested until p0as64 is cut |
| Rewards edit does not black-screen on object rewardFlags / live overlay | **pass** (unit) | **fail** on live p0as39 until p0as65 is cut |
| Own Rewards from plan/breadcrumb is My Rewards, not a second person page | **pass** (unit) | untested until p0as66 is cut |
| 10 entity PATCH + 20 GET /api/company ≤2 assemble, GET never waits on null cache | **pass** (unit, builds=2, max 0 ms, p95 0 ms) | live until Eng cuts p0aw1 (was **4.38s / 8.58s**) |
| People list / Rewards month do not GET `/api/company` after first login | **pass** (unit: list URLs, wrapFetch unchanged, live row GET) | untested until p0as72 is cut |
| APMS month/scorecard/plan/execution/values GET month-records, not company; Home fetches nothing APMS; concurrent 200+409 | **pass** (unit p0as77) | untested until p0as77 is cut |
| Org/person/trash GET org slice or `/api/people/:id`, not company | **pass** (unit p0as74) | untested until p0as74 is cut |
| Plans PATCH 200 + marker; stale baseGen 409 not 500; concurrent entity write must not 500 | **pass** (unit p0as75) | **fail** live 18:05 `{error:patch-failed}` until cut |
| People/Rewards call list APIs after hydrate; idle no company GET / no `_serverFn` LOAD | **pass** (unit p0as75) | **fail** live 18:05 list hits=0 until cut |
| G9 B GET `/api/people/:id` + `/api/reward-records/:period/:id` within 20s; tick entities persist across PM2 | **pass** (unit p0as76; failure shape via=init entityGets=0 then pass) | **fail** live 19:49 entityGets=0 via=init until cut |
| People navigate always GET `/api/people?limit=`; Rewards month always GET `/api/reward-records/:period?limit=`; idle company 0 | **pass** (unit p0as76; lastScreenKey no longer skips already-on-org-people / pre-login 401) | **fail** live 19:49 People listHits=0 until cut |
| Concurrent entity PATCH same person+month 200+409; different people same month both 200 | **pass** (unit p0as76; SQL WHERE rev=baseRev + enqueue) | **fail** live 19:49 200+200 until cut |
| Team option is full name’s team; KRA/KPI pointer dnd; weight empty does not become `020` | **pass** (unit) | untested until p0as52 is cut |
| Employee status is Active / Paused / Exited | **pass** (unit) | untested until p0as53 is cut |
| Click Role on person file does not React #318 | **pass** (unit: `$o` useState before early return) | **fail** on live until p0as54 is cut |

No fake live G9 pass.

## KNOWN BROKEN

- ROWS-V2 two-browser smoke passes locally; SPA editors still write derived role fields (`band`) from their own state and re-seed award prizes on load (one 409 probe per row, no write). See `REPORT-ROWS-V2-SMOKE.md` → Follow-ups.
- Legacy sign-in (`apms-credentials.ts`): `sunny.b` / `sunny` with password `0000` always signs in, and any person with no stored password signs in with `0000`. Server-side only now (the wire no longer carries passwords), but still a hard-coded credential — decide with Sunny before removing.
- Live G9 on p0as14: B entityGets=0 / pulls=55. Fixed in tree p0as69 (hop B: do not drop hints vs lastWireAt; hyphen URL; no company GET). Next LOAD-10 must be LIVE_SEES_HIRE 3/3, LIVE_SEES_LOCK 3/3, B entityGets >= 2.
- This tree is not on Contabo. Hard refresh on live still loads p0as12/p0as14. Preview must load `routes-e2g7y5q8-13m-p0as72.js` and `apms-sync.js?v=p0as77`.
- Restore targets still a separate hole until p0as41 is cut.
- Split-month roster (R2) is not in R1.
- Roster lock (p0as44) is in-tree only; live still overlays whatever R1 loaded for the month on screen.

## HANDOFF

- Stamp / host: **tree SPA p0as77 (sync) + routes p0as72 + server p0aw1**, **live p0as39 / LOAD-10 p0as14** https://apms.alienstattoo.in
- What passed: MOD-APMS — APMS month GET `/api/month-records/:period?limit=80`; scorecard/plan/execution/values GET `/api/month-records/:period/:personId`; fetch on access from nav session; save PATCH that row; concurrent 200+409; Home/People/Rewards fetch nothing APMS. People/Rewards listHits≥1. Idle company 0. Plans 200/409. p0aw1 SWR. ARMY-2 via=init kept.
- What is still broken: **live still company-GET on APMS until Eng cuts p0as77**
- Exact next named job: Eng cut `NITRO_PRESET=node-server` when asked. Do not start Org extras / Rewards extras / Targets / Plans studio / Awards / Settings / Step 8. Do not undo p0aw1 / Plans 200/409 / idle company GET=0.

