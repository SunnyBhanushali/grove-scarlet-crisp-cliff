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
  pullLive(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
  applyPulledBooks(local: Record<string, unknown>, books: Record<string, Record<string, unknown>>, skip?: Record<string, number>): Record<string, unknown>;
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

test("hydrate with whole roles and no roleKrocs in the UI snapshot → zero ops (no login write storm)", () => {
  sync.resetForTests();
  const wire = {
    roles: {
      ceo: { id: "ceo", name: "CEO", band: 6, kras: [{ id: "k1", name: "Group" }], ags: { "1A": 50 } },
      ops: { id: "ops", name: "Ops", band: 5 },
    },
    notices: [{ id: "n1", title: "Hi" }],
  };
  sync.noteLoaded(wire);
  // The SPA store does not keep roleKrocs; roles stay whole.
  const ui = JSON.parse(JSON.stringify(wire)) as Record<string, unknown>;
  assert.deepEqual(sync.collectEntityOps(ui), []);
  // A real edit is still exactly one PATCH, never a role-krocs delete.
  (ui.roles as Record<string, Record<string, unknown>>).ceo.band = 7;
  const ops = sync.collectEntityOps(ui);
  assert.deepEqual(ops.map((o) => [o.url, o.deleted]), [["/api/e/roles/ceo", false]]);
});

test("GET overlay folds role-krocs rows into roles and keeps roleKrocs off the wire", async () => {
  const { foldRoleKrocsIntoRoles } = await import("./company-entities-v2.ts");
  const out = foldRoleKrocsIntoRoles({
    roles: { ceo: { id: "ceo", band: 6, kras: [{ id: "new" }] }, ops: { id: "ops", band: 5 } },
    roleKrocs: { ceo: { kras: [{ id: "stale" }] }, ops: { kras: [{ id: "ops-k" }] } },
  });
  assert.equal("roleKrocs" in out, false);
  const roles = out.roles as Record<string, { kras?: Array<{ id: string }> }>;
  assert.equal(roles.ceo.kras?.[0]?.id, "new", "role row wins over a stale kroc row");
  assert.equal(roles.ops.kras?.[0]?.id, "ops-k", "kroc row fills a role without kras");
});

test("a row whose content already matches the server is adopted, not rewritten (no rev churn)", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    // This client's baseline lacks the brand row (never saw it), but the value
    // it holds on screen is exactly what the server has.
    sync.noteLoaded({ ...base, brands: [base.brands[0]] });
    const log: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, log));
    const ack = await sync.save(base);
    assert.equal(ack.ok, true);
    const patches = log.filter((l) => l.method === "PATCH" && l.url === "/api/e/brands/b2");
    assert.equal(patches.length, 1, "one probe PATCH (409), no identical resend");
    const row = await readEntity(sql, entityIdFromParts("brands", "b2"));
    assert.equal(row?.rev, 1, "server rev untouched");
    assert.equal(sync.entityRevs()["e:brands:b2"], 1);
  } finally {
    db.end();
  }
});

test("a refused feed apply does not teach the rev: the next save 409-merges instead of overwriting", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    const head = await latestSeq(sql);
    // Me: saved ceo once, so I know rev 2.
    sync.resetForTests();
    sync.noteLoaded(base);
    sync.setLiveSeq(head);
    const log: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, log));
    const mine1 = { ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, band: 4 } } };
    assert.equal((await sync.save(mine1)).ok, true);
    const seqAfterMine = await latestSeq(sql);
    // Someone else renames ceo (rev 3).
    await patchEntityRow(sql, entityIdFromParts("roles", "ceo"), { baseRev: 2, payload: { ...base.roles.ceo, band: 4, name: "Chief" } }, "other");
    sync.setLiveSeq(seqAfterMine);
    // Their row arrives while my UI is busy saving: the apply is refused.
    sync.setLiveHooks({ getSnapshot: () => mine1, isBlocked: () => true, apply: () => false, remember: () => {} });
    await sync.pollChanges();
    assert.equal(sync.entityRevs()["e:roles:ceo"], 2, "rev not learned from a refused apply");
    // My next edit (from the screen that never showed "Chief") must merge, not overwrite.
    log.length = 0;
    const mine2 = { ...mine1, roles: { ...mine1.roles, ceo: { ...mine1.roles.ceo, slabs: [1, 2, 3] } } };
    assert.equal((await sync.save(mine2)).ok, true);
    const patches = log.filter((l) => l.method === "PATCH" && l.url === "/api/e/roles/ceo");
    assert.equal((patches[0].body as { baseRev: number }).baseRev, 2);
    assert.equal(patches.length, 2, "409 first, then the merged row");
    const row = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(row?.payload.name, "Chief", "their rename survives");
    assert.deepEqual(row?.payload.slabs, [1, 2, 3], "my edit survives");
  } finally {
    db.end();
  }
});

