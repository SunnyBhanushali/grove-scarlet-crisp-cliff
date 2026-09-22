# LOAD-3TEAM-REPORT — three concurrent teams

**Date:** 2026-09-19  
**Stamp:** `*-p0ar` / `apms-sync.js?v=p0ar1`  
**Lineage:** P0-A/B + per-book PATCH (N5dH / iCoIQ) finished for production writes

## What shipped

| Gap | Fix |
|-----|-----|
| `fallbackPost` full LWW | **Removed** from `save()`. PATCH failure returns `patch-failed` — never POST |
| `pullLive` ignores `isBlocked` | **Early-return** when dirty / in-flight / debounce; remembers remote `at` only |
| Production full POST | **`410 Gone`** unless `restore` / `allowEmpty` / `adminRestore` |
| Lock `Nothing open.` | Replaced with **“Record missing or lost to sync — refresh”** |
| Same-person same-month LWW | **`person-month-conflict`** — no silent overwrite; banner + Refresh |
| Org people | **Union-merge by id**; omitted people kept unless tombstoned |
| Deletes | **Tombstones** on months / people ids; stale gen cannot resurrect |
| P0-A | `kp()` / `cp()` omit UI nav; hydrate preserves month/view/selection |

## A1–A5

| ID | Scenario | Result |
|----|----------|--------|
| **A1** | HR adds 5 people while Rewards locks 10 other month-records | **PASS** — `src/lib/three-team-concurrency.test.ts` |
| **A2** | Same month, different people both persist; same person same month → conflict | **PASS** — rebase keeps both locks; overlapping person-month returns conflict (not silent LWW) |
| **A3** | Lock never bare “Nothing open.”; validation shows concrete messages | **PASS** — bundle has the refresh error; lock validator writes `A.join(' · ')` into the banner |
| **A4** | Save never full-POST (410 / network) | **PASS** — `save()` records `PATCH-FAIL`, methods POST-free |
| **A5** | UI nav never in books; trash stays empty; stale targets cannot resurrect | **PASS** — `splitSnapshot` / `commitBooks` skip stale gens; tombstones hold |

Suite: `company-books` + `apms-sync` + `three-team-concurrency` = **67 pass / 0 fail**.

## Production write contract

- **Only write path:** `PATCH /api/company` with dirty books + `baseGens` + `clientOpId`
- **POST /api/company:** 410 except admin restore / purge
- **Live:** SSE `{ at, bookGens }`; client `GET ?books=` only changed books; skip all hydrate while blocked
- **UI keys never in DB:** `currentMonth`, `view`, `kind`, selection ids

## Not in this drop (Eng rebuild)

- 50-VU live network soak against Contabo `:3010` (needs Eng harness on production DB)
- Drive zip (Eng packs `.output` with `NITRO_PRESET=node-server`)

Until that soak, the unit contract for A1–A5 is green in source. Hard-refresh the preview on `*-p0ar`.
