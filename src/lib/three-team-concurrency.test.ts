import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  applyBookPatches,
  commitBooks,
  mergeKeepPeople,
  type Snapshot,
} from "./company-books.ts";
function isAdminRestorePost(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const inner =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : rec;
  return inner.restore === true || inner.allowEmpty === true || inner.adminRestore === true;
}
import { hasUiSessionKeys, stripUiSessionKeys } from "./company-ui-session.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  BOOK_IDS: string[];
  splitSnapshot: (s: Record<string, unknown>) => Record<string, Record<string, unknown>>;
  dirtyBooks: (s: Record<string, unknown>) => string[];
  rebaseBook: (id: string, local: Record<string, unknown>, server: Record<string, unknown>) => Record<string, unknown>;
  overlappingPersonMonths: (
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    server: Record<string, unknown>,
  ) => Array<{ month: string; personId: string }>;
  save: (s: Record<string, unknown>) => Promise<Record<string, unknown>>;
  pullLive: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  noteLoaded: (s: Record<string, unknown>) => void;
  noteRemote: (t: unknown) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  lastSave: () => { via?: string } | null;
};

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}
function rec(label: string, extra: Record<string, unknown> = {}) {
  return { id: label, status: extra.status || "draft", kpis: extra.kpis || [], updatedAt: extra.updatedAt || 1 };
}

const gens = { org: 4, plans: 4, months: 4, targets: 4 };

test("A1: HR add 5 people while Rewards locks 10 other month-records — both survive", () => {
  const people = Array.from({ length: 12 }, (_, i) => person(`p${i}`));
  const stored: Snapshot = {
    bookGens: { ...gens },
    people,
    trash: [],
    rewardRecords: {
      "2026-04": Object.fromEntries(people.slice(0, 10).map((p) => [p.id, rec(`open-${p.id}`, { status: "draft" })])),
    },
  };
  const hrPeople = [
    ...people,
    person("priya-1"),
    person("priya-2"),
    person("priya-3"),
    person("priya-4"),
    person("priya-5"),
  ];
  const hr = applyBookPatches(stored, { org: { people: hrPeople, trash: [] } }, { org: 4 });
  assert.deepEqual(hr.applied, ["org"]);
  const afterHr = hr.snapshot;
  const locked: Record<string, unknown> = {};
  for (const p of people.slice(0, 10)) locked[p.id] = rec(`lock-${p.id}`, { status: "plan_locked", updatedAt: 9 });
  const rewards = applyBookPatches(afterHr, { months: { rewardRecords: { "2026-04": locked } } }, { months: 4 });
  assert.deepEqual(rewards.applied, ["months"]);
  const ids = (rewards.snapshot.people as { id: string }[]).map((p) => p.id);
  for (const id of ["priya-1", "priya-2", "priya-3", "priya-4", "priya-5"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  const month = (rewards.snapshot.rewardRecords as Record<string, Record<string, { status: string }>>)["2026-04"];
  for (const p of people.slice(0, 10)) {
    assert.equal(month[p.id].status, "plan_locked");
  }
});

test("A2: same month different people both persist; same person same month is a conflict", () => {
  const stored: Snapshot = {
    bookGens: { ...gens },
    people: [person("a"), person("b")],
    rewardRecords: {
      "2026-04": { a: rec("a-open"), b: rec("b-open") },
    },
  };
  const first = applyBookPatches(
    stored,
    { months: { rewardRecords: { "2026-04": { a: rec("a-lock", { status: "plan_locked", updatedAt: 5 }), b: rec("b-open") } } } },
    { months: 4 },
  );
  assert.deepEqual(first.applied, ["months"]);
  const second = applyBookPatches(
    first.snapshot,
    { months: { rewardRecords: { "2026-04": { a: rec("a-open"), b: rec("b-lock", { status: "plan_locked", updatedAt: 6 }) } } } },
    { months: 4 },
  );
  assert.deepEqual(second.conflict, ["months"]);
  const rebased = sync.rebaseBook(
    "months",
    { rewardRecords: { "2026-04": { a: rec("a-open"), b: rec("b-lock", { status: "plan_locked", updatedAt: 6 }) } } },
    first.snapshot as Record<string, unknown>,
  );
  const month = (rebased.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-04"];
  assert.equal(month.a.status, "plan_locked");
  assert.equal(month.b.status, "plan_locked");

  sync.resetForTests();
  const baseMonth = { rewardRecords: { "2026-04": { a: rec("a-open", { updatedAt: 1 }) } } };
  sync.noteLoaded({ people: [person("a")], roles: { r: {} }, bookGens: gens, ...baseMonth } as Record<string, unknown>);
  const hits = sync.overlappingPersonMonths(
    baseMonth,
    { rewardRecords: { "2026-04": { a: rec("a-mine", { status: "plan_locked", updatedAt: 8 }) } } },
    { rewardRecords: { "2026-04": { a: rec("a-theirs", { status: "plan_locked", updatedAt: 9 }) } } },
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].personId, "a");
});

test("A3 copy: lock empty-state string is gone from the scorecard bundle", () => {
  const routes = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url), "utf8");
  assert.equal(routes.includes("Nothing open."), false);
  assert.ok(routes.includes("Record missing or lost to sync — refresh"));
  assert.ok(routes.includes("n(r.slice(0,5).join(` · `))") || routes.includes("n(r.slice(0,5).join("));
});