test("merged rows the busy UI refused are not acked: the next save merges again instead of reverting", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    // Someone else renames ceo first (rev 2).
    await patchEntityRow(sql, entityIdFromParts("roles", "ceo"), { baseRev: 1, payload: { ...base.roles.ceo, name: "Chief" } }, "other");
    sync.resetForTests();
    sync.noteLoaded(base);
    // The SPA refuses applies while its own save is in flight.
    sync.setLiveHooks({ getSnapshot: () => base, isBlocked: () => true, apply: () => false, remember: () => {} });
    const log: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, log));
    const mine1 = { ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, band: 4 } } };
    assert.equal((await sync.save(mine1)).ok, true);
    let row = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(row?.payload.name, "Chief");
    assert.equal(row?.payload.band, 4);
    // The screen never showed "Chief"; the next edit must not send "CEO" back at the current rev.
    const mine2 = { ...mine1, roles: { ...mine1.roles, ceo: { ...mine1.roles.ceo, slabs: [9] } } };
    assert.equal((await sync.save(mine2)).ok, true);
    row = await readEntity(sql, entityIdFromParts("roles", "ceo"));
    assert.equal(row?.payload.name, "Chief", "other user's rename not reverted");
    assert.equal(row?.payload.band, 4);
    assert.deepEqual(row?.payload.slabs, [9]);
  } finally {
    db.end();
  }
});

test("a row this client knew stays deleted even when a pull already dropped it from the baseline", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    sync.noteLoaded(base);
    await patchEntityRow(sql, entityIdFromParts("notices", "n1"), { baseRev: 1, deleted: true, payload: base.notices[0] }, "other");
    // A book pull refreshed the baseline without n1, but the screen still has it.
    sync.noteLoaded({ ...base, notices: [] });
    sync.install(storeFetch(sql, []));
    const ack = await sync.save({ ...base, notices: [{ ...base.notices[0], status: "done" }] });
    assert.equal(ack.ok, true);
    const row = await readEntity(sql, entityIdFromParts("notices", "n1"));
    assert.equal(row?.deleted, true, "not resurrected");
  } finally {
    db.end();
  }
});

test("a person that differs from the baseline only by the server's rev key or hydrate defaults is not re-saved", () => {
  sync.resetForTests();
  const base = baseSnap();
  sync.noteLoaded(base);
  const listed = { ...base, people: [{ ...base.people[0], rev: 3 }] };
  assert.deepEqual(sync.collectEntityOps(listed).map((o) => o.url), []);
  const hydrated = { ...base, people: [{ ...base.people[0], kras: [], brands: [], password: "" }] };
  assert.deepEqual(sync.collectEntityOps(hydrated).map((o) => o.url), []);
  sync.noteLoaded({ ...base, people: [{ ...base.people[0], phone: "123" }] });
  const cleared = { ...base, people: [{ ...base.people[0], phone: "" }] };
  assert.deepEqual(sync.collectEntityOps(cleared).map((o) => o.url), ["/api/people/p1"], "clearing a value is an edit");
  sync.noteLoaded(base);
  const edited = { ...base, people: [{ ...base.people[0], rev: 3, name: "P1 edited" }] };
  assert.deepEqual(sync.collectEntityOps(edited).map((o) => o.url), ["/api/people/p1"]);
});

