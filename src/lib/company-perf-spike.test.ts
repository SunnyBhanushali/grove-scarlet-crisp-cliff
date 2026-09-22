import assert from "node:assert/strict";
import test from "node:test";
import { lastAssembleMeta } from "./company-assemble.ts";
import {
  awaitWireIdleForTests,
  encodeCompanyWire,
  getCompanyWire,
  patchCompanyWireEntity,
  peekCompanyWire,
  resetWireForTests,
  setCompanyWireForTests,
  setWireBuildForTests,
  softInvalidateCompanyWire,
  WIRE_GZIP_LEVEL,
  wireAssembleCalls,
  type CompanyWire,
} from "./company-wire-cache.ts";
import { publishEntityWrite } from "./company-live.ts";
import { slimForWire } from "./company-wire-slim.ts";
import type { Snapshot } from "./company-books.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function makeWire(people: Array<Record<string, unknown>> = [{ id: "p1", name: "Ada" }]): CompanyWire {
  const slim = slimForWire({
    people,
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 1_700_000_000_000,
  } as Snapshot);
  const snapshotJson = JSON.stringify(slim);
  const jsonBody = Buffer.from(
    JSON.stringify({
      snapshotJson,
      personId: null,
      resets: [],
      bootstrap: false,
      forbidden: false,
      bookGens: slim.bookGens,
      notebookUpdatedAt: slim.notebookUpdatedAt,
    }),
    "utf8",
  );
  return {
    at: Number(slim.notebookUpdatedAt) || 1,
    snapshotJson,
    jsonBody,
    gzipBody: Buffer.from("gzip"),
    people: (slim.people as Array<Record<string, unknown>>) || [],
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    slim,
  };
}

test("10 PATCH + 20 GET: ≤2 assemble, GET never waits on a null cache", async () => {
  resetWireForTests();
  let builds = 0;
  setCompanyWireForTests(makeWire());
  setWireBuildForTests(async () => {
    builds += 1;
    await sleep(40);
    return makeWire([{ id: "p-built", name: "Built" }]);
  });
  const samples: number[] = [];
  const gets: Promise<CompanyWire>[] = [];
  let sawNull = false;
  for (let i = 0; i < 10; i++) {
    patchCompanyWireEntity(
      "people",
      { id: `p-w${i}` },
      { payload: { id: `p-w${i}`, name: `W${i}` }, deleted: false },
    );
    softInvalidateCompanyWire();
  }
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    gets.push(
      getCompanyWire().then((w) => {
        samples.push(Date.now() - t0);
        if (!peekCompanyWire()) sawNull = true;
        return w;
      }),
    );
  }
  const wires = await Promise.all(gets);
  const max = Math.max(...samples);
  const p95 = percentile(samples, 95);
  assert.equal(sawNull, false, "GET never observed a null cache");
  assert.ok(
    wires.every((w) => w && w.gzipBody && w.gzipBody.length > 0),
    "every GET served a body",
  );
  assert.ok(max < 2000, `GET max TTFB ${max}ms p95 ${p95}ms — SWR must not wait on assemble`);
  assert.ok(p95 < 1500, `GET p95 ${p95}ms`);
  await awaitWireIdleForTests();
  assert.ok(builds <= 2, `assemble/gzip builds ${builds} (want ≤2)`);
  assert.ok(wireAssembleCalls() === 0, "default assemble must not run; test builder only");
  (globalThis as unknown as { __spikeSoak?: unknown }).__spikeSoak = {
    max,
    p95,
    builds,
    n: samples.length,
  };
  console.log(`SPIKE_SOAK max=${max}ms p95=${p95}ms builds=${builds} n=${samples.length}`);
  resetWireForTests();
});

test("warm-cache people PATCH uses patch-in-place (assembleForGet not called)", async () => {
  resetWireForTests();
  let builds = 0;
  const beforeMeta = lastAssembleMeta;
  setCompanyWireForTests(makeWire([{ id: "p1", name: "Ada" }]));
  setWireBuildForTests(async () => {
    builds += 1;
    return makeWire();
  });
  const ok = patchCompanyWireEntity(
    "people",
    { id: "p2" },
    { payload: { id: "p2", name: "Bo" }, deleted: false },
  );
  assert.equal(ok, true);
  const wire = await getCompanyWire();
  assert.equal(builds, 0);
  assert.equal(wireAssembleCalls(), 0);
  assert.equal(lastAssembleMeta, beforeMeta);
  assert.ok(wire.people.some((p) => p.id === "p2" && p.name === "Bo"));
  assert.ok(wire.people.some((p) => p.id === "p1"));
  resetWireForTests();
});

test("publishEntityWrite on a warm cache patches people without a full rebuild", async () => {
  resetWireForTests();
  let builds = 0;
  setCompanyWireForTests(makeWire([{ id: "p1", name: "Ada" }]));
  setWireBuildForTests(async () => {
    builds += 1;
    return makeWire();
  });
  await publishEntityWrite(
    "people",
    { type: "people", id: "p-new" },
    { payload: { id: "p-new", name: "New" }, deleted: false },
  );
  const wire = await getCompanyWire();
  assert.equal(builds, 0);
  assert.ok(wire.people.some((p) => p.id === "p-new"));
  resetWireForTests();
});

test("reward-records patch-in-place writes the period cell", async () => {
  resetWireForTests();
  const base = makeWire();
  base.slim = { ...base.slim, rewardRecords: { "2026-09": { p1: { status: "open" } } } };
  setCompanyWireForTests(base);
  const ok = patchCompanyWireEntity(
    "reward_records",
    { id: "p1", period: "2026-09" },
    { payload: { status: "plan_locked" } },
  );
  assert.equal(ok, true);
  const wire = await getCompanyWire();
  const tree = (wire.slim as { rewardRecords?: Record<string, Record<string, { status: string }>> })
    .rewardRecords;
  assert.equal(tree?.["2026-09"]?.p1?.status, "plan_locked");
  resetWireForTests();
});

test("cold encodeCompanyWire gzip level 5 of a company-sized envelope", () => {
  const people = Array.from({ length: 180 }, (_, i) => ({
    id: `p-${i}`,
    name: `Person ${i}`,
    title: "Role",
    notes: "n".repeat(80),
  }));
  const months: Record<string, Record<string, unknown>> = {};
  for (let m = 1; m <= 12; m++) {
    const period = `2026-${String(m).padStart(2, "0")}`;
    months[period] = {};
    for (let i = 0; i < 160; i++) {
      months[period][`p-${i}`] = {
        status: "plan_open",
        kpis: Array.from({ length: 6 }, (_, k) => ({ id: `k${k}`, name: `KPI ${k}`, weight: 0.1 })),
      };
    }
  }
  const slim = slimForWire({
    people,
    records: months,
    rewardRecords: months,
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 1,
  } as Snapshot);
  const t0 = Date.now();
  const wire = encodeCompanyWire(slim, Date.now(), {
    org: 1,
    plans: 1,
    months: 1,
    targets: 1,
  });
  const cold = Date.now() - t0;
  const jsonMb = wire.jsonBody.length / (1024 * 1024);
  assert.equal(WIRE_GZIP_LEVEL, 5);
  assert.ok(wire.gzipBody.length > 0);
  assert.ok(jsonMb > 1, `json ${jsonMb.toFixed(2)}MB`);
  console.log(
    `SPIKE_COLD ms=${cold} jsonMB=${jsonMb.toFixed(2)} gzipKB=${(wire.gzipBody.length / 1024).toFixed(1)}`,
  );
});
