import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  getEntity,
  handleEntityHttp,
  memoryEntityBooks,
  parseEntityPath,
  patchEntity,
} from "./company-entities.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

const migration = readFileSync(
  new URL("../../migrations/0005_hot_tables.sql", import.meta.url),
  "utf8",
);

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

function stored(): Snapshot {
  return {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p2")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  };
}

test("parseEntityPath matches the four entity routes", () => {
  assert.deepEqual(parseEntityPath("/api/people/p-admin"), { table: "people", id: "p-admin" });
  assert.deepEqual(parseEntityPath("/api/month-records/2026-04/p1"), {
    table: "month_records",
    period: "2026-04",
    personId: "p1",
  });
  assert.deepEqual(parseEntityPath("/api/reward-records/2026-04/p1"), {
    table: "reward_records",
    period: "2026-04",
    personId: "p1",
  });
  assert.deepEqual(parseEntityPath("/api/target-cells/tn-a::2026-05"), {
    table: "target_cells",
    id: "tn-a::2026-05",
  });
});

test("200 on first PATCH, rev=1; second PATCH, rev=2", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const key = { table: "reward_records" as const, period: "2026-04", personId: "p1" };
  const first = await patchEntity(
    sql,
    key,
    { payload: { status: "plan_locked", updatedAt: 10 }, baseRev: 0, clientOpId: "op-1" },
    books,
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.rev, 1);
  assert.equal((first.body.payload as { status?: string }).status, "plan_locked");

  const second = await patchEntity(
    sql,
    key,
    { payload: { status: "paid", updatedAt: 20 }, baseRev: 1, clientOpId: "op-2" },
    books,
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.rev, 2);
  assert.equal((second.body.payload as { status?: string }).status, "paid");
});

test("stale baseRev → 409 + current row", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const key = { table: "reward_records" as const, period: "2026-04", personId: "p1" };
  await patchEntity(
    sql,
    key,
    { payload: { status: "plan_locked", updatedAt: 10 }, baseRev: 0, clientOpId: "op-ok" },
    books,
  );
  const stale = await patchEntity(
    sql,
    key,
    { payload: { status: "paid", updatedAt: 99 }, baseRev: 0, clientOpId: "op-stale" },
    books,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 1);
  assert.equal((stale.body.payload as { status?: string }).status, "plan_locked");
  assert.equal(stale.body.ok, false);
});

test("same clientOpId → no rev bump", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const key = { table: "people" as const, id: "p-new" };
  const body = { payload: { id: "p-new", name: "New" }, baseRev: 0, clientOpId: "op-retry" };
  const first = await patchEntity(sql, key, body, books);
  assert.equal(first.status, 200);
  assert.equal(first.body.rev, 1);
  const again = await patchEntity(
    sql,
    key,
    { payload: { id: "p-new", name: "Changed" }, baseRev: 1, clientOpId: "op-retry" },
    books,
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.rev, 1);
  assert.equal((again.body.payload as { name?: string }).name, "New");
});

test("anon → 401", async () => {
  const res = await handleEntityHttp(new Request("http://127.0.0.1/api/people/p1"));
  assert.equal(res.status, 401);
  const patch = await handleEntityHttp(
    new Request("http://127.0.0.1/api/reward-records/2026-04/p1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { status: "paid" }, baseRev: 0, clientOpId: "x" }),
    }),
  );
  assert.equal(patch.status, 401);
});

test("GET hydrates one missing slice from the book (no company-wide 404)", async () => {
  const sql = await openSql();
  await sql.query(
    `insert into people (id, payload, rev, updated_at, updated_by, deleted_at)
     values ('p2', '{"id":"p2"}'::jsonb, 1, now(), 'seed', null)`,
  );
  const books = memoryEntityBooks({
    ...stored(),
    people: [person("p1", { title: "Artist" }), person("p2")],
  });
  const got = await getEntity(sql, { table: "people", id: "p1" }, books);
  assert.equal(got.status, 200);
  assert.equal(got.body.rev, 1);
  assert.equal((got.body.payload as { title?: string }).title, "Artist");
  const missing = await getEntity(sql, { table: "people", id: "p-absent" }, books);
  assert.equal(missing.status, 404);
  const onlyTwo = await sql.query<{ n: number }>("select count(*)::int as n from people");
  assert.equal(Number(onlyTwo[0]?.n), 2, "hydrate one slice, not the whole company");
});

test("empty hot tables import from books on GET", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks({
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    people: [person("p1"), person("p2"), person("p3")],
    records: {},
    rewardRecords: {},
    targetCells: {},
  });
  const got = await getEntity(sql, { table: "people", id: "p2" }, books);
  assert.equal(got.status, 200);
  const counts = await sql.query<{ n: number }>("select count(*)::int as n from people where deleted_at is null");
  assert.equal(Number(counts[0]?.n), 3);
});

test("book merge failure still returns 200 and keeps the row win", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  books.applySlice = async () => ({ ok: false, snapshot: stored() });
  const result = await patchEntity(
    sql,
    { table: "reward_records", period: "2026-04", personId: "p1" },
    { payload: { status: "plan_locked" }, baseRev: 0, clientOpId: "op-book-409" },
    books,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.rev, 1);
  const rows = await sql.query<{ n: number }>("select count(*)::int as n from reward_records");
  assert.equal(Number(rows[0]?.n), 1);
});

test("two entity PATCHes, same month, different people both persist", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const a = patchEntity(
    sql,
    { table: "reward_records", period: "2026-04", personId: "p1" },
    { payload: { status: "plan_locked", updatedAt: 10 }, baseRev: 0, clientOpId: "op-a" },
    books,
  );
  const b = patchEntity(
    sql,
    { table: "reward_records", period: "2026-04", personId: "p2" },
    { payload: { status: "plan_locked", updatedAt: 11 }, baseRev: 0, clientOpId: "op-b" },
    books,
  );
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  const rows = await sql.query<{ person_id: string; payload: { status?: string } }>(
    "select person_id, payload from reward_records where deleted_at is null order by person_id",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.person_id, "p1");
  assert.equal(rows[1]?.person_id, "p2");
  const snap = await books.read();
  const month = (snap?.rewardRecords as Record<string, Record<string, { status?: string }>>)["2026-04"];
  assert.equal(month.p1.status, "plan_locked");
  assert.equal(month.p2.status, "plan_locked");
});

test("same person + same month stale rev → 409 + current row", async () => {
  const sql = await openSql();
  const books = memoryEntityBooks(stored());
  const key = { table: "reward_records" as const, period: "2026-04", personId: "p1" };
  await patchEntity(
    sql,
    key,
    { payload: { status: "plan_locked", updatedAt: 10 }, baseRev: 0, clientOpId: "op-first" },
    books,
  );
  const stale = await patchEntity(
    sql,
    key,
    { payload: { status: "paid", updatedAt: 99 }, baseRev: 0, clientOpId: "op-stale-same" },
    books,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 1);
  assert.equal((stale.body.payload as { status?: string }).status, "plan_locked");
});
