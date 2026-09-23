import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openTestDb } from "./test-db.ts";
import {
  changesSince,
  ensureEntitiesFromBooks,
  entityIdFromParts,
  importEntitiesFromSnapshot,
  latestSeq,
  listEntities,
  loadEntityFields,
  patchEntityRow,
  readEntity,
  resetEntityImportForTests,
} from "./company-entity-store.ts";
import { collections } from "./apms-collections.ts";
import type { HotSql } from "./company-hot-tables.ts";

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

const seed = JSON.parse(readFileSync(new URL("./company-seed.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("collections: every seed field round-trips through toRows/fromRows", () => {
  for (const spec of collections.SPECS) {
    const value = seed[spec.field];
    if (value === undefined) continue;
    const skipped: Array<{ field: string; index: number }> = [];
    const rows = collections.toRows(spec, value, skipped);
    assert.equal(skipped.length, 0, `${spec.field} skipped ${JSON.stringify(skipped)}`);
    const back = collections.fromRows(spec, rows);
    if (spec.shape === "list") {
      // order may differ for lists without ids; compare as sets of JSON
      const a = (value as unknown[]).map((v) => JSON.stringify(v)).sort();
      const b = (back as unknown[]).map((v) => JSON.stringify(v)).sort();
      assert.deepEqual(b, a, spec.field);
    } else if (spec.shape === "map2") {
      // An outer key with an empty inner map holds no rows; that is by design.
      const expected: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        if (v && typeof v === "object" && Object.keys(v).length) expected[k] = v;
      }
      assert.deepEqual(back, expected, spec.field);
    } else {
      assert.deepEqual(back, value, spec.field);
    }
  }
});

test("collections: applyRow edits, adds and deletes across shapes", () => {
  const list = collections.specForKind("brands")!;
  let brands: unknown = [{ id: "b1", name: "A" }, { id: "b2", name: "B" }];
  brands = collections.applyRow(list, brands, { kind: "brands", id: "b2", k1: "b2", k2: null, payload: { id: "b2", name: "B2" } }, false);
  brands = collections.applyRow(list, brands, { kind: "brands", id: "b3", k1: "b3", k2: null, payload: { id: "b3", name: "C" } }, false);
  brands = collections.applyRow(list, brands, { kind: "brands", id: "b1", k1: "b1", k2: null, payload: {} }, true);
  assert.deepEqual(brands, [{ id: "b2", name: "B2" }, { id: "b3", name: "C" }]);

  const map2 = collections.specForKind("role-months")!;
  let rm: unknown = { r1: { "2026-01": { status: "open" } } };
  rm = collections.applyRow(map2, rm, { kind: "role-months", id: "r1\u001f2026-02", k1: "r1", k2: "2026-02", payload: { status: "locked" } }, false);
  rm = collections.applyRow(map2, rm, { kind: "role-months", id: "r1\u001f2026-01", k1: "r1", k2: "2026-01", payload: {} }, true);
  assert.deepEqual(rm, { r1: { "2026-02": { status: "locked" } } });

  const scalar = collections.settingsSpec("companyFactor")!;
  assert.equal(collections.applyRow(scalar, 1, { kind: "settings", id: "companyFactor", k1: "companyFactor", k2: null, payload: { value: 1.2 } }, false), 1.2);

  const status = collections.specForKind("target-month-status")!;
  const s = collections.applyRow(status, { "2026-05": "open" }, { kind: "target-month-status", id: "2026-06", k1: "2026-06", k2: null, payload: { value: "closed" } }, false);
  assert.deepEqual(s, { "2026-05": "open", "2026-06": "closed" });
});

test("store: import from books, then assemble the same fields back", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const imported = await ensureEntitiesFromBooks(sql, async () => seed);
    assert.equal(imported, true);
    assert.equal(await ensureEntitiesFromBooks(sql, async () => seed), false, "second call is a no-op");
    const fields = await loadEntityFields(sql);
    assert.equal((fields.roles as Record<string, unknown>)["ceo"] !== undefined, true);
    assert.equal((fields.kpiMaster as unknown[]).length, (seed.kpiMaster as unknown[]).length);
    assert.deepEqual(fields.targetRootOrder, seed.targetRootOrder);
    assert.deepEqual(fields.roleMonths, seed.roleMonths);
    assert.equal(fields.companyFactor, seed.companyFactor);
    assert.equal((fields.notices as unknown[]).length, (seed.notices as unknown[]).length);
  } finally {
    db.end();
  }
});

