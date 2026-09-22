import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { handleRosterHttp } from "./company-roster-http.ts";
import {
  copyRosterFrom,
  ensureRosterSeeded,
  getRoster,
  lockRoster,
  overlayBanner,
  overlayOrgPeople,
  patchRoster,
  unlockRoster,
} from "./company-roster.ts";
import type { HotSql } from "./company-hot-tables.ts";
import { assembleForGet } from "./company-assemble.ts";
import { importHotTables } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";

const mig5 = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");
const mig6 = readFileSync(new URL("../../migrations/0006_roster.sql", import.meta.url), "utf8");

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, status: "active", ...extra };
}

function payloadOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

async function openSql(): Promise<{ sql: HotSql; pg: PGlite }> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(mig5);
  await pg.exec(mig6);
  const sql: HotSql = {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  return { sql, pg };
}

async function insertPeople(sql: HotSql, people: Array<Record<string, unknown>>) {
  for (const p of people) {
    await sql.query(
      `insert into people (id, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, 1, now(), 'test', null)`,
      [p.id, JSON.stringify(p)],
    );
  }
}

async function insertReward(
  sql: HotSql,
  period: string,
  personId: string,
  status = "plan_locked",
) {
  await sql.query(
    `insert into reward_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2, $3::jsonb, 1, now(), 'test', null)`,
    [personId, period, JSON.stringify({ status, personId, period })],
  );
}

const NOW = "2026-09-15T12:00:00Z";

test("seed current period assignments count ≈ active people", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [
    person("p1", { buId: "sbu-a", managerId: "p-boss" }),
    person("p2", { buId: "sbu-a", managerId: "p-boss" }),
    person("p3", { buId: "sbu-b", managerId: "p-boss" }),
    person("p-left", { buId: "sbu-a", status: "left" }),
  ]);
  const seeded = await ensureRosterSeeded(sql, { now: NOW });
  assert.equal(seeded.period, "2026-09");
  assert.equal(seeded.seeded, 3);
  const got = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  assert.equal(got.assignments.length, 3);
  assert.equal(got.status, "current");
  assert.ok(got.assignments.every((a) => a.allocationPct === 100));
  assert.ok(got.assignments.every((a) => a.line === "solid"));
  const again = await ensureRosterSeeded(sql, { now: NOW });
  assert.equal(again.seeded, 0);
  const still = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  assert.equal(still.assignments.length, 3);
});

test("transfer in 2026-10 leaves 2026-09 assignment and reward_record untouched", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [
    person("P", { buId: "SBU-A", managerId: "mgr-a", functionId: "fn-a", brandId: "br-a" }),
    person("Q", { buId: "SBU-A" }),
  ]);
  await insertReward(sql, "2026-09", "P", "plan_locked");
  await ensureRosterSeeded(sql, { now: NOW });
  const sepBefore = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  const pSep = sepBefore.assignments.find((a) => a.personId === "P");
  assert.equal(pSep?.sbuId, "SBU-A");

  const copied = await copyRosterFrom(sql, "2026-10", "2026-09", { now: NOW, updatedBy: "hr" });
  assert.equal(copied.status, 200);
  assert.equal(copied.body.status, "draft");
  const octIds = (copied.body.assignments as Array<{ id: string; personId: string }>).map((a) => a.id);
  const sepIds = sepBefore.assignments.map((a) => a.id);
  for (const id of octIds) assert.equal(sepIds.includes(id), false);

  const patched = await patchRoster(
    sql,
    "2026-10",
    {
      baseRev: copied.body.rev,
      clientOpId: "xfer-1",
      assignments: [{ personId: "P", sbuId: "SBU-B", managerId: "mgr-b" }],
    },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(patched.status, 200);
  const oct = patched.body.assignments as Array<{ personId: string; sbuId: string }>;
  assert.equal(oct.find((a) => a.personId === "P")?.sbuId, "SBU-B");

  const sepAfter = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  assert.equal(sepAfter.assignments.find((a) => a.personId === "P")?.sbuId, "SBU-A");
  assert.equal(sepAfter.status, "current");

  const reward = await sql.query<{ payload: unknown }>(
    `select payload from reward_records where person_id = $1 and period = $2 and deleted_at is null`,
    ["P", "2026-09"],
  );
  assert.equal(reward.length, 1);
  assert.equal(payloadOf(reward[0].payload).status, "plan_locked");

  const identity = await sql.query<{ payload: unknown }>(`select payload from people where id = 'P'`);
  assert.equal(payloadOf(identity[0].payload).buId, "SBU-A");
});

