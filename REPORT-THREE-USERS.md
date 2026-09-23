# REPORT-THREE-USERS — APMS, Rewards, Targets with three real users

Branch `rows-v2`, stamp **p0as80** (sync + routes + login-view), server on the
same branch. Built with `NITRO_PRESET=node-server npm run build:app`, run on
the built output against a fresh local Postgres (`aliens_apms_test`, seed
import), three Chromium browsers signed in as three admins:
A = `sunny.b`, B = `floyd.dsil`, C = `ronlind.mene`.

Test: `scripts/e2e/rows-v2-three-users.mjs` (libs in `scripts/e2e/lib/`).
One pass, one fresh database, every scenario in order, then the module smoke.

The six checks per screen:

1. A and B edit **different records** at the same time → both persist.
2. A and B edit **different fields of the same record** at the same time → both persist.
3. C, idle on the screen, sees A's and B's changes **within 5 s** without reloading.
4. A **deletes** a record; B's live feed is held so B's screen is provably
   stale; B still sees it, edits and saves → it **stays deleted** for everyone,
   after reload too.
5. After everyone **reloads**, the screens and the database agree.
6. No refresh / conflict banner, **no writes on sign-in or on opening the
   screen**, no 5xx.

## 1. Screens and save actions

### APMS

| Screen | What is saved there | Scenario |
|---|---|---|
| Plans → month list | Add APMS / Add people (new plans), Delete plan from the list, month groups | `apms-month-list` |
| Person-month page, open plan (scorecard / plan / execution / values sections — sections of one page, not tabs) | KPI weightage, values selection, execution outcomes (add priority), manager notes | `apms-plan-open` |
| Person-month page, locked plan | KPI actuals (month-end), execution scores, values scores | `apms-plan-locked` |
| Lock plan / Unlock plan / Close plan (+ close validation) | plan status | `apms-lock-close` |
| Plan editing by drag (reorder KPIs / KRAs) | KPI / KRA order | `apms-plan-drag` |
| My APMS → own plan: Self comments (employee) vs Manager notes | selfNotes / notes | `apms-self-comments` |
| EO (execution outcomes across plans) | status, manager rating, notes, Move to trash | `apms-eo` |
| My APMS → Add review → Quarterly review | Open review, Self comments, Manager discussion notes | `apms-quarter-review` |
| APMS mass update | — | **not reached**: this build has no mass update in APMS (Rewards only) |
| My APMS → Team | read-only summary | opened (no save action) |

### Rewards

| Screen | What is saved there | Scenario |
|---|---|---|
| Plans → month list | Add people, Delete plan, month groups | `rewards-month-list` |
| Person reward page, open plan (all sections: KRAs + weights, KPIs, reward flags / disqualifiers, target link "Unlock against", manager notes) | as listed | `rewards-plan-open` |
| Lock / Unlock plan, locked plan month-end actuals, Close plan (with the Close targets dialog) | status, actuals | `rewards-lock-close` |
| Mass update (target link for many people) | targetNodeId on many plans | `rewards-mass-update` |
| My rewards + Self comments vs Manager notes | selfNotes / notes | `rewards-my-rewards` |
| Target link after the target is deleted / re-created | targetNodeId | `targets-delete-recreate` |

### Targets

| Screen | What is saved there | Scenario |
|---|---|---|
| Month list | Add target (new / existing month), Duplicate month, Edit (opens month), Delete month | `targets-month-list` |
| Month view: cells, ladders M1–M5, actuals | target cells | `targets-cells` |
| Groups: create group 1 + members, group 2 + other members (group 1 intact), switch to set floors, remove members | nodes, members | `targets-groups` |
| Reorder and nest by drag | root order, members | `targets-drag` |
| Month status open / lock (Unlock plan / Lock plan), Change log (history), month delete | month status, target history | `targets-month-status` |
| Copy month (month page) | cells, members, order | `targets-copy-month` |
| Import (spreadsheet) | whole months | `targets-import` |
| Target tab / Group tab (one target across months) | read view + month-page edits | `targets-target-tab` |
| Delete a target; delete and re-create while rewards are linked | cells, reward links | `targets-delete-recreate` |
| Month close ("Close targets") | closes only after month end | covered inside `rewards-lock-close` (August) |

## 2. Screens × checks (run 2, fresh database)

RESULTS_TABLE

`n/a` cases:

- **Quarterly review, check 4** — a review has no delete control (open → self
  comments → lock only).
