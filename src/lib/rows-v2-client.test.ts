/**
 * ROWS-V2 client tests: apms-sync.js with apms-collections.js loaded.
 * The "two users" tests run the real row store against local Postgres and
 * bridge the client's fetch to it, so what is asserted is the actual
 * end-to-end merge behaviour, not a mock of it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openTestDb } from "./test-db.ts";
import { entityIdFromParts, patchEntityRow, readEntity, changesSince, latestSeq, importEntitiesFromSnapshot, resetEntityImportForTests } from "./company-entity-store.ts";
import type { HotSql } from "./company-hot-tables.ts";

await import(new URL("../../public/assets/apms-collections.js", import.meta.url).href);
await import(new URL("../../public/assets/apms-sync.js", import.meta.url).href);

type Sync = {
  resetForTests(): void;
  noteLoaded(s: Record<string, unknown>): void;
  install(fn: typeof fetch): unknown;
  save(s: Record<string, unknown>): Promise<Record<string, unknown>>;
  lastSave(): { via?: string; books?: string[]; merged?: number } | null;
  merge3(base: unknown, mine: unknown, theirs: unknown, trace?: unknown[]): unknown;
  collectEntityOps(s: Record<string, unknown>): Array<{ kind: string; url: string; deleted: boolean; payload: Record<string, unknown>; revKey: string }>;
  mergeGenericRow(local: Record<string, unknown>, kind: string, body: Record<string, unknown>): Record<string, unknown>;
  pollChanges(): Promise<unknown>;
  commitPendingAcks(): number;
  setLiveHooks(h: Record<string, unknown>): void;
  handleLiveEvent(t: Record<string, unknown>): unknown;
  liveSeq(): number;
  setLiveSeq(n: number): void;
  entityRevs(): Record<string, number>;
  mergeTrace(): unknown[];
  lastAckedBooks(): Record<string, Record<string, unknown>>;
};
const sync = (globalThis as unknown as { __apmsSync: Sync }).__apmsSync;

const probe = await openTestDb();
if (probe) probe.close();
else console.log("# rows-v2: no test database available (install @electric-sql/pglite or set PGTEST=1) — suite skipped");
const skip = !probe ? { skip: "no test database" } : undefined;

async function openSql() {
  resetEntityImportForTests();
  const db = await openTestDb();
  if (!db) throw new Error("no test database");
  return { sql: db.sql, db: { end: () => db.close() } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that serves /api/e/* and /api/changes from the real store; everything else 404. */
function storeFetch(sql: HotSql, log: Array<{ method: string; url: string; body?: unknown }>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ method, url, body });
    const m = url.match(/^\/api\/e\/([^/?]+)\/([^/?]+)(?:\/([^/?]+))?$/);
    if (m) {
      const key = entityIdFromParts(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3] !== undefined ? decodeURIComponent(m[3]) : undefined);
      if (method === "GET") {
        const row = await readEntity(sql, key);
        return row ? json({ ok: true, ...row }) : json({ ok: false, error: "not-found" }, 404);
      }
      const res = await patchEntityRow(sql, key, body, "test");
      return json(res.body, res.status);
    }
    if (url.startsWith("/api/changes")) {
      const u = new URL(url, "http://x");
      if (u.searchParams.get("head") === "1") return json({ ok: true, seq: await latestSeq(sql) });
      const since = Number(u.searchParams.get("since") || 0);
      const changes = await changesSince(sql, since, 500, { withPayload: true });
      return json({ ok: true, since, seq: changes.length ? changes[changes.length - 1].seq : await latestSeq(sql), changes });
    }
    if (url.startsWith("/api/company") && method === "PATCH") {
      return json({ ok: true, applied: Object.keys(body.books || {}), conflict: [], skipped: [], bookGens: { org: 9, plans: 9, months: 9, targets: 9 }, notebookUpdatedAt: Date.now() });
    }
    return json({ ok: false, error: "unexpected " + method + " " + url }, 404);
  }) as typeof fetch;
}