test("lock period → further PATCH assignments → 409", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "sbu-a" })]);
  await ensureRosterSeeded(sql, { now: NOW });
  const locked = await lockRoster(sql, "2026-09", { updatedBy: "hr" });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.status, "locked");
  const patch = await patchRoster(
    sql,
    "2026-09",
    {
      baseRev: locked.body.rev,
      clientOpId: "after-lock",
      assignments: [{ personId: "p1", sbuId: "sbu-b" }],
    },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(patch.status, 409);
  assert.equal(patch.body.error, "roster-locked");
  const still = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  assert.equal(still.assignments.find((a) => a.personId === "p1")?.sbuId, "sbu-a");
});

test("stale baseRev → 409 + current", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "sbu-a" })]);
  await ensureRosterSeeded(sql, { now: NOW });
  const got = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  await patchRoster(
    sql,
    "2026-09",
    { baseRev: got.rev, clientOpId: "op-ok", assignments: [{ personId: "p1", sbuId: "sbu-b" }] },
    { updatedBy: "hr", now: NOW },
  );
  const stale = await patchRoster(
    sql,
    "2026-09",
    { baseRev: got.rev, clientOpId: "op-stale", assignments: [{ personId: "p1", sbuId: "sbu-z" }] },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "stale");
  assert.equal(
    (stale.body.assignments as Array<{ personId: string; sbuId: string }>).find((a) => a.personId === "p1")
      ?.sbuId,
    "sbu-b",
  );
});

test("same clientOpId → no rev bump", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "sbu-a" })]);
  await ensureRosterSeeded(sql, { now: NOW });
  const got = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  const first = await patchRoster(
    sql,
    "2026-09",
    { baseRev: got.rev, clientOpId: "retry-1", assignments: [{ personId: "p1", sbuId: "sbu-b" }] },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(first.status, 200);
  const again = await patchRoster(
    sql,
    "2026-09",
    { baseRev: first.body.rev, clientOpId: "retry-1", assignments: [{ personId: "p1", sbuId: "sbu-z" }] },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.rev, first.body.rev);
  assert.equal(
    (again.body.assignments as Array<{ sbuId: string }>).find(Boolean)?.sbuId,
    "sbu-b",
  );
});

test("copy 2026-09 → 2026-10 draft; lock 2026-09 untouched", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "sbu-a" }), person("p2", { buId: "sbu-b" })]);
  await ensureRosterSeeded(sql, { now: NOW });
  const locked = await lockRoster(sql, "2026-09", { updatedBy: "hr" });
  assert.equal(locked.body.status, "locked");
  const copied = await copyRosterFrom(sql, "2026-10", "2026-09", { now: NOW, updatedBy: "hr" });
  assert.equal(copied.status, 200);
  assert.equal(copied.body.status, "draft");
  assert.equal(copied.body.copiedFrom, "2026-09");
  assert.equal((copied.body.assignments as unknown[]).length, 2);
  const source = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  assert.equal(source.status, "locked");
  assert.equal(source.rev, locked.body.rev);
  const lockedCopy = await copyRosterFrom(sql, "2026-09", "2026-10", { now: NOW, updatedBy: "hr" });
  assert.equal(lockedCopy.status, 409);
});

test("unlock admin-only when Rewards is locked for that month", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "sbu-a" })]);
  await insertReward(sql, "2026-09", "p1", "plan_locked");
  await ensureRosterSeeded(sql, { now: NOW });
  await lockRoster(sql, "2026-09", { updatedBy: "hr" });
  const hrUnlock = await unlockRoster(sql, "2026-09", { updatedBy: "hr-user", access: "hr", now: NOW });
  assert.equal(hrUnlock.status, 403);
  assert.equal(hrUnlock.body.status, "locked");
  const adminUnlock = await unlockRoster(sql, "2026-09", {
    updatedBy: "p-admin",
    access: "admin",
    now: NOW,
  });
  assert.equal(adminUnlock.status, 200);
  assert.equal(adminUnlock.body.status, "current");
});