test("opening screens proposes nothing: award prizes / rewardYearSeed are in the baseline and a record's updatedAt stamp alone is not an edit", async () => {
  sync.resetForTests();
  const base = {
    ...baseSnap(),
    awardPrizeCatalog: [{ id: "pz-nz", kind: "trip", name: "Trip", amount: 0 }],
    rewardYearSeed: "fy26-v6",
    records: { "2026-07": { p1: { status: "plan_open", updatedAt: 100, kpis: [] } } },
  };
  sync.noteLoaded(base);
  assert.deepEqual(sync.collectEntityOps(base).map((o) => o.url), [], "nothing to save right after load");
  const stamped = { ...base, records: { "2026-07": { p1: { status: "plan_open", updatedAt: 200, kpis: [] } } } };
  assert.deepEqual(sync.collectEntityOps(stamped).map((o) => o.url), [], "updatedAt alone is not written");
  const calls: string[] = [];
  sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${String(input)}`);
    return json({ ok: true, applied: [], conflict: [], skipped: [], bookGens: { org: 1, plans: 1, months: 1, targets: 1 } });
  }) as typeof fetch);
  await sync.save(stamped);
  assert.deepEqual(calls.filter((c) => !c.startsWith("GET")), [], "…not as a row, and not as a whole months book either");
  const edited = { ...base, records: { "2026-07": { p1: { status: "plan_locked", updatedAt: 200, kpis: [] } } } };
  assert.deepEqual(sync.collectEntityOps(edited).map((o) => o.url), ["/api/month-records/2026-07/p1"]);
  const prize = { ...base, awardPrizeCatalog: [{ id: "pz-nz", kind: "trip", name: "Trip to NZ", amount: 0 }] };
  assert.deepEqual(sync.collectEntityOps(prize).map((o) => o.url), ["/api/e/award-prizes/pz-nz"]);
});

test("a book pull (stale-while-revalidate wire) never overwrites row-owned fields on screen", () => {
  sync.resetForTests();
  const base = baseSnap();
  sync.noteLoaded(base);
  const local = { ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, name: "Chief (from feed)" } } };
  const out = sync.applyPulledBooks(local, { org: { roles: { ceo: { id: "ceo", name: "CEO (stale mirror)" } }, notices: [] } });
  assert.equal((out.roles as Record<string, { name: string }>).ceo.name, "Chief (from feed)");
  assert.equal((out.notices as unknown[]).length, 1, "notices kept");
});

test("acks are scoped per flow: the feed committing its rows does not ack rows a pull merged but the UI refused", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    sync.noteLoaded(base);
    await patchEntityRow(sql, entityIdFromParts("roles", "ceo"), { baseRev: 1, payload: { ...base.roles.ceo, name: "Chief" } }, "other");
    sync.setLiveSeq(await latestSeq(sql));
    await patchEntityRow(sql, entityIdFromParts("roles", "cto"), { baseRev: 1, payload: { ...base.roles.cto, band: 9 } }, "other");
    const store = storeFetch(sql, []);
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => { releaseSlow = r; });
    sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/e/brands/b2") await slow;
      return store(input, init);
    }) as typeof fetch);
    let ui: Record<string, unknown> = base;
    // The feed's apply is taken…
    sync.setLiveHooks({ getSnapshot: () => ui, isBlocked: () => false, apply: (s: Record<string, unknown>) => { ui = s; return true; }, remember: () => {} });
    // …the pull's apply is refused.
    const pulling = sync.pullLive({
      entities: [{ type: "e:roles", id: "ceo" }, { type: "e:brands", id: "b2" }],
      getSnapshot: () => ui,
      isBlocked: false,
      apply: (_s: Record<string, unknown>, reason: string) => reason !== "live-entity",
      remember: () => {},
    });
    await new Promise((r) => setTimeout(r, 50)); // ceo fetched + merged, b2 still pending
    await sync.pollChanges(); // applies cto, commits its acks
    releaseSlow();
    await pulling;
    const roles = (ui.roles as Record<string, Record<string, unknown>>);
    assert.equal(roles.cto.band, 9, "feed row applied");
    assert.equal(roles.ceo.name, "CEO", "the refused pull did not reach the screen");
    const acked = sync.lastAckedBooks().org.roles as Record<string, Record<string, unknown>>;
    assert.equal(acked.ceo.name, "CEO", "so the baseline must not have it either");
    assert.notEqual(sync.entityRevs()["e:roles:ceo"], 2, "nor its rev");
  } finally {
    db.end();
  }
});

test("a row the feed applies while a hint GET is in flight stays on screen, and the next save does not delete it", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    sync.noteLoaded(base);
    sync.setLiveSeq(await latestSeq(sql));
    await patchEntityRow(sql, entityIdFromParts("brands", "b2"), { baseRev: 1, payload: { id: "b2", name: "Home+" } }, "other");
    const store = storeFetch(sql, []);
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => { releaseSlow = r; });
    sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/e/brands/b2") await slow;
      return store(input, init);
    }) as typeof fetch);
    let ui: Record<string, unknown> = base;
    const hooks = { getSnapshot: () => ui, isBlocked: () => false, apply: (s: Record<string, unknown>) => { ui = s; return true; }, remember: () => {} };
    sync.setLiveHooks(hooks);
    const pulling = sync.pullLive({ entities: [{ type: "e:brands", id: "b2" }], getSnapshot: () => ui, isBlocked: false, apply: hooks.apply, remember: () => {} });
    await new Promise((r) => setTimeout(r, 30)); // b2 GET in flight
    // Another user creates a notice; the feed puts it on screen meanwhile.
    await patchEntityRow(sql, entityIdFromParts("notices", "n2"), { baseRev: 0, payload: { id: "n2", title: "New", status: "open" } }, "other");
    await sync.pollChanges();
    assert.ok((ui.notices as Array<{ id: string }>).some((n) => n.id === "n2"), "feed applied n2");
    releaseSlow();
    await pulling;
    assert.equal((ui.brands as Array<{ id: string; name: string }>).find((b) => b.id === "b2")?.name, "Home+", "pulled row applied");
    assert.ok((ui.notices as Array<{ id: string }>).some((n) => n.id === "n2"), "n2 still on screen after the pull");
    assert.deepEqual(sync.collectEntityOps(ui).filter((o) => o.deleted).map((o) => o.url), [], "nothing to delete");
  } finally {
    db.end();
  }
});

test("reordering a target group's members is saved (pos) and replayed in order; an unchanged order writes nothing", () => {
  sync.resetForTests();
  const m = (g: string, id: string, extra: Record<string, unknown> = {}) => ({ month: "2026-09", groupId: g, memberId: id, ...extra });
  const base = { ...baseSnap(), targetMembers: [m("g1", "a"), m("g1", "b"), m("g1", "c"), m("g2", "x")] };
  sync.noteLoaded(base);
  assert.deepEqual(sync.collectEntityOps(base).map((o) => o.url), [], "loaded order: nothing to save");
  const reordered = { ...base, targetMembers: [m("g1", "c"), m("g1", "a"), m("g1", "b"), m("g2", "x")] };
  const ops = sync.collectEntityOps(reordered);
  assert.equal(ops.length, 3, "the three g1 rows get positions");
  const pos = Object.fromEntries(ops.map((o) => [String(o.payload.memberId), o.payload.pos]));
  assert.deepEqual(pos, { c: 0, a: 1, b: 2 });
  const C = (globalThis as unknown as { __apmsCollections: { specForField(f: string): unknown; applyRow(s: unknown, cur: unknown, row: unknown, del: boolean): Array<{ memberId: string }> } }).__apmsCollections;
  const spec = C.specForField("targetMembers");
  let list: unknown = base.targetMembers;
  for (const o of ops) list = C.applyRow(spec, list, { id: "x", payload: o.payload }, false);
  // applyRow keys rows by id; with fresh ids they are appended, then sorted by pos.
  const g1 = (list as Array<{ groupId: string; memberId: string; pos?: number }>).filter((x) => x.groupId === "g1" && typeof x.pos === "number").map((x) => x.memberId);
  assert.deepEqual(g1, ["c", "a", "b"], "another screen shows the saved order");
});

test("a stale screen adding a target to a month another user deleted: the month stays deleted, nothing new is written into it", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = { ...baseSnap(), targetNodes: { n1: { id: "n1", name: "One" } }, targetRootOrder: { "2088-04": ["n1"] } };
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    sync.noteLoaded(base);
    // A deletes the month (its order row).
    const del = await patchEntityRow(sql, entityIdFromParts("target-root-order", "2088-04"), { baseRev: 1, deleted: true }, "A");
    assert.equal(del.status, 200);
    const log: Array<{ method: string; url: string }> = [];
    sync.install(storeFetch(sql, log));
    // B's stale screen: New target n2 in that month.
    const stale = {
      ...base,
      targetNodes: { ...base.targetNodes, n2: { id: "n2", name: "Stale" } },
      targetRootOrder: { "2088-04": ["n1", "n2"] },
      targetCells: { "n2::2088-04": { nodeId: "n2", month: "2088-04", mode: "set" } },
    };
    await sync.save(stale);
    const writes = log.filter((l) => l.method === "PATCH").map((l) => l.url);
    assert.ok(!writes.some((u) => u.includes("target-cells/n2")), "no cell written into the deleted month: " + writes.join(", "));
    assert.ok(!writes.some((u) => u.includes("target-nodes/n2")), "no orphan target created");
    const order = await readEntity(sql, entityIdFromParts("target-root-order", "2088-04"));
    assert.equal(order?.deleted, true, "the month stays deleted");
  } finally {
    db.end();
  }
});

test("a row another user deleted is not re-created when stale screen state re-adds it", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const base = baseSnap();
    await importEntitiesFromSnapshot(sql, base, "seed");
    sync.resetForTests();
    sync.noteLoaded(base);
    sync.setLiveSeq(await latestSeq(sql));
    await patchEntityRow(sql, entityIdFromParts("notices", "n1"), { baseRev: 1, deleted: true, payload: base.notices[0] }, "other");
    let ui: Record<string, unknown> = base;
    sync.setLiveHooks({ getSnapshot: () => ui, isBlocked: () => false, apply: (s: Record<string, unknown>) => { ui = s; return true; }, remember: () => {} });
    const log: Array<{ method: string; url: string; body?: unknown }> = [];
    sync.install(storeFetch(sql, log));
    await sync.pollChanges();
    assert.equal((ui.notices as unknown[]).length, 0, "feed removed it");
    assert.equal(sync.entityRevs()["e:notices:n1"], 2, "tombstone rev learned");
    // The SPA rebuilds its notice list from memory and puts n1 back.
    const ack = await sync.save({ ...(ui as object), notices: [{ ...base.notices[0], title: "Hello (refreshed)" }] } as Record<string, unknown>);
    assert.equal(ack.ok, true);
    assert.equal(log.some((l) => l.method === "PATCH" && l.url === "/api/e/notices/n1"), false, "nothing sent");
    const row = await readEntity(sql, entityIdFromParts("notices", "n1"));
    assert.equal(row?.deleted, true, "still deleted");
  } finally {
    db.end();
  }
});

test("a row-owned edit sends no book PATCH, and the baseline keeps what the screen has (no revert of a row the screen never took)", async () => {
  sync.resetForTests();
  const base = baseSnap();
  sync.noteLoaded(base);
  let bookCalls = 0;
  sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.startsWith("/api/e/")) return json({ ok: true, rev: 2, payload: body.payload, deleted: false });
    if (url.startsWith("/api/company")) {
      bookCalls += 1;
      if (bookCalls === 1) {
        return json({ ok: false, conflict: ["plans", "org"], applied: [], books: { org: { roles: { ...base.roles, ceo: { ...base.roles.ceo, name: "Chief" } } }, plans: {} }, bookGens: { org: 5, plans: 5, months: 1, targets: 1 } }, 409);
      }
      return json({ ok: true, applied: ["plans", "org"], conflict: [], skipped: [], bookGens: { org: 6, plans: 6, months: 1, targets: 1 }, notebookUpdatedAt: Date.now() });
    }
    return json({ ok: false }, 404);
  }) as typeof fetch);
  // An AGS edit: the ceo row saves, and the plans book (roleKrocs split) goes dirty.
  const ui = { ...base, roles: { ...base.roles, ceo: { ...base.roles.ceo, ags: { "1A": 40 } } } };
  const ack = await sync.save(ui);
  assert.equal(ack.ok, true);
  // Every book field is row-owned now: after the row save nothing is left for
  // a book PATCH (it used to send the whole plans book for the roleKrocs split).
  assert.equal(bookCalls, 0, "no book PATCH for a row-owned edit");
  const acked = sync.lastAckedBooks().org.roles as Record<string, Record<string, unknown>>;
  assert.equal(acked.ceo.name, "CEO", "baseline still what the screen has");
  assert.deepEqual(sync.collectEntityOps(ui).map((o) => o.url), [], "so the untouched name is not re-sent as an edit");
});