const baseSnap = () => ({
  people: [{ id: "p1", name: "P1" }],
  roles: { ceo: { id: "ceo", name: "CEO", band: 1, slabs: [1, 2] }, cto: { id: "cto", name: "CTO", band: 1 } },
  brands: [{ id: "b1", name: "Aliens" }, { id: "b2", name: "Home" }],
  notices: [{ id: "n1", title: "Hello", status: "open" }],
  companyFactor: 1.1,
  roleMonths: { ceo: { "2026-09": { status: "plan_open", kras: [{ id: "k1", name: "Rev", weight: 0.5 }] } } },
  kpiMaster: [{ id: "kpi1", name: "Revenue" }],
  bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
  notebookUpdatedAt: 1000,
});

test("merge3: non-overlapping edits from two users both survive; primitive clash → local wins", () => {
  const base = { name: "CEO", band: 1, note: "x" };
  const mine = { name: "Chief", band: 1, note: "x" };
  const theirs = { name: "CEO", band: 2, note: "x" };
  assert.deepEqual(sync.merge3(base, mine, theirs), { name: "Chief", band: 2, note: "x" });
  // they added a field, I deleted another
  assert.deepEqual(sync.merge3({ a: 1, b: 1 }, { a: 1 }, { a: 1, b: 1, c: 3 }), { a: 1, c: 3 });
  // same field both changed differently → mine, recorded
  const trace: unknown[] = [];
  assert.deepEqual(sync.merge3({ a: 1 }, { a: 2 }, { a: 3 }, trace), { a: 2 });
  assert.equal(trace.length, 1);
  // nested id-arrays: I edit KRA k1's weight, they add KRA k2
  const b = { kras: [{ id: "k1", weight: 0.5 }] };
  const m = { kras: [{ id: "k1", weight: 0.6 }] };
  const t = { kras: [{ id: "k1", weight: 0.5 }, { id: "k2", weight: 0.4 }] };
  assert.deepEqual(sync.merge3(b, m, t), { kras: [{ id: "k1", weight: 0.6 }, { id: "k2", weight: 0.4 }] });
  // they deleted k1 while I left it alone → gone; my new k3 stays
  assert.deepEqual(
    sync.merge3({ kras: [{ id: "k1" }] }, { kras: [{ id: "k1" }, { id: "k3" }] }, { kras: [] }),
    { kras: [{ id: "k3" }] },
  );
});

test("collectEntityOps: every changed row becomes one PATCH with its own URL", () => {
  sync.resetForTests();
  const base = baseSnap();
  sync.noteLoaded(base);
  const next = {
    ...base,
    roles: { ...base.roles, ceo: { ...base.roles.ceo, name: "Chief Exec" } },
    brands: [{ id: "b1", name: "Aliens" }],
    notices: [...base.notices, { id: "n2", title: "New", status: "open" }],
    companyFactor: 1.25,
    roleMonths: { ceo: { "2026-09": { status: "plan_locked", kras: base.roleMonths.ceo["2026-09"].kras } } },
  };
  const ops = sync.collectEntityOps(next);
  const byUrl = Object.fromEntries(ops.map((o) => [o.url, o]));
  assert.deepEqual(Object.keys(byUrl).sort(), [
    "/api/e/brands/b2",
    "/api/e/notices/n2",
    "/api/e/role-months/ceo/2026-09",
    "/api/e/roles/ceo",
    "/api/e/settings/companyFactor",
  ]);
  assert.equal(byUrl["/api/e/brands/b2"].deleted, true);
  assert.equal(byUrl["/api/e/roles/ceo"].payload.name, "Chief Exec");
  assert.deepEqual(byUrl["/api/e/settings/companyFactor"].payload, { value: 1.25 });
  assert.equal(byUrl["/api/e/role-months/ceo/2026-09"].payload.status, "plan_locked");
  // Nothing in the four hot tables changed → no legacy ops
  assert.equal(ops.some((o) => o.url.startsWith("/api/people")), false);
});

