/**
 * PERF (server p0aw5 / SPA sync p0as83): the in-memory wire, the screen-read
 * cache and the session cache keep every data-safety rule while doing less.
 *
 *   - read-after-write: a commit is in the wire before the save returns;
 *   - a hard change makes reads wait for the reassemble (never the old copy);
 *   - a commit that lands during a reassemble is not dropped by it;
 *   - the wire's feed position never passes a write still in flight;
 *   - generic-kind re-reads land in commit order;
 *   - encoding happens once per version, only when read;
 *   - cached screen reads: same generation → memory / 304, a write → rebuilt;
 *   - row commits keep the book generations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEntityFieldsToWire,
  awaitWireIdleForTests,
  encodeCompanyWire,
  getCompanyWire,
  noteWireWriteEnd,
  noteWireWriteStart,
  patchCompanyWireEntity,
  resetWireForTests,
  setCompanyWireForTests,
  setWireBuildForTests,
  softInvalidateCompanyWire,
  wireEncodeCalls,
  type CompanyWire,
} from "./company-wire-cache.ts";
import { bumpHotGen, cachedJsonResponse, hotGen, readCacheStats, resetReadCacheForTests } from "./company-read-cache.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wireOf(slim: Record<string, unknown>, at = 1000): CompanyWire {
  return encodeCompanyWire(slim, at, { org: 1, plans: 1, months: 1, targets: 1 });
}

function snap(wire: CompanyWire): Record<string, unknown> {
  return JSON.parse(wire.snapshotJson);
}

test("a hot-row commit is in the next GET (read-after-write), encoded once when read", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [{ id: "p1", name: "Ada" }], records: {}, feedSeq: 5 }));
  const before = wireEncodeCalls();
  assert.equal(patchCompanyWireEntity("month_records", { id: "p1", period: "2026-09" }, { payload: { notes: "saved" } }), true);
  assert.equal(patchCompanyWireEntity("people", { id: "p1" }, { payload: { id: "p1", name: "Ada L" } }), true);
  assert.equal(wireEncodeCalls(), before, "no encode until someone reads");
  const w = await getCompanyWire();
  const s = snap(w);
  assert.deepEqual((s.records as Record<string, Record<string, unknown>>)["2026-09"].p1, { notes: "saved" });
  assert.equal((s.people as Array<{ name: string }>)[0].name, "Ada L");
  assert.equal(wireEncodeCalls(), before + 1, "two commits, one encode");
  assert.ok(w.at > 1000, "version moved");
  await getCompanyWire();
  assert.equal(wireEncodeCalls(), before + 1, "unchanged → no second encode");
});

test("a hard change: reads wait for the reassemble and never get the old copy", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [], notices: [{ id: "n1" }] }));
  setWireBuildForTests(async () => {
    await sleep(40);
    return wireOf({ people: [], notices: [{ id: "n1" }, { id: "n2" }] }, 2000);
  });
  softInvalidateCompanyWire();
  const w = await getCompanyWire();
  assert.equal((snap(w).notices as unknown[]).length, 2);
  await awaitWireIdleForTests();
});

test("a commit during a reassemble survives it (journal)", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [{ id: "p1", name: "A" }], records: {} }));
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  // The assemble read the database before the commit below: its copy lacks it.
  setWireBuildForTests(async () => {
    await gate;
    return wireOf({ people: [{ id: "p1", name: "A" }], records: {} }, 3000);
  });
  softInvalidateCompanyWire();
  patchCompanyWireEntity("month_records", { id: "p1", period: "2026-09" }, { payload: { v: 1 } });
  release();
  const w = await getCompanyWire();
  assert.deepEqual((snap(w).records as Record<string, Record<string, unknown>>)["2026-09"].p1, { v: 1 });
  await awaitWireIdleForTests();
});

test("feedSeq moves only when no row write is in flight", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [], feedSeq: 10 }));
  noteWireWriteStart(); // A
  noteWireWriteStart(); // B
  noteWireWriteEnd(12); // B done (seq 12) — A (seq 11?) still between commit and patch
  assert.equal(snap(await getCompanyWire()).feedSeq, 10, "must not pass A");
  noteWireWriteEnd(11); // A done
  assert.equal(snap(await getCompanyWire()).feedSeq, 12);
});

test("generic-kind re-reads land in commit order", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [], notices: [] }));
  let db: Array<{ id: string }> = [];
  const load = (delay: number) => async () => {
    const rows = db.slice();
    await sleep(delay);
    return { notices: rows };
  };
  db = [{ id: "n1" }];
  const a = applyEntityFieldsToWire(load(30), (s) => s); // slow read of the first commit
  db = [{ id: "n1" }, { id: "n2" }];
  const b = applyEntityFieldsToWire(load(0), (s) => s); // fast read of the second
  await Promise.all([a, b]);
  assert.deepEqual(snap(await getCompanyWire()).notices, [{ id: "n1" }, { id: "n2" }], "the later commit's rows win");
});

test("screen reads: same generation from memory, If-None-Match → 304, a write → rebuilt", async () => {
  resetReadCacheForTests();
  let builds = 0;
  const build = async () => {
    builds += 1;
    return { ok: true, n: builds };
  };
  const req = (etag?: string) =>
    new Request("http://x/api/reward-records/2026-09", { headers: etag ? { "if-none-match": etag } : {} });
  const r1 = await cachedJsonResponse(req(), "k", hotGen("reward_records", "2026-09"), build);
  const etag = r1.headers.get("etag")!;
  assert.equal((await r1.json()).n, 1);
  const r2 = await cachedJsonResponse(req(), "k", hotGen("reward_records", "2026-09"), build);
  assert.equal((await r2.json()).n, 1, "memory");
  const r3 = await cachedJsonResponse(req(etag), "k", hotGen("reward_records", "2026-09"), build);
  assert.equal(r3.status, 304);
  bumpHotGen("reward_records", "2026-08");
  const r4 = await cachedJsonResponse(req(etag), "k", hotGen("reward_records", "2026-09"), build);
  assert.equal(r4.status, 304, "another month's write does not touch this one");
  bumpHotGen("reward_records", "2026-09");
  const r5 = await cachedJsonResponse(req(etag), "k", hotGen("reward_records", "2026-09"), build);
  assert.equal(r5.status, 200);
  assert.equal((await r5.json()).n, 2, "rebuilt after the write");
  assert.equal(builds, 2);
  assert.ok(readCacheStats().notModified >= 2);
});

test("screen reads: concurrent misses share one build", async () => {
  resetReadCacheForTests();
  let builds = 0;
  const build = async () => {
    builds += 1;
    await sleep(20);
    return { ok: true };
  };
  await Promise.all(
    Array.from({ length: 20 }, () => cachedJsonResponse(new Request("http://x/api/people"), "p", hotGen("people"), build)),
  );
  assert.equal(builds, 1);
});

test("row commits keep the book generations (the wire never runs ahead of the stored books)", async () => {
  resetWireForTests();
  setCompanyWireForTests(wireOf({ people: [{ id: "p1", name: "A" }], records: {} }));
  patchCompanyWireEntity("people", { id: "p1" }, { payload: { id: "p1", name: "B" } });
  patchCompanyWireEntity("month_records", { id: "p1", period: "2026-09" }, { payload: { v: 1 } });
  patchCompanyWireEntity("target_cells", { id: "t1", period: "2026-09" }, { payload: { actual: 1 } });
  const w = await getCompanyWire();
  // A tab whose book gen is behind re-reads the whole book; a pulled book
  // reports the stored gen, so a bumped wire gen made it re-read forever.
  assert.deepEqual(snap(w).bookGens, { org: 1, plans: 1, months: 1, targets: 1 });
  assert.deepEqual(w.bookGens, { org: 1, plans: 1, months: 1, targets: 1 });
});