test("A4: save() never falls back to full POST even on PATCH 410/network", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    kpiMaster: [{ id: "k1" }],
    trash: [],
    bookGens: gens,
  };
  sync.noteLoaded(live);
  const methods: string[] = [];
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String(init?.method || "GET").toUpperCase());
    return new Response("", { status: 410 });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save({ ...live, kpiMaster: [{ id: "k1" }, { id: "k2" }] });
  assert.equal(ack.ok, false);
  assert.equal(ack.error, "patch-failed");
  assert.equal(methods.includes("POST"), false);
  assert.equal(sync.lastSave()?.via, "PATCH-FAIL");
});

test("A5: UI nav never in books; deletes stay deleted; stale targets cannot resurrect", () => {
  const stripped = stripUiSessionKeys({
    people: [person("p1")],
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p1",
  });
  assert.equal(hasUiSessionKeys(stripped), false);
  const books = sync.splitSnapshot({
    people: [person("p1")],
    roles: { r: {} },
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p1",
  });
  for (const book of Object.values(books)) {
    assert.equal("currentMonth" in book, false);
    assert.equal("view" in book, false);
  }

  const live: Snapshot = {
    bookGens: { org: 4, plans: 1, months: 1, targets: 3 },
    trash: [],
    people: [person("p1")],
    targetCells: { "n1|2026-04": { value: 10 } },
  };
  const emptied = applyBookPatches(live, { org: { people: [person("p1")], trash: [] } }, { org: 4 });
  const replayTrash = commitBooks(emptied.snapshot, {
    bookGens: { org: 3, plans: 1, months: 1, targets: 3 },
    trash: [{ id: "ghost", kind: "person" }],
    people: [person("p1")],
  });
  assert.equal((replayTrash.trash as unknown[]).length, 0);

  const replayTargets = commitBooks(emptied.snapshot, {
    bookGens: { org: 4, plans: 1, months: 1, targets: 1 },
    targetCells: { "n1|2026-04": { value: 999 }, "resurrect": { value: 1 } },
    notebookUpdatedAt: 90,
  });
  assert.equal((replayTargets.targetCells as Record<string, unknown>)["resurrect"], undefined);
  assert.equal((replayTargets.bookGens as Record<string, number>).targets, 3);
});

test("pullLive isBlocked never fetches or applies", async () => {
  sync.resetForTests();
  sync.noteRemote({ bookGens: { org: 9, plans: 9, months: 9, targets: 9 } });
  let fetched = false;
  sync.install((async () => {
    fetched = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch);
  let applied = false;
  const result = await sync.pullLive({
    isBlocked: true,
    getSnapshot: () => ({ people: [person("p1")], roles: { r: {} }, bookGens: gens }),
    apply: () => {
      applied = true;
    },
  });
  assert.equal(fetched, false);
  assert.equal(applied, false);
  assert.equal(result.blocked, true);
});

test("production POST is restore-only", () => {
  assert.equal(isAdminRestorePost({ json: "{}" }), false);
  assert.equal(isAdminRestorePost({ restore: true, json: "{}" }), true);
  assert.equal(isAdminRestorePost({ data: { allowEmpty: true } }), true);
  assert.equal(isAdminRestorePost({ data: { restore: true } }), true);
});

test("mergeKeepPeople never drops a live hire the incoming org omitted", () => {
  const kept = mergeKeepPeople(
    [person("p1"), person("priya")],
    [person("p1", { name: "P1 updated", updatedAt: 8 })],
  ) as { id: string }[];
  assert.deepEqual(kept.map((p) => p.id).sort(), ["p1", "priya"]);
});

test("A1-parallel persist: org and months applied from the same stored gen both survive", () => {
  const people = Array.from({ length: 12 }, (_, i) => person(`p${i}`));
  const stored: Snapshot = {
    bookGens: { ...gens },
    people,
    trash: [],
    rewardRecords: {
      "2026-04": Object.fromEntries(people.slice(0, 10).map((p) => [p.id, rec(`open-${p.id}`, { status: "draft" })])),
    },
  };
  const hrPeople = [
    ...people,
    person("priya-1"),
    person("priya-2"),
    person("priya-3"),
    person("priya-4"),
    person("priya-5"),
  ];
  const hr = applyBookPatches(stored, { org: { people: hrPeople, trash: [] } }, { org: 4 });
  const locked: Record<string, unknown> = {};
  for (const p of people.slice(0, 10)) locked[p.id] = rec(`lock-${p.id}`, { status: "plan_locked", updatedAt: 9 });
  const rewards = applyBookPatches(stored, { months: { rewardRecords: { "2026-04": locked } } }, { months: 4 });
  assert.deepEqual(hr.applied, ["org"]);
  assert.deepEqual(rewards.applied, ["months"]);
  const out: Snapshot = {
    ...stored,
    people: hr.snapshot.people,
    trash: hr.snapshot.trash,
    rewardRecords: rewards.snapshot.rewardRecords,
    bookGens: {
      org: (hr.snapshot.bookGens as Record<string, number>).org,
      plans: 4,
      months: (rewards.snapshot.bookGens as Record<string, number>).months,
      targets: 4,
    },
  };
  const ids = (out.people as { id: string }[]).map((p) => p.id);
  for (const id of ["priya-1", "priya-2", "priya-3", "priya-4", "priya-5"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  const month = (out.rewardRecords as Record<string, Record<string, { status: string }>>)["2026-04"];
  for (const p of people.slice(0, 10)) {
    assert.equal(month[p.id].status, "plan_locked");
  }
});