test("two users, same role, different fields: both edits survive (Google-Sheets rule)", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    // ---- user A saves a name change
    sync.resetForTests();
    sync.noteLoaded(base);
    const logA: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, logA));
    const ackA = await sync.save({ ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, name: "Chief Exec" } } });
    assert.equal(ackA.ok, true);
    assert.equal(sync.lastSave()?.via, "ENTITY");
    const afterA = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(afterA?.payload.name, "Chief Exec");
    assert.equal(afterA?.rev, 2);
    // No book PATCH went out: the change was entirely row-owned.
    assert.equal(logA.some((l) => l.url === "/api/company"), false);

    // ---- user B loaded the same original snapshot, changes band, saves after A
    sync.resetForTests();
    sync.noteLoaded(base);
    const logB: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, logB));
    const ackB = await sync.save({ ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, band: 3 } } });
    assert.equal(ackB.ok, true);
    const patches = logB.filter((l) => l.method === "PATCH" && l.url === "/api/e/roles/ceo");
    assert.equal(patches.length, 2, "first PATCH 409s (rev 1 vs 2), second carries the merge");
    assert.equal((patches[1].body as { baseRev: number }).baseRev, 2);
    const merged = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(merged?.payload.name, "Chief Exec", "A's edit kept");
    assert.equal(merged?.payload.band, 3, "B's edit kept");
    assert.equal(merged?.rev, 3);
    assert.equal(sync.lastSave()?.merged, 1);
    assert.equal(sync.entityRevs()["e:roles:ceo"], 3);
    // B's acked baseline is the merged row, so the next save has nothing to send
    const acked = sync.lastAckedBooks().org.roles as Record<string, Record<string, unknown>>;
    assert.equal(acked.ceo.name, "Chief Exec");
    assert.equal(acked.ceo.band, 3);
  } finally {
    db.end();
  }
});

test("a deleted row does not come back when a stale user saves an edit to it", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    // A deletes notice n1
    sync.resetForTests();
    sync.noteLoaded(base);
    sync.install(storeFetch(sql, []));
    const ackA = await sync.save({ ...base, notices: [] });
    assert.equal(ackA.ok, true);
    assert.equal((await readEntity(sql, entityIdFromParts("notices", "n1")))?.deleted, true);
    // B, still holding n1, edits its title and saves
    sync.resetForTests();
    sync.noteLoaded(base);
    const applied: Array<Record<string, unknown>> = [];
    sync.setLiveHooks({
      getSnapshot: () => base,
      isBlocked: () => false,
      apply: (s: Record<string, unknown>) => {
        applied.push(s);
        return true;
      },
      remember: () => {},
    });
    sync.install(storeFetch(sql, []));
    const ackB = await sync.save({ ...base, notices: [{ id: "n1", title: "Hello edited", status: "open" }] });
    assert.equal(ackB.ok, true);
    const row = await readEntity(sql, entityIdFromParts("notices", "n1"));
    assert.equal(row?.deleted, true, "still deleted on the server");
    // B's screen was corrected: the row is gone locally too
    const last = applied[applied.length - 1];
    assert.ok(last, "corrected snapshot pushed to the UI");
    assert.deepEqual(last.notices, []);
    assert.deepEqual(sync.lastAckedBooks().org.notices, []);
  } finally {
    db.end();
  }
});

