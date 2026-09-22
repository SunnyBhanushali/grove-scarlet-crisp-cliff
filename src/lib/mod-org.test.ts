/**
 * Stage 5 — Org + person profile + trash fetch slices, not the company file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  getOrgNodeFromBook,
  orgSliceFromBook,
  parseOrgPath,
  patchOrgNodeInBook,
  listTrashPeople,
} from "./company-org-read.ts";
import { memoryEntityBooks, patchEntity } from "./company-entities.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  handleLiveEvent: (t: unknown) => unknown;
  maybeScreenRead: () => void;
  openOrgSlice: (kind: string) => Promise<{ url: string; body?: unknown }>;
  openOrgNode: (kind: string, id: string) => Promise<{ url: string; payload?: unknown }>;
  openOrgPerson: (id: string) => Promise<{ url: string; payload?: unknown }>;
  collectEntityOps: (s: Record<string, unknown>) => Array<{ url: string }>;
};

const migration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");

function waitMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function book(): Snapshot {
  return {
    companies: [{ id: "c1", name: "Aliens", rev: 1 }],
    brands: [
      { id: "b1", name: "Studio", rev: 1 },
      { id: "b2", name: "Lab", rev: 1 },
    ],
    businessUnits: [
      { id: "s1", name: "Thane", rev: 1 },
      { id: "s2", name: "Andheri", rev: 1 },
    ],
    functions: [{ id: "f1", name: "Art", rev: 1 }],
    roles: { r1: { id: "r1", name: "Artist", rev: 1 } },
    people: [{ id: "p1", name: "Asha" }],
  };
}

test("parseOrgPath list vs node", () => {
  assert.deepEqual(parseOrgPath("/api/org"), { list: true });
  assert.deepEqual(parseOrgPath("/api/org/sbus"), { list: true, kind: "sbus" });
  assert.deepEqual(parseOrgPath("/api/org/sbus/s1"), { list: false, kind: "sbus", id: "s1" });
});

test("SBU slice is businessUnits, not the company file", () => {
  const slice = orgSliceFromBook(book(), "sbus");
  assert.equal(slice.kind, "sbus");
  assert.ok(Array.isArray(slice.businessUnits));
  assert.equal((slice.businessUnits as unknown[]).length, 2);
  assert.equal(slice.people, undefined);
  assert.equal(slice.records, undefined);
});

test("two different org nodes both persist; stale same row is 409", () => {
  let snap = book();
  const a = patchOrgNodeInBook(snap, "sbus", "s1", { name: "Thane West" }, 1);
  assert.equal(a.status, 200);
  snap = a.book;
  const b = patchOrgNodeInBook(snap, "sbus", "s2", { name: "Andheri West" }, 1);
  assert.equal(b.status, 200);
  snap = b.book;
  const units = snap.businessUnits as Array<{ id: string; name: string }>;
  assert.equal(units.find((u) => u.id === "s1")?.name, "Thane West");
  assert.equal(units.find((u) => u.id === "s2")?.name, "Andheri West");
  const stale = patchOrgNodeInBook(snap, "sbus", "s1", { name: "old" }, 1);
  assert.equal(stale.status, 409);
});

test("open org-person Network is /api/people/:id not company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1", name: "old" }],
    view: "org-person",
    selectedPersonId: "p1",
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (/\/api\/people\/p1$/.test(url)) {
      return new Response(
        JSON.stringify({ ok: true, payload: { id: "p1", name: "Asha" }, rev: 2, deleted: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("must not hit " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.people = snap.people;
      return true;
    },
  });
  const out = await sync.openOrgPerson("p1");
  assert.ok(out.url.endsWith("/api/people/p1"), out.url);
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  assert.equal((local.people as Array<{ name: string }>)[0]?.name, "Asha");
});

test("open SBU Network is that slice not company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [],
    businessUnits: [],
    view: "org-sbus",
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({ ok: true, kind: "sbus", businessUnits: [{ id: "s1", name: "Thane" }], sbuMembers: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.businessUnits = snap.businessUnits;
      return true;
    },
  });
  const out = await sync.openOrgSlice("sbus");
  assert.ok(out.url.includes("/api/org?kind=sbus"), out.url);
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("A edits a person; B on Home fetches nothing org; B opens profile and sees it", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [{ id: "p1", name: "old" }],
    view: "home",
    currentMonth: "2026-09",
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (/\/api\/people\/p1$/.test(url)) {
      return new Response(
        JSON.stringify({ ok: true, payload: { id: "p1", name: "from-A" }, rev: 3, deleted: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("unexpected " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      if (reason !== "live-entity") return false;
      localB.people = snap.people;
      return true;
    },
  });
  sync.handleLiveEvent({
    at: Date.now(),
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "org-sbus", id: "s1" }],
  });
  await waitMs(40);
  assert.equal(urls.some((u) => u.includes("/api/org")), false, JSON.stringify(urls));
  localB.view = "org-person";
  localB.selectedPersonId = "p1";
  sync.maybeScreenRead();
  await waitMs(40);
  assert.ok(urls.some((u) => /\/api\/people\/p1$/.test(u)), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  assert.equal((localB.people as Array<{ name: string }>)[0]?.name, "from-A");
});

test("APMS/Rewards/Home do not GET /api/org on org ticks", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1" }],
    view: "apms",
    currentMonth: "2026-09",
    selectedPersonId: "p1",
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (String(input).includes("/api/month-records/")) {
      return new Response(JSON.stringify({ ok: true, records: [], payload: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("no org pull: " + String(input));
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  sync.handleLiveEvent({
    at: Date.now(),
    entities: [{ type: "org-brands", id: "b1" }],
  });
  await waitMs(40);
  assert.equal(urls.some((u) => u.includes("/api/org")), false, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("save org node PATCHes /api/org/:kind/:id", () => {
  sync.resetForTests();
  const local = {
    people: [{ id: "p1" }],
    roles: {},
    businessUnits: [{ id: "s1", name: "Thane" }],
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const next = {
    ...local,
    businessUnits: [{ id: "s1", name: "Thane West" }],
  };
  const ops = sync.collectEntityOps(next);
  assert.ok(ops.some((op) => op.url === "/api/org/sbus/s1"), JSON.stringify(ops));
});

test("listTrashPeople is deleted rows only", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(migration);
  const sql: HotSql = {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  const books = memoryEntityBooks({ people: [] } as Snapshot);
  await patchEntity(sql, { table: "people", id: "live" }, { payload: { id: "live", name: "Live" }, baseRev: 0 }, books);
  await patchEntity(
    sql,
    { table: "people", id: "gone" },
    { payload: { id: "gone", name: "Gone" }, baseRev: 0, deleted: true },
    books,
  );
  const page = await listTrashPeople(sql);
  assert.equal(page.people.some((p) => p.id === "gone"), true);
  assert.equal(page.people.some((p) => p.id === "live"), false);
});

test("fallbackPost absent; stamp p0as74; APMS/Rewards still off company", () => {
  const src = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(src.includes("fallbackPost"), false);
  assert.equal(src.includes("p0as74"), true);
  assert.equal(src.includes("openOrgSlice"), true);
  assert.equal(src.includes("/api/month-records/"), true);
  assert.equal(src.includes("/api/reward-records/"), true);
});

test("getOrgNodeFromBook returns that SBU", () => {
  const got = getOrgNodeFromBook(book(), "sbus", "s1");
  assert.equal(got.status, 200);
  assert.equal((got.body.payload as { name: string }).name, "Thane");
});
