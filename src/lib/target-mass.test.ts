import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  applyMassField,
  allowedMassFields,
  massActionEnabled,
  massEntityUrl,
  monthUnlockGroups,
  monthUnlockNodes,
  summarizeMassResults,
} from "./target-mass.ts";
import { getEntity, memoryEntityBooks, patchEntity } from "./company-entities.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

const migration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");

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

function stored(people: string[]): Snapshot {
  return {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: people.map((id) => person(id)),
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
}

test("select none → mass action disabled", () => {
  assert.equal(massActionEnabled([]), false);
  assert.equal(massActionEnabled(["p1"]), true);
  assert.deepEqual(allowedMassFields("rewards"), ["targetNodeId"]);
  assert.deepEqual(allowedMassFields("apms"), []);
});

test("mass update 5 people targetNodeId → GET shows new id", async () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const sql = await openSql();
  const books = memoryEntityBooks(stored(ids));
  const node = { id: "tn-goa", sbuId: "bu-goa", metric: "rupees" };
  for (const id of ids) {
    const key = { table: "reward_records" as const, period: "2026-04", personId: id };
    const first = await patchEntity(
      sql,
      key,
      { payload: { status: "plan_open", targetNodeId: "tn-old", heldRoleId: "role-a" }, baseRev: 0, clientOpId: `seed-${id}` },
      books,
    );
    assert.equal(first.status, 200);
    const payload = applyMassField(first.body.payload as Record<string, unknown>, "targetNodeId", node.id, { node });
    const next = await patchEntity(
      sql,
      key,
      { payload, baseRev: Number(first.body.rev), clientOpId: `mass-${id}` },
      books,
    );
    assert.equal(next.status, 200, id);
  }
  for (const id of ids) {
    const got = await getEntity(sql, { table: "reward_records", period: "2026-04", personId: id }, books);
    assert.equal(got.status, 200);
    assert.equal((got.body.payload as { targetNodeId?: string }).targetNodeId, "tn-goa");
    assert.equal((got.body.payload as { targetSbuId?: string }).targetSbuId, "bu-goa");
  }
});

test("one stale rev → 4 updated, 1 409", async () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const sql = await openSql();
  const books = memoryEntityBooks(stored(ids));
  const revs: Record<string, number> = {};
  for (const id of ids) {
    const key = { table: "reward_records" as const, period: "2026-04", personId: id };
    const first = await patchEntity(
      sql,
      key,
      { payload: { status: "plan_open", targetNodeId: "tn-old" }, baseRev: 0, clientOpId: `seed-${id}` },
      books,
    );
    assert.equal(first.status, 200);
    revs[id] = Number(first.body.rev);
  }
  await patchEntity(
    sql,
    { table: "reward_records", period: "2026-04", personId: "p3" },
    { payload: { status: "plan_open", targetNodeId: "tn-other" }, baseRev: revs.p3, clientOpId: "other-p3" },
    books,
  );
  const results: { status: number; personId: string }[] = [];
  for (const id of ids) {
    const key = { table: "reward_records" as const, period: "2026-04", personId: id };
    const rec = await getEntity(sql, key, books);
    const payload = applyMassField(rec.body.payload as Record<string, unknown>, "targetNodeId", "tn-goa", {
      node: { id: "tn-goa", sbuId: "bu-goa", metric: "rupees" },
    });
    const next = await patchEntity(
      sql,
      key,
      { payload, baseRev: revs[id], clientOpId: `mass-${id}` },
      books,
    );
    results.push({ status: next.status, personId: id });
  }
  const sum = summarizeMassResults(results);
  assert.equal(sum.updated, 4);
  assert.equal(sum.stale, 1);
  assert.equal(sum.failed, 0);
  assert.deepEqual(sum.staleIds, ["p3"]);
  assert.equal(sum.message, "4 updated, 1 stale (409), 0 failed.");
  const p3 = await getEntity(sql, { table: "reward_records", period: "2026-04", personId: "p3" }, books);
  assert.equal((p3.body.payload as { targetNodeId?: string }).targetNodeId, "tn-other");
});

test("mass entity URL and held-role field stay on existing controls", () => {
  assert.equal(massEntityUrl("rewards", "2026-04", "p1"), "/api/reward-records/2026-04/p1");
  assert.equal(massEntityUrl("apms", "2026-04", "p1"), "/api/month-records/2026-04/p1");
  const rec = applyMassField({ status: "plan_open", kras: [1] }, "heldRoleId", "role-b", {
    role: { id: "role-b", name: "Studio head" },
  });
  assert.equal(rec.heldRoleId, "role-b");
  assert.equal(rec.heldRoleName, "Studio head");
  assert.deepEqual(rec.kras, [1]);
});

test("SPA ships massPatch, no fallbackPost, import confirm copy", () => {
  const routes = readFileSync(new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url), "utf8");
  const sync = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(sync.includes("fallbackPost"), false);
  assert.match(sync, /function massPatch/);
  assert.match(sync, /p0as60/);
  assert.equal(routes.includes("this would unmap"), false);
  assert.match(routes, /Apply anyway/);
  assert.match(routes, /unmappedRows/);
  assert.match(routes, /needsConfirm/);
  assert.match(routes, /will stay unmapped/);
  assert.match(routes, /findReusableNode/);
  assert.match(routes, /Mass update/);
  assert.match(routes, /Unlock against/);
  assert.match(routes, /canMass:t&&massOn===r/);
  assert.match(routes, /setMassOn\(r\)/);
  assert.match(routes, /data-mass-unlock/);
  assert.match(routes, /label:`Groups`/);
  assert.match(routes, /label:`Studios`/);
  assert.match(routes, /No targets for /);
  assert.equal(routes.includes("children:[`Field`"), false);
  assert.match(routes, /i\.kind===`rewards`&&t&&i\.hasAccessFlag\(`mass_rewards`\)&&\(0,Q\.jsx\)\(z,\{size:`sm`,variant:`outline`,disabled:massOn===r/);
});

test("Unlock against is this month's targets only", () => {
  const state = {
    targetNodes: {
      a: { id: "a", name: "Goa", kind: "leaf", sbuId: "bu-goa" },
      b: { id: "b", name: "West", kind: "group", sbuId: null },
      c: { id: "c", name: "Old", kind: "leaf", sbuId: "bu-old" },
    },
    targetCells: {
      "a::2026-09": { nodeId: "a", month: "2026-09" },
      "b::2026-09": { nodeId: "b", month: "2026-09" },
      "c::2026-04": { nodeId: "c", month: "2026-04" },
    },
    targetMembers: [{ month: "2026-09", groupId: "b", memberId: "a" }],
    targetRootOrder: { "2026-09": ["b"] },
  };
  const nodes = monthUnlockNodes(state, "2026-09");
  assert.deepEqual(nodes.map((n) => n.id).sort(), ["a", "b"]);
  const g = monthUnlockGroups(nodes);
  assert.deepEqual(g.groups.map((n) => n.id), ["b"]);
  assert.deepEqual(g.studios.map((n) => n.id), ["a"]);
  assert.equal(monthUnlockNodes(state, "2026-04").map((n) => n.id).join(), "c");
});
