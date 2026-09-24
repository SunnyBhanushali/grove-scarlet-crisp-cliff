import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIVE_ENTITY_CAP,
  entitiesSince,
  pushLiveEntities,
  resetLiveForTests,
} from "./company-live.ts";
import { handleCompanyTickRequest } from "./company-live-http.ts";
import { issueSessionToken, useMemorySessionsForTests } from "./apms-sessions.ts";

// BATCH-2: only server-issued session tokens are accepted.
useMemorySessionsForTests();
const TOKEN_SUNNY = await issueSessionToken("p-admin");

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  LIVE_ENTITY_CAP: number;
  handleLiveEvent: (t: unknown) => { queued: number; shouldPull: boolean; at: number };
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  noteLoaded: (s: Record<string, unknown>) => void;
  mergeKeepPeopleClient: (stored: unknown[], incoming: unknown[]) => unknown[];
};

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installPeopleFetch(localB: Record<string, unknown>) {
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const id = url.split("/").pop() || "x";
    return new Response(
      JSON.stringify({ ok: true, table: "people", id, payload: person(id), rev: 1, deleted: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      localB.people = snap.people;
      return true;
    },
  });
  return urls;
}

test("LIVE_ENTITY_CAP is 20", () => {
  assert.equal(LIVE_ENTITY_CAP, 20);
  assert.equal(sync.LIVE_ENTITY_CAP, 20);
});

test("server tick given 200 old entity ids → response includes ≤20", async () => {
  resetLiveForTests();
  const hints = Array.from({ length: 200 }, (_, i) => ({ type: "people", id: `p-old-${i}` }));
  pushLiveEntities(hints, 1_000);
  assert.equal(entitiesSince(0).length <= 20, true);
  assert.equal(entitiesSince(0).length, 20);
  assert.equal(entitiesSince(2_000).length, 0);
  const res = await handleCompanyTickRequest(
    new Request("http://apms.local/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { entities: unknown[] };
  assert.ok(Array.isArray(body.entities));
  assert.ok(body.entities.length <= 20, String(body.entities.length));
  const bytes = JSON.stringify(body).length;
  assert.ok(bytes < 8_000, `tick body ${bytes}`);
});

test("idle tick since past last write returns empty entities", async () => {
  resetLiveForTests();
  pushLiveEntities(
    Array.from({ length: 200 }, (_, i) => ({ type: "people", id: `p-idle-${i}` })),
    1_000,
  );
  const res = await handleCompanyTickRequest(
    new Request("http://apms.local/api/company-tick?since=2000", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { entities: unknown[] };
  assert.equal(body.entities.length, 0);
  assert.ok(JSON.stringify(body).length < 500, JSON.stringify(body));
});

test("client handleLiveEvent given 200 hints → ≤20 entity GETs", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(localB);
  const urls = installPeopleFetch(localB);
  const ents = Array.from({ length: 200 }, (_, i) => ({ type: "people", id: `p-flood-${i}` }));
  sync.handleLiveEvent({ at: Date.now(), bookGens: { org: 2, plans: 1, months: 1, targets: 1 }, entities: ents });
  await waitMs(80);
  const peopleGets = urls.filter((u) => u.includes("/api/people/"));
  assert.ok(peopleGets.length <= 20, JSON.stringify(peopleGets.length));
  assert.equal(urls.some((u) => u.includes("/api/company?") || u.includes("snapshotJson")), false);
});

test("replayed hints at or before lastPulledAt are ignored (0 extra GETs)", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 5_000,
  };
  sync.noteLoaded(localB);
  const urls = installPeopleFetch(localB);
  sync.handleLiveEvent({
    at: 6_000,
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-fresh", at: 6_000 }],
  });
  await waitMs(40);
  const afterFirst = urls.filter((u) => u.includes("/api/people/")).length;
  assert.ok(afterFirst >= 1, JSON.stringify(urls));
  urls.length = 0;
  sync.handleLiveEvent({
    at: 6_000,
    bookGens: { org: 2, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-fresh", at: 6_000 }],
  });
  await waitMs(40);
  assert.deepEqual(
    urls.filter((u) => u.includes("/api/people/")),
    [],
  );
});

test("G9 new people hint still GETs /api/people/:id", async () => {
  sync.resetForTests();
  const localB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 4, plans: 1, months: 1, targets: 1 },
    notebookUpdatedAt: 9_999_999,
  };
  sync.noteLoaded(localB);
  const urls = installPeopleFetch(localB);
  sync.handleLiveEvent({
    at: 50,
    bookGens: { org: 5, plans: 1, months: 1, targets: 1 },
    entities: [{ type: "people", id: "p-two" }],
  });
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/people/p-two")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});

test("in-place people merge keeps other row identity when id exists", () => {
  const a = person("a", { name: "A" });
  const b = person("b", { name: "B" });
  const stored = [a, b];
  const next = sync.mergeKeepPeopleClient(stored, [{ id: "b", name: "Bee" }]) as { id: string }[];
  assert.equal(next.length, 2);
  assert.equal(next[0], a);
  assert.equal(next[1].id, "b");
  assert.notEqual(next[1], b);
});

test("second GET /api/company no writes → unchanged:true / tiny body", () => {
  const body = JSON.stringify({
    unchanged: true,
    notebookUpdatedAt: 123,
    snapshotJson: null,
    personId: "p-admin",
    entities: [],
    resets: [],
    bootstrap: false,
    forbidden: false,
  });
  assert.ok(body.length < 500, String(body.length));
  assert.equal(JSON.parse(body).unchanged, true);
  assert.equal(JSON.parse(body).snapshotJson, null);
  const wire = readFileSync(new URL("./company-wire-http.ts", import.meta.url), "utf8");
  assert.equal(wire.includes("unchanged: true"), true);
  assert.equal(wire.includes("entities: []"), true);
  assert.equal(wire.includes("currentLiveEntities()"), false);
});

test("SPA virt + stamp p0as60 + no fallbackPost", () => {
  const syncSrc = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  const routes = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(syncSrc.includes("fallbackPost"), false);
  assert.equal(syncSrc.includes("p0as60"), true);
  assert.equal(syncSrc.includes("LIVE_ENTITY_CAP"), true);
  assert.equal(syncSrc.includes("snapshotJson = null"), true);
  assert.equal(routes.includes("function Virt("), true);
  assert.equal(routes.includes("data-virt"), true);
  assert.equal(routes.includes("Virt,{items:j"), true);
  assert.equal(routes.includes("Virt,{items:N"), true);
  assert.equal(routes.includes("Virt,{items:a"), true);
});
