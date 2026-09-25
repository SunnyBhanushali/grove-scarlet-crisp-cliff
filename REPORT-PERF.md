# REPORT-PERF — APMS fast for 250 people at once (p0as83)

Branch **`perf-2`** (from `batch-3`, p0as82), server **p0aw5**, browser sync
stamp **p0as83** (`apms-sync.js?v=p0as83`; routes / collections / login-view
unchanged from p0as82). Not merged to `main`. Pack **`aliens-apms-p0as83.zip`**
(source, like p0as81: the deploy bot runs
`npm install --include=dev && NITRO_PRESET=node-server npm run build:app`).
Phase 1 (measure only) is on branch `perf` with `PERF-FINDINGS.md`.

## For Sunny, in plain English

- **Why it was slow.** Every time anyone saved anything, the server re-read,
  re-wrote and re-packed the *whole company* (about 6–7 MB) — several times —
  and every open screen asked the server again, every 2 seconds, for whole
  month lists (up to 1 MB each). That work grows with *people × saves*, so 10
  people already filled the server's one processor; 250 would have taken
  minutes per click.
- **What changed.** A save now changes just its own row in memory and tells
  everyone the change directly over the live connection each screen already
  has open. Screens stop re-downloading lists that did not change. Signing in
  no longer reads the whole company. The rules that keep data safe (nobody
  overwrites anyone, deleted stays deleted, secrets never sent, each person
  sees only what their role allows) are untouched and re-tested.
- **Result on a server the size of one live processor core:** at 250 people
  working at once the server uses **about 40 % of that core** (it was full,
  96–99 %, from about 50 people), a save takes **0.014 s typically / 0.28 s
  for the slowest 5 %** (was 28 s / 61 s), a screen's live check 0.17 s at
  worst (was 73 s), and **others see a save in 0.05 s typically, under 1 s
  for 99.6 % of saves** (was 28 s for the slowest 5 %). No save was lost and
  no deleted record came back in any run, before or after.
- **"My data was lost".** Found and fixed: right after a save, reading the
  company could still return the old copy (up to 1 in 3 checks at 50 users in
  the first measurement). After the fix, every answered read right after a
  save includes it.
- **What you will notice.** Saves are instant, other people's changes appear
  within a second, pages open faster (staff 2–2.7 s instead of 3.5–4 s on a
  quiet server; under load the server no longer adds to it). An admin's first
  page load (3–4 s) is still the slowest part — that is the browser unpacking
  the whole company on the laptop, not the server (§1). The "page open under
  2 s" target is **not met** for that reason; everything else is.
- **Server size.** The current VPS is enough: one Node process handles 250
  users at ~40 % of one core. Nothing to buy. Recommended nginx settings are in
  `docs/perf/NGINX-AND-SERVER.md` (HTTP/2 and compression matter most).

## 1. Targets at 250 users — met or not

Measured on a 4 vCPU sandbox with the server pinned to **one core** (`taskset -c 0`),
Postgres to one core, the load runner and three real headless Chromium tabs on
the other two. "CPU" is % of that one core — what `pm2 monit` shows on live,
where one Node process can only ever use one core for JavaScript. 180 s steady
window after a 10 s ramp; production-sized data (180 people, 7.3 MB company);
fresh database per run. Final build `d3617af` (server p0aw5 / sync p0as83).

| Target (250 users) | Result | |
|---|---|---|
| page open p95 < 2 s | employee 4.45 s, editor 15.8 s (real browser, sandbox) — **server part 0.32 s** | **not met in the browser** — see note |
| company load p95 < 1.5 s | **0.16 s** | met |
| tick p95 < 300 ms | **166 ms** | met |
| save p95 < 500 ms | **280 ms** (p50 14 ms) | met |
| others see a save < 1 s | p95 **292 ms**, **99.6 %** under 1 s (p99 0.78 s) | met (0.4 % slower; max 32 s, one outlier) |
| CPU < 70 % sustained (one core) | p50 **39 %**, p95 **65 %** (max 80 % for a second) | met |
| no errors | **0** | met |
| zero lost saves | **0** of 1 847 acknowledged | met |
| zero resurrected deletes | **0** | met |
| read-after-write always consistent | row **1 847 / 1 847**, company wire **70 / 70**, wire + feed replay 70 / 70 | met |