test("follower: change feed applies other users' rows; a locally dirty row is merged, not clobbered", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    const head = await latestSeq(sql);
    // Someone else changes cto's band and adds a brand, directly in the store.
    await patchEntityRow(sql, entityIdFromParts("roles", "cto"), { baseRev: 1, payload: { id: "cto", name: "CTO", band: 5 } }, "other");
    await patchEntityRow(sql, entityIdFromParts("brands", "b3"), { baseRev: 0, payload: { id: "b3", name: "School" } }, "other");
    // Someone else also edits ceo.name while THIS client has an unsaved ceo.band edit.
    await patchEntityRow(sql, entityIdFromParts("roles", "ceo"), { baseRev: 1, payload: { ...base.roles.ceo, name: "Chief" } }, "other");

    sync.resetForTests();
    sync.noteLoaded(base);
    sync.setLiveSeq(head);
    let local: Record<string, unknown> = { ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, band: 9 } } }; // dirty ceo.band
    const applied: Array<Record<string, unknown>> = [];
    sync.setLiveHooks({
      getSnapshot: () => local,
      isBlocked: () => false,
      apply: (s: Record<string, unknown>) => {
        applied.push(s);
        local = s;
        return true;
      },
      remember: () => {},
    });
    sync.install(storeFetch(sql, []));
    sync.handleLiveEvent({ at: Date.now(), bookGens: { org: 2, plans: 1, months: 1, targets: 1 }, entities: [] });
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(applied.length >= 1, "snapshot applied");
    const roles = local.roles as Record<string, Record<string, unknown>>;
    assert.equal(roles.cto.band, 5, "clean row overlaid");
    assert.equal((local.brands as unknown[]).length, 3, "new row added");
    assert.equal(roles.ceo.name, "Chief", "their name change arrived");
    assert.equal(roles.ceo.band, 9, "my unsaved band edit kept");
    assert.equal(sync.liveSeq() > head, true, "cursor advanced");
    // ceo is still dirty (band differs from acked), cto/brands are clean
    const ops = sync.collectEntityOps(local);
    assert.deepEqual(ops.map((o) => o.url), ["/api/e/roles/ceo"]);
    assert.equal(ops[0].payload.name, "Chief");
    assert.equal(ops[0].payload.band, 9);
    // and saving it now carries the merged row with the right rev, no 409
    const log: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, log));
    const ack = await sync.save(local);
    assert.equal(ack.ok, true);
    assert.equal(log.filter((l) => l.method === "PATCH").length, 1);
    const final = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(final?.payload.name, "Chief");
    assert.equal(final?.payload.band, 9);
  } finally {
    db.end();
  }
});

test("follower: when the UI refuses the apply, the cursor rewinds so nothing is lost", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    const head = await latestSeq(sql);
    await patchEntityRow(sql, entityIdFromParts("roles", "cto"), { baseRev: 1, payload: { id: "cto", name: "CTO", band: 7 } }, "other");
    sync.resetForTests();
    sync.noteLoaded(base);
    sync.setLiveSeq(head);
    let refuse = true;
    let local: Record<string, unknown> = base;
    sync.setLiveHooks({
      getSnapshot: () => local,
      isBlocked: () => refuse,
      apply: (s: Record<string, unknown>) => {
        if (refuse) return false;
        local = s;
        return true;
      },
      remember: () => {},
    });
    sync.install(storeFetch(sql, []));
    await sync.pollChanges();
    assert.equal(sync.liveSeq(), head, "cursor did not move");
    assert.equal((sync.lastAckedBooks().org.roles as Record<string, Record<string, unknown>>).cto.band, 1, "baseline untouched");
    refuse = false;
    await sync.pollChanges();
    assert.equal((local.roles as Record<string, Record<string, unknown>>).cto.band, 7);
    assert.equal(sync.liveSeq() > head, true);
  } finally {
    db.end();
  }
});

test("collections script served to the browser is the same file the server imports", () => {
  const served = readFileSync(new URL("../../public/assets/apms-collections.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("./apms-collections.js", import.meta.url), "utf8");
  assert.equal(served, source);
  const html = readFileSync(new URL("../../public/apms.html", import.meta.url), "utf8");
  assert.ok(html.indexOf("apms-collections.js") < html.indexOf("apms-sync.js"), "collections loads before sync");
});
