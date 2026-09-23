import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeSse } from "./company-live.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  handleLiveEvent: (t: unknown) => { queued: number; shouldPull: boolean; at: number };
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  showGlobalConflictBar: () => boolean;
};

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("fallbackPost is absent; stamp is p0as60", () => {
  const src = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(src.includes("fallbackPost"), false);
  assert.equal(src.includes("p0as60"), true);
  assert.equal(src.includes("handleLiveEvent"), true);
  assert.equal(src.includes("setLiveHooks"), true);
  assert.equal(src.includes("live-entity"), true);
});

test("G9 two-client: published SSE entities drive B GET /api/people (no hand pullLive)", async () => {
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

  assert.equal(50 > Number(localB.notebookUpdatedAt), false);

  let applyReason = "";
  sync.setLiveHooks({
    isBlocked: () => false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>, reason?: string) => {
      applyReason = String(reason || "");
      // Live routes Ft(t) === people.length. Without reason==='live-entity' this
      // returns false and B never shows the hire (LOAD-10 names=0 after GET).
      if (Array.isArray(snap.people) && snap.people.length && reason !== "live-entity") {
        return false;
      }
      applied = snap;
      localB.people = snap.people;
      return true;
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
  assert.ok(payload.entities.some((row) => row.type === "people" && row.id === "p-two"));
  const driven = sync.handleLiveEvent(payload);
  assert.equal(driven.shouldPull, true);
  await waitMs(40);
  assert.ok(urls.some((u) => u.includes("/api/people/p-two")), JSON.stringify(urls));
  assert.equal(urls.some((u) => u.includes("/api/company")), false, JSON.stringify(urls));
  const hired = ((applied || localB).people as { id: string; name?: string }[]).find((p) => p.id === "p-two");
  assert.equal(hired?.name, "Two Client Hire");
  assert.equal(applyReason, "live-entity");
  assert.equal(sync.showGlobalConflictBar(), false);
});

test("G9 hop A race: tick wrapFetch before setLiveHooks still GETs reward-records", async () => {
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
    throw new Error("race must GET reward-records, not " + url);
  }) as typeof fetch);

  await (globalThis.fetch as typeof fetch)("/api/company-tick", { credentials: "include" });
  await waitMs(20);
  // p0as76: fetchHintNow GETs the row even before setLiveHooks (via=init).
  assert.ok(urls.some((u) => u.includes("/api/reward-records/")), JSON.stringify(urls));

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

test("idle matching gens + empty entities does not GET books", async () => {
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

test("routes hop A is wired to handleLiveEvent + credentials + live-entity apply", () => {
  const src = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(src.includes("handleLiveEvent"), true);
  assert.equal(src.includes("setLiveHooks"), true);
  assert.equal(src.includes("withCredentials:!0"), true);
  assert.equal(src.includes("&&i())"), false);
  assert.equal(src.includes("reason===`live-entity`"), true);
  assert.equal(src.includes("K.setState({people:t.people,rewardRecords:t.rewardRecords"), true);
});
