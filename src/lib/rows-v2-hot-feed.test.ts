/**
 * ROWS-V2 hot feed: people / month-records / reward-records / target-cells
 * commits ride the change feed with their payload, and the client applies
 * them with the same merge rules as generic rows. This replaces the hint
 * channel that never delivered on live (G9 RED on p0as77 and p0as78).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { openTestDb } from "./test-db.ts";
import { patchEntity, memoryEntityBooks } from "./company-entities.ts";
import { changesSince, latestSeq, resetEntityImportForTests } from "./company-entity-store.ts";
import { resetLiveForTests } from "./company-live.ts";
import type { HotSql } from "./company-hot-tables.ts";

await import(new URL("../../public/assets/apms-collections.js", import.meta.url).href);
await import(new URL("../../public/assets/apms-sync.js", import.meta.url).href);

type Sync = {
  resetForTests(): void;
  noteLoaded(s: Record<string, unknown>): void;
  install(fn: typeof fetch): unknown;
  setLiveHooks(h: Record<string, unknown>): void;
  pollChanges(): Promise<unknown>;
  setLiveSeq(n: number): void;
  liveSeq(): number;
  entityRevs(): Record<string, number>;
  collectEntityOps(s: Record<string, unknown>): Array<{ url: string; payload: Record<string, unknown>; deleted: boolean }>;
  lastAckedBooks(): Record<string, Record<string, unknown>>;
  save(s: Record<string, unknown>): Promise<Record<string, unknown>>;
  handleLiveEvent(t: Record<string, unknown>): unknown;
};
const sync = (globalThis as unknown as { __apmsSync: Sync }).__apmsSync;

const probe = await openTestDb();
if (probe) probe.close();
else console.log("# rows-v2 hot feed: no test database — suite skipped");
const skip = !probe ? { skip: "no test database" } : undefined;

async function openSql() {
  resetEntityImportForTests();
  resetLiveForTests();
  const db = await openTestDb();
  if (!db) throw new Error("no test database");
  return { sql: db.sql, close: () => db.close() };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function feedFetch(sql: HotSql) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/changes")) {
      const u = new URL(url, "http://x");
      if (u.searchParams.get("head") === "1") return json({ ok: true, seq: await latestSeq(sql) });
      const since = Number(u.searchParams.get("since") || 0);
      const changes = await changesSince(sql, since, 500, { withPayload: true });
      return json({ ok: true, since, seq: changes.length ? changes[changes.length - 1].seq : await latestSeq(sql), changes });
    }
    return json({ ok: false, error: "unexpected " + url }, 404);
  }) as typeof fetch;
}

const base = () => ({
  people: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
  roles: { r: { id: "r" } },
  records: { "2026-09": { p1: { status: "plan_open", kras: [{ id: "k1", weight: 0.5 }] } } },
  rewardRecords: { "2026-09": { p1: { status: "draft" } } },
  targetCells: { "tn-a::2026-09": { nodeId: "tn-a", month: "2026-09", actual: 10 } },
  bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
  notebookUpdatedAt: 1000,
});

test("server: a month-record PATCH appears on the change feed with its payload", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const start = await latestSeq(sql);
    const res = await patchEntity(sql, { table: "month_records", period: "2026-09", personId: "p1" }, { baseRev: 1, payload: { status: "plan_locked" } }, books, "A");
    assert.equal(res.status, 200);
    assert.ok(Number(res.body.seq) > start, "PATCH response carries the feed seq");
    const changes = await changesSince(sql, start, 100, { withPayload: true });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, "month-records");
    assert.equal(changes[0].k1, "p1");
    assert.equal(changes[0].k2, "2026-09");
    assert.deepEqual(changes[0].payload, { status: "plan_locked" });
    // people rows on the feed never carry secrets
    const p = await patchEntity(sql, { table: "people", id: "p9" }, { baseRev: 0, payload: { id: "p9", name: "New", password: "s3cret" } }, books, "A");
    assert.equal(p.status, 200);
    const tail = await changesSince(sql, changes[0].seq, 100, { withPayload: true });
    assert.equal(tail[0].kind, "people");
    assert.equal(JSON.stringify(tail[0].payload).includes("s3cret"), false);
  } finally {
    close();
  }
});

test("follower: B sees A's APMS lock, reward change, hire and cell edit from the feed (no hint GETs)", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const head = await latestSeq(sql);
    // A commits on the server
    await patchEntity(sql, { table: "month_records", period: "2026-09", personId: "p1" }, { baseRev: 1, payload: { status: "plan_locked", kras: [{ id: "k1", weight: 0.5 }] } }, books, "A");
    await patchEntity(sql, { table: "reward_records", period: "2026-09", personId: "p1" }, { baseRev: 1, payload: { status: "plan_locked" } }, books, "A");
    await patchEntity(sql, { table: "people", id: "p3" }, { baseRev: 0, payload: { id: "p3", name: "Hired" } }, books, "A");
    await patchEntity(sql, { table: "target_cells", id: "tn-a::2026-09" }, { baseRev: 1, payload: { nodeId: "tn-a", month: "2026-09", actual: 42 } }, books, "A");
    // B, idle, follows the feed
    sync.resetForTests();
    sync.noteLoaded(base());
    sync.setLiveSeq(head);
    let local: Record<string, unknown> = base();
    const urls: string[] = [];
    const inner = feedFetch(sql);
    sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return inner(input, init);
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
    await sync.pollChanges();
    const records = local.records as Record<string, Record<string, { status: string }>>;
    assert.equal(records["2026-09"].p1.status, "plan_locked", "APMS lock arrived");
    const rewards = local.rewardRecords as Record<string, Record<string, { status: string }>>;
    assert.equal(rewards["2026-09"].p1.status, "plan_locked", "reward lock arrived");
    assert.equal((local.people as Array<{ id: string }>).some((p) => p.id === "p3"), true, "hire arrived");
    assert.equal((local.targetCells as Record<string, { actual: number }>)["tn-a::2026-09"].actual, 42, "cell edit arrived");
    assert.equal(urls.some((u) => u.startsWith("/api/people/") || u.startsWith("/api/month-records/")), false, "no per-row hint GETs needed");
    // revs learned, baseline acked → nothing dirty to send
    assert.equal(sync.entityRevs()["month_records:2026-09:p1"], 2);
    assert.equal(sync.entityRevs()["people:p3"], 1);
    assert.deepEqual(sync.collectEntityOps(local), []);
  } finally {
    close();
  }
});

test("follower: B's unsaved APMS edit survives A's change to the same record (merge, stays dirty)", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const head = await latestSeq(sql);
    await patchEntity(sql, { table: "month_records", period: "2026-09", personId: "p1" }, { baseRev: 1, payload: { status: "plan_locked", kras: [{ id: "k1", weight: 0.5 }] } }, books, "A");
    sync.resetForTests();
    sync.noteLoaded(base());
    sync.setLiveSeq(head);
    // B has changed k1's weight locally and not saved yet
    let local: Record<string, unknown> = { ...base(), records: { "2026-09": { p1: { status: "plan_open", kras: [{ id: "k1", weight: 0.7 }] } } } };
    sync.install(feedFetch(sql));
    sync.setLiveHooks({ getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { local = s; return true; }, remember: () => {} });
    await sync.pollChanges();
    const rec = (local.records as Record<string, Record<string, { status: string; kras: Array<{ weight: number }> }>>)["2026-09"].p1;
    assert.equal(rec.status, "plan_locked", "A's lock arrived");
    assert.equal(rec.kras[0].weight, 0.7, "B's unsaved weight kept");
    const ops = sync.collectEntityOps(local);
    assert.deepEqual(ops.map((o) => o.url), ["/api/month-records/2026-09/p1"], "still dirty, will save the merge");
    assert.equal(ops[0].payload.status, "plan_locked");
  } finally {
    close();
  }
});

test("follower: a person deleted by A disappears for B and is not re-sent", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const { ensureHotTablesFromBooks } = await import("./company-entities.ts");
    await ensureHotTablesFromBooks(sql, () => books.read());
    const head = await latestSeq(sql);
    await patchEntity(sql, { table: "people", id: "p2" }, { baseRev: 1, deleted: true }, books, "A");
    sync.resetForTests();
    sync.noteLoaded(base());
    sync.setLiveSeq(head);
    let local: Record<string, unknown> = base();
    sync.install(feedFetch(sql));
    sync.setLiveHooks({ getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { local = s; return true; }, remember: () => {} });
    await sync.pollChanges();
    assert.equal((local.people as Array<{ id: string }>).some((p) => p.id === "p2"), false);
    assert.deepEqual(sync.collectEntityOps(local), []);
  } finally {
    close();
  }
});

test("stale page: a plan another user deleted is not re-created by a stale or reloaded page; Add APMS → Create plan re-creates it", skip, async () => {
  const { sql, close } = await openSql();
  const g = globalThis as unknown as { __apmsNavUi?: { loadSession(): Record<string, unknown> } };
  const nav = (s: Record<string, unknown>) => { g.__apmsNavUi = { loadSession: () => s }; };
  const onPage = { view: "scorecard", kind: "apms", selectedPersonId: "p1", currentMonth: "2026-09" };
  const onList = { view: "apms", kind: "apms", selectedPersonId: "p1", currentMonth: "2026-09" };
  try {
    const books = memoryEntityBooks(base());
    const { ensureHotTablesFromBooks } = await import("./company-entities.ts");
    await ensureHotTablesFromBooks(sql, () => books.read());
    const row = async () => (await sql.query<{ deleted_at: unknown; payload: { notes?: string } }>("select deleted_at, payload from month_records where person_id = 'p1' and period = '2026-09'"))[0];
    const head = await latestSeq(sql);
    const del = await patchEntity(sql, { table: "month_records", period: "2026-09", personId: "p1" }, { baseRev: 1, deleted: true }, books, "A");
    assert.equal(del.status, 200);
    const feed = feedFetch(sql);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const m = String(input).match(/^\/api\/month-records\/([^/]+)\/([^/?]+)/);
      if (m && init?.method === "PATCH") {
        const r = await patchEntity(sql, { table: "month_records", period: m[1], personId: m[2] }, JSON.parse(String(init.body)), books, "B");
        return json(r.body, r.status);
      }
      return feed(input);
    }) as typeof fetch;
    let local: Record<string, unknown> = base();
    let refuse = false;
    const hooks = { getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { if (refuse) return false; local = s; return true; }, remember: () => {} };

    // 1. B came to p1's page from the list while the plan existed; A deletes it; B types.
    sync.resetForTests();
    sync.noteLoaded(base());
    sync.setLiveSeq(head);
    sync.install(fetcher);
    nav(onList);
    sync.setLiveHooks(hooks);
    nav(onPage);
    sync.setLiveHooks(hooks);
    await sync.pollChanges();
    assert.equal((local.records as Record<string, Record<string, unknown>>)["2026-09"]?.p1, undefined, "the delete reached B");
    await sync.save({ ...local, records: { "2026-09": { p1: { status: "plan_open", notes: "stale" } } } });
    assert.ok((await row()).deleted_at, "stale edit: still deleted");

    // 2. After a reload the session reopens p1's page; the SPA rebuilds a blank plan.
    sync.resetForTests();
    const wire = { ...base(), records: {} };
    sync.noteLoaded(wire);
    sync.setLiveSeq(await latestSeq(sql)); // the reloaded wire already reflects the delete
    local = wire;
    sync.install(fetcher);
    nav(onPage);
    local = { ...wire, records: { "2026-09": { p1: { status: "plan_open", notes: "" } } } };
    sync.setLiveHooks(hooks);
    // …and the person has already moved on to the month list when it is saved,
    // while the UI is busy and refuses the corrected screen.
    nav(onList);
    refuse = true;
    sync.setLiveHooks(hooks);
    await sync.save(local);
    assert.ok((await row()).deleted_at, "page restored on load: still deleted");
    assert.ok((local.records as Record<string, Record<string, unknown>>)["2026-09"]?.p1, "UI refused the correction");
    refuse = false;
    sync.setLiveHooks(hooks); // next screen tick
    assert.equal((local.records as Record<string, Record<string, unknown>>)["2026-09"]?.p1, undefined, "the blank plan leaves the screen");
    local = wire;

    // 3. Add APMS → Create plan: from the list to p1's page, which has no plan yet.
    nav(onList);
    sync.setLiveHooks(hooks);
    nav(onPage);
    sync.setLiveHooks(hooks);
    await sync.save({ ...wire, records: { "2026-09": { p1: { status: "plan_open", notes: "created again" } } } });
    const again = await row();
    assert.equal(again.deleted_at, null, "deliberate create re-creates the plan");
    assert.equal(again.payload.notes, "created again");
  } finally {
    delete g.__apmsNavUi;
    close();
  }
});

test("reload on a stale wire: the feed is replayed from the wire's position, so a delete it missed still leaves the screen", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const { ensureHotTablesFromBooks } = await import("./company-entities.ts");
    await ensureHotTablesFromBooks(sql, () => books.read());
    const wireSeq = await latestSeq(sql); // the cached wire was built here…
    await patchEntity(sql, { table: "month_records", period: "2026-09", personId: "p1" }, { baseRev: 1, deleted: true }, books, "A"); // …then A deleted the plan
    sync.resetForTests();
    sync.install(feedFetch(sql));
    let local: Record<string, unknown> = base();
    sync.setLiveSeq(await latestSeq(sql)); // a head read already past the delete
    sync.noteLoaded({ ...base(), feedSeq: wireSeq });
    sync.setLiveHooks({ getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { local = s; return true; }, remember: () => {} });
    await sync.pollChanges();
    assert.equal((local.records as Record<string, Record<string, unknown>>)["2026-09"]?.p1, undefined, "the delete reached the reloaded screen");
    assert.ok(sync.liveSeq() > wireSeq);
  } finally {
    close();
  }
});

test("an idle screen writing back its older copy of a plan does not undo another user's lock", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const { ensureHotTablesFromBooks } = await import("./company-entities.ts");
    await ensureHotTablesFromBooks(sql, () => books.read());
    const key = { table: "month_records" as const, period: "2026-09", personId: "p1" };
    const v1 = { status: "plan_open", kras: [{ id: "k1", weight: 0.5 }], notes: "B's notes", updatedAt: 711 };
    await patchEntity(sql, key, { baseRev: 1, payload: v1 }, books, "B");
    sync.resetForTests();
    sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
      const m = String(input).match(/^\/api\/month-records\/([^/]+)\/([^/?]+)/);
      if (m && init?.method === "PATCH") {
        const r = await patchEntity(sql, { table: "month_records", period: m[1], personId: m[2] }, JSON.parse(String(init.body)), books, "C");
        return json(r.body, r.status);
      }
      return feedFetch(sql)(input);
    }) as typeof fetch);
    const loaded = { ...base(), records: { "2026-09": { p1: v1 } } };
    sync.noteLoaded(loaded);
    sync.setLiveSeq(await latestSeq(sql));
    let local: Record<string, unknown> = loaded;
    sync.setLiveHooks({ getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { local = s; return true; }, remember: () => {} });
    // A locks the plan; C (idle) receives it.
    await patchEntity(sql, key, { baseRev: 2, payload: { ...v1, status: "plan_locked", updatedAt: 720 } }, books, "A");
    await sync.pollChanges();
    assert.equal((local.records as Record<string, Record<string, { status: string }>>)["2026-09"].p1.status, "plan_locked");
    // C's page writes its older copy back (same updatedAt as before the lock).
    await sync.save({ ...local, records: { "2026-09": { p1: v1 } } });
    const row = (await sql.query<{ payload: { status: string } }>("select payload from month_records where person_id = 'p1' and period = '2026-09'"))[0];
    assert.equal(row.payload.status, "plan_locked", "A's lock stands");
    assert.equal((local.records as Record<string, Record<string, { status: string }>>)["2026-09"].p1.status, "plan_locked", "C's screen shows the lock again");
    // A real edit by C (fresh stamp) still saves, on top of the lock.
    await sync.save({ ...local, records: { "2026-09": { p1: { ...v1, status: "plan_locked", notes: "C's notes", updatedAt: 730 } } } });
    const row2 = (await sql.query<{ payload: { status: string; notes: string } }>("select payload from month_records where person_id = 'p1' and period = '2026-09'"))[0];
    assert.equal(row2.payload.notes, "C's notes");
    assert.equal(row2.payload.status, "plan_locked");
  } finally {
    close();
  }
});

test("a tick that arrives while a feed poll is in flight is not lost (burst of writes)", skip, async () => {
  const { sql, close } = await openSql();
  try {
    const books = memoryEntityBooks(base());
    const { ensureHotTablesFromBooks } = await import("./company-entities.ts");
    await ensureHotTablesFromBooks(sql, () => books.read());
    sync.resetForTests();
    sync.noteLoaded(base());
    sync.setLiveSeq(await latestSeq(sql));
    const feed = feedFetch(sql);
    let release: () => void = () => {};
    let slowOnce = true;
    sync.install((async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/changes") && slowOnce) {
        slowOnce = false;
        const res = await feed(input); // taken now: before the second commit
        await new Promise<void>((r) => { release = r; });
        return res;
      }
      return feed(input);
    }) as typeof fetch);
    let local: Record<string, unknown> = base();
    sync.setLiveHooks({ getSnapshot: () => local, isBlocked: () => false, apply: (s: Record<string, unknown>) => { local = s; return true; }, remember: () => {} });
    await patchEntity(sql, { table: "target_cells", id: "tn-a::2026-09" }, { baseRev: 1, payload: { nodeId: "tn-a", month: "2026-09", actual: 11 } }, books, "A");
    const first = sync.pollChanges(); // in flight, sees actual 11
    await new Promise((r) => setTimeout(r, 20));
    await patchEntity(sql, { table: "target_cells", id: "tn-a::2026-09" }, { baseRev: 2, payload: { nodeId: "tn-a", month: "2026-09", actual: 12 } }, books, "A");
    sync.handleLiveEvent({ at: Date.now() + 5000 }); // the tick for the second commit, during the flight
    release();
    await first;
    for (let i = 0; i < 50 && (local.targetCells as Record<string, { actual: number }>)["tn-a::2026-09"]?.actual !== 12; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal((local.targetCells as Record<string, { actual: number }>)["tn-a::2026-09"].actual, 12, "the second commit reached the screen without another tick");
  } finally {
    close();
  }
});

test("targets: a deleted target id in a stale order list does not come back (client merge)", async () => {
  const s = (globalThis as unknown as { __apmsSync: { merge3(b: unknown, m: unknown, t: unknown): unknown } }).__apmsSync;
  // A deleted tn-b; B's stale screen appended tn-d to the same month's order.
  assert.deepEqual(s.merge3(["tn-a", "tn-b", "tn-c"], ["tn-a", "tn-b", "tn-c", "tn-d"], ["tn-a", "tn-c"]), ["tn-a", "tn-c", "tn-d"]);
  // B reordered; A added tn-e → both kept, B's order.
  assert.deepEqual(s.merge3(["a", "b", "c"], ["c", "a", "b"], ["a", "b", "c", "e"]), ["c", "a", "b", "e"]);
});

test("targets: assemble drops order entries and memberships that point at a deleted target", async () => {
  const { pruneDanglingTargets } = await import("./company-entities-v2.ts");
  const out = pruneDanglingTargets({
    targetNodes: { "tn-a": { id: "tn-a" }, "tn-c": { id: "tn-c" }, "g1": { id: "g1" } },
    targetRootOrder: { "2026-09": ["tn-a", "tn-b", "g1"], "2026-10": ["tn-c"] },
    targetMembers: [
      { groupId: "g1", memberId: "tn-a", month: "2026-09" },
      { groupId: "g1", memberId: "tn-b", month: "2026-09" },
      { groupId: "g-gone", memberId: "tn-c", month: "2026-09" },
    ],
  });
  assert.deepEqual(out.targetRootOrder, { "2026-09": ["tn-a", "g1"], "2026-10": ["tn-c"] });
  assert.deepEqual(out.targetMembers, [{ groupId: "g1", memberId: "tn-a", month: "2026-09" }]);
  // no nodes loaded → nothing pruned (never blank a graph we could not read)
  const same = { targetRootOrder: { m: ["x"] } };
  assert.equal(pruneDanglingTargets(same), same);
});
