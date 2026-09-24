/**
 * LOAD-10-ARMY-2: G9 via=init entity GET, People list always, OCC 200+409.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { handleCompanyTickRequest } from "./company-live-http.ts";
import {
  currentLiveAt,
  currentLiveEntities,
  currentLiveGens,
  hydrateLiveFromTickRow,
  persistLiveTick,
  resetLiveForTests,
} from "./company-live.ts";
import { issueSessionToken, useMemorySessionsForTests } from "./apms-sessions.ts";

// BATCH-2: only server-issued session tokens are accepted.
useMemorySessionsForTests();
const TOKEN_SUNNY = await issueSessionToken("p-admin");
import { memoryEntityBooks, patchEntity } from "./company-entities.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

test.after(() => {
  delete (globalThis as { __apmsNavUi?: unknown }).__apmsNavUi;
});

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  handleLiveEvent: (t: unknown) => unknown;
  maybeScreenRead: () => void;
  lastLiveTrace: () => { tick: unknown; urls: Array<{ hint: unknown; url: string }> };
  entityUrl: (h: { type?: string; id?: string; period?: string }) => string;
};

const migration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");

function waitMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function stored(): Snapshot {
  return {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p2")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
}

/** Live 7:02 pm IST on p0as75: wrapFetch handleLiveEvent before setLiveHooks → entityGets=0 via=init. */
function liveP0as75ViaInit(opts: { liveHooks: unknown; queued: number }) {
  if (!opts.liveHooks) return { entityGets: 0, via: "init" as const };
  return { entityGets: opts.queued, via: "hooks" as const };
}

test("stamp p0as76; fallbackPost absent; routes not hand-edited; OCC SQL present", () => {
  const syncSrc = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0as72.js", import.meta.url), "utf8");
  const entities = readFileSync(new URL("./company-entities.ts", import.meta.url), "utf8");
  const liveHttp = readFileSync(new URL("./company-live-http.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../recovered-site/index.html", import.meta.url), "utf8");
  assert.equal(syncSrc.includes("fallbackPost"), false);
  assert.equal(syncSrc.includes("p0as76"), true);
  assert.equal(syncSrc.includes("fetchHintNow"), true);
  assert.equal(syncSrc.includes("startLiveWatch"), true);
  assert.equal(syncSrc.includes("lastPeopleFetchAt"), true);
  assert.equal(html.includes("apms-sync.js?v=p0as77") || html.includes("apms-sync.js?v=p0as76"), true);
  assert.equal(routes.includes("openPeopleScreen"), false);
  assert.equal(entities.includes("where people.rev = $5"), true);
  assert.equal(entities.includes("enqueueEntityPatch"), true);
  assert.equal(liveHttp.includes("first ? []"), false);
  assert.equal(liveHttp.includes("currentLiveEntities()"), true);
});

