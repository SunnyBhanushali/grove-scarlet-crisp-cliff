# REPORT-MOD-ORG

## Status
done in this tree. 20 Sep 2026 17:55 IST. Stamp **p0as74** (`apms-sync.js?v=p0as74`). Routes stay **p0as72**. **Not deployed.**

Does not undo p0aw1 / SCREEN-READ / APMS month-records. Soft wire, tick cap 20, `unchanged:true`, POST 410 kept.

## Job
Stage 5 of 9 — Org + person profile + trash only. Fetch on access.

## Child screens and the GET each uses

| Screen (view) | GET |
|---|---|
| org-overview / org | `GET /api/org?kind=overview` |
| org-chart | `GET /api/org?kind=chart` |
| org-builder | `GET /api/org?kind=builder` |
| org-units / companies | `GET /api/org?kind=companies` |
| org-brands / org-brand | `GET /api/org?kind=brands` — selected → `GET /api/org/brands/:id` |
| org-sbus / org-sbu | `GET /api/org?kind=sbus` — selected → `GET /api/org/sbus/:id` |
| org-cluster | `GET /api/org?kind=cluster` |
| org-functions / org-function | `GET /api/org?kind=functions` — selected → `GET /api/org/functions/:id` |
| org-roles / role-edit / role-view | `GET /api/org?kind=roles` — selected → `GET /api/org/roles/:id` |
| org-people tabs | `GET /api/people?limit=80` (`q` / `sbu` optional) — **unchanged** |
| org-person profile (hire / edit / status) | `GET /api/people/:id` |
| people search / picker from Org | `GET /api/people?limit=80&q=` |
| settings-trash / people trash | `GET /api/org?kind=trash` |

## Save
| What | PATCH |
|---|---|
| Person | `/api/people/:id` |
| Org node | `/api/org/:kind/:id` (companies, brands, sbus, functions, roles, subFunctions) |
| Two different people/nodes | both persist |
| Stale same row | **409** |

No GET `/api/company` on these pages. APMS/Rewards/Home do not GET `/api/org`. APMS month-records and Rewards month stay off `/api/company`.

Live: `org-*` hints only pull while an Org/person/trash screen is open. People G9 row GET unchanged.

## Tests
| Case | result |
|---|---|
| open org-person Network is `/api/people/:id` not company | **pass** |
| open SBU Network is that slice not company | **pass** |
| A edits a person; B opens that profile and sees it | **pass** |
| two nodes persist; stale same row 409 | **pass** |
| APMS/Rewards/Home no extra org pull | **pass** |
| Existing APMS / screen-read / G9 / sync | **pass** (58/58 this run) |
| `fallbackPost` | **absent** |

## HANDOFF
```
MOD-ORG done in tree. Stamp p0as74.
Org screens GET /api/org?kind= or /api/org/:kind/:id. Person GET/PATCH /api/people/:id.
Trash GET /api/org?kind=trash. Home/APMS/Rewards fetch nothing org.
Do not undo p0aw1 / screen-read / APMS month-records.
Do not start Rewards extras, Targets, Plans, Awards, or Settings.
```
