import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assembleSnapshot,
  applyBookPatches,
  bookHash,
  commitBooks,
  mergeConcurrentSnapshots,
  mergeKeepMonthMaps,
  mergeKeepPeople,
  peopleCount,
  splitSnapshot,
  wouldShrinkLive,
  type Snapshot,
} from "./company-books.ts";

const seed = JSON.parse(
  readFileSync(new URL("./company-seed.json", import.meta.url), "utf8"),
) as Snapshot;

test("split + assemble restores people, roles KROC, and month records", () => {
  const books = splitSnapshot(seed);
  assert.ok(peopleCount(books.org) >= 10);
  assert.equal(Array.isArray(books.months.records) || typeof books.months.records === "object", true);
  assert.ok(books.plans.roleKrocs && typeof books.plans.roleKrocs === "object");
  const ceo = (books.org.roles as Record<string, Record<string, unknown>>).ceo;
  assert.ok(ceo);
  assert.equal(ceo.kras, undefined);

  const assembled = assembleSnapshot(books);
  assert.equal(peopleCount(assembled), peopleCount(seed));
  const seedCeo = (seed.roles as Record<string, { kras?: unknown }>).ceo;
  const outCeo = (assembled.roles as Record<string, { kras?: unknown }>).ceo;
  assert.deepEqual(outCeo.kras, seedCeo.kras);
  assert.equal("roleKrocs" in assembled, false);
  assert.deepEqual(assembled.records, seed.records);
  assert.deepEqual(assembled.kpiMaster, seed.kpiMaster);
  assert.deepEqual(assembled.targetNodes, seed.targetNodes);
});

test("unchanged split hashes stay stable", () => {
  const a = splitSnapshot(seed);
  const b = splitSnapshot(seed);
  for (const id of ["org", "plans", "months", "targets"] as const) {
    assert.equal(bookHash(a[id]), bookHash(b[id]));
  }
});

test("editing people does not change the months hash", () => {
  const before = splitSnapshot(seed);
  const clone = JSON.parse(JSON.stringify(seed)) as Snapshot;
  const people = clone.people as Array<Record<string, unknown>>;
  people[0] = { ...people[0], title: "Changed for hash test" };
  const after = splitSnapshot(clone);
  assert.notEqual(bookHash(before.org), bookHash(after.org));
  assert.equal(bookHash(before.months), bookHash(after.months));
  assert.equal(bookHash(before.plans), bookHash(after.plans));
  assert.equal(bookHash(before.targets), bookHash(after.targets));
});

test("editing a closed APMS month does not change the org hash", () => {
  const before = splitSnapshot(seed);
  const clone = JSON.parse(JSON.stringify(seed)) as Snapshot;
  const records = clone.records as Record<string, Record<string, { notes?: string }>>;
  const month = Object.keys(records)[0];
  const person = Object.keys(records[month])[0];
  records[month][person] = { ...records[month][person], notes: "hash-test" };
  const after = splitSnapshot(clone);
  assert.notEqual(bookHash(before.months), bookHash(after.months));
  assert.equal(bookHash(before.org), bookHash(after.org));
});

test("trash stays on the org book", () => {
  const snap = { ...seed, trash: [{ id: "tr-1", kind: "person" }] };
  const books = splitSnapshot(snap);
  assert.equal((books.org.trash as { kind?: string }[] | undefined)?.[0]?.kind, "person");
  assert.equal("trash" in books.plans, false);
  const assembled = assembleSnapshot(books);
  assert.equal((assembled.trash as { id?: string }[] | undefined)?.[0]?.id, "tr-1");
});

test("UI nav keys never land in books or commitBooks output", () => {
  const snap = {
    ...seed,
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p-1",
    selectedMonth: "2026-08",
    selectedRoleId: "ceo",
    selectedTargetMonth: "2026-09",
    currentUserId: "p-admin",
  } as Snapshot;
  const books = splitSnapshot(snap);
  for (const book of Object.values(books)) {
    for (const key of [
      "currentMonth",
      "view",
      "kind",
      "selectedPersonId",
      "selectedMonth",
      "selectedRoleId",
      "selectedTargetMonth",
      "currentUserId",
    ]) {
      assert.equal(key in book, false, `${key} leaked into a book`);
    }
  }
  const stored = { ...seed, currentMonth: "2026-09", view: "home", notebookUpdatedAt: 1 } as Snapshot;
  const incoming = { ...seed, currentMonth: "2026-08", view: "people", notebookUpdatedAt: 2 } as Snapshot;
  const committed = commitBooks(stored, incoming);
  assert.equal("currentMonth" in committed, false);
  assert.equal("view" in committed, false);
  assert.equal("kind" in committed, false);
  assert.equal("selectedPersonId" in committed, false);
});