test("live failure shape via=init entityGets=0 then wrapFetch-before-hooks GETs the row", async () => {
  assert.equal(liveP0as75ViaInit({ liveHooks: null, queued: 2 }).entityGets, 0);
  assert.equal(liveP0as75ViaInit({ liveHooks: null, queued: 2 }).via, "init");

  sync.resetForTests();
  resetLiveForTests();
  const hintJson = {
    at: 1789911658991,
    bookGens: { org: 1, plans: 0, months: 1, targets: 0 },
    entities: [
      { type: "people", id: "p-hire", at: 1789911658988 },
      { type: "reward-records", id: "p-hire", period: "2026-09", at: 1789911658991 },
    ],
  };
  const local: Record<string, unknown> = {
    people: [{ id: "p1", name: "old" }],
    rewardRecords: {},
    roles: {},
    bookGens: { org: 1, plans: 0, months: 0, targets: 0 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/company-tick")) {
      return new Response(JSON.stringify(hintJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/\/api\/people\/p-hire$/.test(url)) {
      return new Response(JSON.stringify({ ok: true, payload: { id: "p-hire", name: "Ada Hire" }, rev: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/reward-records/2026-09/p-hire")) {
      return new Response(
        JSON.stringify({ ok: true, payload: { status: "plan_locked" }, period: "2026-09", personId: "p-hire", rev: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("no company file: " + url);
  }) as typeof fetch);
  // via=init: wrapFetch handleLiveEvent BEFORE setLiveHooks.
  await fetch("/api/company-tick?since=0");
  await waitMs(40);
  const peopleGet = urls.filter((u) => /\/api\/people\/p-hire$/.test(u)).length;
  const lockGet = urls.filter((u) => u.includes("/api/reward-records/2026-09/p-hire")).length;
  assert.ok(peopleGet >= 1, JSON.stringify(urls));
  assert.ok(lockGet >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => /\/api\/company(\?|$)/.test(u)), false, JSON.stringify(urls));
  const trace = sync.lastLiveTrace();
  assert.ok(trace.urls.some((row) => row.url === "/api/people/p-hire"), JSON.stringify(trace));
  assert.ok(
    trace.urls.some((row) => row.url === "/api/reward-records/2026-09/p-hire"),
    JSON.stringify(trace),
  );
});

test("two sessions: A PATCH → B tick hint JSON → GET people + reward-records", async () => {
  resetLiveForTests();
  const at = Date.now() + 80_000;
  const hintJson = {
    at,
    bookGens: { org: 1, plans: 0, months: 1, targets: 0 },
    entities: [
      { type: "people" as const, id: "p-hire", at: at - 3 },
      { type: "reward-records" as const, id: "p-hire", period: "2026-09", at },
    ],
  };
  hydrateLiveFromTickRow(hintJson);
  await persistLiveTick();
  const res = await handleCompanyTickRequest(
    new Request("http://127.0.0.1/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const tick = (await res.json()) as {
    at: number;
    bookGens: Record<string, number>;
    entities: Array<{ type: string; id: string; period?: string; at?: number }>;
  };
  console.log("ARMY_2_HINT_JSON", JSON.stringify(tick));
  assert.ok(tick.entities.some((e) => e.type === "people" && e.id === "p-hire"), JSON.stringify(tick));
  assert.ok(
    tick.entities.some((e) => e.type === "reward-records" && e.id === "p-hire" && e.period === "2026-09"),
    JSON.stringify(tick),
  );

  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1", name: "old" }],
    rewardRecords: {},
    roles: {},
    bookGens: { org: 1, plans: 0, months: 0, targets: 0 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (/\/api\/people\/p-hire$/.test(url)) {
      return new Response(JSON.stringify({ ok: true, payload: { id: "p-hire", name: "Ada Hire" }, rev: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/reward-records/2026-09/p-hire")) {
      return new Response(
        JSON.stringify({ ok: true, payload: { status: "plan_locked" }, period: "2026-09", personId: "p-hire", rev: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("no company file: " + url);
  }) as typeof fetch);
  sync.handleLiveEvent(tick);
  await waitMs(40);
  assert.ok(urls.filter((u) => /\/api\/people\/p-hire$/.test(u)).length >= 1, JSON.stringify(urls));
  assert.ok(urls.filter((u) => u.includes("/api/reward-records/2026-09/p-hire")).length >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
});

test("People listHits was 0 because lastScreenKey skipped already-on-org-people / pre-login 401", async () => {
  sync.resetForTests();
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "org-people", currentMonth: "2026-09" }),
  };
  const urls: string[] = [];
  let peopleAuth = 401;
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people?limit=")) {
      if (peopleAuth === 401) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, people: [{ id: "p1" }], records: [], total: 1, limit: 80, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("idle must not " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => ({}),
    apply: () => true,
  });
  sync.maybeScreenRead();
  await waitMs(20);
  const beforeHydrate = urls.filter((u) => u.includes("/api/people?limit=")).length;
  assert.equal(beforeHydrate, 0, "pre-login !everLoaded must not pin lastScreenKey: " + JSON.stringify(urls));

  peopleAuth = 200;
  sync.noteLoaded({
    people: [{ id: "p1" }],
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  });
  await waitMs(20);
  const listHits = urls.filter((u) => u.includes("/api/people?limit=")).length;
  assert.ok(listHits >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));

  const after = urls.length;
  sync.maybeScreenRead();
  await waitMs(10);
  assert.equal(urls.filter((u) => u.includes("/api/people?limit=")).length, listHits, "2s throttle while already on People");
  assert.equal(urls.length, after);
});

test("Rewards month always GET list URL after hydrate; idle company stays 0", async () => {
  sync.resetForTests();
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "rewards", currentMonth: "2026-09" }),
  };
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/reward-records/2026-09")) {
      return new Response(JSON.stringify({ ok: true, records: [], total: 0, limit: 80, offset: 0, period: "2026-09" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("idle must not " + url);
  }) as typeof fetch);
  sync.noteLoaded({
    people: [{ id: "p1" }],
    roles: {},
    rewardRecords: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  });
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => ({}),
    apply: () => true,
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/reward-records/2026-09") && u.includes("limit=")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
});

test("concurrent PATCH same person+month → 200 + 409; different people both 200", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const key = { table: "reward_records" as const, period: "2026-09", personId: "p1" };
  const seed = await patchEntity(
    sql,
    key,
    { payload: { status: "draft", updatedAt: 1 }, baseRev: 0, clientOpId: "op-seed" },
    books,
  );
  assert.equal(seed.status, 200);
  assert.equal(seed.body.rev, 1);

  const a = patchEntity(
    sql,
    key,
    { payload: { status: "plan_locked", updatedAt: 2 }, baseRev: 1, clientOpId: "op-a" },
    books,
  );
  const b = patchEntity(
    sql,
    key,
    { payload: { status: "paid", updatedAt: 3 }, baseRev: 1, clientOpId: "op-b" },
    books,
  );
  const [ra, rb] = await Promise.all([a, b]);
  const codes = [ra.status, rb.status].sort((x, y) => x - y);
  assert.deepEqual(codes, [200, 409], JSON.stringify({ a: ra.status, b: rb.status, aBody: ra.body, bBody: rb.body }));
  const winner = ra.status === 200 ? ra : rb;
  const loser = ra.status === 409 ? ra : rb;
  assert.equal(winner.body.rev, 2);
  assert.equal(loser.body.rev, 2);
  assert.equal(loser.body.ok, false);

  const otherA = patchEntity(
    sql,
    { table: "reward_records", period: "2026-09", personId: "p1" },
    { payload: { status: "held", updatedAt: 10 }, baseRev: 2, clientOpId: "op-p1-next" },
    books,
  );
  const otherB = patchEntity(
    sql,
    { table: "reward_records", period: "2026-09", personId: "p2" },
    { payload: { status: "plan_locked", updatedAt: 11 }, baseRev: 0, clientOpId: "op-p2" },
    books,
  );
  const [oa, ob] = await Promise.all([otherA, otherB]);
  assert.equal(oa.status, 200, JSON.stringify(oa.body));
  assert.equal(ob.status, 200, JSON.stringify(ob.body));
});

test("tick entities persist for worker B empty memory", async () => {
  resetLiveForTests();
  const at = Date.now() + 140_000;
  hydrateLiveFromTickRow({
    at,
    bookGens: { org: 2, plans: 0, months: 2, targets: 0 },
    entities: [
      { type: "people", id: "p-hire", at },
      { type: "reward-records", id: "p-hire", period: "2026-09", at },
    ],
  });
  const row = {
    at: currentLiveAt(),
    bookGens: currentLiveGens(),
    entities: currentLiveEntities(),
  };
  await persistLiveTick();
  resetLiveForTests();
  hydrateLiveFromTickRow(row);
  const res = await handleCompanyTickRequest(
    new Request("http://127.0.0.1/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  const tick = (await res.json()) as { entities: Array<{ type: string; id: string }> };
  assert.ok(tick.entities.some((e) => e.type === "people" && e.id === "p-hire"), JSON.stringify(tick));
});

test("entityUrl army hints stay hyphen URLs", () => {
  assert.equal(sync.entityUrl({ type: "people", id: "p-hire" }), "/api/people/p-hire");
  assert.equal(
    sync.entityUrl({ type: "reward-records", id: "p-hire", period: "2026-09" }),
    "/api/reward-records/2026-09/p-hire",
  );
});