- **Import, check 2** — Import replaces whole months (the dialog says so
  before Import is pressed: "import replaces them completely … numbers for
  those months will be lost"). It never edits one field, so "different fields
  of the same record" cannot happen on this screen. Measured anyway: a number
  B typed while A's import was being applied is replaced by the file's blank.
  **Your decision**: keep (as designed), or make a blank cell in the file mean
  "keep the current value".

## 3. Smoke — other modules

Signed in (three admins at once: **no writes**, no 5xx), opened every screen,
one edit per module, reload. "Edit" = the value is in the database right
after the save and still there after the reload.

SMOKE_TABLE

- Home: read-only dashboard, nothing to edit.
- Plans: the APMS / Rewards plans screens are covered above.
- Roster: **not reached** — the Roster link opens no page in this build.

## 4. What failed, why, and the fix

Each fix is in the server or the sync layer (plus small stamps on the SPA
bundle where the bug was in the SPA itself), keeping the ROWS-V2 design in
`APMS-BUILD-CONTRACT.md`. Commits on `rows-v2` after HOT-FEED (3a49ec4):

| # | Failure (check) | Root cause | Fix | Commit |
|---|---|---|---|---|
| 1 | Writes on sign-in / opening APMS & Rewards (6) | award prizes / reward seed / `updatedAt` treated as edits; auto reminders created by every admin | book-field split, content compare without `updatedAt`, server dedupe of auto reminders | 8563a42 |
| 2 | Deleted plans came back (4) | a stale or reloaded person page rebuilt a blank plan and saved it | stale re-add detection per screen entry; tombstone stands | 09f09f5, eaf56e9 |
| 3 | Idle / reloaded screens undid other users' APMS changes (2, 5) | stale write-back of a whole record; wire cached before the last commits | superseded-row guard, feed replay from the wire's `feedSeq`, ghost records cleared, no conflict banner on remote delete | 906278c |
| 4 | Another user's new target vanished (2) | a row pull merged onto the snapshot taken before its GETs | merge onto the current screen | 7813ca3 |
| 5 | Member order lost; stale drag re-attached a deleted target (1, 4) | member `pos` not saved; membership accepted for a deleted cell | `pos` ordering; server refuses membership for a tombstoned cell; cells before members | 3353684 |
| 6 | C saw a month lock 5–8 s late (3) | (a) a tick during an in-flight poll was dropped; (b) the SPA left the screen "dirty" after a feed apply, so the next apply was refused; (c) C's browser froze ~3 s copying the whole company per tick | re-poll on missed ticks; stamp p0as80 clears the dirty flag after a feed apply; screen checks share one snapshot copy; LISTEN-driven SSE ticks; book mirror / wire encode off the reply path | fac5f2c, 7c7a68b |
| 7 | Duplicate month took 6.5 s to reach others (3) | every membership row waited for a whole-book rewrite, one at a time; two SSE streams per tab left four request slots | generic-row book mirror group-committed in the background; one live stream per tab | 7c7a68b |
| 8 | Server never exited on SIGTERM (restart hang) | the LISTEN connection held the event loop | unref'd socket and retry timers | 7c7a68b |
| 9 | **Lost update on Targets values** (2, 5) | a focused value input kept the copy it took on focus; another user's change arrived; on the next click elsewhere the stale copy was written back as if typed | stamp p0as80: commit on blur only what was typed since focus; untouched focused input follows the store; Target-tab rename starts from the current name | 95f68c6 |
| 10 | **Trashed EO came back** (4) | `merge3` on id arrays kept an item one side deleted if the other side had edited it | a removal by either side stands (id arrays) | a98adef |
| 11 | Opening a quarterly review wrote an empty review; reminders written on every sign-in (6) | the SPA puts placeholder rows in its store | the sync does not write a blank idle review or an untouched derived reminder; a server row replaces a local placeholder | a98adef |
| 12 | **MIS folders lost on reload** (smoke) | the SPA's `exportSnapshot` (login-view chunk) omitted `reportFolders` | added (stamp p0as80, idempotent); routes load `?v=p0as80` | 4ed1151 |
| 13 | Three scenarios stopped in run 1 | test data: two scenarios deleted the same plan; delete/re-create ran after Rewards had moved its links | each scenario deletes its own record; order fixed | 013c7cd, 3393815, e5f0d16 |

Live latency after the fixes (C idle, edits by A and B): typically 1–3 s; month
lock with a concurrent cell edit ≈ 3 s.

### Delete and re-create a target while rewards are linked

Rewards unlock against a target **node** (`targetNodeId`). Deleting the target
from a month deletes its **cell** for that month only; the node and the reward
links stay. The Rewards page shows "Select a target…" (nothing to unlock
against) within ~4 s on an idle screen. Re-creating it — from **Brand or SBU**
or as a **custom name** with the same name — reuses the same node, so the
cell comes back and every reward link points at it again (C's page shows the
target again ~1 s later). No link is lost or rewritten.

## 5. Still open / notes

- Contract deviation (recorded in the CHANGELOG): the hydrate cursor replays
  the change feed from the wire's `feedSeq` instead of `head=1`, so a reload
  never misses commits made after the wire was cached.
- Import vs a concurrent edit: see section 2 (design decision for you).
- The test sandbox has no internet: the Google Fonts stylesheet fails to load
  there (reported as a note, not an app error).
- Unit tests: `npm test` 196 + 381 pass; `npm run typecheck` clean.