**Page open — what the number is.** It is a real Chromium tab reloading the app
(app shell + company data on screen). The server's share of that
(`GET /`, session, company, feed head, live stream) is **p95 0.32 s at 250
users**; the rest is the browser parsing and hydrating the company — an
employee's filtered company (~200 KB) or an editor's whole company (7 MB) —
on a CPU core the sandbox shares with the 250 simulated users. With 1 user
(no contention) the same tab opens in **2.0 s / 2.7 s** (employee p50 / p95)
and **3.3 s / 3.7 s** (editor); before this batch it was 3.5 s / 4.0 s and
3.2 s / 4.1 s. On a staff laptop that is not also running 250 simulated users
the 250-user page open should be close to the 1-user number: the server's share stays ≤ 0.5 s.
Getting an editor's first open under 2 s is client-side work (the sync's
sorted-stringify dirty baseline is ~26 % of it) that touches the data-safety
code — not done in this batch, listed in §8.

**Server size.** One Node process on one core carries 250 users at ~40 %
(p95 65 %). The current Contabo VPS is enough; nothing to buy. No worker
processes were added (not needed; §6).

## 2. Before / after at 1, 10, 50, 100, 250 users

Same runner, same fixture, same machine and pinning for both columns.
`before` = p0as81 (branch `batch-2`, what live runs), `after` = p0as83
(branch `perf-2`, built on batch-3). Every run: `docs/perf/runs/<label>-u<N>/`
(`summary.md` has every route, Postgres top statements, per-second samples;
`cpuprof/` at 50 and 250).

| users | build | page open employee p50 / p95 | page open editor p50 / p95 | server part of page open p95 | company load p95 | tick p50 / p95 | save p50 / p95 | others see a save p95 | server CPU p50 / p95 (1 core) | event-loop lag max | errors | saves acked | lost | resurrected | wire read-after-write |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | p0as81 | 3.46 s / 3.97 s | 3.19 s / 4.09 s | 300 ms | 50 ms | 3 ms / 17 ms | 59 ms / 302 ms | — | 2.9 % / 32.6 % | 388 ms | 0 | 6 | 0 | 0 | — |
| 1 | p0as83 | 2.04 s / 2.67 s | 3.25 s / 3.66 s | 80 ms | 39 ms | 3 ms / 126 ms | 16 ms / 28 ms | — | 1.6 % / 17.6 % | 184 ms | 0 | 7 | 0 | 0 | 1/1 |
| 10 | p0as81 | 3.87 s / 6.25 s | 3.96 s / 6.40 s | 287 ms | 41 ms | 4 ms / 200 ms | 32 ms / 408 ms | 164 ms (100.0 % < 1 s) | 14.5 % / 79.7 % | 373 ms | 0 | 63 | 0 | 0 | 4/4 |
| 10 | p0as83 | 2.30 s / 2.57 s | 3.26 s / 3.44 s | 145 ms | 44 ms | 2 ms / 11 ms | 13 ms / 51 ms | 190 ms (100.0 % < 1 s) | 3 % / 21.2 % | 191 ms | 0 | 65 | 0 | 0 | 7/7 |
| 50 | p0as81 | 6.04 s / 7.84 s | 7.47 s / 7.58 s | 10.80 s | 2.50 s | 353 ms / 1.47 s | 1.00 s / 2.64 s | 1.12 s (94.6 % < 1 s) | 95.8 % / 99.1 % | 576 ms | 3 | 298 | 0 | 0 | 24/25 |
| 50 | p0as83 | 2.30 s / 2.76 s | 3.35 s / 3.67 s | 139 ms | 48 ms | 2 ms / 28 ms | 11 ms / 66 ms | 260 ms (100.0 % < 1 s) | 11.8 % / 32 % | 148 ms | 0 | 320 | 0 | 0 | 44/44 |
| 100 | p0as81 | 4.75 s / 6.83 s | 4.04 s / 8.05 s | 11.82 s | 2.18 s | 772 ms / 2.60 s | 3.50 s / 10.31 s | 1.36 s (92.3 % < 1 s) | 98.3 % / 99.6 % | 473 ms | 13 | 531 | 0 | 0 | 13/14 |
| 100 | p0as83 | 2.23 s / 3.74 s | 3.52 s / 6.12 s | 266 ms | 151 ms | 1 ms / 50 ms | 10 ms / 95 ms | 126 ms (100.0 % < 1 s) | 17.8 % / 39.9 % | 164 ms | 0 | 662 | 0 | 0 | 18/19 |
| 250 | p0as81 | 11.62 s / 25.57 s | 16.07 s / 25.97 s | 93.46 s | 33.47 s | 17.53 s / 72.96 s | 28.43 s / 60.94 s | 28.17 s (50.0 % < 1 s) | 98.9 % / 99.8 % | 1562 ms | 161 | 233 | 0 | 0 | 8/8 |
| 250 | p0as83 | 2.77 s / 4.45 s | 7.32 s / 15.80 s | 319 ms | 156 ms | 7 ms / 166 ms | 14 ms / 280 ms | 292 ms (99.6 % < 1 s) | 39.3 % / 64.9 % | 215 ms | 0 | 1847 | 0 | 0 | 70/70 |

