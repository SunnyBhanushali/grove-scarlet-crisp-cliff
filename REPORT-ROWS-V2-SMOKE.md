# REPORT-ROWS-V2-SMOKE — build, tests, two-browser run (p0as78 / p0aw3)

23 Sep 2026. Branch `rows-v2` = `main` + the two patches (`ROWS-V2 p0as78/p0aw2`,
`NO-SECRETS-WIRE p0aw3`) + the fixes below. Not merged to `main`. Not on live.

## Result

| Step | Before fixes (patches only) | After |
| --- | --- | --- |
| `npm install --include=dev` | ok | ok |
| `npm run typecheck` | 50+ errors (most already on `main`) | **0 errors** |
| `npm test` | `scripts/` suite 10 fail (same on `main`), so the `src/` suite never ran; `src/` alone: 6 fail | **196/196 + 360/360** |
| `NITRO_PRESET=node-server npm run build:app` | built `.vercel/output` → `[apms] node-server build missing` | **ok, `.output/server/index.mjs`** |
| Built server boots | **crashed**: `Cannot read properties of undefined (reading 'FIELDS')` | ok |
| Two-browser Playwright | — | **16/16, three runs on fresh databases** |

## Two-browser test

`scripts/e2e/rows-v2-two-browser.mjs` (in the repo). Real browsers (Chromium),
built `.output` server, local **PostgreSQL 16**, database seeded by the server's
own first-boot import (180 people, 59 roles, 829 entity rows). A = `sunny.b`,
B = `floyd.dsil` (a second super admin; test password set in `issued_logins`).

**Scenario 1: same role, two users.** Both open Org → Roles → Studio Manager.
A changes the band: AGS 1A → Master, 1B → Multi-Func (148 → 183 pts, Band 3 → 4).
B, without waiting, changes the name (Edit → Title → Save placement).

```
A 409 /api/e/roles/studio-mgr baseRev=0 → rev 1      (A did not know the rev yet)
B 409 /api/e/roles/studio-mgr baseRev=0 → rev 2      (A already committed)
A 200 /api/e/roles/studio-mgr baseRev=1 → rev 2      band 4, ags 40/30
B 200 /api/e/roles/studio-mgr baseRev=2 → rev 3      merge: B's name + A's band
```

| Check | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| No entity writes on sign-in | pass | pass | pass |
| B's screen shows A's band without reload (≤ 5 s) | **1.8 s** | **3.0 s** | **3.0 s** |
| No refresh banner (A and B; text + `showGlobalConflictBar` + `rowConflicts`) | pass | pass | pass |
| Server keeps B's name | pass | pass | pass |
| Server keeps A's band (AGS factors + stored `band`) | pass | pass | pass |
| After reload, both browsers show B's name + Band 4 | pass | pass | pass |
| Writes to the role | 4 | 4 | 4 |

