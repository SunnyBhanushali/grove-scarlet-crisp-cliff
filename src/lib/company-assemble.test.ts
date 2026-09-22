import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  assembleForGet,
  overlayHotSlices,
  prepareBookPatch,
  stripRowOwnedFromBooks,
  normalizeRecordPayload,
  type HotSlices,
} from "./company-assemble.ts";
import { importHotTables, liveHotTableCounts, type HotSql } from "./company-hot-tables.ts";
import { applyBookPatches, peopleCount, type Snapshot } from "./company-books.ts";

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

async function openSql(): Promise<HotSql> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(migration);
  return {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
}

test("month-record object fields become arrays so Rewards Plans can .find", () => {
  const rec = normalizeRecordPayload({
    status: "plan_locked",
    rewardFlags: { dq: { kind: "disqualifier", on: true } },
    brands: {
      a: {
        id: "b1",
        kras: { k1: { id: "k1", kpis: { p: { id: "p1", name: "Hit", children: {} } } } },
      },
    },
    kras: {},
  });
  assert.equal(Array.isArray(rec.rewardFlags), true);
  assert.equal((rec.rewardFlags as unknown[]).length, 1);
  assert.equal(Array.isArray(rec.brands), true);
  assert.equal((rec.brands as unknown[]).length, 1);
  const brand0 = (rec.brands as Array<Record<string, unknown>>)[0];
  assert.equal(Array.isArray(brand0.kras), true);
  const kra0 = (brand0.kras as Array<Record<string, unknown>>)[0];
  assert.equal(Array.isArray(kra0.kpis), true);
  const kpi0 = (kra0.kpis as Array<Record<string, unknown>>)[0];
  assert.equal(Array.isArray(kpi0.children), true);
  assert.deepEqual(rec.kras, []);
  const empty = normalizeRecordPayload({ status: "draft" });
  assert.deepEqual(empty.rewardFlags, []);
  assert.deepEqual(empty.priorities, []);
});

test("GET assembled people count matches rows (seed)", async () => {
  const sql = await openSql();
  await importHotTables(sql, seed, { updatedBy: "test" });
  const counts = await liveHotTableCounts(sql);
  const { snapshot, meta } = await assembleForGet(sql, seed);
  assert.equal(meta.source, "rows");
  assert.equal(meta.rowPeople, counts.people);
  assert.equal(peopleCount(snapshot), counts.people);
  assert.equal(peopleCount(snapshot), peopleCount(seed));
});

test("entity-deleted person stays gone on GET even if the book still has them", async () => {
  const sql = await openSql();
  const snap: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p-gone"), person("p2")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
  await importHotTables(sql, snap, { updatedBy: "test" });
  await sql.query("update people set deleted_at = now() where id = $1", ["p-gone"]);
  const { snapshot, meta } = await assembleForGet(sql, snap);
  assert.equal(meta.source, "rows");
  const ids = (snapshot.people as { id: string }[]).map((p) => p.id).sort();
  assert.deepEqual(ids, ["p1", "p2"]);
  assert.equal(peopleCount(snap), 3);
});

test("empty hot tables import from books then assemble", async () => {
  const sql = await openSql();
  const { snapshot, meta } = await assembleForGet(sql, seed);
  assert.equal(meta.imported, true);
  assert.equal(meta.source, "rows");
  assert.equal(peopleCount(snapshot), peopleCount(seed));
});

test("PATCH /api/company strip ignores people / records / rewardRecords / targetCells", () => {
  const stored: Snapshot = {
    bookGens: { org: 4, plans: 1, months: 4, targets: 2 },
    people: [person("p1"), person("p2")],
    records: { "2026-04": { p1: { actual: 1 } } },
    rewardRecords: { "2026-04": { p1: { status: "draft" } } },
    targetCells: { "c1": { actual: 1 } },
    trash: [{ id: "old" }],
    roles: { r: { id: "r" } },
  };
  const incoming = prepareBookPatch(
    {
      org: {
        people: [person("p1")],
        trash: [],
        roles: { r: { id: "r" }, n: { id: "n" } },
      },
      months: {
        records: { "2026-04": { p1: { actual: 99 } } },
        rewardRecords: { "2026-04": { p1: { status: "plan_locked" } } },
        roleMonths: { "2026-04": { r: { closed: true } } },
      },
      targets: { targetCells: { c1: { actual: 9 } }, targetNodes: { n: { id: "n" } } },
    },
    stored,
  );
  assert.equal("people" in (incoming.org || {}), false);
  assert.equal("people" in (stripRowOwnedFromBooks({ org: { people: [person("p1")], trash: [] } }).org || {}), false);
  const result = applyBookPatches(stored, incoming, { org: 4, months: 4, targets: 2 });
  assert.equal((result.snapshot.people as { id: string }[]).length, 2);
  assert.equal(
    (result.snapshot.records as Record<string, Record<string, { actual?: number }>>)["2026-04"].p1.actual,
    1,
  );
  assert.equal(
    (result.snapshot.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-04"].p1
      .status,
    "draft",
  );
  assert.equal((result.snapshot.targetCells as { c1?: { actual?: number } }).c1?.actual, 1);
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
  assert.ok((result.snapshot.roles as Record<string, unknown>).n);
});

test("empty-trash org PATCH cannot resurrect a row-deleted person on overlay", () => {
  const book: Snapshot = {
    people: [person("p1"), person("p-gone")],
    trash: [],
  };
  const slices: HotSlices = {
    people: [person("p1")],
    records: {},
    rewardRecords: {},
    targetCells: {},
    peopleCount: 1,
    monthCount: 0,
    rewardCount: 0,
    cellCount: 0,
  };
  const got = overlayHotSlices(book, slices);
  const ids = (got.people as { id: string }[]).map((p) => p.id);
  assert.deepEqual(ids, ["p1"]);
});
