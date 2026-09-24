# PERF-FINDINGS — why APMS slows down with more users (Phase 1, measure only)

Branch `perf` (from `batch-2`, server p0aw4 / SPA p0as81), **no product changes**.
Built exactly as the deploy bot does (`NITRO_PRESET=node-server npm run build:app`)
and run as one Node process (`.output/server/index.mjs`), like PM2 on live.

## 1. How it was measured

**Machine used.** 4 vCPU / 15 GB sandbox. The server process was pinned to **one
core** (`taskset -c 0`), Postgres 16 to one core (`-c 1`), the load runner and the
real browsers to the other two. Node runs JavaScript on one thread, so "server
CPU %" below is **% of one core** (the same number `pm2 monit` / `top` show on
live, where 100 % = that one core is full). Live's Contabo VPS has at least as
many cores; one Node process can only ever use one of them for JavaScript, so
these numbers carry over.

**Data.** Production-sized fixture (`scripts/load/scale-fixture.mjs`): the seed's
180 people, 240 APMS month records (~14 KB each), 180 reward records, 416 target
cells, 900 target-history rows, 450 notices, the rest of the seed's catalogs.
Company wire **7.3 MB** JSON (live measured ~5.8 MB), 350 KB gzipped. Fresh
database per run (`scripts/load/fresh-load-server.sh`).

**What a tab does** — captured from a real Chromium tab on p0as81 (sign-in,
idle 30 s, each module, then another user saving every 5 s):

| When | Requests |
|---|---|
| page open | `GET /`, 12 stamped assets (first visit), `GET /api/auth/get-session`, `GET /api/company` (gzip), `GET /api/changes?since=<wire feedSeq>&payload=1&limit=500`, `EventSource /api/company-live` |
| always | `GET /api/company-tick` every 2.5 s (SPA timer) **and** `GET /api/company-tick?since=…` every 2.5 s (sync timer) |
| on a list screen | the 400 ms screen-read loop re-reads the open list every **2 s**: People `GET /api/people?limit=80` (117 KB), Rewards month `GET /api/reward-records/:p?limit=80` (**853 KB**), APMS month `GET /api/month-records/:p?limit=80` (**1.14 MB**), APMS person `GET /api/month-records/:p/:id` (14 KB) |
| after **any** save by anyone | every open tab polls `GET /api/changes?since=…&payload=1` — **3 times** per save (the SSE frame, then the LISTEN re-tick, then the book-mirror tick each move `at`) |

**Load runner** (`scripts/load/`): `run.mjs` (coordinator) + `vu-worker.mjs`
(simulated users over HTTP, a 6-connection keep-alive pool each, exactly the
sequence above) + 3 real headless Chromium tabs timing page opens
(reload → app shell and company data loaded). Screen mix: Home 25 %, People
15 %, Rewards month 15 %, APMS month 10 %, APMS person 15 %, Org 10 %, person
file 10 %, a new screen every 20–60 s. Saves every 20–40 s per user: APMS
month record 35 %, reward record 25 %, person 15 %, a generic row 25 %; **20 %
of saves on six rows everyone shares** (409 → take the server row, re-apply my
field, retry — as `merge3`). 5 % of save slots are a delete probe (create a
row, delete it, then a stale edit and a stale re-create — both must be 409).
Page re-open every 4–8 min. Checks: every acknowledged save is in Postgres at
the end (**lost saves**), every deleted row still deleted (**resurrected**),
read-after-write (the row GET right after the 200; a sample also re-reads the
company wire and replays the feed from its `feedSeq`, as a reload does), and
the time until other users' feeds show the save (**others see**).
`--profile` runs the server under `node --cpu-prof`; Postgres statement stats
from `pg_stat_statements` for the steady window. Every run: `docs/perf/runs/<label>-u<N>/`
(`summary.md`, `summary.json`, per-second server samples, profile summary).

## 2. Baseline (p0as81 as it is) — 180 s steady window per level

