import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyBookPatches, type Snapshot } from "./company-books.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  BOOK_IDS: string[];
  splitSnapshot: (s: Record<string, unknown>) => Record<string, Record<string, unknown>>;
  bookPayload: (s: Record<string, unknown>, id: string) => Record<string, unknown>;
  dirtyBooks: (s: Record<string, unknown>) => string[];
  buildPatch: (s: Record<string, unknown>, ids: string[]) => { books: Record<string, unknown>; baseGens: Record<string, number> };
  rebaseBook: (id: string, local: Record<string, unknown>, server: Record<string, unknown>) => Record<string, unknown>;
  applyPulledBooks: (local: Record<string, unknown>, books: Record<string, Record<string, unknown>>, skip: Record<string, number>) => Record<string, unknown>;
  extractSnapshot: (v: unknown) => Record<string, unknown> | null;
  noteLoaded: (s: Record<string, unknown>) => void;
  noteRemote: (t: unknown) => void;
  save: (s: Record<string, unknown>) => Promise<Record<string, unknown>>;
  pullLive: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  lastSave: () => { via?: string; bytes?: number; books?: string[] } | null;
  gens: () => { local: Record<string, number>; remote: Record<string, number> };
};

const seed = JSON.parse(
  readFileSync(new URL("./company-seed.json", import.meta.url), "utf8"),
) as Snapshot;

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
}

test("splitSnapshot keeps UI nav out of every book", () => {
  const books = sync.splitSnapshot({
    ...seed,
    currentMonth: "2026-09",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p-1",
    selectedMonth: "2026-08",
  } as Record<string, unknown>);
  for (const book of Object.values(books)) {
    assert.equal("currentMonth" in book, false);
    assert.equal("view" in book, false);
    assert.equal("kind" in book, false);
    assert.equal("selectedPersonId" in book, false);
    assert.equal("selectedMonth" in book, false);
  }
});

test("editing KPIs dirties only the plans book", () => {
  sync.resetForTests();
  sync.noteLoaded(seed as Record<string, unknown>);
  const next = JSON.parse(JSON.stringify(seed)) as Snapshot;
  const kpis = Array.isArray(next.kpiMaster) ? [...(next.kpiMaster as unknown[])] : [];
  kpis.push({ id: "k-new", name: "Draft KPI" });
  next.kpiMaster = kpis;
  assert.deepEqual(sync.dirtyBooks(next as Record<string, unknown>), ["plans"]);
  const patch = sync.buildPatch(next as Record<string, unknown>, ["plans"]);
  assert.equal("plans" in patch.books, true);
  assert.equal("org" in patch.books, false);
  assert.equal("months" in patch.books, false);
  assert.equal("currentMonth" in (patch.books.plans as object), false);
});

test("emptying trash dirties only org", () => {
  sync.resetForTests();
  const live = { ...seed, trash: [{ id: "tr-1", kind: "person" }], bookGens: { org: 4, plans: 1, months: 1, targets: 1 } };
  sync.noteLoaded(live as Record<string, unknown>);
  const next = { ...live, trash: [] };
  assert.deepEqual(sync.dirtyBooks(next as Record<string, unknown>), ["org"]);
});

test("extractSnapshot unwraps {json} and {data:{json}}", () => {
  const snap = { people: [person("p1")], roles: { r: { id: "r" } } };
  const a = sync.extractSnapshot({ json: JSON.stringify(snap) }) as { people: { id: string }[] };
  const b = sync.extractSnapshot({ data: { json: JSON.stringify(snap) } }) as { people: { id: string }[] };
  assert.equal(a.people[0].id, "p1");
  assert.equal(b.people[0].id, "p1");
});