**Scenario 2: delete vs stale edit.** B deletes "September 2026 APMS is late"
(A's notice). A's live feed is held (Playwright aborts `/api/changes`,
`/api/company-tick`, `/api/company-live`), so A provably still has it on screen.
A clicks **Done** on it and saves. Then A's feed is released.

| Check | Runs 1–3 |
| --- | --- |
| B's delete: HTTP 200, rev 2 | pass |
| A still sees it (stale screen) | pass |
| A's save: the row is known to be deleted, nothing is sent | pass |
| Server: still deleted (rev 2) | pass |
| A's screen drops it once the feed resumes; not back after A reloads | pass |
| No refresh banner | pass |

Run it again:

```
NITRO_PRESET=node-server npm run build:app
DATABASE_URL=… node scripts/migrate.mjs && DATABASE_URL=… PORT=3010 node .output/server/index.mjs
CHROMIUM_PATH=/path/to/chromium B_USER=<second admin> B_PASS=… node scripts/e2e/rows-v2-two-browser.mjs
```

Use a fresh database: the test edits Studio Manager and deletes one notice.

## What was fixed

None of these change the ROWS-V2 design (rows + per-row rev, 409 = field merge,
tombstones stay, change feed for followers, no refresh bar). Each one is where the
implementation did not do what the design says.

### Build / boot
- `vite.config.ts` hard-coded `nitro({ preset: "vercel" })`, so every build shipped a Vercel SPA with no `.output/server`. It now uses `resolveNitroPreset()`. `scripts/nitro-preset.mjs` no longer honours `vercel` (contract lock: node-server).
- `package.json` `"sideEffects": false` let the bundler drop `import "./apms-collections.js"`, so the built server crashed on boot. `sideEffects` now lists that file.
- `company-notebook.ts` `import("./apms-collections")` resolved to the `.js` classic script (no exports) → `.ts`.
- `server/middleware/02-apms-serverfn.ts` used `handleCompanyGetRequest` without importing it (already broken on `main`).

### Data loss / silent reverts (found in the browser)
1. **Login rewrote every role and tombstoned all 59 role-krocs rows.** The client diffed roles split (book shape) against whole rows, and read the absent `roleKrocs` field as "every row deleted". The server also put `roleKrocs` back on the wire. Fix: a field the UI snapshot doesn't carry is not a delete. The roles baseline is compared in row shape. The GET overlay folds role-krocs rows into roles and drops `roleKrocs` from the wire, as `assembleSnapshot` always did.
2. **Opening Org → Roles wiped `kras` / `ags` / `competencies` from every role.** `GET /api/org?kind=roles` served the org book, where roles are stored split. The row merge then read the missing fields as deletions. Org slices are now read from the entity rows. Node GET no longer injects `rev` into the payload.
3. **Lost updates between the two users** had four client causes. Each one let a save go out at the current rev carrying a value the screen never showed:
   - the rev learned from the feed before the UI took the row;
   - merged rows acked while the UI refused them (it refuses while saving);
   - one global ack queue shared by `pullLive` / `pollChanges` / hint GETs;
   - book PATCH 409 and book pulls (served from the stale-while-revalidate wire) copying row-owned values into the baseline or the screen.

   Rows are now learned and acked only with what the UI actually took, per flow. Book paths never touch row-owned fields (except the full pull after a `*` restore).
4. **Deleted rows came back.** A stale save re-created a tombstone because the baseline had dropped the row, or because the SPA re-added it from memory with the tombstone rev learned from the feed. Rows the client has held, or learned were deleted, are never re-created.
5. **Followers stopped updating.** The SPA's `live` apply marked its own setState dirty and suppressed the save that clears it, so every later live-entity apply was refused. In the same window, real edits were never saved. The routes stamp (`scripts/stamp-p0as78-rows-v2.mjs`) now clears the flag after the apply and always schedules the save.
6. **Every load re-saved all 180 people.** The server-injected `rev` and the SPA's empty hydrate defaults were diffed as edits. The resulting 180 slow PATCHes held the save, and the live view, for many seconds. People are now compared by content.
7. 409s with nothing to merge (payload already equal to the server's) are adopted instead of rewritten, so there's no rev churn.

### Tests
- Stale tests updated to what the code deliberately does now: book PATCH can't write entity-owned fields, hint GET may start before hooks, and the workspace's branding / app migrations no longer break template tests. Hard-coded `/workspace/...` paths removed. All pre-existing typecheck errors fixed. An idle tick at the loaded `at` no longer polls the change feed.
- 11 new regression tests in `rows-v2-client.test.ts`. Ten were confirmed failing on the client without the fix; the eleventh covers the new server fold helper. Stamp assertions were added to `access-views.test.ts`.

## Follow-ups (not fixed here)

- **Security (already on `main`):** `hasSessionToken` accepts any bearer longer than 8 characters, and `apms-login.<personId>` tokens can be forged. `POST /api/issued-logins` and `/api/provision-logins` are unauthenticated and set any user's password. `sunny.b/0000` always works, and anyone without a stored password signs in with `0000`.
- **SPA noise:** the role editors still write the derived `band` from their own state (converges now, no ping-pong). Award prizes / `rewardYearSeed` are re-seeded on each page load (one 409 probe per row, no write). Opening Org auto-closes "Close … Rewards" notices. Two people share username `cm`, and the SPA swaps them.
- **Fresh-database boot race (already on `main`):** the two server module copies (Nitro middleware and SSR routes) race the first hot-table import. One can cache a wire with a handful of people, and the SPA then falls back to `p-admin` as the current user. Production already has imported hot tables. The ROWS-V2 entity import is safe: each copy awaits its own import, and the flag is written last.
- Row writes still mirror into books and bump book gens, so followers do book pulls (harmless now, but traffic).
- `src/lib/mod-army-2-fix.test.ts` (not in `npm test`) asserts the old p0as76 stamp and fails since the patch.
- Not tested: PM2 with more than one worker (no cross-worker live events), real Contabo host, restore under load.
