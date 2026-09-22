import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  listPeoplePage,
  listRewardMonthPage,
  parseScreenReadPath,
  SCREEN_PAGE_LIMIT,
} from "./company-screen-read.ts";
import { importHotTables, type HotSql } from "./company-hot-tables.ts";
import { patchEntity, memoryEntityBooks } from "./company-entities.ts";
import type { Snapshot } from "./company-books.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  handleLiveEvent: (t: unknown) => unknown;
  openPeopleScreen: (opts?: Record<string, unknown>) => Promise<{ people: unknown[]; url: string }>;
  openRewardsMonth: (
    period: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ records: unknown[]; url: string }>;
  maybeScreenRead: () => void;
  mergeKeepPeopleClient: (a: unknown, b: unknown) => unknown;
};

const migration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: extra.name || id, ...extra };
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

function waitMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test("parseScreenReadPath matches list URLs only", () => {
  assert.deepEqual(parseScreenReadPath("/api/people"), { kind: "people" });
  assert.deepEqual(parseScreenReadPath("/api/people/"), { kind: "people" });
  assert.equal(parseScreenReadPath("/api/people/p-admin"), null);
  assert.deepEqual(parseScreenReadPath("/api/reward-records/2026-09"), {
    kind: "reward-records",
    period: "2026-09",
  });
  assert.equal(parseScreenReadPath("/api/reward-records/2026-09/p1"), null);
  assert.equal(SCREEN_PAGE_LIMIT, 80);
});

test("listPeoplePage filters q/sbu and respects limit", async () => {
  const sql = await openSql();
  await importHotTables(
    sql,
    {
      people: [
        person("p1", { name: "Ada", buId: "sbu-a" }),
        person("p2", { name: "Bo", buId: "sbu-b" }),
        person("p3", { name: "Adaire", buId: "sbu-a" }),
      ],
    } as Snapshot,
    { updatedBy: "test" },
  );
  const page = await listPeoplePage(sql, { limit: 80, q: "Ada" });
  assert.equal(page.people.every((p) => String(p.name).toLowerCase().includes("ada")), true);
  assert.ok(page.people.length >= 1);
  const sbu = await listPeoplePage(sql, { limit: 80, sbu: "sbu-a" });
  assert.equal(sbu.people.every((p) => p.buId === "sbu-a"), true);
  const tiny = await listPeoplePage(sql, { limit: 1 });
  assert.equal(tiny.people.length, 1);
  assert.ok(tiny.total >= 3);
});

test("listRewardMonthPage returns that month only", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks({
    people: [person("p1"), person("p2")],
    rewardRecords: {},
  } as Snapshot);
  await patchEntity(
    sql,
    { table: "reward_records", period: "2026-09", personId: "p1" },
    { payload: { status: "plan_locked" }, baseRev: 0 },
    books,
  );
  await patchEntity(
    sql,
    { table: "reward_records", period: "2026-08", personId: "p1" },
    { payload: { status: "draft" }, baseRev: 0 },
    books,
  );
  const page = await listRewardMonthPage(sql, "2026-09", { limit: 80 });
  assert.equal(page.period, "2026-09");
  assert.ok(page.records.some((r) => r.personId === "p1"));
  assert.equal(page.records.every((r) => r.period === "2026-09"), true);
});

test("Open People: GET /api/people?limit= and does not GET /api/company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people?limit=")) {
      return new Response(
        JSON.stringify({
          ok: true,
          people: [person("p1"), person("p2", { name: "Bo" })],
          total: 2,
          limit: 80,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("People screen must not hit " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.people = snap.people;
      return true;
    },
  });
  const out = await sync.openPeopleScreen({ limit: 80 });
  assert.ok(out.url.includes("/api/people?limit="), out.url);
  assert.ok(urls.some((u) => u.includes("/api/people?limit=")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
  assert.ok((local.people as { id: string }[]).some((p) => p.id === "p2"));
});

test("Open Rewards month: GET /api/reward-records/YYYY-MM and no company GET", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    rewardRecords: { "2026-09": { p1: { status: "draft" } } },
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/reward-records/2026-09")) {
      return new Response(
        JSON.stringify({
          ok: true,
          period: "2026-09",
          records: [{ personId: "p1", period: "2026-09", payload: { status: "plan_open" }, rev: 1 }],
          total: 1,
          limit: 80,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("Rewards month must not hit " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.rewardRecords = snap.rewardRecords;
      return true;
    },
  });
  const out = await sync.openRewardsMonth("2026-09", { limit: 80 });
  assert.ok(out.url.includes("/api/reward-records/2026-09"), out.url);
  assert.ok(urls.some((u) => /\/api\/reward-records\/2026-09/.test(u)), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
});

test("A PATCH people → B list updates from /api/people/:id only", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p-hire", { name: "Old" })],
    roles: {},
    bookGens: { org: 4, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 99,
  };
  sync.noteLoaded(localB);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-hire") && !url.includes("limit=")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: person("p-hire", { name: "Ada Hire" }),
          rev: 2,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("B must GET the row only, not " + url);
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
    bookGens: { org: 5, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-hire" }],
  });
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/people/p-hire")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("?limit=")), false, JSON.stringify(urls));
  const hired = (localB.people as { id: string; name?: string }[]).find((p) => p.id === "p-hire");
  assert.equal(hired?.name, "Ada Hire");
});

test("after first hydrate, GET /api/company is unchanged locally (no network)", async () => {
  sync.resetForTests();
  sync.noteLoaded({
    people: [person("p1")],
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 50,
  });
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("must not network " + String(input));
  }) as typeof fetch);
  const res = await fetch("/api/company", { credentials: "include" });
  assert.equal(res.ok, true);
  const body = (await res.json()) as { unchanged?: boolean; snapshotJson?: unknown };
  assert.equal(body.unchanged, true);
  assert.equal(body.snapshotJson, null);
  assert.deepEqual(urls, []);
});

test("maybeScreenRead opens People list once when view is org-people", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    view: "org-people",
    currentMonth: "2026-09",
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people?limit=")) {
      return new Response(JSON.stringify({ ok: true, people: [person("p1")], total: 1, limit: 80, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("must not hit " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/people?limit=")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  const n = urls.length;
  sync.maybeScreenRead();
  await waitMs(20);
  assert.equal(urls.length, n, "second watch must not refetch same view");
});

test("SPA list watch lives in sync; stamp p0as71; routes not syntax-broken", async () => {
  const routes = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0as72.js", import.meta.url),
    "utf8",
  );
  const syncSrc = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(routes.includes("openPeopleScreen"), false);
  assert.equal(routes.includes("`${e.personId}-${e.functionId}`"), true);
  assert.equal(syncSrc.includes("maybeScreenRead"), true);
  assert.equal(syncSrc.includes("fallbackPost"), false);
  const acorn = await import("acorn");
  acorn.parse(routes, { ecmaVersion: 2022, sourceType: "module" });
});
