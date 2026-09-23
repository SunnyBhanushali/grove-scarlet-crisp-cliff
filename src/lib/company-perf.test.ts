import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { assembleForGet, resetAssembleImportForTests } from "./company-assemble.ts";
import { importHotTables, liveHotTableCounts, type HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

await import(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url).href);
const sync = (globalThis as unknown as { __apmsSync: SyncApi }).__apmsSync;

type SyncApi = {
  noteLoaded: (s: Record<string, unknown>) => void;
  noteRemote: (t: unknown) => void;
  pullLive: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  install: (fn: typeof fetch) => unknown;
  resetForTests: () => void;
};

const migration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");

function clientMatchesWire(clientAt: number, wireAt: number): boolean {
  return !!clientAt && !!wireAt && clientAt === wireAt;
}

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, ...extra };
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

test("same If-None-Match / at matches wire (unchanged GET)", () => {
  assert.equal(clientMatchesWire(50, 50), true);
  assert.equal(clientMatchesWire(49, 50), false);
  assert.equal(clientMatchesWire(0, 50), false);
});

test("two GETs conceptually: matching at is unchanged, not a new etag", () => {
  const firstAt = 1_700_000_000_000;
  const secondAt = firstAt;
  assert.equal(clientMatchesWire(firstAt, secondAt), true);
});

test("assembleForGet imports empty tables once, then stops", async () => {
  resetAssembleImportForTests();
  const sql = await openSql();
  const snap: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p2")],
  };
  const first = await assembleForGet(sql, snap);
  assert.equal(first.meta.imported, true);
  assert.ok(first.meta.assembledPeople >= 2);
  await sql.query("update people set deleted_at = now()");
  const counts = await liveHotTableCounts(sql);
  assert.equal(counts.people, 0);
  const second = await assembleForGet(sql, snap);
  assert.equal(second.meta.imported, false);
});

test("pullLive with matching gens + newer at does not refetch books", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 2, plans: 1, months: 4, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(localB);
  sync.noteRemote({ at: 99, bookGens: { org: 2, plans: 1, months: 4, targets: 1 } });
  let fetched = 0;
  sync.install((async () => {
    fetched += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: () => true,
  });
  assert.equal(fetched, 0, "idle tick with same gens must not GET books");
  assert.deepEqual(pulled.pulled, []);
  assert.equal(pulled.banner, false);
});

test("at-only tick without gens still pulls (LIVE-FIX)", async () => {
  sync.resetForTests();
  const localB = {
    people: [person("p1")],
    roles: { r: { id: "r" } },
    bookGens: { org: 2, plans: 1, months: 2, targets: 1 },
    notebookUpdatedAt: 10,
  };
  sync.noteLoaded(localB);
  sync.noteRemote({ at: 99 });
  let fetched = 0;
  sync.install((async () => {
    fetched += 1;
    return new Response(
      JSON.stringify({
        ok: true,
        books: {
          org: { people: [person("p1"), person("p-new")], roles: { r: { id: "r" } }, trash: [] },
          months: { rewardRecords: {} },
          targets: { targetCells: {} },
        },
        bookGens: { org: 3, plans: 1, months: 2, targets: 1 },
        notebookUpdatedAt: 99,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);
  let applied = null as Record<string, unknown> | null;
  const pulled = await sync.pullLive({
    isBlocked: false,
    getSnapshot: () => localB,
    apply: (snap: Record<string, unknown>) => {
      applied = snap;
    },
  });
  assert.ok(fetched >= 1);
  assert.ok((pulled.pulled as string[]).includes("org"));
  assert.ok((applied?.people as { id: string }[]).some((p) => p.id === "p-new"));
});