test("anon GET /api/roster/2026-09 → 401", async () => {
  const res = await handleRosterHttp(new Request("http://127.0.0.1/api/roster/2026-09"));
  assert.equal(res.status, 401);
  const patch = await handleRosterHttp(
    new Request("http://127.0.0.1/api/roster/2026-09", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRev: 1, assignments: [] }),
    }),
  );
  assert.equal(patch.status, 401);
});

test("missing PATCH key is not a delete; overlay falls back", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [
    person("p1", { buId: "sbu-a", managerId: "m1" }),
    person("p2", { buId: "sbu-b", managerId: "m2" }),
  ]);
  await ensureRosterSeeded(sql, { now: NOW });
  const got = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  const patch = await patchRoster(
    sql,
    "2026-09",
    { baseRev: got.rev, clientOpId: "one", assignments: [{ personId: "p1", sbuId: "sbu-z" }] },
    { now: NOW },
  );
  assert.equal(patch.status, 200);
  const rows = patch.body.assignments as Array<{ personId: string; sbuId: string }>;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((a) => a.personId === "p2")?.sbuId, "sbu-b");

  const overlay = overlayOrgPeople(
    [
      { id: "p1", buId: "identity-a", managerId: "m1" },
      { id: "p-missing", buId: "identity-x", managerId: "mx" },
    ],
    rows.map((a) => ({
      personId: a.personId,
      sbuId: a.sbuId,
      brandId: "",
      companyId: "",
      functionId: "",
      managerId: "",
      status: "active" as const,
      line: "solid" as const,
    })),
  );
  assert.equal(overlay.people.find((p) => p.id === "p1")?.buId, "sbu-z");
  assert.equal(overlay.people.find((p) => p.id === "p1")?.rosterSet, true);
  assert.equal(overlay.people.find((p) => p.id === "p-missing")?.buId, "identity-x");
  assert.equal(overlay.people.find((p) => p.id === "p-missing")?.rosterSet, false);
  assert.equal(overlayBanner(0, 2), "Roster not set for this month.");
  assert.equal(overlayBanner(2, 2), null);
});

test("GET /api/company assemble does not overlay roster onto people identity", async () => {
  const { sql } = await openSql();
  const snap: Snapshot = {
    people: [person("p1", { buId: "SBU-A" })],
    records: { "2026-09": { p1: { status: "draft" } } },
    rewardRecords: { "2026-09": { p1: { status: "plan_locked" } } },
    targetCells: {},
  };
  await importHotTables(sql, snap, { updatedBy: "test" });
  await ensureRosterSeeded(sql, { now: NOW });
  const got = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  await patchRoster(
    sql,
    "2026-09",
    { baseRev: got.rev, clientOpId: "ov", assignments: [{ personId: "p1", sbuId: "SBU-B" }] },
    { now: NOW },
  );
  const assembled = await assembleForGet(sql, snap);
  const people = assembled.snapshot.people as Array<{ id: string; buId?: string }>;
  assert.equal(people.find((p) => p.id === "p1")?.buId, "SBU-A");
});

test("SPA Roster nav + view + canNav are wired (HR/admin)", () => {
  const routes = readFileSync(
    new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  const login = readFileSync(
    new URL("../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(routes.includes("{id:`roster`,label:`Roster`"), true);
  assert.equal(routes.includes("r===`roster`&&(0,Q.jsx)(`div`,{id:`apms-roster-root`"), true);
  assert.equal(login.includes("if(id===`roster`)"), true);
  const html = readFileSync(new URL("../../public/apms.html", import.meta.url), "utf8");
  assert.equal(html.includes("apms-roster.js"), true);
  const scope = readFileSync(
    new URL("../../public/assets/apms-org-scope-p0ao.js", import.meta.url),
    "utf8",
  );
  assert.equal(scope.includes("__rosterOverlay"), true);
  const sync = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(sync.includes("fallbackPost"), false);
  assert.equal(routes.includes("&&i())"), false);
  for (const rel of [
    "../../public/assets/routes-e2g7y5q8-13m-p0ar.js",
    "../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js",
    "../../public/assets/apms-roster.js",
  ]) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    const chk = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(chk.status, 0, chk.stderr || rel);
  }
});
