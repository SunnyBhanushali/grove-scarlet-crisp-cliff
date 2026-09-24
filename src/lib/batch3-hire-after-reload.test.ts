/**
 * BATCH-3 Part D: "one hire by B not saved within 20 s".
 *
 * After a reload the SPA asks for the company file with `?at=<its cached
 * stamp>`. When the server answered `unchanged`, the sync never learned a
 * baseline; the first save then took the screen (with the hire just made) as
 * already saved and sent nothing. The sync now asks for the whole file while
 * it has no baseline, so the first edit after a reload is sent.
 */
import assert from "node:assert/strict";
import test from "node:test";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
  setLiveHooks: (h: Record<string, unknown> | null) => void;
  save: (s: Record<string, unknown>) => Promise<Record<string, unknown>>;
  lastAckedBooks: () => Record<string, { people?: Array<{ id: string }> }>;
};

const AT = 1_790_000_000_000;
const serverPeople = [
  { id: "p-1", name: "Sunny B", username: "sunny.b", email: "sunny@x.test", rev: 1 },
  { id: "p-2", name: "Floyd D", username: "floyd.dsil", email: "floyd@x.test", rev: 1 },
];
const serverSnap = { people: serverPeople, roles: {}, notebookUpdatedAt: AT, bookGens: { org: 5, plans: 1, months: 1, targets: 1 } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("first edit after an 'unchanged' reload is sent (hire not lost)", async () => {
  sync.resetForTests();
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => json({})) as typeof fetch;
  sync.install((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init && init.method) || "GET";
    seen.push(`${method} ${url}`);
    if (method === "GET" && url.startsWith("/api/company")) {
      // The server's answer to a cached stamp that is current.
      if (/[?&]at=/.test(url)) return json({ unchanged: true, notebookUpdatedAt: AT, snapshotJson: null, bookGens: serverSnap.bookGens });
      return json({ snapshotJson: JSON.stringify(serverSnap), notebookUpdatedAt: AT, bookGens: serverSnap.bookGens });
    }
    if (method === "PATCH" && url.startsWith("/api/people/")) {
      const id = decodeURIComponent(url.split("/").pop() || "");
      const body = JSON.parse(String(init?.body || "{}"));
      return json({ ok: true, table: "people", id, payload: body.payload, rev: 1, deleted: false, bookGens: { org: 6 } });
    }
    return json({ ok: true });
  }) as typeof fetch);
  try {
    // The SPA's load after a reload: its cached copy's stamp in `at`.
    const res = await globalThis.fetch(`/api/company?at=${AT}`, { credentials: "include" });
    const body = (await res.json()) as { unchanged?: boolean; snapshotJson?: string | null };
    assert.equal(seen[0], "GET /api/company", "no baseline yet: the whole file is asked for (no `at`)");
    assert.notEqual(body.unchanged, true);
    assert.ok(body.snapshotJson, "the full snapshot reaches the SPA");
    assert.deepEqual(
      (sync.lastAckedBooks().org?.people || []).map((p) => p.id).sort(),
      ["p-1", "p-2"],
      "baseline = what the server sent",
    );

    // The screen holds the cached copy; the person hires Vbob.
    const screen = {
      people: [...serverPeople.map((p) => ({ ...p })), { id: "p-new", name: "Vbob View", username: "vbob.view", email: "vbob@x.test", password: "Aliens2026" }],
      roles: {},
      notebookUpdatedAt: AT + 1,
      bookGens: serverSnap.bookGens,
    };
    sync.setLiveHooks({ isBlocked: () => false, getSnapshot: () => screen, apply: () => true });
    await sync.save(screen);
    assert.ok(
      seen.some((s) => s === "PATCH /api/people/p-new"),
      `the hire is sent (requests: ${seen.join(" · ")})`,
    );
    assert.ok(!seen.some((s) => s === "PATCH /api/people/p-1" || s === "PATCH /api/people/p-2"), "untouched people are not re-sent");
  } finally {
    sync.setLiveHooks(null);
    globalThis.fetch = realFetch;
    sync.resetForTests();
  }
});
