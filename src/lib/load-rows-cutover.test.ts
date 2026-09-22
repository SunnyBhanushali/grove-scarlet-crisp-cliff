/**
 * Step 7 cutover: prove the row path holds under concurrent edits.
 * Isolated PGLite + apms-sync. Does not hit Contabo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assembleForGet } from "./company-assemble.ts";
import { applyBookPatches, peopleCount, type Snapshot } from "./company-books.ts";
import { memoryEntityBooks, patchEntity } from "./company-entities.ts";
import { importHotTables, type HotSql } from "./company-hot-tables.ts";
import { hasUiSessionKeys, stripUiSessionKeys } from "./company-ui-session.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  splitSnapshot: (s: Record<string, unknown>) => Record<string, Record<string, unknown>>;
  applyPulledBooks: (
    local: Record<string, unknown>,
    books: Record<string, Record<string, unknown>>,
    skip: Record<string, number>,
  ) => Record<string, unknown>;
  pullLive: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  noteLoaded: (s: Record<string, unknown>) => void;
  noteRemote: (t: unknown) => void;
  save: (s: Record<string, unknown>) => Promise<Record<string, unknown>>;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  lastSave: () => { via?: string } | null;
};

const seed = JSON.parse(
  readFileSync(new URL("./company-seed.json", import.meta.url), "utf8"),
) as Snapshot;
const migration = readFileSync(
  new URL("../../migrations/0005_hot_tables.sql", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const syncSrc = readFileSync(
  new URL("../../recovered-site/assets/apms-sync.js", import.meta.url),
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

test("A1 row-path: HR adds 5 people while Rewards locks 10 other month-records — both survive refresh", async () => {
  const sql = await openSql();
  const people = Array.from({ length: 12 }, (_, i) => person(`p${i}`));
  const stored: Snapshot = {
    bookGens: { org: 4, plans: 1, months: 4, targets: 1 },
    people,
    records: {},
    rewardRecords: {
      "2026-04": Object.fromEntries(
        people.slice(0, 10).map((p) => [p.id, { status: "draft", updatedAt: 1 }]),
      ),
    },
    targetCells: {},
  };
  await importHotTables(sql, stored, { updatedBy: "cutover" });
  const books = memoryEntityBooks(stored);

  const hires = ["priya-1", "priya-2", "priya-3", "priya-4", "priya-5"].map((id) =>
    patchEntity(
      sql,
      { table: "people", id },
      { payload: person(id), baseRev: 0, clientOpId: `hire-${id}` },
      books,
    ),
  );
  const locks = people.slice(0, 10).map((p) =>
    patchEntity(
      sql,
      { table: "reward_records", period: "2026-04", personId: p.id },
      { payload: { status: "plan_locked", updatedAt: 9 }, baseRev: 1, clientOpId: `lock-${p.id}` },
      books,
    ),
  );
  const results = await Promise.all([...hires, ...locks]);
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

  const { snapshot } = await assembleForGet(sql, stored);
  const ids = (snapshot.people as { id: string }[]).map((p) => p.id);
  for (const id of ["priya-1", "priya-2", "priya-3", "priya-4", "priya-5"]) {
    assert.ok(ids.includes(id), `missing hire ${id} after refresh assemble`);
  }
  const month = (snapshot.rewardRecords as Record<string, Record<string, { status?: string }>>)[
    "2026-04"
  ];
  for (const p of people.slice(0, 10)) {
    assert.equal(month[p.id].status, "plan_locked", `lock lost for ${p.id}`);
  }
});

test("A2 row-path: different people same month both persist; same person stale rev → 409", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
    people: [person("a"), person("b")],
    rewardRecords: {
      "2026-04": { a: { status: "draft", updatedAt: 1 }, b: { status: "draft", updatedAt: 1 } },
    },
  };
  await importHotTables(sql, stored, { updatedBy: "cutover" });
  const books = memoryEntityBooks(stored);
  const [ra, rb] = await Promise.all([
    patchEntity(
      sql,
      { table: "reward_records", period: "2026-04", personId: "a" },
      { payload: { status: "plan_locked", updatedAt: 5 }, baseRev: 1, clientOpId: "lock-a" },
      books,
    ),
    patchEntity(
      sql,
      { table: "reward_records", period: "2026-04", personId: "b" },
      { payload: { status: "plan_locked", updatedAt: 6 }, baseRev: 1, clientOpId: "lock-b" },
      books,
    ),
  ]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  const stale = await patchEntity(
    sql,
    { table: "reward_records", period: "2026-04", personId: "a" },
    { payload: { status: "paid", updatedAt: 99 }, baseRev: 1, clientOpId: "stale-a" },
    books,
  );
  assert.equal(stale.status, 409);
  assert.equal((stale.body.payload as { status?: string }).status, "plan_locked");
  const { snapshot } = await assembleForGet(sql, stored);
  const month = (snapshot.rewardRecords as Record<string, Record<string, { status?: string }>>)[
    "2026-04"
  ];
  assert.equal(month.a.status, "plan_locked");
  assert.equal(month.b.status, "plan_locked");
});

test("A3 Lock never bare “Nothing open.”", () => {
  assert.equal(routes.includes("Nothing open."), false);
  assert.ok(routes.includes("Record missing or lost to sync — refresh"));
});

test("A4 no successful full-snapshot POST /api/company", async () => {
  assert.equal(syncSrc.includes("fallbackPost"), false);
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    kpiMaster: [{ id: "k1" }],
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded(live);
  const methods: string[] = [];
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String(init?.method || "GET").toUpperCase());
    if (String(init?.method || "GET").toUpperCase() === "POST") {
      throw new Error("full POST is forbidden");
    }
    return new Response(
      JSON.stringify({
        ok: true,
        applied: ["plans"],
        conflict: [],
        skipped: [],
        bookGens: { org: 1, plans: 2, months: 1, targets: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  sync.install(fake);
  const res = await globalThis.fetch("/api/company", {
    method: "POST",
    body: JSON.stringify({ json: JSON.stringify({ ...live, kpiMaster: [{ id: "k1" }, { id: "k2" }] }) }),
  });
  assert.equal(res.status, 200);
  assert.equal(methods.includes("POST"), false);
  const empty = await globalThis.fetch("/api/company", {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
  });
  assert.equal(empty.status, 410);
});

test("A5 trash / entity-delete stays gone on GET; UI nav keys never in DB", async () => {
  const stripped = stripUiSessionKeys({
    people: [person("p1")],
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p1",
    selectedMonth: "2026-08",
    selectedRoleId: "r",
    selectedTargetMonth: "2026-08",
  });
  assert.equal(hasUiSessionKeys(stripped), false);
  const booksSplit = sync.splitSnapshot({
    people: [person("p1")],
    roles: { r: {} },
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p1",
  });
  for (const book of Object.values(booksSplit)) {
    assert.equal("currentMonth" in book, false);
    assert.equal("view" in book, false);
    assert.equal("kind" in book, false);
    assert.equal("selectedPersonId" in book, false);
  }

  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p-gone")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
  await importHotTables(sql, stored, { updatedBy: "cutover" });
  const books = memoryEntityBooks(stored);
  const del = await patchEntity(
    sql,
    { table: "people", id: "p-gone" },
    { payload: person("p-gone"), baseRev: 1, deleted: true, clientOpId: "trash-p-gone" },
    books,
  );
  assert.equal(del.status, 200);
  const resurrect = applyBookPatches(
    stored,
    { org: { people: [person("p1"), person("p-gone")], trash: [] } },
    { org: 2 },
  );
  assert.ok((resurrect.snapshot.people as { id: string }[]).some((p) => p.id === "p-gone"));
  const { snapshot } = await assembleForGet(sql, resurrect.snapshot);
  const ids = (snapshot.people as { id: string }[]).map((p) => p.id);
  assert.equal(ids.includes("p-gone"), false, "entity-deleted person must stay gone on GET");
  assert.ok(ids.includes("p1"));
});

test("A6 GET assembled people count is not empty (~180 seed)", async () => {
  const sql = await openSql();
  const { snapshot, meta } = await assembleForGet(sql, seed);
  assert.equal(meta.source, "rows");
  const n = peopleCount(snapshot);
  assert.ok(n >= 170, `assembled people ${n} too low`);
  assert.equal(n, meta.rowPeople);
  assert.equal(n, 180);
});

test("A7 month change does not snap another tab back", async () => {
  sync.resetForTests();
  const local = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p1",
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded({ ...local, currentMonth: "2026-04" });
  sync.noteRemote({ bookGens: { org: 3, plans: 1, months: 1, targets: 1 } });
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.ok(url.includes("books=org"));
    return new Response(
      JSON.stringify({
        ok: true,
        books: {
          org: { people: [person("p1"), person("p2")], roles: { r: { id: "r" } }, trash: [] },
        },
        bookGens: { org: 3, plans: 1, months: 1, targets: 1 },
        notebookUpdatedAt: 70,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  sync.install(fake);
  let applied: Record<string, unknown> | null = null;
  const result = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.deepEqual(result.pulled, ["org"]);
  assert.ok(applied);
  assert.equal(applied.currentMonth, "2026-08");
  assert.equal(applied.view, "rewards");
  assert.equal((applied.people as { id: string }[]).length, 2);

  const merged = sync.applyPulledBooks(
    { ...local, currentMonth: "2026-09" },
    { org: { people: [person("p1")], roles: { r: { id: "r" } } } },
    {},
  );
  assert.equal(merged.currentMonth, "2026-09");
});
