import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { handleRosterBindHttp } from "./company-roster-bind-http.ts";
import {
  defaultRosterId,
  ensureRosterBound,
  getRosterBind,
  overlayBoundPeople,
  parseRosterBindPath,
  readRosterBind,
  rebindRoster,
  rosterIdForSubject,
  seedMonthBinds,
} from "./company-roster-bind.ts";
import {
  copyRosterFrom,
  ensureRosterSeeded,
  getRoster,
  overlayOrgPeople,
  patchRoster,
} from "./company-roster.ts";
import type { HotSql } from "./company-hot-tables.ts";
import { importHotTables } from "./company-hot-tables.ts";
import { assembleForGet } from "./company-assemble.ts";
import type { Snapshot } from "./company-books.ts";

const mig5 = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");
const mig6 = readFileSync(new URL("../../migrations/0006_roster.sql", import.meta.url), "utf8");
const mig7 = readFileSync(new URL("../../migrations/0007_roster_binds.sql", import.meta.url), "utf8");

function person(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, status: "active", ...extra };
}

async function openSql(): Promise<{ sql: HotSql; pg: PGlite }> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(mig5);
  await pg.exec(mig6);
  await pg.exec(mig7);
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

async function insertReward(sql: HotSql, period: string, personId: string, status = "plan_locked") {
  await sql.query(
    `insert into reward_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2, $3::jsonb, 1, now(), 'test', null)`,
    [personId, period, JSON.stringify({ status, personId, period })],
  );
}

async function insertMonth(sql: HotSql, period: string, personId: string) {
  await sql.query(
    `insert into month_records (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2, $3::jsonb, 1, now(), 'test', null)`,
    [personId, period, JSON.stringify({ status: "open", personId, period })],
  );
}

const NOW = "2026-09-15T12:00:00Z";

test("parseRosterBindPath + defaultRosterId never uses current Org", () => {
  assert.deepEqual(parseRosterBindPath("/api/roster-bind/rewards/2026-04"), {
    kind: "rewards",
    subjectId: "2026-04",
    action: "get",
  });
  assert.deepEqual(parseRosterBindPath("/api/roster-bind/award/aw-1/rebind"), {
    kind: "award",
    subjectId: "aw-1",
    action: "rebind",
  });
  assert.equal(
    defaultRosterId({ kind: "rewards", subjectId: "2026-04", currentOrgPeriod: "2026-09" }),
    "2026-04",
  );
  assert.equal(
    defaultRosterId({ kind: "apms", subjectId: "2026-04", currentOrgPeriod: "2026-09" }),
    "2026-04",
  );
  assert.equal(
    defaultRosterId({
      kind: "award",
      subjectId: "aw-1",
      awardPeriod: "2026-10",
      currentOrgPeriod: "2026-09",
    }),
    "2026-10",
  );
  assert.equal(
    defaultRosterId({ kind: "award", subjectId: "aw-1", currentOrgPeriod: "2026-09" }),
    "",
  );
});

test("rewards month stores rosterId; Org transfer does not switch pointer", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [
    person("P", { buId: "SBU-A", managerId: "mgr-a" }),
    person("Q", { buId: "SBU-A" }),
  ]);
  await insertReward(sql, "2026-04", "P");
  await ensureRosterSeeded(sql, { now: NOW });
  const copiedApr = await copyRosterFrom(sql, "2026-04", "2026-09", { now: NOW, updatedBy: "hr" });
  assert.equal(copiedApr.status, 200);
  const seeded = await seedMonthBinds(sql, { updatedBy: "seed" });
  assert.ok(seeded.seeded >= 1);

  const bind = await readRosterBind(sql, "rewards", "2026-04");
  assert.equal(bind?.rosterId, "2026-04");

  const sep = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  const patched = await patchRoster(
    sql,
    "2026-09",
    {
      baseRev: sep.rev,
      clientOpId: "org-xfer",
      assignments: [{ personId: "P", sbuId: "SBU-B", managerId: "mgr-b" }],
    },
    { updatedBy: "hr", now: NOW },
  );
  assert.equal(patched.status, 200);
  await sql.query(`update people set payload = payload || '{"buId":"SBU-B"}'::jsonb where id = 'P'`);

  const still = await readRosterBind(sql, "rewards", "2026-04");
  assert.equal(still?.rosterId, "2026-04");

  const overlay = await overlayBoundPeople(
    sql,
    "rewards",
    "2026-04",
    [{ id: "P", buId: "SBU-B", managerId: "mgr-b" }],
    { now: NOW },
  );
  assert.equal(overlay.rosterId, "2026-04");
  assert.equal(overlay.people[0]?.buId, "SBU-A");
  assert.equal(overlay.bound, true);

  const org = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  const orgOverlay = overlayOrgPeople(
    [{ id: "P", buId: "SBU-B" }],
    org.assignments,
  );
  assert.equal(orgOverlay.people[0]?.buId, "SBU-B");
});

