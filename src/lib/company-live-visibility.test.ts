import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assembleForGet } from "./company-assemble.ts";
import type { Snapshot } from "./company-books.ts";
import { memoryEntityBooks, patchEntity } from "./company-entities.ts";
import { importHotTables, type HotSql } from "./company-hot-tables.ts";
import {
  currentLiveAt,
  currentLiveEntities,
  currentLiveGens,
  encodeSse,
  hintFromEntityTable,
  publishEntityWrite,
  subscribeCompanyLive,
} from "./company-live.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  noteRemote: (t: unknown) => void;
  handleLiveEvent: (t: unknown) => { queued: number; shouldPull: boolean; at: number };
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  pullLive: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  applyPulledBooks: (
    local: Record<string, unknown>,
    books: Record<string, Record<string, unknown>>,
    skip: Record<string, number>,
  ) => Record<string, unknown>;
  rowConflicts: () => Array<{ personId: string; period: string; field: string }>;
  showGlobalConflictBar: () => boolean;
  dismissRowConflict: (period: string, personId: string) => void;
};

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

test("SSE frames include bookGens and entity hints", () => {
  const frame = encodeSse(
    50,
    { org: 3, plans: 1, months: 2, targets: 1 },
    [{ type: "people", id: "p-live" }],
  );
  const body = JSON.parse(frame.slice(6).trim()) as {
    at: number;
    bookGens: { org: number };
    entities: Array<{ type: string; id: string }>;
  };
  assert.equal(body.at, 50);
  assert.equal(body.bookGens.org, 3);
  assert.equal(body.entities[0].id, "p-live");
});

test("PATCH people 200 → immediate assemble GET includes that id (5 times)", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
  await importHotTables(sql, stored, { updatedBy: "vis" });
  const books = memoryEntityBooks(stored);
  for (let i = 1; i <= 5; i++) {
    const id = `hire-${i}`;
    const res = await patchEntity(
      sql,
      { table: "people", id },
      { payload: person(id, { title: "Hire" }), baseRev: 0, clientOpId: `op-hire-${i}` },
      books,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { snapshot } = await assembleForGet(sql, stored);
    const ids = (snapshot.people as { id: string }[]).map((p) => p.id);
    assert.ok(ids.includes(id), `assemble missing ${id} right after PATCH 200`);
  }
});