- *page open* = real browser reload (3 tabs, see §1 note); *server part* =
  the requests of a page open measured by the simulated users.
- *wire read-after-write* = a reload right after an acknowledged save (company
  GET) carrying that save. After: at 100 users 18 / 18 answered reads had it;
  one read got no reply (connection closed, status 0 — counted in the 19).
  Before: an immediate company read returned the pre-save company ("my data
  was lost") 1 of 25 times at 50 users and 1 of 14 at 100 in these runs, 11 of
  37 at 50 users in the Phase 1 measurement (`PERF-FINDINGS.md` §2) — it
  depends on a wire rebuild being under way.
- *before* at 250 users: the server is saturated (CPU 99–100 %), 161 requests
  timed out (errors), and the simulated users got through ~1/8 of the saves of
  the after run in the same 180 s (233 vs 1 847 acknowledged); its latency
  percentiles are of the requests that did finish. Its tables were pre-filled
  from the fixture before boot (`PREFILL_HOT=1`, the state live is in): on a
  fresh database p0as81's one-time import sometimes left the month rows out (§8).
- **lost saves 0 and resurrected deletes 0 in every run, before and after.**
  The data-safety rules held even when p0as81 was drowning; it was just late.

## 3. How it was measured

Load runner in `scripts/load/` (Phase 1, `PERF-FINDINGS.md` §1): `run.mjs`
(coordinator: fresh DB + fixture, built server with the event-loop monitor,
CPU pinning, `--cpu-prof`, `pg_stat_statements`, per-second CPU / RSS / lag
samples) and `vu-worker.mjs` (simulated users over HTTP doing what a tab does,
per client version: p0as81 polls / re-reads as it does today; p0as83 takes the
pushed feed). 180 people sign in; 50 are editors (whole company, save anyone's
rows, send the SPA's org-book PATCH after a people / org edit), the rest
employees (own filtered company, save their own month / reward notes). Screen
mix, save mix (20 % on six shared rows → 409 → merge → retry), delete probes
(stale edit and stale re-create must both 409), page re-opens, and the checks
(lost saves, resurrected deletes, read-after-write, others see) as in
`PERF-FINDINGS.md` §1. Run: `LABEL=after sh scripts/load/sweep.sh`.

## 4. What changed (and why — each item is a row of PERF-FINDINGS §3)

### Server (p0aw5)

| # | Change | Files | Removes |
|---|---|---|---|
| 1 | **Company wire kept in memory and patched on every commit, before the save returns.** Hot rows (people / APMS / Rewards / target cells) patched in place; a generic row re-reads only its kind (and the kinds folded with it: roles + KROCs, the targets graph) with the same `fromRows` + fold / prune / sibling-order / secret-strip the full assemble uses, in commit order. Bodies encoded lazily, once per version, only when a GET needs them. A full assemble only for a hard change (restore, book-wide PATCH, admin wipe) — reads wait for it — and a 10-min background refresh; commits during it are journaled and re-applied. `feedSeq` moves only when no row write sits between its commit and its wire patch. State on `globalThis` (both server module copies share one wire). | `company-wire-cache.ts`, `company-entities-v2.ts` (`applyEntityCommitToWire`), `company-entity-store.ts` (`loadEntityFieldsForKinds`, write registration), `company-entities.ts`, `company-wire-http.ts` | #3 wire rebuild / re-encode per save; the stale wire after a save (read-after-write) |
| 2 | **Change feed pushed down the live stream.** When the feed head moves, its rows are read once (coalesced ~40 ms), filtered per viewer with batch-3's `filterChange` (one shared frame for viewers who see everything), and written to every open stream as `{…tick, push:1, since, seq, changes}`. Ticks / frames carry the feed head `seq`. Polls of the same cursor share one cached page (1 s, invalidated when the head moves). Tick frames on a stream coalesced to one per 150 ms. An ended session is told on its stream (`sessionEnded`) within ~2 s and the stream closes. | `company-live-http.ts`, `company-live.ts` (`noteFeedSeq`, `onFeedSeq`), `company-entities-v2.ts` (`feedPage`) | #6 feed fan-out (every tab polling after every save, up to 3×) |
| 3 | **Books read only when they changed; mirrors group-committed.** Each book's text is cached with its `content_hash`; a reader fetches the text only for books whose hash moved. Row → book mirrors wait 5 s and become one book write (hash of the written text; no re-read of all books; the ~6 MB legacy combined row rewritten at most every 10 min). **Every book reader flushes the pending mirrors of the books it reads first**, so no reader ever sees a book behind the rows. Backups read the rows (books + hot rows + entity rows, secrets kept). `/api/org` reads parse the org book only. | `company-notebook.ts`, `company-backups.ts` | #1 whole-book re-reads, #4 book mirror writes |
| 4 | **Screen reads cached.** People list, Rewards month and APMS month lists: body serialized + gzipped once per (table [+ month] generation, viewer scope), `ETag` / `If-None-Match` → 304. Generations bumped by the write path (after the commit), imports / restore, and LISTEN notifications; 10 s TTL as a net. | `company-read-cache.ts` (new), `company-screen-read.ts`, `company-hot-tables.ts` | #5 list re-reads |
| 5 | **Sign-in and page open no longer assemble the company.** Sign-in / `get-session` read the people and logins rows (book path kept as the fallback for an empty database); `companyIsEmpty` counts people rows; scrypt password checks run on the libuv pool (`verifyPasswordAsync`). | `server/middleware/01-apms-auth.ts`, `apms-password.ts`, `apms-credentials.ts`, `company-notebook.ts` | #1 (sign-in / get-session / sign-in page) |
| 6 | **Ticks and sessions from memory.** The tick-row read (other workers' ticks) is shared: one database read per second per process for all ticks and streams. Session cache 30 s, with revocation pushed to every process by `pg_notify('apms_sessions')` (sign-out, password change / reset clear it at once; without LISTEN the 2 s window stays); concurrent lookups of one token share one query. | `company-live.ts`, `apms-sessions.ts` | #7 |
| 7 | **Book generations move only when a book changes.** A row commit publishes (live tick, wire) the book generations unchanged — the row is on the feed and its mirror keeps the stored generation — so live = wire = stored. (Bumping them left tabs one generation ahead of any book they could pull: they re-read the whole org / targets book on every live pull.) A book reader's flush no longer waits another 5 s gather for rows that arrive while it waits. | `company-live.ts` (`rowWriteGens`), `company-entities-v2.ts`, `company-wire-cache.ts`, `company-notebook.ts` | whole-book re-reads per save per tab; a 5 s stall on imports (new target cells) |
| 8 | **A book PATCH that changes nothing writes nothing.** The SPA sends its whole org book after a people / org edit whose rows are already committed; when every applied book and the tombstones come out exactly as stored, it is acked as applied at the stored generation: no write, no new generation (which 409'd every other editor's next PATCH), no dual-write, no wire reassemble. | `company-books.ts` (`bookPatchIsNoop`), `company-notebook.ts` | full reassemble per editor people / org edit (server CPU p50 40 % → 89 % at 250 users without it) |

### Browser sync (apms-sync.js p0as83; SPA bundle unchanged)

| Change | Why |
|---|---|
| A feed page pushed on the live stream is applied exactly like a poll answer (`applyFeedBody`, same merge / ack / refuse rules); a page that starts past the cursor, or a push the stream announced but did not deliver within 1.5 s, falls back to the poll. | one request per save per tab → none |
| A tick / frame whose `seq` is not past the cursor does not poll; an in-flight poll is not repeated for a seq it was already sent for. | 3 polls per save → 0–1 |
| One real `/api/company-tick` per 5 s while visible, per 30 s while hidden, shared by the SPA's timer (answered from the last tick in `wrapFetch`) and the sync's; back to visible → immediate tick. | 0.8 tick/s per tab → 0.2 (0.03 hidden) |
| Open list screens re-read every 20 s (was 2 s) with `If-None-Match` (304 → nothing applied); an ETag is used for at most 60 s. | the feed already brings every row change within a second |
| While the feed is pushed, a live hint does not `GET` the row it names (the row is in the feed). Without pushes the G9 hint path is unchanged. | one GET per new row per tab |
| A refused feed page (the screen's own save in flight) is replayed after 0.8 s / 1.6 s / 3 s (was: next tick). | ticks are 5 s apart now |
| `sessionEnded` on the stream → the batch-3 "session ended" check (get-session → sign-in page). | tabs still leave within ~2 s |
| Test hook `setFeedHoldForTests` (e2e "stale screen" checks hold pushed pages too). | harness |

## 5. Data safety — what still holds, and how it was checked

| Rule | How it holds | Checked by |
|---|---|---|
| ROWS-V2 CAS (`baseRev`, 409 = merge, never retry-as-is) | Write paths unchanged (same `casWrite` / `writeRow where rev = base`); the wire / feed / caches are read-side only | unit (`company-entity-store`, `rows-v2-client`), load runs: every 409 re-applied on the server row, **0 lost saves** in every run |
| Tombstones / deletes stay deleted | Unchanged server rules; pushed pages carry `deleted` rows exactly as polls do | load delete probes (stale edit → 409, stale re-create → 409, still deleted at the end), batch 1–3 check 4 |
| `merge3` / dirty rows | Pushed pages go through the same `applyFeedBody` → `mergeHotRow` / `mergeGenericRow`; a refused apply rewinds the cursor | batch 1–3 checks 1–5, `perf-p0as83-client.test.ts` |
| Read-after-write | The wire is patched before the save returns; list caches are bumped after the commit; feed pages are cached only while the head has not moved | load runs: every answered read right after a save had it (row, wire, wire + replay), every level; `perf-p0aw5.test.ts` |
| NO-SECRETS-WIRE | Wire patches use `slimPersonForWire`; generic fields finished with `slimForWire`; pushed pages are the feed rows (payload redaction unchanged); login reads stay server-side | security batch 2 / batch 3 suites |
| Batch-3 permissions | Per-viewer wire keyed on the wire version; pushed pages filtered per viewer with `filterChange`; list caches keyed on the viewer scope (and the org-context version for filtered viewers); hints filtered as before | security batch 3 (176 checks), batch 3 four-browser suite |
| Sessions end on reset / change | Revocation clears every process's cache (NOTIFY) and the stream tells the tab | security batch 3 (S), batch 3 `session-ended` |

## 6. Workers, nginx, server

- **Workers: not needed, not added.** One process at ~40 % of one core for 250
  users leaves headroom for ~2× that. Running several Node processes (PM2
  cluster) is **not recommended**: the in-memory wire, the pushed feed and the
  screen-read cache are per process. LISTEN / NOTIFY keeps other processes'
  copies coherent (entity commits, session revocation), but the multi-process
  set-up was not load-tested. If it is ever needed: sticky sessions for
  `/api/company-live`, and a cross-process check of the push fan-out first.
- **nginx / server settings:** `docs/perf/NGINX-AND-SERVER.md` — HTTP/2 (a
  browser keeps at most 6 HTTP/1.1 connections per host and each tab holds one
  for its live stream), gzip for the bundles and JSON, **no buffering on
  `/api/company-live`** (the feed is pushed on it now; a buffered stream makes
  others' saves arrive late), upstream keep-alive below Node's 5 s, stamped
  `/assets/` served from disk with `immutable`. `--max-old-space-size=2048`
  (RSS ≈ 0.8–0.9 GB at 250 users). Postgres defaults are fine (≤ 28 % of a
  core, ≤ 14 connections at 250 users).
- If live has fewer or slower cores than the sandbox's, the one-core CPU number
  still applies (Node uses one core for JavaScript); Postgres wants a second.

## 7. Gate (final build `d3617af`, fresh database per suite, built node-server)

| Suite | Result | Report |
|---|---|---|
| security batch 3 (server-side permissions, hashed passwords, lock-out, sessions) | **176 / 176** | `docs/e2e/perf-2-gate5/security-batch3.log` |
| security batch 2 | **43 / 43** | `docs/e2e/perf-2-gate5/security-batch2.log` |
| batch 1 (three browsers, APMS / Rewards / Targets × six checks) | **pass** | `docs/e2e/perf-2-gate5/batch1.log` |
| batch 2 (three browsers, Org / People / Me / Home / Settings) | **pass** | `docs/e2e/perf-2-gate5/batch2.log` |
| batch 3 (four browsers incl. employee D, restricted editor, targets links) | **pass** | `docs/e2e/perf-2-gate5/batch3.log` |
| `npm test` | 196 + 463 pass, 0 fail | — |
| `npm run typecheck` | clean | — |

Test changes made in this batch (none loosens a check):
- `setFeedHoldForTests` — the e2e "stale screen" holds also hold pages pushed
  on the live stream (they only held polls before).
- batch 3 `employee-d` check 4 — the leak test is exact (the other person's own
  object carries a salary, or the new salary value appears anywhere). The old
  ±3000-character window around their id matched D's *own* salary whenever D's
  filtered org book was in the reply; checked both ways against a real reply.
- security batch 3 check H — saves a manual backup when the list is empty (the
  hourly backup only runs 09:00–03:59 IST; a run at 04:55 IST had none to
  download). Same leak test on the download.
- Two `company-live-visibility` assertions that a row commit *bumps* the book
  generation now assert it does *not* (intentional, §4 row 7).

Earlier gate on `2899452` (before the no-op PATCH): all pass as well
(`docs/e2e/perf-2-gate4/`). Problems the gates found and fixed on the way:
a refused pushed page waited for a 5 s tick (now retried 0.8 / 1.6 / 3 s); a
drag re-rendered under the pointer (applies wait for the drop); an org-chart
un-nest read a book 5 s behind its rows (readers flush pending mirrors); a
settings save 409'd against its own flush (mirrors keep the generation); a
held-back Targets delete leaked through a book pull and an import stalled 5 s
(generations / flush, §4 row 7).

## 8. Notes, deviations, open

- **Deviations from the contract, each chosen to never lose data:**
  (a) while the feed is pushed, a live hint no longer `GET`s the row it names
  (the row is in the pushed page; without pushes the G9 path is unchanged);
  (b) the SPA's own tick timer is answered from the sync's last tick
  (one real tick per 5 s per tab); (c) a book mirror and a row commit keep the
  book generation (only a book change moves it); (d) open lists re-read every
  20 s instead of 2 s (the feed brings every change within a second);
  (e) a book PATCH that changes nothing is acked at the stored generation
  without a write.
- **p0as81 fresh-database import (found by the runner, not fixed there):**
  p0as81 bulk-imports its hot tables once, on the first read after boot. On a
  fresh database whose company is only in the legacy combined row, that import
  left the APMS / Rewards month rows out in about half of the fresh starts
  — the split months book holds none — and the months read as empty. Only a
  brand-new database is exposed (live's tables are filled); the `before` runs
  that hit it were re-run (250 users with `PREFILL_HOT=1`). batch-3 / p0as83
  imported correctly in every run.
- **Open (next steps, not done):** editor first page open in the browser
  (client-side, data-safety code); nginx settings not verified on live; a
  live 10-user check after the cut (tick p95, CPU).
- Every browser signs in once after the cut (batch 2 / 3 note); the SPA picks
  up `apms-sync.js?v=p0as83` from the HTML, no hard refresh needed.