test("APMS month + award instance store rosterId; super-admin people edit does not rebind", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("P", { buId: "SBU-A" })]);
  await insertMonth(sql, "2026-04", "P");
  await ensureRosterSeeded(sql, { now: NOW });

  const apms = await getRosterBind(sql, "apms", "2026-04", { now: NOW, updatedBy: "sys" });
  assert.equal(apms.status, 200);
  assert.equal(apms.body.rosterId, "2026-04");
  assert.equal(apms.body.bound, true);

  const award = await getRosterBind(sql, "award", "aw-best", {
    now: NOW,
    updatedBy: "sys",
    awardPeriod: "2026-04",
  });
  assert.equal(award.status, 200);
  assert.equal(award.body.rosterId, "2026-04");
  assert.equal(award.body.kind, "award");
  assert.equal(award.body.subjectId, "aw-best");

  await sql.query(`update people set payload = payload || '{"buId":"SBU-NOW"}'::jsonb where id = 'P'`);
  const afterPeople = await rosterIdForSubject(sql, "apms", "2026-04", {
    currentOrgPeriod: "2026-09",
  });
  assert.equal(afterPeople.rosterId, "2026-04");
  assert.equal(afterPeople.bound, true);
  const awardAfter = await rosterIdForSubject(sql, "award", "aw-best", {
    awardPeriod: "2026-10",
    currentOrgPeriod: "2026-09",
  });
  assert.equal(awardAfter.rosterId, "2026-04");
});

test("rebind is explicit admin+reason+audit; implicit lock/org edit is not a rebind", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("P", { buId: "SBU-A" })]);
  await insertReward(sql, "2026-04", "P");
  await ensureRosterSeeded(sql, { now: NOW });
  const copiedApr = await copyRosterFrom(sql, "2026-04", "2026-09", { now: NOW, updatedBy: "hr" });
  assert.equal(copiedApr.status, 200);
  await getRosterBind(sql, "rewards", "2026-04", { now: NOW });
  const sep = await getRoster(sql, "2026-09", { now: NOW, seed: false });
  await patchRoster(
    sql,
    "2026-09",
    {
      baseRev: sep.rev,
      clientOpId: "move",
      assignments: [{ personId: "P", sbuId: "SBU-B" }],
    },
    { now: NOW },
  );

  const hr = await rebindRoster(
    sql,
    "rewards",
    "2026-04",
    { rosterId: "2026-09", reason: "use current", clientOpId: "rb-hr" },
    { updatedBy: "hr-user", access: "hr", now: NOW },
  );
  assert.equal(hr.status, 403);

  const noReason = await rebindRoster(
    sql,
    "rewards",
    "2026-04",
    { rosterId: "2026-09", clientOpId: "rb-none" },
    { updatedBy: "p-admin", access: "super_admin", now: NOW },
  );
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, "reason-required");

  const ok = await rebindRoster(
    sql,
    "rewards",
    "2026-04",
    { rosterId: "2026-09", reason: "admin requested April use September roster", clientOpId: "rb-1" },
    { updatedBy: "p-admin", access: "super_admin", now: NOW },
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rosterId, "2026-09");
  assert.equal(ok.body.fromRosterId, "2026-04");
  const audit = ok.body.audit as Array<{ reason: string; toRosterId: string }>;
  assert.ok(audit.some((a) => a.toRosterId === "2026-09" && /admin requested/.test(a.reason)));

  const overlay = await overlayBoundPeople(sql, "rewards", "2026-04", [{ id: "P", buId: "SBU-A" }], {
    now: NOW,
  });
  assert.equal(overlay.rosterId, "2026-09");
  assert.equal(overlay.people[0]?.buId, "SBU-B");

  const replay = await rebindRoster(
    sql,
    "rewards",
    "2026-04",
    { rosterId: "2026-04", reason: "undo", clientOpId: "rb-1" },
    { updatedBy: "p-admin", access: "super_admin", now: NOW },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.rosterId, "2026-09");
  assert.equal(replay.body.replayed, true);
});

test("ensure bound twice does not move pointer; GET company still identity", async () => {
  const { sql } = await openSql();
  await insertPeople(sql, [person("p1", { buId: "SBU-A" })]);
  await insertReward(sql, "2026-04", "p1");
  await ensureRosterSeeded(sql, { now: NOW });
  const first = await ensureRosterBound(sql, "rewards", "2026-04", "2026-04", { updatedBy: "a" });
  assert.equal(first.initial, true);
  const second = await ensureRosterBound(sql, "rewards", "2026-04", "2026-09", { updatedBy: "a" });
  assert.equal(second.initial, false);
  assert.equal(second.bind.rosterId, "2026-04");

  const snap: Snapshot = {
    people: [person("p1", { buId: "SBU-A" })],
    records: { "2026-04": { p1: { status: "draft" } } },
    rewardRecords: { "2026-04": { p1: { status: "plan_locked" } } },
    targetCells: {},
    awardInstances: [{ id: "aw-1", period: "2026-04", name: "Best" }],
  };
  await importHotTables(sql, snap, { updatedBy: "test" });
  const assembled = await assembleForGet(sql, snap);
  const people = assembled.snapshot.people as Array<{ id: string; buId?: string }>;
  assert.equal(people.find((p) => p.id === "p1")?.buId, "SBU-A");
});

test("anon GET /api/roster-bind → 401; SPA overlay uses bind for rewards/apms/award", async () => {
  const res = await handleRosterBindHttp(
    new Request("http://127.0.0.1/api/roster-bind/rewards/2026-04"),
  );
  assert.equal(res.status, 401);
  const post = await handleRosterBindHttp(
    new Request("http://127.0.0.1/api/roster-bind/rewards/2026-04/rebind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rosterId: "2026-09", reason: "x" }),
    }),
  );
  assert.equal(post.status, 401);

  const rosterJs = readFileSync(new URL("../../public/assets/apms-roster.js", import.meta.url), "utf8");
  assert.equal(rosterJs.includes("/api/roster-bind/"), true);
  assert.equal(rosterJs.includes("loadBind"), true);
  const sync = readFileSync(new URL("../../recovered-site/assets/apms-sync.js", import.meta.url), "utf8");
  assert.equal(sync.includes("fallbackPost"), false);
});
