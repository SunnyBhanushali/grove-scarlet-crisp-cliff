/**
 * G9-LIVE-2: when A saves, B GETs THAT row. Not the company file.
 * Starts from the live failure shape (pulls>0, entityGets=0) then passes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeSse, hintFromEntityTable, publishEntityWrite, resetLiveForTests } from "./company-live.ts";
import { handleCompanyTickRequest } from "./company-live-http.ts";
import { TOKEN_SUNNY } from "./apms-request-auth.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  handleLiveEvent: (t: unknown) => { queued: number; shouldPull: boolean; at: number };
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  showGlobalConflictBar: () => boolean;
  entityUrl: (hint: { type?: string; id?: string; period?: string } | null) => string;
  lastLiveTrace: () => {
    tick: { at: number; bookGens: unknown; entities: unknown[] } | null;
    urls: Array<{ hint: unknown; url: string }>;
  };
};

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Live p0as14 hop B: only underscore table names. Hyphen API types → empty URL. */
function liveP0as14EntityUrl(hint: { type?: string; id?: string; period?: string } | null): string {
  if (!hint || !hint.type || !hint.id) return "";
  if (hint.type === "people") return "/api/people/" + encodeURIComponent(hint.id);
  if (hint.type === "reward_records" && hint.period) {
    return "/api/reward-records/" + encodeURIComponent(hint.period) + "/" + encodeURIComponent(hint.id);
  }
  return "";
}

test("stamp p0as69 + entityUrl exported; no fallbackPost", () => {
  const src = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(src.includes("fallbackPost"), false);
  assert.equal(src.includes("p0as69"), true);
  assert.equal(src.includes("p0as60"), true);
  assert.equal(typeof sync.entityUrl, "function");
});

test("live failure shape: lastWireAt drop + hyphen URL → pulls>0 entityGets=0", () => {
  const tick = {
    at: 88,
    bookGens: { org: 5, plans: 1, months: 6, targets: 1 },
    entities: [
      { type: "people", id: "p-hire", at: 88 },
      { type: "reward-records", id: "p-hire", period: "2026-09", at: 88 },
    ],
  };
  // Live p0as14: B already hydrated GET /api/company (lastWireAt >= tick.at).
  const lastWireAt = 88;
  const fresh = tick.entities.filter((h) => {
    const hat = Number(h.at) || 0;
    if (hat && hat <= lastWireAt) return false;
    return true;
  });
  let entityGets = 0;
  let emptyUrls = 0;
  for (const hint of tick.entities) {
    const url = liveP0as14EntityUrl(hint);
    if (!url) emptyUrls += 1;
    else if (url.includes("/api/people/") || url.includes("/api/reward-records/")) entityGets += 1;
  }
  // Hints dropped vs lastWireAt → pullLive GETs the company file instead.
  const pulls = fresh.length === 0 ? 55 : 0;
  assert.equal(fresh.length, 0, "p0as14 dropped every hint against lastWireAt");
  assert.equal(liveP0as14EntityUrl(tick.entities[1]), "", "hyphen reward-records URL empty");
  assert.ok(emptyUrls >= 1);
  assert.ok(pulls > 0);
  assert.equal(entityGets === 0 || fresh.length === 0, true);
  // Observer never called entity GET because pendingEntities was empty.
  const observerEntityGets = fresh.length === 0 ? 0 : entityGets;
  assert.equal(observerEntityGets, 0);
});

