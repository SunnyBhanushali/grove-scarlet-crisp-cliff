/**
 * LOAD-10-ARMY fixes: plans PATCH, screen-read wiring, G9 tick persist.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyBookPatches } from "./company-books.ts";
import { handleCompanyTickRequest } from "./company-live-http.ts";
import { currentLiveAt, currentLiveEntities, currentLiveGens, hydrateLiveFromTickRow, persistLiveTick, resetLiveForTests } from "./company-live.ts";
import { issueSessionToken, useMemorySessionsForTests } from "./apms-sessions.ts";

// BATCH-2: only server-issued session tokens are accepted.
useMemorySessionsForTests();
const TOKEN_SUNNY = await issueSessionToken("p-admin");

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

function waitMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test("valid plans PATCH applies; stale baseGen is 409 not 500", () => {
  const stored = {
    bookGens: { org: 1, plans: 4, months: 1, targets: 1 },
    kpiMaster: [{ id: "k1", name: "old" }],
    people: [{ id: "p1" }],
    roles: { r: { id: "r" } },
  };
  const ok = applyBookPatches(stored, { plans: { kpiMaster: [{ id: "k1", name: "ARMY-MARKER" }] } }, { plans: 4 });
  assert.deepEqual(ok.applied, ["plans"]);
  assert.equal(ok.conflict.length, 0);
  const kpis = ok.snapshot.kpiMaster as Array<{ name: string }>;
  assert.equal(kpis[0].name, "ARMY-MARKER");
  const stale = applyBookPatches(ok.snapshot, { plans: { kpiMaster: [{ id: "k1", name: "nope" }] } }, { plans: 4 });
  assert.ok(stale.conflict.includes("plans"));
  assert.equal(stale.applied.includes("plans"), false);
});

test("list APIs unused because exportSnapshot strips view — nav session wires them", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1" }],
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
    // kp()/exportSnapshot omits view
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true, people: [{ id: "p1" }], records: [], total: 1, limit: 80, offset: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "org-people", currentMonth: "2026-09" }),
  };
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/people?limit=")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("Rewards month uses list URL from nav session, not company", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1" }],
    roles: {},
    rewardRecords: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true, records: [], total: 0, limit: 80, offset: 0, period: "2026-09" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "rewards", currentMonth: "2026-09" }),
  };
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: () => true,
  });
  await waitMs(20);
  assert.ok(urls.some((u) => u.includes("/api/reward-records/2026-09")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("after hydrate, GET /api/company and /_serverFn LOAD are local unchanged", async () => {
  sync.resetForTests();
  sync.noteLoaded({
    people: [{ id: "p1" }],
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  });
  let net = 0;
  sync.install((async () => {
    net += 1;
    throw new Error("network company GET");
  }) as typeof fetch);
  const a = await fetch("/api/company");
  const b = await fetch("/_serverFn/5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const ja = await a.json();
  const jb = await b.json();
  assert.equal(ja.unchanged, true);
  assert.equal(jb.unchanged, true);
  assert.equal(net, 0);
});

test("failure shape entityGets=0 then two-session entity GETs pass", async () => {
  const dead = { type: "reward-records" as const, id: "p-hire", period: "2026-09" };
  function liveP0as14Url(hint: { type?: string }) {
    if (hint.type === "people") return "/api/people/x";
    return "";
  }
  assert.equal(liveP0as14Url(dead), "");
  sync.resetForTests();
  resetLiveForTests();
  const tickRow = {
    at: Date.now() + 60_000,
    bookGens: { org: 1, plans: 0, months: 1, targets: 0 },
    entities: [
      { type: "people" as const, id: "p-hire", at: Date.now() + 59_000 },
      { type: "reward-records" as const, id: "p-hire", period: "2026-09", at: Date.now() + 60_000 },
    ],
  };
  hydrateLiveFromTickRow(tickRow);
  await persistLiveTick();
  const res = await handleCompanyTickRequest(
    new Request("http://127.0.0.1/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const tick = (await res.json()) as { entities?: Array<{ type: string; id: string; period?: string }>; at: number };
  assert.ok(Array.isArray(tick.entities), JSON.stringify(tick));
  assert.ok(tick.entities.some((e) => e.type === "people" && e.id === "p-hire"));
  assert.ok(tick.entities.some((e) => e.type === "reward-records" && e.id === "p-hire"));
  const local: Record<string, unknown> = {
    people: [{ id: "p1", name: "old" }],
    rewardRecords: {},
    roles: {},
    view: "org-people",
    bookGens: { org: 1, plans: 0, months: 0, targets: 0 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-hire")) {
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
    if (url.includes("/api/people?limit=")) {
      return new Response(JSON.stringify({ ok: true, people: [], total: 0, limit: 80, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("no company file: " + url);
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "org-people", currentMonth: "2026-09" }),
  };
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      if (reason !== "live-entity") return false;
      if (snap.people) local.people = snap.people;
      if (snap.rewardRecords) local.rewardRecords = snap.rewardRecords;
      return true;
    },
  });
  sync.handleLiveEvent(tick);
  await waitMs(50);
  const peopleGet = urls.filter((u) => /\/api\/people\/p-hire$/.test(u)).length;
  const lockGet = urls.filter((u) => u.includes("/api/reward-records/2026-09/p-hire")).length;
  assert.ok(peopleGet >= 1, JSON.stringify(urls));
  assert.ok(lockGet >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
  const name = (local.people as Array<{ id: string; name?: string }>).find((p) => p.id === "p-hire")?.name;
  assert.equal(name, "Ada Hire");
});

test("tick entities persist after empty-memory hydrate (PM2 worker B)", async () => {
  resetLiveForTests();
  const at = Date.now() + 120_000;
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
  assert.ok(row.entities.some((e) => e.type === "people" && e.id === "p-hire"));
  await persistLiveTick();
  resetLiveForTests();
  hydrateLiveFromTickRow(row);
  const res = await handleCompanyTickRequest(
    new Request("http://127.0.0.1/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const tick = (await res.json()) as { entities: Array<{ type: string; id: string }> };
  assert.ok(tick.entities.some((e) => e.type === "people" && e.id === "p-hire"), JSON.stringify(tick));
  assert.ok(
    tick.entities.some((e) => e.type === "reward-records" && e.id === "p-hire"),
    JSON.stringify(tick),
  );
});

test("Home idle does not pull the company file", async () => {
  sync.resetForTests();
  const local: Record<string, unknown> = {
    people: [{ id: "p1" }],
    roles: {},
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(local);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (String(input).includes("/api/people/p-hire")) {
      return new Response(JSON.stringify({ ok: true, payload: { id: "p-hire", name: "Ada" }, rev: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("home must not " + String(input));
  }) as typeof fetch);
  (globalThis as { __apmsNavUi?: { loadSession: () => Record<string, string> } }).__apmsNavUi = {
    loadSession: () => ({ view: "home" }),
  };
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      if (reason === "live-entity" && snap.people) local.people = snap.people;
      return true;
    },
  });
  sync.handleLiveEvent({
    at: Date.now(),
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-hire" }],
  });
  await waitMs(40);
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
});

test("fallbackPost absent; stamp p0as75; routes not hand-edited", () => {
  const syncSrc = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0as72.js", import.meta.url), "utf8");
  const company = readFileSync(new URL("../../src/routes/api/company.ts", import.meta.url), "utf8");
  const live = readFileSync(new URL("./company-live.ts", import.meta.url), "utf8");
  const notebook = readFileSync(new URL("./company-notebook.ts", import.meta.url), "utf8");
  assert.equal(syncSrc.includes("fallbackPost"), false);
  assert.equal(syncSrc.includes("p0as75"), true);
  assert.equal(syncSrc.includes("loadSession"), true);
  assert.equal(syncSrc.includes('uiView() === ""'), false);
  assert.equal(routes.includes("openPeopleScreen"), false);
  const patchBlock = company.slice(company.indexOf("PATCH:"));
  assert.equal(patchBlock.includes("getCompanyWire"), false);
  assert.equal(patchBlock.includes("[api/company PATCH] patch-failed"), true);
  assert.equal(patchBlock.includes("409"), true);
  assert.equal(live.includes("hydrateLiveFromTickRow"), true);
  assert.equal(notebook.includes("softInvalidateCompanyWire"), true);
});

test("entityUrl for army hints is non-empty", () => {
  assert.equal(sync.entityUrl({ type: "people", id: "p-hire" }), "/api/people/p-hire");
  assert.equal(
    sync.entityUrl({ type: "reward-records", id: "p-hire", period: "2026-09" }),
    "/api/reward-records/2026-09/p-hire",
  );
});