test("store: two users editing different roles both keep their edit", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { roles: { ceo: { id: "ceo", name: "CEO", band: 1 }, cto: { id: "cto", name: "CTO", band: 1 } } }, "seed");
    const ceo = entityIdFromParts("roles", "ceo");
    const cto = entityIdFromParts("roles", "cto");
    const [a, b] = await Promise.all([
      patchEntityRow(sql, ceo, { baseRev: 1, payload: { id: "ceo", name: "Chief Exec", band: 1 } }, "userA"),
      patchEntityRow(sql, cto, { baseRev: 1, payload: { id: "cto", name: "CTO", band: 2 } }, "userB"),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const fields = await loadEntityFields(sql);
    const roles = fields.roles as Record<string, Record<string, unknown>>;
    assert.equal(roles.ceo.name, "Chief Exec");
    assert.equal(roles.cto.band, 2);
  } finally {
    db.end();
  }
});

test("store: same row, two writers → exactly one 200 and one 409 carrying the winner", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { roles: { ceo: { id: "ceo", name: "CEO" } } }, "seed");
    const key = entityIdFromParts("roles", "ceo");
    const results = await Promise.all([
      patchEntityRow(sql, key, { baseRev: 1, payload: { id: "ceo", name: "from A" } }, "A"),
      patchEntityRow(sql, key, { baseRev: 1, payload: { id: "ceo", name: "from B" } }, "B"),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    const winner = results.find((r) => r.status === 200)!;
    assert.equal(loser.body.rev, 2, "409 carries the current rev");
    assert.deepEqual(loser.body.payload, winner.body.payload, "409 carries the winner's payload");
    // Loser rebases and retries with the new rev → wins.
    const retry = await patchEntityRow(sql, key, { baseRev: 2, payload: { id: "ceo", name: "merged" } }, "B");
    assert.equal(retry.status, 200);
    assert.equal(retry.body.rev, 3);
  } finally {
    db.end();
  }
});

test("store: a stale client cannot resurrect a deleted row", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { notices: [{ id: "n1", title: "Hello" }] }, "seed");
    const key = entityIdFromParts("notices", "n1");
    const del = await patchEntityRow(sql, key, { baseRev: 1, deleted: true }, "A");
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, true);
    // B still holds rev 1 and tries to "save" the row it still sees.
    const stale = await patchEntityRow(sql, key, { baseRev: 1, payload: { id: "n1", title: "Hello edited" } }, "B");
    assert.equal(stale.status, 409);
    assert.equal(stale.body.deleted, true, "409 tells B the row is gone");
    const fields = await loadEntityFields(sql);
    assert.deepEqual(fields.notices, [], "row stays deleted in the assembled snapshot");
    // baseRev 0 (a client that simply does not know the rev) is refused too…
    const blind = await patchEntityRow(sql, key, { baseRev: 0, payload: { id: "n1", title: "Blind" } }, "C");
    assert.equal(blind.status, 409);
    assert.equal(blind.body.deleted, true);
    // …re-creating means acknowledging the tombstone's rev.
    const recreate = await patchEntityRow(sql, key, { baseRev: Number(blind.body.rev), payload: { id: "n1", title: "New again" } }, "C");
    assert.equal(recreate.status, 200);
    assert.equal(recreate.body.deleted, false);
  } finally {
    db.end();
  }
});

