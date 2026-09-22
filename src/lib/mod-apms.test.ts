/**
 * Stage 4 — APMS screens fetch month-records, not the company file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { listMonthRecordsPage, parseScreenReadPath } from "./company-screen-read.ts";
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
  openApmsMonth: (period: string, opts?: Record<string, unknown>) => Promise<{ records: unknown[]; url: string }>;
  openApmsPerson: (
    period: string,
    personId: string,
  ) => Promise<{ payload: Record<string, unknown> | null; url: string }>;
  maybeScreenRead: () => void;
  collectEntityOps: (local: Record<string, unknown>, remote: Record<string, unknown>) => unknown[];
  save: (snap: Record<string, unknown>) => Promise<{ ok?: boolean }>;
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

function rec(status: string, extra: Record<string, unknown> = {}) {
  return { status, kras: [], ...extra };
}

test.after(() => {
  delete (globalThis as { __apmsNavUi?: unknown }).__apmsNavUi;
});

test("parseScreenReadPath matches month-records list only", () => {
  assert.deepEqual(parseScreenReadPath("/api/month-records/2026-09"), {
    kind: "month-records",
    period: "2026-09",
  });
  assert.equal(parseScreenReadPath("/api/month-records/2026-09/p1"), null);
});

test("listMonthRecordsPage is that month only; two people persist", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks({
    people: [person("p1"), person("p2")],
    records: {},
  } as Snapshot);
  await patchEntity(
    sql,
    { table: "month_records", period: "2026-09", personId: "p1" },
    { payload: rec("plan_open", { kpi: 1 }), baseRev: 0 },
    books,
  );
  await patchEntity(
    sql,
    { table: "month_records", period: "2026-09", personId: "p2" },
    { payload: rec("plan_open", { kpi: 2 }), baseRev: 0 },
    books,
  );
  await patchEntity(
    sql,
    { table: "month_records", period: "2026-08", personId: "p1" },
    { payload: rec("closed"), baseRev: 0 },
    books,
  );
  const page = await listMonthRecordsPage(sql, "2026-09", { limit: 80 });
  assert.equal(page.period, "2026-09");
  assert.equal(page.records.length, 2);
  assert.ok(page.records.some((r) => r.personId === "p1"));
  assert.ok(page.records.some((r) => r.personId === "p2"));
  assert.equal(page.records.every((r) => r.period === "2026-09"), true);
});

test("same person+month stale PATCH is 409", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks({ people: [person("p1")], records: {} } as Snapshot);
  const key = { table: "month_records" as const, period: "2026-09", personId: "p1" };
  const first = await patchEntity(sql, key, { payload: rec("plan_open"), baseRev: 0 }, books);
  assert.equal(first.status, 200);
  const stale = await patchEntity(sql, key, { payload: rec("plan_locked"), baseRev: 0 }, books);
  assert.equal(stale.status, 409);
});

test("scorecard Network is month-records, not company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    records: {},
    view: "apms-person",
    selectedPersonId: "p1",
    currentMonth: "2026-09",
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (/\/api\/month-records\/2026-09\/p1$/.test(url)) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "month_records",
          period: "2026-09",
          personId: "p1",
          payload: rec("plan_open", { note: "from-row" }),
          rev: 2,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("scorecard must not hit " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.records = snap.records;
      return true;
    },
  });
  const out = await sync.openApmsPerson("2026-09", "p1");
  assert.ok(out.url.includes("/api/month-records/2026-09/p1"), out.url);
  assert.ok(urls.every((u) => u.includes("/api/month-records/")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  const month = (local.records as Record<string, Record<string, { note?: string }>>)["2026-09"];
  assert.equal(month?.p1?.note, "from-row");
});

test("APMS month index GET /api/month-records/:period and not company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    records: {},
    view: "apms",
    currentMonth: "2026-09",
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({
        ok: true,
        period: "2026-09",
        records: [{ personId: "p1", period: "2026-09", payload: rec("plan_open"), rev: 1 }],
        total: 1,
        limit: 80,
        offset: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.records = snap.records;
      return true;
    },
  });
  const out = await sync.openApmsMonth("2026-09", { limit: 80 });
  assert.ok(out.url.includes("/api/month-records/2026-09"), out.url);
  assert.ok(out.url.includes("limit="), out.url);
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("A saves P1; B on Home fetches nothing APMS; B opens P1 and sees it", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    records: { "2026-09": { p1: rec("plan_open", { note: "old" }) } },
    view: "home",
    currentMonth: "2026-09",
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
    notebookUpdatedAt: 40,
  };
  sync.noteLoaded(localB);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "home", currentMonth: "2026-09" }),
  };
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (/\/api\/month-records\/2026-09\/p1$/.test(url)) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: rec("plan_open", { note: "from-A" }),
          rev: 3,
          deleted: false,
          period: "2026-09",
          personId: "p1",
        }),
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
      localB.records = snap.records;
      return true;
    },
  });
  sync.handleLiveEvent({
    at: Date.now(),
    bookGens: { org: 1, plans: 1, months: 5, targets: 1 },
    entities: [{ type: "month-records", id: "p1", period: "2026-09" }],
  });
  await waitMs(40);
  assert.equal(urls.length, 0, "Home must not GET APMS month-records: " + JSON.stringify(urls));
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "apms-person", currentMonth: "2026-09", selectedPersonId: "p1" }),
  };
  localB.view = "apms-person";
  localB.selectedPersonId = "p1";
  sync.maybeScreenRead();
  await waitMs(40);
  assert.ok(urls.some((u) => /\/api\/month-records\/2026-09\/p1$/.test(u)), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  const month = (localB.records as Record<string, Record<string, { note?: string }>>)["2026-09"];
  assert.equal(month?.p1?.note, "from-A");
});

test("People / Rewards screens do not fetch month-records on APMS ticks", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    view: "org-people",
    currentMonth: "2026-09",
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "org-people", currentMonth: "2026-09" }),
  };
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (String(input).includes("/api/people?limit=")) {
      return new Response(JSON.stringify({ ok: true, people: [person("p1")], total: 1, limit: 80, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("must not hit " + String(input));
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  sync.handleLiveEvent({
    at: Date.now(),
    bookGens: { org: 1, plans: 1, months: 2, targets: 1 },
    entities: [{ type: "month-records", id: "p1", period: "2026-09" }],
  });
  await waitMs(40);
  assert.equal(urls.some((u) => u.includes("/api/month-records/")), false, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("fallbackPost absent; stamp p0as77; People/Rewards still off company", () => {
  const src = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(src.includes("fallbackPost"), false);
  assert.equal(src.includes("p0as77"), true);
  assert.equal(src.includes("p0as73"), true);
  assert.equal(src.includes("openApmsMonth"), true);
  assert.equal(src.includes("fetchApmsPersonRow"), true);
  assert.equal(src.includes("/api/people?limit="), true);
  assert.equal(src.includes("/api/reward-records/"), true);
  const routes = readFileSync(new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0as72.js", import.meta.url), "utf8");
  assert.equal(routes.includes("openPeopleScreen"), false);
});

test("nav session wires APMS month index — exportSnapshot strips view", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    records: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({
        ok: true,
        period: "2026-09",
        records: [{ personId: "p1", period: "2026-09", payload: rec("plan_open"), rev: 1 }],
        total: 1,
        limit: 80,
        offset: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "apms", currentMonth: "2026-09" }),
  };
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      local.records = snap.records;
      return true;
    },
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/month-records/2026-09") && u.includes("limit=")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("scorecard / plan / execution / values GET month-records person row, not company", async () => {
  const views = ["apms-person", "apms-plan", "execution", "values", "kroc"];
  for (const view of views) {
    sync.resetForTests();
    (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
      loadSession: () => ({ view, currentMonth: "2026-09", selectedPersonId: "p1" }),
    };
    const local: Record<string, unknown> = {
      people: [person("p1")],
      records: {},
      bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
      notebookUpdatedAt: 10,
    };
    const urls: string[] = [];
    sync.install((async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (/\/api\/month-records\/2026-09\/p1$/.test(url)) {
        return new Response(
          JSON.stringify({
            ok: true,
            payload: rec("plan_open", { tab: view }),
            rev: 2,
            deleted: false,
            period: "2026-09",
            personId: "p1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(view + " must not hit " + url);
    }) as typeof fetch);
    sync.noteLoaded(local);
    sync.setLiveHooks({
      isBlocked: () => false,
      getSnapshot: () => local,
      apply: (snap: Record<string, unknown>) => {
        local.records = snap.records;
        return true;
      },
    });
    await waitMs(20);
    assert.ok(
      urls.some((u) => /\/api\/month-records\/2026-09\/p1$/.test(u)),
      view + " " + JSON.stringify(urls),
    );
    assert.equal(urls.some((u) => u.includes("/api/company")), false, view);
  }
});

test("expand person on APMS month index GETs that month-record", async () => {
  sync.resetForTests();
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "apms", currentMonth: "2026-09" }),
  };
  const local: Record<string, unknown> = {
    people: [person("p1")],
    records: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/month-records/2026-09?") || /\/api\/month-records\/2026-09$/.test(url.split("?")[0] || "")) {
      return new Response(
        JSON.stringify({
          ok: true,
          period: "2026-09",
          records: [{ personId: "p1", period: "2026-09", payload: rec("plan_open"), rev: 1 }],
          total: 1,
          limit: 80,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (/\/api\/month-records\/2026-09\/p1$/.test(url)) {
      return new Response(
        JSON.stringify({ ok: true, payload: rec("plan_open", { expanded: true }), rev: 1, personId: "p1", period: "2026-09" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("expand must not hit " + url);
  }) as typeof fetch);
  sync.noteLoaded(local);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/month-records/2026-09") && u.includes("limit=")), JSON.stringify(urls));
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "apms", currentMonth: "2026-09", selectedPersonId: "p1" }),
  };
  sync.maybeScreenRead();
  await waitMs(20);
  assert.ok(urls.some((u) => /\/api\/month-records\/2026-09\/p1$/.test(u)), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("concurrent month-records same person+month → 200+409; different people both 200", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks({ people: [person("p1"), person("p2")], records: {} } as Snapshot);
  const key = { table: "month_records" as const, period: "2026-09", personId: "p1" };
  const seed = await patchEntity(sql, key, { payload: rec("plan_open"), baseRev: 0, clientOpId: "apms-seed" }, books);
  assert.equal(seed.status, 200);
  const [a, b] = await Promise.all([
    patchEntity(sql, key, { payload: rec("plan_locked", { who: "A" }), baseRev: 1, clientOpId: "apms-a" }, books),
    patchEntity(sql, key, { payload: rec("plan_locked", { who: "B" }), baseRev: 1, clientOpId: "apms-b" }, books),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify({ a: a.status, b: b.status }));
  const [c, d] = await Promise.all([
    patchEntity(
      sql,
      { table: "month_records", period: "2026-09", personId: "p1" },
      { payload: rec("plan_open", { who: "p1" }), baseRev: 2, clientOpId: "apms-p1" },
      books,
    ),
    patchEntity(
      sql,
      { table: "month_records", period: "2026-09", personId: "p2" },
      { payload: rec("plan_open", { who: "p2" }), baseRev: 0, clientOpId: "apms-p2" },
      books,
    ),
  ]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(d.status, 200, JSON.stringify(d.body));
});

test("People listHits≥1 and Rewards listHits≥1 from nav session; idle company 0", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [person("p1")],
    rewardRecords: {},
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
    if (url.includes("/api/reward-records/2026-09")) {
      return new Response(JSON.stringify({ ok: true, records: [], total: 0, limit: 80, offset: 0, period: "2026-09" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("must not " + url);
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "org-people", currentMonth: "2026-09" }),
  };
  sync.setLiveHooks({ isBlocked: () => false, getSnapshot: () => local, apply: () => true });
  await waitMs(20);
  const peopleHits = urls.filter((u) => u.includes("/api/people?limit=")).length;
  assert.ok(peopleHits >= 1, JSON.stringify(urls));
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "rewards", currentMonth: "2026-09" }),
  };
  sync.maybeScreenRead();
  await waitMs(20);
  const rewardHits = urls.filter((u) => u.includes("/api/reward-records/2026-09")).length;
  assert.ok(rewardHits >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

