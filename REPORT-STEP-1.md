# REPORT-STEP-1 — stop snapshot overwrite (PATCH / books)

**Date:** 2026-09-19  
**Stamp:** `apms-sync.js?v=p0as1` (routes `*-p0ar`)  
**Scope:** Step 1 of 7 only. No Postgres row tables. No OT / CRDT / Yjs.

## Holes closed

| Hole | Result |
|------|--------|
| `fallbackPost` full snapshot LWW | **Deleted.** `save()` PATCHes only. `wrapFetch` converts a legacy company POST into `save()`, or returns **410** — it never forwards a full POST. Production `POST /api/company` remains 410 unless `restore` / `allowEmpty` / `adminRestore`. Anon POST/GET/PATCH stay **401**. |
| Global `saveChain` | **Split per book.** Org and months PATCH wait on their own queues and can run together. Persist writes **only applied books**, then reassembles from `company_books` rows so one book cannot clobber another. |
| `pullLive` while dirty / in-flight / debounce | **Early-return.** Remembers remote `at` only. After unblock, applies **non-dirty books**. Never replaces the whole company. SPA `isBlocked` is dirty `D` / save-in-flight `f` / debounce `p`. |
| UI nav in books | **Stripped.** `currentMonth` is not in org `BOOK_FIELDS`. `bookPayload` skips session keys. Hydrate preserves `currentMonth`, `view`, `kind`, selection ids. |
| Lock empty state | **Kept.** Scorecard shows **“Record missing or lost to sync — refresh”** + Refresh. Validator writes `join(' · ')`. No bare **“Nothing open.”** |
| Same person + same month | **409 `person-month-conflict`** + banner + Refresh. Different people in the same month union-merge. |
| Deletes / empty trash | **Tombstones.** Stale PATCH / `commitBooks` cannot resurrect people, months, or target cells. |

## A1–A5

| ID | Scenario | Result |
|----|----------|--------|
| **A1** | HR adds 5 people while Rewards locks 10 other month-records | **PASS** — `three-team-concurrency.test.ts` (serial PATCH + parallel persist-applied-books) |
| **A2** | Different people same month both persist; same person same month → conflict UI | **PASS** — rebase keeps both locks; overlapping person-month returns `person-month-conflict` (not silent LWW); SyncBar + Refresh |
| **A3** | Lock never bare “Nothing open.” | **PASS** — `routes-e2g7y5q8-13m-p0ar.js` has the refresh error; lock validator writes `n(r.slice(0,5).join(' · '))` |
| **A4** | `save()` never full-POSTs | **PASS** — PATCH 410/network → `patch-failed`; wrapFetch POST → PATCH or 410; `fallbackPost` gone |
| **A5** | UI nav never persisted; deletes stay deleted | **PASS** — `splitSnapshot` / `commitBooks` skip nav keys; tombstones hold against stale gens |

Suite: `company-books` + `apms-sync` + `three-team-concurrency` + `company-ui-session` = **72 pass / 0 fail**. Typecheck pass. Production build pass. Dev + built login screen match. Signed-in home: **Hey Sunny**, **175** people.

## Production write contract (unchanged + this step)

- **Only write path:** `PATCH /api/company` with dirty books + `baseGens` + `clientOpId`
- **POST /api/company:** 410 except admin restore / purge
- **Live:** SSE `{ at, bookGens }`; client `GET ?books=` only changed books; skip all hydrate while blocked
- **UI keys never in DB:** `currentMonth`, `view`, `kind`, `selectedPersonId`, `selectedMonth`, `selectedRoleId`, `selectedTargetMonth`

## Not in this step

- Step 2+ Postgres row tables for people / month records / targets
- 50-VU live soak (needs Eng harness on the test deploy)

Hard-refresh the preview on `apms-sync.js?v=p0as1`. Testers can keep working at the same time.
