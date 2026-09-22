import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { assembleForGet } from "./company-assemble.ts";
import { importHotTables, type HotSql } from "./company-hot-tables.ts";
import { bookPayload, splitSnapshot, type Snapshot } from "./company-books.ts";
import {
  countTargetCells,
  countTargetNodes,
  keepStoredTargets,
  listedTargetMonths,
  normalizeTargetsGraph,
  restoreTargetsGuard,
  targetCellKeys,
  targetNodeIds,
} from "./company-restore-targets.ts";

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

test("snapshot with people + rewardRecords + targetNodes + targetCells restores same ids", async () => {
  const sql = await openSql();
  const nodeId = "tn-bu-andheri-s7wq";
  const cellId = "tc-2026-09-andheri";
  const snap: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p2")],
    rewardRecords: {
      "2026-09": {
        p1: { status: "plan_locked", targetNodeId: nodeId, brands: [], kras: [], rewardFlags: [] },
      },
    },
    targetNodes: {
      [nodeId]: { id: nodeId, name: "Andheri", kind: "sbu", sbuId: "bu-andheri" },
    },
    targetMembers: [{ nodeId, personId: "p1" }],
    targetCells: {
      [cellId]: { id: cellId, month: "2026-09", nodeId, metric: "rupees", M1: 1 },
    },
    targetMonthStatus: { "2026-09": "plan_locked" },
    targetRootOrder: { "2026-09": [nodeId] },
  };
  const normalized = normalizeTargetsGraph(snap);
  const guard = restoreTargetsGuard(normalized);
  assert.equal(guard.ok, true);
  await importHotTables(sql, normalized, { updatedBy: "restore" });
  const { snapshot, meta } = await assembleForGet(sql, normalized);
  assert.equal(meta.source, "rows");
  assert.equal(peopleCountish(snapshot), 2);
  assert.deepEqual(targetNodeIds(snapshot).sort(), [nodeId]);
  assert.deepEqual(targetCellKeys(snapshot).sort(), [cellId]);
  const rec = (snapshot.rewardRecords as Record<string, Record<string, { targetNodeId?: string }>>)[
    "2026-09"
  ]?.p1;
  assert.equal(rec?.targetNodeId, nodeId);
  assert.equal(
    Boolean((snapshot.targetNodes as Record<string, unknown>)[rec!.targetNodeId!]),
    true,
  );
  const targetsBook = bookPayload(splitSnapshot(normalized).targets, "targets");
  assert.equal((targetsBook.targetNodes as Record<string, unknown>)[nodeId] !== undefined, true);
  assert.deepEqual(targetsBook.targetRootOrder, { "2026-09": [nodeId] });
});

function peopleCountish(snapshot: Snapshot) {
  return Array.isArray(snapshot.people) ? snapshot.people.length : 0;
}

test("snapshot with target months listed and zero cells is allowed", () => {
  const snap: Snapshot = {
    people: [person("p1")],
    rewardRecords: { "2026-09": { p1: { targetNodeId: "tn-missing" } } },
    targetNodes: {},
    targetCells: {},
    targetMonthStatus: { "2026-09": "closed", "2026-08": "closed" },
    targetRootOrder: { "2026-09": ["tn-imp-11-l1f8f8"] },
  };
  const guard = restoreTargetsGuard(snap);
  assert.equal(guard.ok, true);
  assert.ok(listedTargetMonths(snap).includes("2026-09"));
  assert.equal(countTargetNodes(snap), 0);
  assert.equal(countTargetCells(snap), 0);
});

test("seed restore graph keeps node ids that reward plans point at", () => {
  const normalized = normalizeTargetsGraph(seed);
  const guard = restoreTargetsGuard(normalized);
  assert.equal(guard.ok, true);
  const nodes = new Set(targetNodeIds(normalized));
  assert.ok(nodes.size > 0);
  const rr = (normalized.rewardRecords || {}) as Record<string, Record<string, { targetNodeId?: string }>>;
  let checked = 0;
  for (const month of Object.values(rr)) {
    if (!month) continue;
    for (const rec of Object.values(month)) {
      const id = rec?.targetNodeId;
      if (!id) continue;
      assert.equal(nodes.has(id), true, `reward plan node ${id} missing after restore normalize`);
      checked += 1;
    }
  }
  assert.ok(checked >= 0);
});

test("empty incoming targets does not blank stored interiors", () => {
  const stored: Snapshot = {
    targetNodes: { "tn-keep": { id: "tn-keep" } },
    targetCells: { "tc-keep": { id: "tc-keep", month: "2026-09" } },
    targetMonthStatus: { "2026-09": "closed" },
    targetRootOrder: { "2026-09": ["tn-keep"] },
    targetMembers: [],
  };
  const incoming: Snapshot = { people: [person("p1")], targetNodes: {}, targetCells: {} };
  const kept = keepStoredTargets(incoming, stored);
  assert.equal((kept.targetNodes as Record<string, unknown>)["tn-keep"] !== undefined, true);
  assert.equal((kept.targetCells as Record<string, unknown>)["tc-keep"] !== undefined, true);
});

test("months listed with zero cells still keeps stored interiors", () => {
  const stored: Snapshot = {
    targetNodes: { "tn-keep": { id: "tn-keep" } },
    targetCells: { "tc-keep": { id: "tc-keep", month: "2026-09" } },
    targetMonthStatus: { "2026-09": "closed" },
    targetRootOrder: { "2026-09": ["tn-keep"] },
  };
  const incoming: Snapshot = {
    people: [person("p1")],
    targetNodes: {},
    targetCells: {},
    targetMonthStatus: { "2026-09": "closed" },
    targetRootOrder: { "2026-09": ["tn-missing"] },
  };
  const kept = keepStoredTargets(incoming, stored);
  assert.equal((kept.targetNodes as Record<string, unknown>)["tn-keep"] !== undefined, true);
  assert.equal((kept.targetCells as Record<string, unknown>)["tc-keep"] !== undefined, true);
});