test("wrapFetch passes restore POST through and still 410s a full snapshot POST", async () => {
  sync.resetForTests();
  const methods: string[] = [];
  const bodies: unknown[] = [];
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String(init?.method || "GET").toUpperCase());
    const raw = init?.body;
    bodies.push(typeof raw === "string" ? JSON.parse(raw) : raw);
    return new Response(JSON.stringify({ ok: true, restored: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const snap = { people: [person("p1")], roles: { r: { id: "r" } }, kpiMaster: [] };
  const restore = await globalThis.fetch("/api/company", {
    method: "POST",
    body: JSON.stringify({ data: { json: JSON.stringify(snap), restore: true } }),
  });
  assert.equal(restore.status, 200);
  assert.equal(methods.includes("POST"), true);
  const passed = bodies[0] as { data?: { restore?: boolean } };
  assert.equal(passed?.data?.restore, true);

  methods.length = 0;
  const blocked = await globalThis.fetch("/api/company", {
    method: "POST",
    body: JSON.stringify({ json: JSON.stringify(snap) }),
  });
  assert.equal(blocked.status, 200);
  assert.equal(methods.includes("POST"), false);
});

test("409 rebase keeps local KPI edit and server trash empty", () => {
  sync.resetForTests();
  const base = {
    kpiMaster: [{ id: "k1", name: "Hit rate" }],
    trash: [{ id: "tr-1", kind: "person" }],
    bookGens: { org: 5, plans: 9, months: 1, targets: 1 },
  };
  sync.noteLoaded(base);
  const localPlans = { kpiMaster: [{ id: "k1", name: "Hit rate" }, { id: "k-new", name: "Draft" }] };
  const serverPlans = { kpiMaster: [{ id: "k1", name: "Hit rate" }, { id: "k-other", name: "Other session" }] };
  const rebased = sync.rebaseBook("plans", localPlans, serverPlans);
  const ids = (rebased.kpiMaster as { id: string }[]).map((k) => k.id).sort();
  assert.deepEqual(ids, ["k-new", "k-other", "k1"]);
});

test("applyPulledBooks skips a dirty book so in-progress KPIs survive", () => {
  const local = {
    currentMonth: "2026-08",
    view: "rewards",
    kpiMaster: [{ id: "k-draft", name: "Typing…" }],
    trash: [],
    people: [person("p1")],
    roles: { r: { id: "r" } },
  };
  const pulled = {
    plans: { kpiMaster: [{ id: "k-old", name: "Server" }] },
    org: { trash: [{ id: "tr-ghost" }], people: [person("p1"), person("p2")], roles: { r: { id: "r" } } },
  };
  const merged = sync.applyPulledBooks(local, pulled, { plans: 1 });
  assert.equal((merged.kpiMaster as { id: string }[])[0].id, "k-draft");
  assert.equal((merged.people as { id: string }[]).length, 2);
  assert.equal(merged.currentMonth, "2026-08");
  assert.equal(merged.view, "rewards");
});

test("save PATCHes only dirty books and records ack gens", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1"), person("p2")],
    roles: { r: { id: "r", name: "Role" } },
    kpiMaster: [{ id: "k1" }],
    trash: [],
    bookGens: { org: 3, plans: 9, months: 2, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    kpiMaster: [{ id: "k1" }, { id: "k2", name: "New" }],
    bookGens: { org: 3, plans: 9, months: 2, targets: 1 },
  };
  const fetches: Array<{ url: string; method: string; body: string }> = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const body = String(init?.body || "");
    fetches.push({ url, method, body });
    if (method === "PATCH") {
      const parsed = JSON.parse(body) as { books: { plans?: unknown }; baseGens: { plans?: number } };
      assert.equal("plans" in parsed.books, true);
      assert.equal("org" in parsed.books, false);
      assert.equal(parsed.baseGens.plans, 9);
      assert.ok(body.length < 20_000, `PATCH should be KB-scale, got ${body.length}`);
      return new Response(
        JSON.stringify({
          ok: true,
          applied: ["plans"],
          conflict: [],
          skipped: ["org", "months", "targets"],
          bookGens: { org: 3, plans: 10, months: 2, targets: 1 },
          notebookUpdatedAt: 99,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.equal((ack.bookGens as { plans: number }).plans, 10);
  assert.equal(sync.lastSave()?.via, "PATCH");
  assert.deepEqual(sync.lastSave()?.books, ["plans"]);
  assert.equal(fetches.every((f) => f.method === "PATCH"), true);
});

test("save rebases a 409 then retries with the server gen", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    kpiMaster: [{ id: "k1", name: "Hit" }],
    bookGens: { org: 1, plans: 4, months: 1, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    kpiMaster: [{ id: "k1", name: "Hit" }, { id: "k-local", name: "Mine" }],
  };
  let patches = 0;
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || "GET").toUpperCase();
    const body = String(init?.body || "");
    if (method !== "PATCH") throw new Error(method);
    patches += 1;
    const parsed = JSON.parse(body) as { baseGens: { plans: number }; books: { plans: { kpiMaster: { id: string }[] } } };
    if (patches === 1) {
      assert.equal(parsed.baseGens.plans, 4);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "stale",
          applied: [],
          conflict: ["plans"],
          skipped: ["org", "months", "targets"],
          bookGens: { org: 1, plans: 5, months: 1, targets: 1 },
          notebookUpdatedAt: 50,
          books: { plans: { kpiMaster: [{ id: "k1", name: "Hit" }, { id: "k-server", name: "Theirs" }] } },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
    assert.equal(parsed.baseGens.plans, 5);
    const ids = parsed.books.plans.kpiMaster.map((k) => k.id).sort();
    assert.deepEqual(ids, ["k-local", "k-server", "k1"]);
    return new Response(
      JSON.stringify({
        ok: true,
        applied: ["plans"],
        conflict: [],
        skipped: ["org", "months", "targets"],
        bookGens: { org: 1, plans: 6, months: 1, targets: 1 },
        notebookUpdatedAt: 60,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.equal(patches, 2);
  assert.equal((ack.bookGens as { plans: number }).plans, 6);
});

test("pullLive skips all hydrate while isBlocked (P0-B dirty / in-flight save)", async () => {
  sync.resetForTests();
  const local = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    kpiMaster: [{ id: "k-draft", name: "Typing" }],
    trash: [],
    bookGens: { org: 2, plans: 8, months: 1, targets: 1 },
  };
  sync.noteLoaded({
    ...local,
    kpiMaster: [{ id: "k1", name: "Saved" }],
    bookGens: { org: 2, plans: 8, months: 1, targets: 1 },
  });
  sync.noteRemote({ bookGens: { org: 3, plans: 8, months: 1, targets: 1 } });
  let fetched = false;
  const fake = (async () => {
    fetched = true;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  sync.install(fake);
  let applied: Record<string, unknown> | null = null;
  const result = await sync.pullLive({
    isBlocked: true,
    getSnapshot: () => local,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(result.pulled, []);
  assert.equal(result.blocked, true);
  assert.equal(applied, null);
});

test("pullLive hydrates a clean org book while plans stay dirty", async () => {
  sync.resetForTests();
  const local = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    kpiMaster: [{ id: "k-draft", name: "Typing" }],
    trash: [],
    bookGens: { org: 2, plans: 8, months: 1, targets: 1 },
  };
  sync.noteLoaded({
    ...local,
    kpiMaster: [{ id: "k1", name: "Saved" }],
    bookGens: { org: 2, plans: 8, months: 1, targets: 1 },
  });
  sync.noteRemote({ bookGens: { org: 3, plans: 8, months: 1, targets: 1 } });
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.ok(url.includes("books=org"), url);
    assert.equal(url.includes("plans"), false);
    return new Response(
      JSON.stringify({
        ok: true,
        books: { org: { people: [person("p1"), person("p2")], trash: [], roles: { r: { id: "r" } } } },
        bookGens: { org: 3, plans: 8, months: 1, targets: 1 },
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
  const appliedSnap = applied as Record<string, unknown>;
  assert.equal((appliedSnap.kpiMaster as { id: string }[])[0].id, "k-draft");
  assert.equal((appliedSnap.people as { id: string }[]).length, 2);
});

test("applyBookPatches matching gen replaces only that book", () => {
  const stored: Snapshot = {
    bookGens: { org: 6, plans: 9, months: 4, targets: 2 },
    people: [person("p1")],
    trash: [],
    kpiMaster: [{ id: "k-old" }],
  };
  const result = applyBookPatches(
    stored,
    { plans: { kpiMaster: [{ id: "k-new", name: "Draft KPI" }] } },
    { plans: 9 },
  );
  assert.deepEqual(result.applied, ["plans"]);
  assert.deepEqual(result.conflict, []);
  assert.equal((result.snapshot.kpiMaster as { id?: string }[])[0]?.id, "k-new");
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
  assert.equal((result.snapshot.bookGens as Record<string, number>).plans, 10);
  assert.equal((result.snapshot.bookGens as Record<string, number>).org, 6);
});

test("applyBookPatches stale gen 409s and cannot restore trash", () => {
  const stored: Snapshot = {
    bookGens: { org: 6, plans: 9, months: 4, targets: 2 },
    people: [person("p1")],
    trash: [],
    kpiMaster: [{ id: "k-old" }],
  };
  const result = applyBookPatches(
    stored,
    {
      org: { people: [person("p1")], trash: [{ id: "tr-ghost", kind: "person" }] },
      plans: { kpiMaster: [{ id: "k-new" }] },
    },
    { org: 5, plans: 9 },
  );
  assert.deepEqual(result.applied, ["plans"]);
  assert.deepEqual(result.conflict, ["org"]);
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
});

test("applyBookPatches omitted baseGen is a conflict", () => {
  const stored: Snapshot = {
    bookGens: { org: 2, plans: 2, months: 2, targets: 2 },
    trash: [],
    people: [person("p1")],
  };
  const result = applyBookPatches(stored, { org: { people: [person("p1")], trash: [{ id: "x" }] } }, {});
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.conflict, ["org"]);
  assert.equal((result.snapshot.trash as unknown[]).length, 0);
});

test("save PATCHes hire and lock via entity APIs, never POSTs", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    trash: [],
    rewardRecords: { "2026-04": { p1: { id: "open", status: "draft" } } },
    bookGens: { org: 3, plans: 1, months: 2, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    people: [person("p1"), person("priya")],
    rewardRecords: { "2026-04": { p1: { id: "lock", status: "plan_locked", updatedAt: 9 } } },
  };
  const methods: string[] = [];
  const urls: string[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || "GET").toUpperCase();
    const url = String(input);
    methods.push(method);
    urls.push(url);
    const parsed = JSON.parse(String(init?.body || "{}")) as { payload?: { status?: string; id?: string } };
    const id = url.includes("people") ? "priya" : "p1";
    return new Response(
      JSON.stringify({
        ok: true,
        rev: 1,
        payload: parsed.payload || { id },
        bookGens: { org: 4, plans: 1, months: 3, targets: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.equal(methods.includes("POST"), false);
  assert.equal(methods.every((m) => m === "PATCH"), true);
  assert.equal(methods.length, 2);
  urls.sort();
  assert.ok(urls.some((u) => u.includes("/api/people/priya")));
  assert.ok(urls.some((u) => u.includes("/api/reward-records/2026-04/p1")));
  assert.equal(urls.some((u) => u === "/api/company"), false);
});

test("wrapFetch never forwards a full company POST", async () => {
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
    const method = String(init?.method || "GET").toUpperCase();
    methods.push(method);
    if (method === "POST") throw new Error("full POST is forbidden");
    return new Response(
      JSON.stringify({
        ok: true,
        applied: ["plans"],
        conflict: [],
        skipped: [],
        bookGens: { org: 1, plans: 2, months: 1, targets: 1 },
        notebookUpdatedAt: 3,
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
  const ack = (await res.json()) as { ok?: boolean };
  assert.equal(ack.ok, true);
  assert.equal(methods.includes("POST"), false);
  assert.ok(methods.includes("PATCH"));
});

test("wrapFetch returns 410 when POST has no snapshot", async () => {
  sync.resetForTests();
  const methods: string[] = [];
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String(init?.method || "GET").toUpperCase());
    return new Response("should-not-run", { status: 200 });
  }) as typeof fetch;
  sync.install(fake);
  const res = await globalThis.fetch("/api/company", {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
  });
  assert.equal(res.status, 410);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "gone");
  assert.deepEqual(methods, []);
});

test("KPI actual PATCHes /api/month-records", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    records: { "2026-04": { p1: { kpis: [{ id: "k1", actual: 0 }], updatedAt: 1 } } },
    bookGens: { org: 1, plans: 1, months: 2, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    records: { "2026-04": { p1: { kpis: [{ id: "k1", actual: 7 }], updatedAt: 2 } } },
  };
  const urls: string[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true, rev: 1, payload: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.deepEqual(urls, ["/api/month-records/2026-04/p1"]);
});

test("target cell edit PATCHes /api/target-cells", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    targetCells: { "tn-a::2026-05": { nodeId: "tn-a", actual: 1 } },
    bookGens: { org: 1, plans: 1, months: 1, targets: 2 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    targetCells: { "tn-a::2026-05": { nodeId: "tn-a", actual: 9 } },
  };
  const urls: string[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true, rev: 2, payload: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("/api/target-cells/"));
  assert.ok(urls[0].includes("tn-a"));
});

test("trash person PATCHes /api/people with deleted flag", async () => {
  sync.resetForTests();
  const live = {
    people: [person("p1"), person("p2")],
    roles: { r: { id: "r" } },
    trash: [],
    bookGens: { org: 3, plans: 1, months: 1, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    people: [person("p1")],
    trash: [{ id: "p2", kind: "person" }],
  };
  const bodies: Array<{ url: string; deleted?: boolean }> = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body || "{}")) as { deleted?: boolean };
    bodies.push({ url: String(input), deleted: parsed.deleted });
    return new Response(JSON.stringify({ ok: true, rev: 2, payload: {}, deleted: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.ok(bodies.some((b) => b.url.includes("/api/people/p2") && b.deleted === true));
});

test("two entity PATCHes same month different people both persist on the client wire", async () => {
  sync.resetForTests();
  const live = {
    people: [person("a"), person("b")],
    roles: { r: { id: "r" } },
    rewardRecords: {
      "2026-04": { a: { status: "draft", updatedAt: 1 }, b: { status: "draft", updatedAt: 1 } },
    },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    rewardRecords: {
      "2026-04": {
        a: { status: "plan_locked", updatedAt: 5 },
        b: { status: "plan_locked", updatedAt: 6 },
      },
    },
  };
  const urls: string[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: true, rev: 1, payload: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  urls.sort();
  assert.deepEqual(urls, ["/api/reward-records/2026-04/a", "/api/reward-records/2026-04/b"]);
});

test("same person same month stale entity rev retries last-write-wins — no refresh banner", async () => {
  sync.resetForTests();
  const live = {
    people: [person("a")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-04": { a: { status: "draft", updatedAt: 1 } } },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  sync.noteLoaded(live);
  const next = {
    ...live,
    rewardRecords: { "2026-04": { a: { status: "plan_locked", updatedAt: 9 } } },
  };
  let hits = 0;
  const fake = (async () => {
    hits += 1;
    if (hits === 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "stale",
          rev: 3,
          payload: { status: "paid", updatedAt: 8 },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, rev: 4, payload: { status: "plan_locked", updatedAt: 9 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(next);
  assert.equal(ack.ok, true);
  assert.equal(hits, 2);
  assert.notEqual(ack.error, "person-month-conflict");
});

test("first save before hydrate is a no-op, not a company-wide conflict", async () => {
  sync.resetForTests();
  const live = {
    people: [person("a"), person("b")],
    roles: { r: { id: "r" } },
    rewardRecords: { "2026-04": { a: { status: "draft" }, b: { status: "draft" } } },
    bookGens: { org: 1, plans: 1, months: 4, targets: 1 },
  };
  const urls: string[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ ok: false, error: "stale", rev: 1 }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ack = await sync.save(live);
  assert.equal(ack.ok, true);
  assert.equal(urls.length, 0);
  assert.notEqual(ack.error, "person-month-conflict");
});

test("fallbackPost is still absent from apms-sync.js", () => {
  const src = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(src.includes("fallbackPost"), false);
  assert.equal(src.includes("Nothing open."), false);
});

test("massPatch one-shots each row; 409 is not retried", async () => {
  sync.resetForTests();
  const hits: { method: string; url: string; body?: string }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    hits.push({ method, url, body });
    if (url.includes("/p3") && method === "PATCH") {
      return new Response(JSON.stringify({ ok: false, error: "stale", rev: 2, payload: { targetNodeId: "tn-old" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "PATCH") {
      return new Response(JSON.stringify({ ok: true, rev: 2, payload: { targetNodeId: "tn-goa" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, rev: 1, payload: { targetNodeId: "tn-old" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  sync.install(fake);
  const ops = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({
    kind: "reward_records",
    url: "/api/reward-records/2026-04/" + id,
    payload: { targetNodeId: "tn-goa" },
    personId: id,
    period: "2026-04",
    revKey: "reward_records:2026-04:" + id,
    baseRev: 1,
  }));
  const api = (globalThis as unknown as { __apmsSync: { massPatch: (ops: unknown[]) => Promise<{ updated: number; stale: number; failed: number; staleIds: string[]; message: string }> } }).__apmsSync;
  const out = await api.massPatch(ops);
  assert.equal(out.updated, 4);
  assert.equal(out.stale, 1);
  assert.equal(out.failed, 0);
  assert.deepEqual(out.staleIds, ["p3"]);
  assert.equal(out.message, "4 updated, 1 stale (409), 0 failed.");
  const patches = hits.filter((h) => h.method === "PATCH");
  assert.equal(patches.length, 5);
  assert.equal(hits.filter((h) => h.url.includes("/p3") && h.method === "PATCH").length, 1);
});