test("wouldShrinkLive blocks a stale preview replica, not a real empty start", () => {
  const live = { people: Array.from({ length: 172 }, (_, i) => ({ id: `p-${i}` })) };
  const preview = { people: Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}` })) };
  const sameSize = { people: Array.from({ length: 170 }, (_, i) => ({ id: `p-${i}` })) };
  assert.equal(wouldShrinkLive(preview, live), true);
  assert.equal(wouldShrinkLive(sameSize, live), false);
  assert.equal(wouldShrinkLive(live, { people: [] }), false);
  assert.equal(wouldShrinkLive(live, null), false);
});

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, managerId: extra.managerId ?? null, roleId: extra.roleId ?? null, ...extra };
}

test("concurrent manager edits on different people both survive", () => {
  const base: Snapshot = {
    notebookUpdatedAt: 1,
    people: [person("p1"), person("p2"), person("boss")],
    roles: { r1: { id: "r1", name: "Role 1" } },
  };
  const a: Snapshot = {
    notebookUpdatedAt: 2,
    people: [person("p1", { managerId: "boss" }), person("p2"), person("boss")],
    roles: base.roles,
  };
  const b: Snapshot = {
    notebookUpdatedAt: 3,
    notebookBaseAt: 1,
    people: [person("p1"), person("p2", { managerId: "boss" }), person("boss")],
    roles: base.roles,
  };
  const merged = mergeConcurrentSnapshots(a, b, base);
  const byId = Object.fromEntries((merged.people as { id: string }[]).map((p) => [p.id, p]));
  assert.equal((byId.p1 as { managerId?: string }).managerId, "boss");
  assert.equal((byId.p2 as { managerId?: string }).managerId, "boss");
  assert.equal((merged.people as unknown[]).length, 3);
});

test("stale save cannot drop a person another session just added", () => {
  const base: Snapshot = {
    notebookUpdatedAt: 1,
    people: [person("p1")],
    roles: {},
  };
  const stored: Snapshot = {
    notebookUpdatedAt: 2,
    people: [person("p1"), person("p-new", { name: "New hire" })],
    roles: { "role-new": { id: "role-new", name: "Artist" } },
  };
  const stale: Snapshot = {
    notebookUpdatedAt: 3,
    notebookBaseAt: 1,
    people: [person("p1", { managerId: "p1" })],
    roles: {},
  };
  const merged = mergeConcurrentSnapshots(stored, stale, base);
  const ids = (merged.people as { id: string }[]).map((p) => p.id).sort();
  assert.deepEqual(ids, ["p-new", "p1"]);
  assert.equal((merged.roles as Record<string, { name?: string }>)["role-new"]?.name, "Artist");
  const p1 = (merged.people as { id: string; managerId?: string }[]).find((p) => p.id === "p1");
  assert.equal(p1?.managerId, "p1");
});

test("same-person conflict prefers the newer updatedAt", () => {
  const base: Snapshot = { people: [person("p1", { managerId: "old" })] };
  const stored: Snapshot = { people: [person("p1", { managerId: "a", updatedAt: 10 })] };
  const incoming: Snapshot = { people: [person("p1", { managerId: "b", updatedAt: 20 })] };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const p1 = (merged.people as { managerId?: string }[])[0];
  assert.equal(p1.managerId, "b");
});

test("without base, stored people are never dropped", () => {
  const stored: Snapshot = { people: [person("p1"), person("p2")] };
  const incoming: Snapshot = { people: [person("p1", { managerId: "x" })] };
  const merged = mergeConcurrentSnapshots(stored, incoming, null);
  assert.equal((merged.people as unknown[]).length, 2);
});

test("newer client can delete a rewards month even without a merge base", () => {
  const stored: Snapshot = {
    notebookUpdatedAt: 10,
    months: ["2026-04", "2026-05"],
    rewardRecords: {
      "2026-04": { p1: rec("apr") },
      "2026-05": { p1: rec("may") },
    },
    trash: [{ id: "tr-apr", kind: "reward-month", month: "2026-04" }],
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 20,
    months: [],
    rewardRecords: {},
    trash: [],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, null);
  assert.deepEqual(merged.months, []);
  assert.equal((merged.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.equal((merged.rewardRecords as Record<string, unknown>)["2026-05"], undefined);
  assert.equal((merged.trash as unknown[]).length, 0);
});

test("stale client cannot revive deleted rewards months or trash", () => {
  const stored: Snapshot = {
    notebookUpdatedAt: 30,
    months: [],
    rewardRecords: {},
    trash: [],
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 20,
    months: ["2026-04"],
    rewardRecords: { "2026-04": { p1: rec("apr") } },
    trash: [{ id: "tr-apr", kind: "reward-month" }],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, null);
  assert.deepEqual(merged.months, []);
  assert.equal((merged.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.equal((merged.trash as unknown[]).length, 0);
});

test("tombstone blocks a later save that still has the deleted month", () => {
  const afterDelete = mergeConcurrentSnapshots(
    {
      notebookUpdatedAt: 10,
      months: ["2026-04"],
      rewardRecords: { "2026-04": { p1: rec("apr") } },
      trash: [{ id: "tr-1", kind: "reward-month" }],
      targetMonthStatus: { "2026-04": "plan_open" },
    },
    {
      notebookUpdatedAt: 20,
      notebookBaseAt: 10,
      months: [],
      rewardRecords: {},
      trash: [],
      targetMonthStatus: {},
    },
    null,
  );
  assert.equal((afterDelete.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.equal((afterDelete.trash as unknown[]).length, 0);

  const staleReplay = mergeConcurrentSnapshots(
    afterDelete,
    {
      notebookUpdatedAt: 50,
      notebookBaseAt: 10,
      months: ["2026-04"],
      rewardRecords: { "2026-04": { p1: rec("apr") } },
      trash: [{ id: "tr-1", kind: "reward-month" }],
      targetMonthStatus: { "2026-04": "plan_open" },
    },
    null,
  );
  assert.equal((staleReplay.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.deepEqual(staleReplay.months, []);
  assert.equal((staleReplay.trash as unknown[]).length, 0);
  assert.equal((staleReplay.targetMonthStatus as Record<string, unknown>)["2026-04"], undefined);
});

test("a client that loaded after the delete can create the month again", () => {
  const stored: Snapshot = {
    notebookUpdatedAt: 20,
    months: [],
    rewardRecords: {},
    tombstones: { rewardRecords: { "2026-04": 20 }, months: { "2026-04": 20 } },
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 40,
    notebookBaseAt: 21,
    months: ["2026-04"],
    rewardRecords: { "2026-04": { p1: rec("fresh", { updatedAt: 40 }) } },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, null);
  const records = (merged.rewardRecords || {}) as Record<string, Record<string, { notes?: string }>>;
  assert.equal(records["2026-04"]?.p1?.notes, "fresh");
});

function rec(notes: string, extra: Record<string, unknown> = {}) {
  return { notes, status: "plan_open", kras: [], ...extra };
}

test("concurrent APMS scores for different people both survive", () => {
  const base: Snapshot = {
    records: { "2026-09": { u1: rec("old1"), u2: rec("old2") } },
  };
  const stored: Snapshot = {
    records: { "2026-09": { u1: rec("A", { updatedAt: 10 }), u2: rec("old2") } },
  };
  const incoming: Snapshot = {
    notebookBaseAt: 1,
    records: { "2026-09": { u1: rec("old1"), u2: rec("B", { updatedAt: 11 }) } },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const month = merged.records as Record<string, Record<string, { notes?: string }>>;
  assert.equal(month["2026-09"].u1.notes, "A");
  assert.equal(month["2026-09"].u2.notes, "B");
});

test("stale APMS save cannot drop another session's record", () => {
  const base: Snapshot = { records: { "2026-09": { u1: rec("old") } } };
  const stored: Snapshot = {
    records: { "2026-09": { u1: rec("old"), u2: rec("new-person") } },
  };
  const stale: Snapshot = {
    notebookBaseAt: 1,
    records: { "2026-09": { u1: rec("stale-edit") } },
  };
  const merged = mergeConcurrentSnapshots(stored, stale, base);
  const month = merged.records as Record<string, Record<string, { notes?: string }>>;
  assert.equal(month["2026-09"].u2.notes, "new-person");
  assert.equal(month["2026-09"].u1.notes, "stale-edit");
});

test("concurrent reward records for different people both survive", () => {
  const base: Snapshot = {
    rewardRecords: { "2026-09": { p1: rec("old"), p2: rec("old") } },
  };
  const stored: Snapshot = {
    rewardRecords: { "2026-09": { p1: rec("rewA"), p2: rec("old") } },
  };
  const incoming: Snapshot = {
    rewardRecords: { "2026-09": { p1: rec("old"), p2: rec("rewB") } },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const month = merged.rewardRecords as Record<string, Record<string, { notes?: string }>>;
  assert.equal(month["2026-09"].p1.notes, "rewA");
  assert.equal(month["2026-09"].p2.notes, "rewB");
});

test("concurrent KPI library adds both survive", () => {
  const base: Snapshot = { kpiMaster: [{ id: "k1", name: "Hit rate" }] };
  const stored: Snapshot = {
    kpiMaster: [
      { id: "k1", name: "Hit rate" },
      { id: "k-a", name: "NPS A" },
    ],
  };
  const incoming: Snapshot = {
    kpiMaster: [
      { id: "k1", name: "Hit rate" },
      { id: "k-b", name: "NPS B" },
    ],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const ids = (merged.kpiMaster as { id: string }[]).map((k) => k.id).sort();
  assert.deepEqual(ids, ["k-a", "k-b", "k1"]);
});

test("concurrent award patches on different awards both survive", () => {
  const base: Snapshot = {
    awardInstances: [
      { id: "aw1", name: "One", status: "draft" },
      { id: "aw2", name: "Two", status: "draft" },
    ],
  };
  const stored: Snapshot = {
    awardInstances: [
      { id: "aw1", name: "One live", status: "live", updatedAt: 10 },
      { id: "aw2", name: "Two", status: "draft" },
    ],
  };
  const incoming: Snapshot = {
    awardInstances: [
      { id: "aw1", name: "One", status: "draft" },
      { id: "aw2", name: "Two named", status: "draft", updatedAt: 11 },
    ],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const byId = Object.fromEntries(
    (merged.awardInstances as { id: string; name: string; status: string }[]).map((a) => [a.id, a]),
  );
  assert.equal(byId.aw1.status, "live");
  assert.equal(byId.aw1.name, "One live");
  assert.equal(byId.aw2.name, "Two named");
});

test("concurrent target cell edits both survive", () => {
  const base: Snapshot = {
    targetCells: {
      "tn-a::2026-09": { nodeId: "tn-a", month: "2026-09", actual: 0 },
      "tn-b::2026-09": { nodeId: "tn-b", month: "2026-09", actual: 0 },
    },
  };
  const stored: Snapshot = {
    targetCells: {
      "tn-a::2026-09": { nodeId: "tn-a", month: "2026-09", actual: 10, updatedAt: 5 },
      "tn-b::2026-09": { nodeId: "tn-b", month: "2026-09", actual: 0 },
    },
  };
  const incoming: Snapshot = {
    targetCells: {
      "tn-a::2026-09": { nodeId: "tn-a", month: "2026-09", actual: 0 },
      "tn-b::2026-09": { nodeId: "tn-b", month: "2026-09", actual: 20, updatedAt: 6 },
    },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const cells = merged.targetCells as Record<string, { actual?: number }>;
  assert.equal(cells["tn-a::2026-09"].actual, 10);
  assert.equal(cells["tn-b::2026-09"].actual, 20);
});

test("empty-map targetMembers plus two array adds both survive", () => {
  const base: Snapshot = { targetMembers: {} };
  const stored: Snapshot = {
    targetMembers: [{ month: "2026-09", groupId: "g1", memberId: "m1" }],
  };
  const incoming: Snapshot = {
    targetMembers: [{ month: "2026-09", groupId: "g1", memberId: "m2" }],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const rows = merged.targetMembers as { memberId: string }[];
  assert.equal(Array.isArray(rows), true);
  const ids = rows.map((r) => r.memberId).sort();
  assert.deepEqual(ids, ["m1", "m2"]);
});

test("apmsMonths empty object plus two plan-month rows both survive", () => {
  const base: Snapshot = { apmsMonths: {} };
  const stored: Snapshot = {
    apmsMonths: [{ planId: "p1", month: "2026-09", status: "planning" }],
  };
  const incoming: Snapshot = {
    apmsMonths: [{ planId: "p2", month: "2026-09", status: "planning" }],
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const rows = merged.apmsMonths as { planId: string }[];
  assert.equal(Array.isArray(rows), true);
  assert.deepEqual(rows.map((r) => r.planId).sort(), ["p1", "p2"]);
});

test("concurrent EO reviews and period reviews both survive", () => {
  const base: Snapshot = { agsReviews: [], periodReviews: {} };
  const stored: Snapshot = {
    agsReviews: [{ id: "ag-a", personId: "p1", rating: 5 }],
    periodReviews: { "2026-Q3:p1": { id: "pr-a", note: "A" } },
  };
  const incoming: Snapshot = {
    agsReviews: [{ id: "ag-b", personId: "p2", rating: 4 }],
    periodReviews: { "2026-Q3:p2": { id: "pr-b", note: "B" } },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const ags = merged.agsReviews as { id: string }[];
  assert.deepEqual(ags.map((r) => r.id).sort(), ["ag-a", "ag-b"]);
  const periods = merged.periodReviews as Record<string, { note?: string }>;
  assert.equal(periods["2026-Q3:p1"].note, "A");
  assert.equal(periods["2026-Q3:p2"].note, "B");
});

test("empty object vs empty array keeps stored type", () => {
  const stored: Snapshot = { accessRoles: {}, targetMembers: {}, apmsMonths: {} };
  const incoming: Snapshot = { accessRoles: [], targetMembers: [], apmsMonths: [] };
  const merged = mergeConcurrentSnapshots(stored, incoming, stored);
  assert.deepEqual(merged.accessRoles, {});
  assert.deepEqual(merged.targetMembers, {});
  assert.deepEqual(merged.apmsMonths, {});
});

test("records stay a month map, not an array", () => {
  const base: Snapshot = { records: { "2026-09": { u1: rec("old") } } };
  const stored: Snapshot = { records: { "2026-09": { u1: rec("A") } } };
  const incoming: Snapshot = { records: { "2026-09": { u1: rec("old"), u2: rec("B") } } };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  assert.equal(Array.isArray(merged.records), false);
  const month = merged.records as Record<string, Record<string, { notes?: string }>>;
  assert.equal(month["2026-09"].u1.notes, "A");
  assert.equal(month["2026-09"].u2.notes, "B");
});

function aprilGroup() {
  return { id: "tn-apr-1", kind: "group", name: "Soumyajit Ghosh Cluster" };
}

function aprilSnap(extra: Record<string, unknown> = {}): Snapshot {
  return {
    targetNodes: { "tn-apr-1": aprilGroup() },
    targetCells: {
      "tn-apr-1::2026-04": { nodeId: "tn-apr-1", month: "2026-04", actual: 0, ladder: { M1: 1 } },
    },
    targetMembers: [{ month: "2026-04", groupId: "tn-apr-1", memberId: "tn-leaf-1" }],
    targetMonthStatus: { "2026-04": "planning" },
    targetRootOrder: { "2026-04": ["tn-apr-1"] },
    ...extra,
  };
}

function emptyAprilSnap(): Snapshot {
  return {
    targetNodes: {},
    targetCells: {},
    targetMembers: [],
    targetMonthStatus: {},
    targetRootOrder: {},
  };
}

test("deleted April targets stay deleted when another session still has the old copy", () => {
  const base = aprilSnap();
  const stored = emptyAprilSnap();
  const stale = aprilSnap();
  const merged = mergeConcurrentSnapshots(stored, stale, base);
  assert.deepEqual(merged.targetNodes, {});
  assert.deepEqual(merged.targetCells, {});
  assert.equal((merged.targetMembers as unknown[]).length, 0);
  assert.equal((merged.targetMonthStatus as Record<string, unknown>)["2026-04"], undefined);
  assert.equal((merged.targetRootOrder as Record<string, unknown>)["2026-04"], undefined);
});

test("stored April create is not dropped by a stale session that never saw it", () => {
  const base = emptyAprilSnap();
  const stored = aprilSnap();
  const stale = emptyAprilSnap();
  const merged = mergeConcurrentSnapshots(stored, stale, base);
  const nodes = merged.targetNodes as Record<string, { name?: string }>;
  assert.equal(nodes["tn-apr-1"]?.name, "Soumyajit Ghosh Cluster");
  assert.equal(
    (merged.targetCells as Record<string, { actual?: number }>)["tn-apr-1::2026-04"]?.actual,
    0,
  );
  assert.equal((merged.targetMembers as { memberId: string }[])[0]?.memberId, "tn-leaf-1");
  assert.equal((merged.targetMonthStatus as Record<string, unknown>)["2026-04"], "planning");
  assert.deepEqual((merged.targetRootOrder as Record<string, string[]>)["2026-04"], ["tn-apr-1"]);
});

test("stale session cannot revive a deleted target node even if it edited another node", () => {
  const kept = { id: "tn-keep", kind: "leaf", name: "Kept" };
  const gone = aprilGroup();
  const base: Snapshot = { targetNodes: { "tn-keep": kept, "tn-apr-1": gone } };
  const stored: Snapshot = { targetNodes: { "tn-keep": kept } };
  const incoming: Snapshot = {
    targetNodes: { "tn-keep": { ...kept, name: "Kept renamed" }, "tn-apr-1": gone },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  const nodes = merged.targetNodes as Record<string, { name?: string }>;
  assert.equal(nodes["tn-apr-1"], undefined);
  assert.equal(nodes["tn-keep"]?.name, "Kept renamed");
});

test("deleted target member rows stay deleted against a stale array copy", () => {
  const row = { month: "2026-04", groupId: "tn-apr-1", memberId: "tn-leaf-1" };
  const base: Snapshot = { targetMembers: [row] };
  const stored: Snapshot = { targetMembers: [] };
  const stale: Snapshot = { targetMembers: [row] };
  const merged = mergeConcurrentSnapshots(stored, stale, base);
  assert.equal((merged.targetMembers as unknown[]).length, 0);
});

test("an org edit does not roll months back to an older copy", () => {
  const monthBase = { "2026-04": { p1: rec("original", { updatedAt: 10 }) } };
  const base: Snapshot = {
    notebookUpdatedAt: 10,
    people: [person("p1", { name: "Old" })],
    rewardRecords: monthBase,
  };
  const stored: Snapshot = {
    notebookUpdatedAt: 20,
    people: [person("p1", { name: "Old" })],
    rewardRecords: { "2026-04": { p1: rec("server-new", { updatedAt: 20 }) } },
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 30,
    notebookBaseAt: 10,
    people: [person("p1", { name: "Renamed" })],
    rewardRecords: monthBase,
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, base);
  assert.equal((merged.people as { name?: string }[])[0]?.name, "Renamed");
  const month = merged.rewardRecords as Record<string, Record<string, { notes?: string }>>;
  assert.equal(month["2026-04"].p1.notes, "server-new");
});

test("a tab that loaded older data cannot overwrite a newer stored cell", () => {
  const stored: Snapshot = {
    notebookUpdatedAt: 40,
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 99, updatedAt: 40 },
    },
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 80,
    notebookBaseAt: 10,
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 1, updatedAt: 10 },
    },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, null);
  const cells = merged.targetCells as Record<string, { actual?: number }>;
  assert.equal(cells["tn-1::2026-04"]?.actual, 99);
});

test("newer unstamped edit is kept over an older stamped original", () => {
  const stored: Snapshot = {
    notebookUpdatedAt: 10,
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 1, updatedAt: 10 },
    },
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 20,
    notebookBaseAt: 10,
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 50 },
    },
  };
  const merged = mergeConcurrentSnapshots(stored, incoming, stored);
  const cells = merged.targetCells as Record<string, { actual?: number }>;
  assert.equal(cells["tn-1::2026-04"]?.actual, 50);
});

test("INVARIANT: stale book cannot restore a deleted rewards month", () => {
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 4, targets: 1 },
    months: [],
    rewardRecords: {},
    tombstones: { rewardRecords: { "2026-04": 20 }, months: { "2026-04": 20 } },
  };
  const incoming: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 3, targets: 1 },
    months: ["2026-04"],
    rewardRecords: { "2026-04": { p1: rec("ghost") } },
  };
  const next = commitBooks(stored, incoming);
  assert.equal((next.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.deepEqual(next.months, []);
});

test("INVARIANT: stale book cannot roll a target cell back in time", () => {
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 8 },
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 99, updatedAt: 80 },
    },
  };
  const incoming: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 7 },
    targetCells: {
      "tn-1::2026-04": { nodeId: "tn-1", month: "2026-04", actual: 1, updatedAt: 10 },
    },
  };
  const next = commitBooks(stored, incoming);
  const cells = next.targetCells as Record<string, { actual?: number }>;
  assert.equal(cells["tn-1::2026-04"]?.actual, 99);
});

test("INVARIANT: org save does not rewrite the months book", () => {
  const month = { "2026-04": { p1: rec("live") } };
  const stored: Snapshot = {
    bookGens: { org: 3, plans: 1, months: 5, targets: 2 },
    people: [person("p1", { name: "Old" })],
    rewardRecords: month,
  };
  const incoming: Snapshot = {
    bookGens: { org: 3, plans: 1, months: 5, targets: 2 },
    people: [person("p1", { name: "Renamed" })],
    rewardRecords: month,
  };
  const next = commitBooks(stored, incoming);
  assert.equal((next.people as { name?: string }[])[0]?.name, "Renamed");
  const records = next.rewardRecords as Record<string, Record<string, { notes?: string }>>;
  assert.equal(records["2026-04"].p1.notes, "live");
  const gens = next.bookGens as Record<string, number>;
  assert.equal(gens.months, 5);
  assert.equal(gens.org, 4);
});

test("INVARIANT: fresh months save deletes a month and a stale replay cannot restore it", () => {
  const live: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 2, targets: 1 },
    months: ["2026-04"],
    rewardRecords: { "2026-04": { p1: rec("apr") } },
  };
  const deleted = commitBooks(live, {
    bookGens: { org: 1, plans: 1, months: 2, targets: 1 },
    months: [],
    rewardRecords: {},
    notebookUpdatedAt: 50,
  });
  assert.equal((deleted.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.equal((deleted.bookGens as Record<string, number>).months, 3);

  const replay = commitBooks(deleted, {
    bookGens: { org: 1, plans: 1, months: 2, targets: 1 },
    months: ["2026-04"],
    rewardRecords: { "2026-04": { p1: rec("apr") } },
    notebookUpdatedAt: 90,
  });
  assert.equal((replay.rewardRecords as Record<string, unknown>)["2026-04"], undefined);
  assert.deepEqual(replay.months, []);
});

test("INVARIANT: emptied trash stays empty against a stale org snapshot", () => {
  const live: Snapshot = {
    bookGens: { org: 4, plans: 1, months: 1, targets: 1 },
    trash: [],
    people: [person("p1")],
  };
  const replay = commitBooks(live, {
    bookGens: { org: 3, plans: 1, months: 1, targets: 1 },
    trash: [{ id: "tr-1", kind: "reward-month" }],
    people: [person("p1")],
  });
  assert.equal((replay.trash as unknown[]).length, 0);
});

test("without bookGens, an org-only save cannot restore emptied trash or old plans", () => {
  const stored: Snapshot = {
    bookGens: { org: 5, plans: 9, months: 4, targets: 2 },
    notebookUpdatedAt: 50,
    people: [person("p1"), person("p2")],
    trash: [],
    kpiMaster: [{ id: "k-new", name: "Live KPI" }],
    awardInstances: [{ id: "aw-1", name: "Live award" }],
    dismissedAlertIds: ["a1"],
  };
  const incoming: Snapshot = {
    notebookUpdatedAt: 90,
    notebookBaseAt: 40,
    people: [person("p1"), person("p2")],
    trash: [{ id: "tr-1", kind: "person" }],
    kpiMaster: [{ id: "k-old", name: "Stale KPI" }],
    awardInstances: [],
    dismissedAlertIds: ["a1", "a2"],
  };
  const next = commitBooks(stored, incoming);
  assert.equal((next.trash as unknown[]).length, 0);
  assert.equal((next.kpiMaster as { id?: string }[])[0]?.id, "k-new");
  assert.equal((next.awardInstances as { id?: string }[])[0]?.id, "aw-1");
  const gens = next.bookGens as Record<string, number>;
  assert.equal(gens.plans, 9);
  assert.equal(gens.org, 5);
});

test("matching plans gen saves KPIs while a stale org gen cannot restore trash", () => {
  const stored: Snapshot = {
    bookGens: { org: 6, plans: 9, months: 4, targets: 2 },
    notebookUpdatedAt: 50,
    people: [person("p1")],
    trash: [],
    kpiMaster: [{ id: "k-old" }],
    awardInstances: [{ id: "aw-1" }],
  };
  const incoming: Snapshot = {
    bookGens: { org: 5, plans: 9, months: 4, targets: 2 },
    notebookUpdatedAt: 90,
    notebookBaseAt: 40,
    people: [person("p1")],
    trash: [{ id: "tr-ghost", kind: "person" }],
    kpiMaster: [{ id: "k-new", name: "Draft KPI" }],
    awardInstances: [{ id: "aw-1" }, { id: "aw-2", name: "New award" }],
  };
  const next = commitBooks(stored, incoming);
  assert.equal((next.trash as unknown[]).length, 0);
  assert.equal((next.kpiMaster as { id?: string }[])[0]?.id, "k-new");
  assert.equal((next.awardInstances as { id?: string }[]).length, 2);
  const gens = next.bookGens as Record<string, number>;
  assert.equal(gens.org, 6);
  assert.equal(gens.plans, 10);
});

test("applyBookPatches matching gen replaces only that book", () => {
  const stored: Snapshot = {
    bookGens: { org: 6, plans: 9, months: 4, targets: 2 },
    people: [person("p1")],
    trash: [],
    kpiMaster: [{ id: "k-old" }],
  };
  const result = applyBookPatches(
    stored,
    { plans: { kpiMaster: [{ id: "k-new", name: "Draft KPI" }] } },
    { plans: 9 },
  );
  assert.deepEqual(result.applied, ["plans"]);
  assert.deepEqual(result.conflict, []);
  assert.equal((result.snapshot.kpiMaster as { id?: string }[])[0]?.id, "k-new");
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
  assert.equal((result.snapshot.bookGens as Record<string, number>).plans, 10);
  assert.equal((result.snapshot.bookGens as Record<string, number>).org, 6);
});

test("applyBookPatches stale gen 409s and cannot restore trash", () => {
  const stored: Snapshot = {
    bookGens: { org: 6, plans: 9, months: 4, targets: 2 },
    people: [person("p1")],
    trash: [],
    kpiMaster: [{ id: "k-old" }],
  };
  const result = applyBookPatches(
    stored,
    {
      org: { people: [person("p1")], trash: [{ id: "tr-ghost", kind: "person" }] },
      plans: { kpiMaster: [{ id: "k-new" }] },
    },
    { org: 5, plans: 9 },
  );
  assert.deepEqual(result.applied, ["plans"]);
  assert.deepEqual(result.conflict, ["org"]);
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
});

test("applyBookPatches omitted baseGen is a conflict", () => {
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 2, months: 2, targets: 2 },
    trash: [],
    people: [person("p1")],
  };
  const result = applyBookPatches(stored, { org: { people: [person("p1")], trash: [{ id: "x" }] } }, {});
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.conflict, ["org"]);
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
});

test("matching PATCH gen can recreate a row that an older tombstone had removed", () => {
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 4, months: 1, targets: 1 },
    kpiMaster: [],
    tombstones: { kpiMaster: { "id:k1": 10 } },
  };
  const result = applyBookPatches(
    stored,
    { plans: { kpiMaster: [{ id: "k1", name: "Restored", updatedAt: 20 }] } },
    { plans: 4 },
  );
  assert.deepEqual(result.applied, ["plans"]);
  assert.equal((result.snapshot.kpiMaster as { id?: string }[])[0]?.id, "k1");
});

test("concurrent reward locks on different people both survive a matching-gen months patch", () => {
  const stored: Snapshot = {
    bookGens: { org: 3, plans: 3, months: 8, targets: 3 },
    people: [person("rajesh"), person("priya")],
    rewardRecords: {
      "2026-06": {
        rajesh: { status: "plan_open", kpis: [{ id: "k1" }], updatedAt: 10 },
      },
    },
  };
  const result = applyBookPatches(
    stored,
    {
      months: {
        rewardRecords: {
          "2026-06": {
            priya: { status: "plan_locked", kpis: [{ id: "k2" }], updatedAt: 20 },
          },
        },
      },
    },
    { months: 8 },
  );
  assert.deepEqual(result.applied, ["months"]);
  const june = (result.snapshot.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-06"];
  assert.equal(june.rajesh.status, "plan_open");
  assert.equal(june.priya.status, "plan_locked");
});

test("mergeKeepPeople never drops a person the other tab omitted", () => {
  const kept = mergeKeepPeople(
    [person("a"), person("priya", { updatedAt: 5 })],
    [person("a", { title: "Lead", updatedAt: 9 })],
  ) as Array<{ id: string; title?: string }>;
  assert.equal(kept.some((p) => p.id === "priya"), true);
  assert.equal(kept.find((p) => p.id === "a")?.title, "Lead");
});