test("store: three screens raising the same month reminder keep one notice", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { notices: [] }, "seed");
    const reminder = { kind: "month_close_due", planKind: "rewards", month: "2026-08", phase: "close", status: "open", title: "Close August 2026 Rewards", toIds: ["p9"] };
    const results = await Promise.all(
      ["na", "nb", "nc"].map((id, i) =>
        patchEntityRow(sql, entityIdFromParts("notices", id), { baseRev: 0, payload: { ...reminder, id } }, `user-${i}`),
      ),
    );
    for (const r of results) assert.equal(r.status, 200);
    assert.equal(results.filter((r) => r.body.deleted === false).length, 1, "exactly one create stays live");
    const fields = await loadEntityFields(sql);
    assert.equal((fields.notices as unknown[]).length, 1);
    // A different recipient or month, or a person-typed notice, is not a duplicate.
    const otherTo = await patchEntityRow(sql, entityIdFromParts("notices", "nf"), { baseRev: 0, payload: { ...reminder, id: "nf", toIds: ["p8"] } }, "A");
    assert.equal(otherTo.body.deleted, false);
    const other = await patchEntityRow(sql, entityIdFromParts("notices", "nd"), { baseRev: 0, payload: { ...reminder, id: "nd", month: "2026-09" } }, "A");
    assert.equal(other.body.deleted, false);
    const typed = await patchEntityRow(sql, entityIdFromParts("notices", "ne"), { baseRev: 0, payload: { id: "ne", kind: "note", title: "Close August 2026 Rewards", month: "2026-08" } }, "A");
    assert.equal(typed.body.deleted, false);
  } finally {
    db.end();
  }
});

test("store: change feed lists every commit after a cursor, in order", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { brands: [] }, "seed");
    const start = await latestSeq(sql);
    await patchEntityRow(sql, entityIdFromParts("brands", "b1"), { baseRev: 0, payload: { id: "b1", name: "One" } }, "A");
    await patchEntityRow(sql, entityIdFromParts("brands", "b2"), { baseRev: 0, payload: { id: "b2", name: "Two" } }, "B");
    await patchEntityRow(sql, entityIdFromParts("brands", "b1"), { baseRev: 1, deleted: true }, "A");
    const changes = await changesSince(sql, start);
    assert.deepEqual(
      changes.map((c) => [c.kind, c.id, c.rev, c.deleted]),
      [
        ["brands", "b1", 1, false],
        ["brands", "b2", 1, false],
        ["brands", "b1", 2, true],
      ],
    );
    const tail = await changesSince(sql, changes[1].seq);
    assert.equal(tail.length, 1);
    assert.equal(tail[0].deleted, true);
  } finally {
    db.end();
  }
});

test("store: map2 keys round-trip through the URL parts", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const key = entityIdFromParts("role-months", "role-1", "2026-09");
    assert.equal(key.k1, "role-1");
    assert.equal(key.k2, "2026-09");
    const res = await patchEntityRow(sql, key, { baseRev: 0, payload: { status: "plan_open" } }, "A");
    assert.equal(res.status, 200);
    const row = await readEntity(sql, key);
    assert.equal(row?.k2, "2026-09");
    const fields = await loadEntityFields(sql);
    assert.deepEqual(fields.roleMonths, { "role-1": { "2026-09": { status: "plan_open" } } });
    assert.equal((await listEntities(sql, "role-months", { k1: "role-1" })).length, 1);
  } finally {
    db.end();
  }
});

test("store: replayed clientOpId is idempotent", skip, async () => {
  const { sql, db } = await openSql();
  try {
    const key = entityIdFromParts("brands", "b1");
    const first = await patchEntityRow(sql, key, { baseRev: 0, payload: { id: "b1", name: "One" }, clientOpId: "op-1" }, "A");
    const again = await patchEntityRow(sql, key, { baseRev: 0, payload: { id: "b1", name: "One" }, clientOpId: "op-1" }, "A");
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.rev, 1);
  } finally {
    db.end();
  }
});

test("store: restore import prunes rows the file no longer has and bumps revs", skip, async () => {
  const { sql, db } = await openSql();
  try {
    await importEntitiesFromSnapshot(sql, { brands: [{ id: "b1", name: "One" }, { id: "b2", name: "Two" }] }, "seed");
    const result = await importEntitiesFromSnapshot(sql, { brands: [{ id: "b1", name: "One!" }] }, "restore", { pruneMissing: true });
    assert.equal(result.pruned, 1);
    const fields = await loadEntityFields(sql);
    assert.deepEqual(fields.brands, [{ id: "b1", name: "One!" }]);
    const b1 = await readEntity(sql, entityIdFromParts("brands", "b1"));
    assert.equal(b1?.rev, 2, "changed row bumped");
    const stale = await patchEntityRow(sql, entityIdFromParts("brands", "b1"), { baseRev: 1, payload: { id: "b1", name: "old" } }, "A");
    assert.equal(stale.status, 409);
  } finally {
    db.end();
  }
});