test("PATCH people publishes live gens; B pullLive sees the id without a full reload", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    people: [person("p1")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
  await importHotTables(sql, stored, { updatedBy: "vis" });
  const books = memoryEntityBooks(stored);
  const ticks: number[] = [];
  const stop = subscribeCompanyLive((at) => ticks.push(at));
  const before = currentLiveAt();
  const res = await patchEntity(
    sql,
    { table: "people", id: "p-live" },
    { payload: person("p-live", { name: "Live Hire" }), baseRev: 0, clientOpId: "op-live-hire" },
    books,
  );
  stop();
  assert.equal(res.status, 200);
  assert.ok(currentLiveAt() >= before);
  assert.ok((currentLiveGens()?.org || 0) >= 1);
  assert.ok(ticks.length >= 1);

  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded(localB);
  sync.noteRemote({
    at: currentLiveAt(),
    bookGens: currentLiveGens(),
    entities: currentLiveEntities().length
      ? currentLiveEntities()
      : [{ type: "people", id: "p-live" }],
  });
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.equal(url.includes("snapshotJson"), false, url);
    if (url.includes("/api/people/p-live")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-live",
          payload: person("p-live", { name: "Live Hire" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("pullLive must GET the one person, not books: " + url);
  }) as typeof fetch;
  sync.install(fake);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok((pulled.entities as Array<{ id: string }>).some((row) => row.id === "p-live"), JSON.stringify(pulled));
  assert.equal(pulled.banner, false);
  assert.ok(applied);
  const ids = (applied.people as { id: string }[]).map((p) => p.id);
  assert.ok(ids.includes("p-live"));
});

test("at-only SSE tick still pulls people (does not skip because gens missing)", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: { org: 2, plans: 1, months: 2, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(localB);
  sync.noteRemote({ at: 99 });
  const fake = (async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        books: {
          org: { people: [person("p1"), person("p-new")], roles: { r: { id: "r" } }, trash: [] },
          months: { rewardRecords: { "2026-09": { p1: { status: "plan_locked" } } } },
          targets: { targetCells: {} },
        },
        bookGens: { org: 2, plans: 1, months: 2, targets: 1 },
        notebookUpdatedAt: 99,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  sync.install(fake);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok((pulled.pulled as string[]).includes("org"));
  assert.ok((pulled.pulled as string[]).includes("months"));
  const ids = (applied?.people as { id: string }[]).map((p) => p.id);
  assert.ok(ids.includes("p-new"));
  const lock = (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1;
  assert.equal(lock.status, "plan_locked");
});

test("PATCH reward-record lock → assemble + B pullLive sees the lock", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
    people: [person("p1")],
    rewardRecords: { "2026-09": { p1: { status: "draft", updatedAt: 1 } } },
  };
  await importHotTables(sql, stored, { updatedBy: "vis" });
  const books = memoryEntityBooks(stored);
  const res = await patchEntity(
    sql,
    { table: "reward_records", period: "2026-09", personId: "p1" },
    { payload: { status: "plan_locked", notes: "locked" }, baseRev: 1, clientOpId: "op-lock-p1" },
    books,
  );
  assert.equal(res.status, 200);
  const { snapshot } = await assembleForGet(sql, stored);
  assert.equal(
    (snapshot.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1.status,
    "plan_locked",
  );

  sync.resetForTests();
  const gens = currentLiveGens() || { org: 1, plans: 1, months: 4, targets: 1 };
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: gens,
  };
  sync.noteLoaded(localB);
  sync.noteRemote({
    at: currentLiveAt(),
    bookGens: gens,
    entities: [{ type: "reward_records", id: "p1", period: "2026-09" }],
  });
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/reward-records/")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "reward_records",
          period: "2026-09",
          personId: "p1",
          payload: { status: "plan_locked", notes: "locked" },
          rev: 2,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("lock pullLive must GET the reward row, not books: " + url);
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok(((pulled.entities as Array<{ type: string }>) || []).some((row) => row.type === "reward-records" || row.type === "reward_records"));
  assert.equal(pulled.banner, false);
  assert.equal(
    (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1.status,
    "plan_locked",
  );
});

test("A PATCH people 200 → B pullLive sees name, B conflict banner hidden", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    view: "settings",
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded(localB);
  sync.noteRemote({
    at: 80,
    bookGens: { org: 3, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-hire" }],
  });
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/people/p-hire")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-hire",
          payload: person("p-hire", { name: "New Hire" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("idle B must not download books/snapshotJson: " + url);
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.equal(pulled.banner, false);
  assert.equal(sync.showGlobalConflictBar(), false);
  assert.equal(sync.rowConflicts().length, 0);
  const ids = (applied?.people as { id: string }[]).map((p) => p.id);
  assert.ok(ids.includes("p-hire"));
});

test("A PATCH reward-record on X, B idle on Settings → no banner, lock in state", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("x"), person("y")],
    roles: { r: { id: "r" } },
    view: "settings",
    rewardRecords: {
      "2026-09": { x: { status: "draft" }, y: { status: "draft" } },
    },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(localB);
  sync.noteRemote({ at: 90, bookGens: { org: 1, plans: 1, months: 5, targets: 1 } });
  sync.install((async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        books: {
          months: {
            rewardRecords: { "2026-09": { x: { status: "plan_locked" }, y: { status: "draft" } } },
          },
        },
        bookGens: { org: 1, plans: 1, months: 5, targets: 1 },
        notebookUpdatedAt: 90,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.equal(pulled.banner, false);
  assert.equal(sync.showGlobalConflictBar(), false);
  assert.equal(sync.rowConflicts().length, 0);
  assert.equal(
    (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].x.status,
    "plan_locked",
  );
});

test("B dirty on X+month, A saves X+month → row conflict only, no global bar; different person still merges", async () => {
  sync.resetForTests();
  const loaded = {
    people: [person("x"), person("y")],
    roles: { r: { id: "r" } },
    view: "rewards-person",
    selectedPersonId: "x",
    selectedMonth: "2026-09",
    rewardRecords: {
      "2026-09": { x: { status: "draft", notes: "acked" }, y: { status: "draft" } },
    },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(loaded);
  const dirtyB = {
    ...loaded,
    rewardRecords: {
      "2026-09": { x: { status: "draft", notes: "B typing" }, y: { status: "draft" } },
    },
  };
  sync.noteRemote({ at: 110, bookGens: { org: 1, plans: 1, months: 6, targets: 1 } });
  sync.install((async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        books: {
          months: {
            rewardRecords: {
              "2026-09": {
                x: { status: "plan_locked", notes: "A lock" },
                y: { status: "plan_locked", notes: "A other" },
              },
            },
          },
        },
        bookGens: { org: 1, plans: 1, months: 6, targets: 1 },
        notebookUpdatedAt: 110,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => dirtyB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.equal(pulled.banner, false);
  assert.equal(sync.showGlobalConflictBar(), false);
  const recs = applied?.rewardRecords as Record<string, Record<string, { status?: string; notes?: string }>>;
  assert.equal(recs["2026-09"].x.notes, "B typing");
  assert.equal(recs["2026-09"].y.status, "plan_locked");
  const hits = sync.rowConflicts();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].personId, "x");
  assert.equal(hits[0].period, "2026-09");
  sync.dismissRowConflict("2026-09", "x");
  assert.equal(sync.rowConflicts().length, 0);
});

test("routes SPA has no global Refresh-to-take-their-version copy", () => {
  const src = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(src.includes("Someone else saved this same person"), false);
  assert.equal(src.includes("Refresh to take their version"), false);
});

test("hint types are API path names, not table names", () => {
  assert.equal(hintFromEntityTable("people", { id: "p9" }).type, "people");
  assert.equal(hintFromEntityTable("reward_records", { personId: "p1", period: "2026-09" }).type, "reward-records");
  assert.equal(hintFromEntityTable("month_records", { personId: "p1", period: "2026-09" }).type, "month-records");
  assert.equal(hintFromEntityTable("target_cells", { id: "c1" }).type, "target-cells");
  const frame = encodeSse(1, { org: 1, plans: 1, months: 1, targets: 1 }, []);
  const body = JSON.parse(frame.slice(6).trim()) as { entities: unknown };
  assert.equal(Array.isArray(body.entities), true);
});

test("PATCH people publishes people hint; B GET /api/people/:id", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    people: [person("p1")],
  };
  await importHotTables(sql, stored, { updatedBy: "hint" });
  const books = memoryEntityBooks(stored);
  const res = await patchEntity(
    sql,
    { table: "people", id: "p-hint" },
    { payload: person("p-hint", { name: "Hint Hire" }), baseRev: 0, clientOpId: "op-hint-hire" },
    books,
  );
  assert.equal(res.status, 200);
  const hints = currentLiveEntities();
  assert.ok(hints.some((h) => h.type === "people" && h.id === "p-hint"), JSON.stringify(hints));

  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: currentLiveGens() || { org: 2, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded(localB);
  sync.noteRemote({ at: currentLiveAt(), bookGens: currentLiveGens(), entities: hints });
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-hint")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-hint",
          payload: person("p-hint", { name: "Hint Hire" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("must GET the person entity: " + url);
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok(urls.some((u) => u.includes("/api/people/p-hint")), JSON.stringify(urls));
  assert.equal(pulled.banner, false);
  assert.ok((applied?.people as { id: string }[]).some((p) => p.id === "p-hint"));
});

test("PATCH reward-records publishes hyphen type on the live channel", async () => {
  const gens = await publishEntityWrite(
    "reward_records",
    hintFromEntityTable("reward_records", { personId: "p1", period: "2026-09" }),
  );
  assert.ok((Number(gens.months) || 0) >= 1);
  const hints = currentLiveEntities();
  assert.ok(
    hints.some((h) => h.type === "reward-records" && h.id === "p1" && h.period === "2026-09"),
    JSON.stringify(hints),
  );
  assert.equal(
    hints.some((h) => h.type === "reward_records"),
    false,
    JSON.stringify(hints),
  );
  const frame = encodeSse(currentLiveAt(), currentLiveGens(), hints);
  const body = JSON.parse(frame.replace(/^data: /, "").trim()) as {
    entities: Array<{ type: string }>;
  };
  assert.ok(body.entities.some((row) => row.type === "reward-records"));
});

test("hyphen reward-records hint GETs /api/reward-records/:period/:id", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(localB);
  sync.noteRemote({
    at: 120,
    bookGens: { org: 1, plans: 1, months: 5, targets: 1 },
    entities: [{ type: "reward-records", id: "p1", period: "2026-09" }],
  });
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/reward-records/2026-09/p1")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: { status: "plan_locked" },
          rev: 2,
          deleted: false,
          period: "2026-09",
          personId: "p1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("must GET reward-records entity: " + url);
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok(urls.some((u) => u.includes("/api/reward-records/")), JSON.stringify(urls));
  assert.equal(
    (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1.status,
    "plan_locked",
  );
});

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("G9 hop A+B: published SSE/tick drives B entity GET without hand pullLive (hire)", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    people: [person("p1")],
  };
  await importHotTables(sql, stored, { updatedBy: "g9" });
  const books = memoryEntityBooks(stored);
  const res = await patchEntity(
    sql,
    { table: "people", id: "p-g9" },
    { payload: person("p-g9", { name: "G9 Hire" }), baseRev: 0, clientOpId: "op-g9-hire" },
    books,
  );
  assert.equal(res.status, 200);
  const frame = encodeSse(currentLiveAt(), currentLiveGens(), currentLiveEntities());
  const payload = JSON.parse(frame.replace(/^data: /, "").trim()) as {
    at: number;
    bookGens: Record<string, number>;
    entities: Array<{ type: string; id: string }>;
  };
  assert.ok(payload.entities.some((row) => row.type === "people" && row.id === "p-g9"), JSON.stringify(payload));

  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 1,
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  let applied = null as Record<string, unknown> | null;
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-g9")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-g9",
          payload: person("p-g9", { name: "G9 Hire" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("G9 hire must GET /api/people/p-g9, not " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  const driven = sync.handleLiveEvent(payload);
  assert.equal(driven.shouldPull, true);
  await waitMs(30);
  assert.ok(urls.some((u) => u.includes("/api/people/p-g9")), JSON.stringify(urls));
  const ids = ((applied || localB).people as { id: string }[]).map((p) => p.id);
  assert.ok(ids.includes("p-g9"), JSON.stringify(applied));
  assert.equal(sync.showGlobalConflictBar(), false);
});

test("G9 hop A+B: tick GET wrapFetch (no hand pullLive) GETs reward-records", async () => {
  const sql = await openSql();
  const stored: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
    people: [person("p1")],
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
  };
  await importHotTables(sql, stored, { updatedBy: "g9" });
  const books = memoryEntityBooks(stored);
  const res = await patchEntity(
    sql,
    { table: "reward_records", period: "2026-09", personId: "p1" },
    { payload: { status: "plan_locked", notes: "g9 lock" }, baseRev: 1, clientOpId: "op-g9-lock" },
    books,
  );
  assert.equal(res.status, 200);
  const tick = {
    at: currentLiveAt(),
    bookGens: currentLiveGens(),
    entities: currentLiveEntities(),
  };
  assert.ok(
    tick.entities.some((row) => row.type === "reward-records" && row.id === "p1"),
    JSON.stringify(tick),
  );

  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  let applied = null as Record<string, unknown> | null;
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/company-tick")) {
      return new Response(JSON.stringify(tick), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/reward-records/2026-09/p1")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: { status: "plan_locked", notes: "g9 lock" },
          rev: 2,
          deleted: false,
          period: "2026-09",
          personId: "p1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("G9 lock unexpected URL " + url);
  }) as typeof fetch;
  sync.install(fake);
  sync.setLiveHooks({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  await (globalThis.fetch as typeof fetch)("/api/company-tick", { credentials: "include" });
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/company-tick")), JSON.stringify(urls));
  assert.ok(urls.some((u) => u.includes("/api/reward-records/")), JSON.stringify(urls));
  assert.equal(
    (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1.status,
    "plan_locked",
  );
  assert.equal(sync.showGlobalConflictBar(), false);
});

test("routes EventSource/tick call handleLiveEvent (hop A wired)", () => {
  const src = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(src.includes("handleLiveEvent"), true);
  assert.equal(src.includes("setLiveHooks"), true);
  assert.equal(src.includes("withCredentials:!0"), true);
  assert.equal(src.includes("&&i())"), false);
});

test("G9 two-client: live at<=local still GETs /api/people from entities payload (no hand pullLive)", async () => {
  // Live p0as39 only called i()/pullLive when tick.at > d.current. That is the
  // morning LOAD-10 pulls=0 hole. Entities on the published tick must drive B.
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 4, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 9_999_999,
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  let applied = null as Record<string, unknown> | null;
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-two")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-two",
          payload: person("p-two", { name: "Two Client Hire" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("two-client must GET /api/people/p-two, not " + url);
  }) as typeof fetch);

  const liveAtOnlyWouldPull =
    50 > Number(localB.notebookUpdatedAt);
  assert.equal(liveAtOnlyWouldPull, false, "this case is the live p0as39 skip");

  sync.setLiveHooks({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
      localB.people = snap.people;
    },
  });
  const frame = encodeSse(
    50,
    { org: 5, plans: 1, months: 1, targets: 1 },
    [{ type: "people", id: "p-two" }],
  );
  const payload = JSON.parse(frame.replace(/^data: /, "").trim()) as {
    at: number;
    entities: Array<{ type: string; id: string }>;
  };
  const driven = sync.handleLiveEvent(payload);
  assert.equal(driven.shouldPull, true);
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/people/p-two")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
  const ids = ((applied || localB).people as { id: string; name?: string }[]).map((p) => p.id);
  assert.ok(ids.includes("p-two"), JSON.stringify(applied));
  const hired = ((applied || localB).people as { id: string; name?: string }[]).find((p) => p.id === "p-two");
  assert.equal(hired?.name, "Two Client Hire");
  assert.equal(sync.showGlobalConflictBar(), false);
});

test("G9 hop A race: tick wrapFetch before setLiveHooks still GETs entity after hooks attach", async () => {
  // wrapFetch handleLiveEvent runs before routes setLiveHooks. Pending hints
  // must flush when hooks attach — otherwise morning pulls=0.
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  let applied = null as Record<string, unknown> | null;
  const tick = {
    at: 77,
    bookGens: { org: 1, plans: 1, months: 5, targets: 1 },
    entities: [{ type: "reward-records", id: "p1", period: "2026-09" }],
  };
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/company-tick")) {
      return new Response(JSON.stringify(tick), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/reward-records/2026-09/p1")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: { status: "plan_locked", notes: "late hooks" },
          rev: 2,
          deleted: false,
          period: "2026-09",
          personId: "p1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/changes")) {
      return new Response(JSON.stringify({ ok: true, seq: 0, changes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("race must GET reward-records, not " + url);
  }) as typeof fetch);

  await (globalThis.fetch as typeof fetch)("/api/company-tick", { credentials: "include" });
  await waitMs(20);
  // via=init: the row GET may start before hooks exist (fetchHintNow); what
  // matters is that nothing is applied until hooks attach, then it is.
  assert.equal(applied === null, true, "applied before hooks");

  sync.setLiveHooks({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/reward-records/")), JSON.stringify(urls));
  assert.equal(
    (applied?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"].p1.status,
    "plan_locked",
  );
});

test("idle matching gens + empty entities does not GET books or snapshotJson", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 3, plans: 1, months: 2, targets: 1 },
    notebookUpdatedAt: 40,
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("idle tick must fetch nothing: " + String(input));
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: () => {
      throw new Error("idle must not apply");
    },
  });
  sync.handleLiveEvent({
    at: 40,
    bookGens: { org: 3, plans: 1, months: 2, targets: 1 },
    entities: [],
  });
  await waitMs(30);
  assert.deepEqual(urls, []);
});