test("two sessions: A PATCH people + reward-records → B tick JSON → entity GET both rows", async () => {
  resetLiveForTests();
  sync.resetForTests();

  const sessionA = {
    people: [person("p-hire", { name: "Old Name" })],
    rewardRecords: { "2026-09": { "p-hire": { status: "draft" } } },
  };
  await publishEntityWrite(
    "people",
    hintFromEntityTable("people", { id: "p-hire" }),
    { payload: { ...sessionA.people[0], name: "Ada Hire" }, deleted: false },
  );
  await publishEntityWrite(
    "reward_records",
    hintFromEntityTable("reward_records", { id: "p-hire", period: "2026-09" }),
    { payload: { status: "plan_locked", personId: "p-hire" }, deleted: false },
  );

  const tickRes = await handleCompanyTickRequest(
    new Request("http://apms.local/api/company-tick?since=0", {
      headers: { cookie: `better-auth.session_token=${TOKEN_SUNNY}` },
    }),
  );
  assert.equal(tickRes.status, 200);
  const tickJson = (await tickRes.json()) as {
    at: number;
    bookGens: Record<string, number> | null;
    entities: Array<{ type: string; id: string; period?: string; at?: number }>;
  };
  console.log("G9_LIVE_2_TICK_JSON", JSON.stringify(tickJson));
  assert.ok(Array.isArray(tickJson.entities), "B tick has entities[]");
  assert.ok(
    tickJson.entities.some((h) => h.type === "people" && h.id === "p-hire"),
    JSON.stringify(tickJson),
  );
  assert.ok(
    tickJson.entities.some(
      (h) => (h.type === "reward-records" || h.type === "reward_records") && h.id === "p-hire",
    ),
    JSON.stringify(tickJson),
  );

  const sse = encodeSse(tickJson.at, tickJson.bookGens as Parameters<typeof encodeSse>[1], tickJson.entities);
  const ssePayload = JSON.parse(sse.replace(/^data: /, "").trim()) as typeof tickJson;
  console.log("G9_LIVE_2_SSE_JSON", JSON.stringify(ssePayload));

  const urlsForHints = tickJson.entities.map((hint) => {
    const url = sync.entityUrl(hint);
    return { hint, url };
  });
  console.log("G9_LIVE_2_ENTITY_URLS", JSON.stringify(urlsForHints));
  for (const row of urlsForHints) {
    assert.ok(row.url, `empty entityUrl = hop B dead: ${JSON.stringify(row.hint)}`);
  }

  const sessionB: Record<string, unknown> = {
    people: [person("p-hire", { name: "Old Name" })],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-09": { "p-hire": { status: "draft" } } },
    bookGens: { org: 4, plans: 1, months: 4, targets: 1 },
    notebookUpdatedAt: 9_999_999,
  };
  sync.noteLoaded(sessionB);

  const urls: string[] = [];
  let applyReason = "";
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-hire")) {
      return new Response(
        JSON.stringify({
          ok: true,
          table: "people",
          id: "p-hire",
          payload: person("p-hire", { name: "Ada Hire" }),
          rev: 2,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/reward-records/2026-09/p-hire")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: { status: "plan_locked", personId: "p-hire" },
          rev: 2,
          deleted: false,
          period: "2026-09",
          personId: "p-hire",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/company")) {
      throw new Error("B must GET the row, not the company file: " + url);
    }
    throw new Error("unexpected B GET " + url);
  }) as typeof fetch);

  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => sessionB,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      applyReason = String(reason || "");
      if (Array.isArray(snap.people) && snap.people.length && reason !== "live-entity") {
        return false;
      }
      sessionB.people = snap.people;
      sessionB.rewardRecords = snap.rewardRecords;
      return true;
    },
  });

  const driven = sync.handleLiveEvent(tickJson);
  assert.equal(driven.shouldPull, true);
  const trace = sync.lastLiveTrace();
  console.log("G9_LIVE_2_B_TRACE", JSON.stringify(trace));
  await waitMs(60);

  const peopleGets = urls.filter((u) => u.includes("/api/people/p-hire"));
  const rewardGets = urls.filter((u) => u.includes("/api/reward-records/"));
  assert.ok(peopleGets.length >= 1, JSON.stringify(urls));
  assert.ok(rewardGets.length >= 1, JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));

  const hired = (sessionB.people as { id: string; name?: string }[]).find((p) => p.id === "p-hire");
  assert.equal(hired?.name, "Ada Hire");
  const lock = (sessionB.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-09"][
    "p-hire"
  ];
  assert.equal(lock?.status, "plan_locked");
  assert.equal(applyReason, "live-entity");
  assert.equal(sync.showGlobalConflictBar(), false);

  for (const row of trace.urls) {
    assert.ok(row.url, `empty URL in B trace ${JSON.stringify(row)}`);
  }
});

test("B with high lastWireAt still GETs the row (live lastWireAt drop is the dead hop)", async () => {
  sync.resetForTests();
  const sessionB: Record<string, unknown> = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 9, plans: 1, months: 9, targets: 1 },
    notebookUpdatedAt: Date.now() + 60_000,
  };
  sync.noteLoaded(sessionB);
  const urls: string[] = [];
  sync.install((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/people/p-late")) {
      return new Response(
        JSON.stringify({
          ok: true,
          payload: person("p-late", { name: "Late" }),
          rev: 1,
          deleted: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("must GET people row, not " + url);
  }) as typeof fetch);
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => sessionB,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      if (reason !== "live-entity") return false;
      sessionB.people = snap.people;
      return true;
    },
  });
  const now = Date.now();
  sync.handleLiveEvent({
    at: now,
    bookGens: { org: 10, plans: 1, months: 9, targets: 1 },
    entities: [{ type: "people", id: "p-late", at: now }],
  });
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/people/p-late")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false);
});
