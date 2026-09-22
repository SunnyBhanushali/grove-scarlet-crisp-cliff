# REPORT-ROWS-V2 — every collection is a row (p0as78 / p0aw2)

22 Sep 2026 IST. Claude session, from the p0as77 tree.

## Why

Symptoms on live: "refresh" banner every few seconds, edits lost after another
user saves, deleted records coming back, slowdown with several users. Root
cause: the app was built as one JSON document loaded whole into every browser
and saved whole — last write wins across the document. The p0as77 tree had
already moved four collections (people, records, rewardRecords, targetCells)
to rows with per-row `rev`; everything else was still whole-book merge. Even
the row path retried a 409 **with the same payload at the new rev**
(`saveOneEntity`), i.e. a silent row-level overwrite of the other user's change.

## What changed

### Server

- `migrations/0008_entities.sql` — `entities (kind, id, k1, k2, payload, rev,
  updated_at, updated_by, deleted_at)` + `entity_log (seq, …)` change feed.
- `src/lib/apms-collections.js` — the one spec of every remaining snapshot
  field: shape (`list` / `map` / `map2` / `scalar`), key fields, book. Loaded
  by the server (`apms-collections.ts`) and by the browser
  (`/assets/apms-collections.js`, before `apms-sync.js`).
- `src/lib/company-entity-store.ts` — `patchEntityRow` (SQL compare-and-set:
  `where rev = $base returning`; per-key in-process queue; `clientOpId`
  replay), `changesSince` (with payloads, collapsed per row), import from
  books (once, then after every restore with `pruneMissing`), `loadEntityFields`
  for the assembler.
- `src/lib/company-entities-v2.ts` — `GET/PATCH /api/e/:kind/:k1[/:k2]`,
  `GET /api/e/:kind`, `GET /api/changes?since=&payload=1` / `?head=1`;
  hooks: mirror the row into its book (`commitEntityRowToBook`, serialized on
  the book), publish live gens + hint `e:<kind>` + soft wire invalidate.
- `company-assemble.ts` — `prepareBookPatch` restores every entity-owned field
  from `stored` (book PATCH can no longer write them); `assembleForGet`
  overlays entity rows (rows win).
- `company-notebook.ts` — `commitEntityRowToBook`; restore re-imports rows;
  **bug fix:** `invalidateCompanyWire` / `getCompanyWire` were used without
  being imported (restore and `?books=` GET would throw at runtime).
- `company-org-read.ts` — org node GET/PATCH go through the row store. The old
  path read the org book, patched a node, then `commitOrgFields` — the read was
  outside the book lock, so two admins saving different nodes lost one update.
- Routes: `src/routes/api/e.$kind*.ts`, `changes.ts`; `routeTree.gen.ts`
  updated by hand (the router plugin regenerates it at build).

### Client (`apms-sync.js`, p0as78)

- `collectEntityOps` diffs every spec field against `lastAcked` → one PATCH
  per changed/added/removed row (`/api/e/…`). Old `/api/org/*` ops removed.
- `saveOneEntity` on 409: `merge3(base = acked row, mine, theirs)` — field
  level, recursing into objects and id-arrays; only a same-field clash lets
  the local value win. Server-deleted → the delete stands and the screen is
  corrected; explicit local delete stands. A genuine create colliding with a
  tombstone id re-creates with the tombstone rev.
- `foldEntityResults` pushes merged/adopted rows back into the snapshot and
  the UI (`liveHooks.apply(…, "live-entity")`); `markEntityFieldsAcked` acks
  per field, so an entity-only save leaves no dirty book (no residual book
  PATCH).
- Followers: `pollChanges` on every tick whose `at` moved (`/api/changes`
  with payloads) → `mergeGenericRow` per row; a locally dirty row is 3-way
  merged and stays dirty. Acks are queued (`pendingAcks`) and committed only
  when the UI took the snapshot; a refused apply rewinds the cursor. Cursor
  from `/api/changes?head=1` at hydrate. `*` → full pull.
- PERF-TAB: ≤20 row GETs per tick again (was unbounded since ARMY-2); a hint
  already in flight is not queued a second time; a hint the UI could not take
  (via=init) is re-queued for the first `pullLive`.
- Degrades: without `__apmsCollections` the generic path is off and the
  p0as77 behaviour remains.

### SPA stamp

`scripts/stamp-p0as78-rows-v2.mjs` → `routes-e2g7y5q8-13m-p0as78.js`: the
three identical `live-entity` apply sites now
`K.setState(Object.assign(window.__apmsSync.pickDataFields(t), {people…}))`
so generic fields reach the Zustand store. `index-*.js` preload and both HTML
files updated; `?v=p0as78` on collections / sync / index.

## Tests

- `src/lib/company-entity-store.test.ts` (10): round-trip of every seed field;
  two users different rows both win; same row → exactly 200 + 409 carrying the
  winner; stale save cannot resurrect a delete; tombstone re-create needs its
  rev; change feed order/cursor; map2 keys; `clientOpId` replay; restore
  prunes + bumps revs.
- `src/lib/rows-v2-client.test.ts` (7): `merge3` semantics; op collection;
  **two users, same role, different fields → both edits survive** (client
  against the real store); deleted row does not come back and the stale
  screen is corrected; follower applies others' rows and merges its own dirty
  row; refused apply rewinds the cursor; served collections file == source.
- Database: PGlite when installed, else a real Postgres through
  `scripts/mini-pg.mjs` (`PGTEST=1`, port 5433), else the suite skips.
- All previously runnable suites still pass (`apms-sync`, `company-books`,
  `three-team-concurrency`, `company-perf-tab`, `g9-two-client`,
  `access-views` — stamp assertion moved to p0as78). Suites that import
  `@electric-sql/pglite` could not run in this sandbox (no npm registry).

## Not done here

- `vite build` / `npm run build:app` not run (no npm). `routeTree.gen.ts` was
  edited by hand; the build regenerates it.
- No browser run. Two-browser Playwright smoke should be the first thing on
  staging: A edits role band, B edits role name, both save → both persist, no
  banner, B sees A's change within a tick.
- Cross-PM2-worker live events (Postgres LISTEN) — single worker today.
- Passwords in the company wire (`people[].password`, `logins`) — separate fix.

## HANDOFF

- Stamp / host: tree **p0as78** (sync + routes) + server **p0aw2**; live still
  p0as39 / p0as14.
- Cut to staging 3010 with `aliens_apms_test`; watch for
  `[entities] imported from books` once; run the two-browser smoke; then live.
- Kill switch: `APMS_ENTITY_ROWS=off` (server returns 503 on `/api/e/*`, GET
  assemble uses books; the client then sends generic rows nowhere — so only
  use it together with the p0as77 sync stamp).