| users | page open p50 / p95 (browser) | company load p95 | tick p50 / p95 | save p50 / p95 | others see a save p95 / max | server CPU p50 (1 core) | event-loop lag max | errors |
|---|---|---|---|---|---|---|---|---|
| 1 | 2.36 s / 2.74 s | 0.05 s | 3 ms / 72 ms | 21 ms / 109 ms | — | 2 % (peaks 64 %) | 0.32 s | 0 |
| 10 | 3.03 s / 4.45 s | 0.07 s | 3 ms / 165 ms | 34 ms / 217 ms | 0.24 s / 0.44 s | 15 % (p95 86 %) | 0.36 s | 0 |
| 50 | 5.07 s / 7.52 s | 0.88 s | 438 ms / 1.02 s | 1.45 s / 3.47 s | 0.68 s / 11.6 s | **96 %** | 0.61 s | 3 |
| 100 | 4.46 s / 6.39 s | 2.57 s | 0.80 s / 2.44 s | 5.3 s / 10.3 s | 0 / 31 s (p99 3.2 s) | **98 %** | 0.56 s | 19 |
| 250 | 18.1 s / 25.8 s | **39.9 s** | **7.6 s / 61 s** | **23.7 s / 61.5 s** | 30 s / 130 s | **99 %** | 1.71 s | 239 (timeouts) |

- **Lost saves 0, resurrected deletes 0 at every level** — the data-safety rules
  hold even when the server is drowning; everything is just late. (At 250 a few
  delete probes timed out mid-sequence: counted as errors, nothing came back.)
- Postgres is **not** the bottleneck: 25–64 % of its core, ≤ 13 connections.
- The live measurements (10 users: CPU 89.5 %, tick avg 6.2 s) match this curve:
  the process is saturated from ~40 users here; live saturates earlier because
  its tabs also run for hours (more re-opens, more saves per tab) and the SPA
  work competes on the same box.
- **Read-after-write.** The row GET right after a 200 always had the change.
  The **company wire did not**: 1 of 6 (10 users), 11 of 37 (50), 3 of 13 (250)
  immediate `GET /api/company` after a save returned the pre-save company. The
  feed replay from the wire's `feedSeq` covered it every time, but any path that
  trusts the wire alone (`?books=` book pulls, restore pulls, the `unchanged`
  answer to an `If-None-Match`, a second tab) shows "my change is gone". Cause:
  generic-row commits only *soft*-invalidate the wire (stale-while-revalidate,
  rebuild seconds later under load), and a hot-row patch-in-place during a
  rebuild **discards the rebuild** (`seq !== wireSeq`) and marks the wire clean —
  the generic write is then missing until the next invalidation.

## 3. Where the CPU goes (ranked)

CPU profile of the server at **50 users** (203 s busy of 229 s, 89 % of one
core) and **250 users** (261 s busy); Postgres statement stats for the same
windows (50 users, 180 s: `select … from company_books` 677 calls, 79 s of
database time; `insert into company_notebook` 615 calls; APMS / Rewards month
list selects 1 006 calls).

