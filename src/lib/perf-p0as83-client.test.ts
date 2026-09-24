/**
 * PERF — browser sync stamp p0as83 (apms-sync.js):
 *   - a feed page pushed on the live stream is applied like a poll answer,
 *     with no request; a page that starts past the cursor (a gap) polls;
 *   - a tick whose `seq` is not past the cursor does not poll;
 *   - a push-stream tick waits for its rows instead of polling at once;
 *   - while the feed is pushed, a live hint does not GET the row it names;
 *   - the SPA's and the sync's ticks share one real request per window.
 */
import assert from "node:assert/strict";
import test from "node:test";

await import(new URL("../../public/assets/apms-collections.js", import.meta.url).href);
await import(new URL("../../public/assets/apms-sync.js", import.meta.url).href);

type Sync = {
  resetForTests(): void;
  noteLoaded(s: Record<string, unknown>): void;
  install(fn: typeof fetch): unknown;
  setLiveHooks(h: Record<string, unknown>): void;
  setLiveSeq(n: number): void;
  liveSeq(): number;
  handleLiveEvent(t: Record<string, unknown>): unknown;
};
const sync = (globalThis as unknown as { __apmsSync: Sync }).__apmsSync;
const SEP = (globalThis as unknown as { __apmsCollections: { SEP: string } }).__apmsCollections.SEP;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = () => ({
  people: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
  roles: { r: { id: "r" } },
  records: { "2026-09": { p1: { status: "plan_open", kras: [] } } },
  rewardRecords: {},
  targetCells: {},
  bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
  notebookUpdatedAt: 1000,
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(feed: Array<Record<string, unknown>> = []) {
  sync.resetForTests();
  sync.noteLoaded(base());
  sync.setLiveSeq(5);
  let local: Record<string, unknown> = base();
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/changes")) {
      const since = Number(new URL(url, "http://x").searchParams.get("since") || 0);
      // As the server: the latest change per row, in seq order.
      const latest = new Map<string, Record<string, unknown>>();
      for (const c of feed.filter((x) => Number(x.seq) > since)) latest.set(`${c.kind}|${c.id}`, c);
      const rows = [...latest.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
      return json({ ok: true, since, seq: rows.length ? rows[rows.length - 1].seq : since, changes: rows });
    }
    if (url.startsWith("/api/company-tick")) return json({ at: 1500, entities: [], seq: 5 });
    return json({ ok: true, payload: { id: "p2", name: "Two" }, rev: 2 });
  }) as typeof fetch);
  sync.setLiveHooks({
    getSnapshot: () => local,
    isBlocked: () => false,
    apply: (s: Record<string, unknown>) => {
      local = s;
      return true;
    },
    remember: () => {},
  });
  return { urls, local: () => local };
}

const lockRow = (seq: number) => ({
  seq,
  kind: "month-records",
  id: `p1${SEP}2026-09`,
  k1: "p1",
  k2: "2026-09",
  rev: 2,
  deleted: false,
  payload: { status: "plan_locked", kras: [] },
});

test("a pushed feed page is applied with no request; the cursor moves", async () => {
  const { urls, local } = setup();
  sync.handleLiveEvent({ at: 2000, push: 1, since: 5, seq: 6, entities: [], changes: [lockRow(6)] });
  await sleep(20);
  const rec = (local().records as Record<string, Record<string, { status: string }>>)["2026-09"].p1;
  assert.equal(rec.status, "plan_locked");
  assert.equal(sync.liveSeq(), 6);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 0, "no poll");
});

test("a pushed page that starts past the cursor (a missed frame) polls instead", async () => {
  const { urls, local } = setup([lockRow(6), { ...lockRow(8), rev: 3, payload: { status: "plan_closed", kras: [] } }]);
  sync.handleLiveEvent({ at: 2000, push: 1, since: 7, seq: 8, entities: [], changes: [{ ...lockRow(8), rev: 3, payload: { status: "plan_closed", kras: [] } }] });
  await sleep(30);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 1, "polled from its own cursor");
  assert.equal((local().records as Record<string, Record<string, { status: string }>>)["2026-09"].p1.status, "plan_closed");
  assert.equal(sync.liveSeq(), 8);
});

test("a tick whose feed seq is not past the cursor does not poll; one past it does", async () => {
  const { urls } = setup([lockRow(6)]);
  sync.handleLiveEvent({ at: 2000, seq: 5, entities: [] });
  await sleep(10);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 0);
  sync.handleLiveEvent({ at: 2100, seq: 6, entities: [] });
  await sleep(20);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 1);
});

test("a push-stream tick waits for the pushed rows (no poll when they come)", async () => {
  const { urls } = setup([lockRow(6)]);
  sync.handleLiveEvent({ at: 2000, push: 1, seq: 6, entities: [] });
  await sleep(50);
  sync.handleLiveEvent({ at: 2001, push: 1, since: 5, seq: 6, entities: [], changes: [lockRow(6)] });
  await sleep(1700);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 0);
  assert.equal(sync.liveSeq(), 6);
});

test("a push-stream tick whose rows never come polls after the wait", async () => {
  const { urls } = setup([lockRow(6)]);
  sync.handleLiveEvent({ at: 2000, push: 1, seq: 6, entities: [] });
  await sleep(1700);
  assert.equal(urls.filter((u) => u.startsWith("/api/changes")).length, 1);
  assert.equal(sync.liveSeq(), 6);
});

test("while the feed is pushed, a live hint does not GET the row; without pushes it does", async () => {
  const a = setup();
  sync.handleLiveEvent({ at: 2000, push: 1, since: 5, seq: 6, entities: [], changes: [lockRow(6)] });
  sync.handleLiveEvent({ at: 2100, push: 1, seq: 6, entities: [{ type: "people", id: "p2", at: 2100 }] });
  await sleep(20);
  assert.equal(a.urls.some((u) => u.startsWith("/api/people/")), false, "no hint GET");
  const b = setup();
  sync.handleLiveEvent({ at: 2100, seq: 5, entities: [{ type: "people", id: "p2", at: 2100 }] });
  await sleep(20);
  assert.equal(b.urls.some((u) => u.startsWith("/api/people/p2")), true, "hint GET (G9 path) without pushes");
});

test("the SPA tick inside the window is answered from the last real tick", async () => {
  const { urls } = setup();
  const r1 = await fetch("/api/company-tick");
  assert.equal((await r1.json()).at, 1500);
  const r2 = await fetch("/api/company-tick");
  assert.equal(r2.headers.get("x-apms-tick"), "cached");
  assert.equal((await r2.json()).at, 1500);
  assert.equal(urls.filter((u) => u.startsWith("/api/company-tick")).length, 1, "one real request");
});
