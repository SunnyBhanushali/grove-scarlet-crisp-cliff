import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  countFromSnapshot,
  flattenPeople,
  flattenPersonPeriodMap,
  flattenTargetCells,
  flattenTombstones,
  importHotTables,
  liveHotTableCounts,
  rememberWriteId,
  dualWriteAfterPatch,
  type HotSql,
} from "./company-hot-tables.ts";
import { applyBookPatches, type Snapshot } from "./company-books.ts";

const seed = JSON.parse(
  readFileSync(new URL("./company-seed.json", import.meta.url), "utf8"),
) as Snapshot;
const migration = readFileSync(
  new URL("../../migrations/0005_hot_tables.sql", import.meta.url),
  "utf8",
);

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}

function fixture(): Snapshot {
  return {
    people: [person("p1"), person("p2"), person("p3")],
    records: {
      "2026-04": { p1: { status: "draft", updatedAt: 1 }, p2: { status: "draft", updatedAt: 1 } },
    },
    rewardRecords: {
      "2026-04": { p1: { status: "plan_locked", updatedAt: 2 } },
      "2026-05": { p3: { status: "draft", updatedAt: 3 } },
    },
    targetCells: {
      "tn-a::2026-05": { nodeId: "tn-a", month: "2026-05", actual: 10 },
      "tn-b::2026-05": { nodeId: "tn-b", month: "2026-05", actual: 20 },
    },
    tombstones: { people: { "p-gone": 100 }, trash: { "id:old": 90 } },
  };
}

async function openSql(): Promise<{ sql: HotSql; pg: PGlite }> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(migration);
  const sql: HotSql = {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  return { sql, pg };
}

test("flatten helpers match nested book maps", () => {
  const snap = fixture();
  assert.equal(flattenPeople(snap.people).length, 3);
  assert.equal(flattenPersonPeriodMap(snap.records).length, 2);
  assert.equal(flattenPersonPeriodMap(snap.rewardRecords).length, 2);
  assert.equal(flattenTargetCells(snap.targetCells).length, 2);
  assert.equal(flattenTombstones(snap.tombstones).length, 2);
  assert.deepEqual(countFromSnapshot(snap), {
    people: 3,
    monthRecords: 2,
    rewardRecords: 2,
    targetCells: 2,
    tombstones: 2,
  });
});

test("seed snapshot counts are stable", () => {
  const counts = countFromSnapshot(seed);
  assert.equal(counts.people, 180);
  assert.equal(counts.monthRecords, 53);
  assert.equal(counts.rewardRecords, 49);
  assert.equal(counts.targetCells, 114);
  assert.equal(flattenPeople(seed.people).every((p) => p.id), true);
});

test("importer fills hot tables to match book counts", async () => {
  const { sql } = await openSql();
  const snap = fixture();
  const expected = countFromSnapshot(snap);
  const first = await importHotTables(sql, snap);
  assert.deepEqual(first, expected);
  const live = await liveHotTableCounts(sql);
  assert.deepEqual(live, expected);
});

test("importer is safe to run twice (same live counts, no hard delete)", async () => {
  const { sql } = await openSql();
  const snap = fixture();
  await importHotTables(sql, snap);
  const second = await importHotTables(sql, snap);
  assert.deepEqual(second, countFromSnapshot(snap));
  const revs = await sql.query<{ rev: number }>("select rev from people where id = $1", ["p1"]);
  assert.equal(Number(revs[0]?.rev), 1);
  const allPeople = await sql.query<{ n: number }>("select count(*)::int as n from people");
  assert.equal(Number(allPeople[0]?.n), 3);
});

test("missing people / cells / records are tombstoned, not hard-deleted", async () => {
  const { sql } = await openSql();
  await importHotTables(sql, fixture());
  const next: Snapshot = {
    people: [person("p1"), person("p2")],
    records: {
      "2026-04": { p1: { status: "draft", updatedAt: 1 } },
    },
    rewardRecords: {
      "2026-04": { p1: { status: "plan_locked", updatedAt: 2 } },
    },
    targetCells: {
      "tn-a::2026-05": { nodeId: "tn-a", month: "2026-05", actual: 10 },
    },
    tombstones: { people: { "p-gone": 100 }, trash: { "id:old": 90 } },
  };
  const live = await importHotTables(sql, next);
  assert.deepEqual(live, countFromSnapshot(next));
  const gone = await sql.query<{ deleted_at: string | null }>(
    "select deleted_at from people where id = $1",
    ["p3"],
  );
  assert.ok(gone[0]?.deleted_at, "p3 must keep a row with deleted_at");
  const goneMonth = await sql.query<{ deleted_at: string | null }>(
    "select deleted_at from month_records where person_id = $1 and period = $2",
    ["p2", "2026-04"],
  );
  assert.ok(goneMonth[0]?.deleted_at);
  const goneCell = await sql.query<{ deleted_at: string | null }>(
    "select deleted_at from target_cells where id = $1",
    ["tn-b::2026-05"],
  );
  assert.ok(goneCell[0]?.deleted_at);
  const totalPeople = await sql.query<{ n: number }>("select count(*)::int as n from people");
  assert.equal(Number(totalPeople[0]?.n), 3);
});

test("re-importing a deleted person clears deleted_at", async () => {
  const { sql } = await openSql();
  await importHotTables(sql, fixture());
  await importHotTables(sql, { people: [person("p1")], records: {}, rewardRecords: {}, targetCells: {} });
  const again = await importHotTables(sql, fixture());
  assert.equal(again.people, 3);
  const row = await sql.query<{ deleted_at: string | null; rev: number }>(
    "select deleted_at, rev from people where id = $1",
    ["p3"],
  );
  assert.equal(row[0]?.deleted_at, null);
  assert.ok(Number(row[0]?.rev) >= 2);
});