| # | Cause | CPU share (50 u) | CPU share (250 u) | Evidence |
|---|---|---|---|---|
| 1 | **Whole-book re-reads.** Every book mirror (after every save, 3 full reads each), every wire rebuild, every sign-in and every page open's `get-session` (`readCompany` → `loadCompanySnapshot`) and the sign-in page's `companyIsEmpty` read all four books (~6 MB text) from Postgres and `JSON.parse` them | **~30 %** (pg text `slice`/`string` 13 %, `parseSnapshot` 12.5 %, `rowsToBooks`, `loadCompanySnapshot` 2.6 %) | **~34 %** (sign-in / get-session alone: `readCompany` 5 %, `loadCompanySnapshot` 6.8 %, `parseSnapshot` 7.4 % in the middleware copy) | `company_books` read 677× in 180 s (3.8/s, 117 ms each) |
| 2 | **Garbage collection** of those multi-MB strings and objects | 22.7 % | 24.5 % | follows #1, #3, #4 |
| 3 | **Company wire re-encode.** Every hot-row save re-stringifies + gzips the whole company 30 ms later (even if nobody reads it); every generic-row save rebuilds it from every book + row (36 full rebuilds in 180 s) | 12.8 % (`encodeCompanyWire`, zlib 4 %) | 9–10 % | `select … from month_records` (all periods) 36×, entities full read 54× |
| 4 | **Book mirror writes.** Each save rewrites its whole book (sorted-stringify hash of MBs twice) **and** the legacy combined `company_notebook` row (~6 MB) | 10.4 % (`persistBooks`: `bookHash`/`stableStringify`/`sortValue` 4.9 %, `writeCombined` 3.1 %) | ~2 % (starved by #1) | `insert into company_notebook` 615× (58 ms avg), `company_books` write 194× |
| 5 | **List screens every 2 s.** 0.1–1.1 MB JSON per read, from every jsonb row of the month, serialized per request (`Response.json`), never cached, not compressed | ~10 % (pg `parseRow` 6 %, JSON 3 %, handler 3.7 %) | ~10 % (`serializeJavascriptValueToJSONString` 3.8 %, `parseRow` 6.1 %) | 2.6 + 2.4 MB/s of JSON at 50 users; month-list selects 79 ms / 42 ms avg |
| 6 | **Feed fan-out.** Each save → every tab polls `/api/changes` 3× (SSE + LISTEN re-tick + mirror tick); each poll runs the payload join and serializes it per request | ~5 % | ~5 % (5 767 feed queries in the window) | 106 feed polls per user per minute at 50 users (1.8/s per tab) |
| 7 | Ticks: two per tab every 2.5 s, each a tick-row read; every open SSE stream reads the tick row every 2 s; sessions re-read every 2 s per token (batch 3 lowers the cache to 2 s) | ~2 % | ~3 % | tick row read 49 368× and session lookup 18 929× in 180 s at 250 users |

Not a cause: Postgres (≤ 64 % of one core, ≤ 13 connections), memory (flat,
0.4–1.8 GB RSS here), the static assets (already `max-age=31536000, immutable`).
The 250-user latencies also include queueing: once the event loop is full,
every request (ticks included) waits behind the whole-company work above.

**In one sentence:** almost all of the CPU goes into re-reading, re-writing and
re-encoding the *whole company* (6–7 MB) on every save and every sign-in, and
re-sending whole month lists every 2 s — work that grows with users × saves,
while the real per-save change is one 1–15 KB row.

## 4. What Phase 2 changes (designed from the evidence; built on `perf-2` from `batch-3`)

1. **In-memory wire patched on commit** (fixes #3 and read-after-write): hot rows
   patched in place, generic rows re-read for that kind only, both **before the
   save returns**; encode lazily once per version when a GET needs it; full
   assemble only for hard changes (restore / book PATCH) — reads wait for those;
   commits during an assemble are journaled and re-applied; `feedSeq` advances
   only when no write is in flight.
2. **Books read only when they changed** (fixes #1 for every remaining book
   reader): cache each book's text by `content_hash`; sign-in / get-session /
   `companyIsEmpty` read the people and logins rows instead of the books.
3. **Book mirror group-committed** (fixes #4): 1.5 s gather window per book, one
   book write, stored hash reused, no combined-notebook rewrite per mirror
   (≤ once / 10 min). Backups read the rows (authority), so a mirror a moment
   behind cannot make a backup miss a save.
4. **List reads cached per table / month generation** (fixes #5): serialized +
   gzipped once, ETag / 304; the client re-reads an open list every 20 s (the
   change feed already brings every row change) and sends `If-None-Match`.
5. **Feed fan-out** (fixes #6): tick / SSE carry the feed head `seq`; a tab polls
   only if the feed is past its cursor (one poll per save, not three); the
   server answers identical polls from one cached page.
6. **Ticks / sessions** (fixes #7): tick answered from memory (one tick-row read
   per second for the whole process); one real tick per 5 s per visible tab
   (30 s hidden), shared by the SPA and sync timers — the live stream stays the
   < 1 s path; session cache 30 s with revocation pushed to every process by
   `pg_notify('apms_sessions')`; scrypt password checks off the event loop.
7. Multiple workers only if the profile after 1–6 says one process cannot hold
   250 users (see REPORT-PERF.md).

## 5. Batch-3 interlock

Phase 2 waits for `batch-3` + `REPORT-BATCH-3.md`. At the time of this report
`origin/batch-3` (1c96ee2) carries server-side permissions (per-viewer wire,
feed / list / hint filtering), scrypt passwords, lock-out and a 2 s session
cache — no `REPORT-BATCH-3.md` yet. The Phase 2 design above keeps every batch-3
rule: per-viewer wires stay keyed on the wire version; cached list reads are
keyed on the viewer's scope (and the org context version for filtered viewers);
cached feed pages are filtered per viewer; revoking sessions clears every
process's cache.