test("write_ids records client_op_id once and never deletes", async () => {
  const { sql } = await openSql();
  await rememberWriteId(sql, "op-abc", { books: ["org"] });
  await rememberWriteId(sql, "op-abc", { books: ["months"] });
  const rows = await sql.query<{ client_op_id: string }>("select client_op_id from write_ids");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.client_op_id, "op-abc");
});

test("importer matches seed people / records / rewardRecords / targetCells", async () => {
  const { sql } = await openSql();
  const expected = countFromSnapshot(seed);
  const live = await importHotTables(sql, seed, { updatedBy: "test-seed" });
  assert.deepEqual(live, expected);
  const twice = await importHotTables(sql, seed, { updatedBy: "test-seed" });
  assert.deepEqual(twice, expected);
});

const PATCH_GENS = { org: 1, plans: 1, months: 1, targets: 1 };

function storedForPatch(extra: Snapshot = {}): Snapshot {
  return {
    bookGens: { ...PATCH_GENS },
    people: [person("p1"), person("p2")],
    records: {},
    rewardRecords: {
      "2026-04": { p2: { status: "draft", updatedAt: 1 } },
    },
    targetCells: {},
    ...extra,
  };
}

function rewardSlice(personId: string, rec: Record<string, unknown>) {
  return { months: { rewardRecords: { "2026-04": { [personId]: rec } } } };
}

async function rewardRev(sql: HotSql, personId: string, period = "2026-04") {
  const rows = await sql.query<{ rev: number }>(
    "select rev from reward_records where person_id = $1 and period = $2",
    [personId, period],
  );
  return rows[0] ? Number(rows[0].rev) : null;
}

test("PATCH one reward person-month → row rev=1; PATCH again → rev=2", async () => {
  const { sql } = await openSql();
  const stored = storedForPatch();
  const firstIncoming = rewardSlice("p1", { status: "plan_locked", updatedAt: 10 });
  const first = applyBookPatches(stored, firstIncoming, { months: 1 });
  assert.deepEqual(first.applied, ["months"]);
  const dw1 = await dualWriteAfterPatch(sql, first, firstIncoming, { clientOpId: "op-reward-1" });
  assert.equal(dw1.wrote, true);
  assert.equal(await rewardRev(sql, "p1"), 1);

  const secondIncoming = rewardSlice("p1", { status: "paid", updatedAt: 20 });
  const second = applyBookPatches(first.snapshot, secondIncoming, { months: 2 });
  assert.deepEqual(second.applied, ["months"]);
  const dw2 = await dualWriteAfterPatch(sql, second, secondIncoming, { clientOpId: "op-reward-2" });
  assert.equal(dw2.wrote, true);
  assert.equal(await rewardRev(sql, "p1"), 2);

  const p2 = await sql.query<{ deleted_at: string | null }>(
    "select deleted_at from reward_records where person_id = $1 and period = $2",
    ["p2", "2026-04"],
  );
  assert.equal(p2.length, 0, "missing PATCH key must not create or delete the omitted person");
});

test("409 book apply → row rev unchanged", async () => {
  const { sql } = await openSql();
  const stored = storedForPatch();
  const incoming = rewardSlice("p1", { status: "plan_locked", updatedAt: 10 });
  const ok = applyBookPatches(stored, incoming, { months: 1 });
  await dualWriteAfterPatch(sql, ok, incoming, { clientOpId: "op-ok" });
  assert.equal(await rewardRev(sql, "p1"), 1);

  const staleIncoming = rewardSlice("p1", { status: "paid", updatedAt: 99 });
  const stale = applyBookPatches(ok.snapshot, staleIncoming, { months: 1 });
  assert.ok(stale.conflict.includes("months"));
  assert.equal(stale.applied.length, 0);
  const dw = await dualWriteAfterPatch(sql, stale, staleIncoming, { clientOpId: "op-stale" });
  assert.equal(dw.wrote, false);
  assert.equal(dw.skipped, true);
  assert.equal(await rewardRev(sql, "p1"), 1);

  const payload = await sql.query<{ payload: { status?: string } }>(
    "select payload from reward_records where person_id = $1 and period = $2",
    ["p1", "2026-04"],
  );
  const status =
    payload[0]?.payload && typeof payload[0].payload === "object"
      ? (payload[0].payload as { status?: string }).status
      : undefined;
  assert.equal(status, "plan_locked");
});

test("retry same clientOpId → rev unchanged", async () => {
  const { sql } = await openSql();
  const stored = storedForPatch();
  const incoming = rewardSlice("p1", { status: "plan_locked", updatedAt: 10 });
  const first = applyBookPatches(stored, incoming, { months: 1 });
  await dualWriteAfterPatch(sql, first, incoming, { clientOpId: "op-retry" });
  assert.equal(await rewardRev(sql, "p1"), 1);

  const againIncoming = rewardSlice("p1", { status: "paid", updatedAt: 20 });
  const again = applyBookPatches(first.snapshot, againIncoming, { months: 2 });
  const dw = await dualWriteAfterPatch(sql, again, againIncoming, { clientOpId: "op-retry" });
  assert.equal(dw.wrote, false);
  assert.equal(dw.skipped, true);
  assert.equal(await rewardRev(sql, "p1"), 1);
});
