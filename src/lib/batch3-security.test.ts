/**
 * BATCH-3 unit tests: passwords (scrypt, one-time conversion), sign-in
 * lock-out, APMS_DEFAULT_PIN, server-side permissions (reads, writes, hidden
 * fields, feed, tombstones), the atomic first hot-table import.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ensureHashed, hashPassword, hashSnapshotSecrets, isPasswordHash, verifyPassword } from "./apms-password.ts";
import { verifyLoginDetailed, defaultPinEnabled } from "./apms-credentials.ts";
import {
  buildOrgContext,
  can,
  checkEntityWrite,
  checkPersonWrite,
  checkRecordWrite,
  filterChange,
  filterHints,
  filterSnapshot,
  filterTombstones,
  flag,
  isEmptyish,
  onlySelfChanges,
  packForBase,
  readsEverything,
  scopeSet,
  viewerFor,
} from "./apms-permissions.ts";
import { openTestDb } from "./test-db.ts";

// ------------------------------------------------------------- passwords --

test("scrypt: hash, verify, legacy plain text, ensureHashed idempotent", () => {
  const h = hashPassword("Secret-1");
  assert.ok(isPasswordHash(h));
  assert.ok(verifyPassword("Secret-1", h));
  assert.ok(!verifyPassword("Secret-2", h));
  assert.notEqual(hashPassword("Secret-1"), h, "random salt");
  assert.equal(ensureHashed(h), h);
  assert.ok(isPasswordHash(ensureHashed("plain")));
  assert.equal(ensureHashed(""), "");
  assert.ok(verifyPassword("plain", "plain"), "a legacy plain-text value still signs in");
  assert.ok(!verifyPassword("", h));
});

test("hashSnapshotSecrets: people + logins plain text → hashes, hashes untouched", () => {
  const h = hashPassword("x");
  const snap = { people: [{ id: "p1", password: "a" }, { id: "p2", password: h }, { id: "p3", password: "" }], logins: { u1: { personId: "p1", password: "b" } } };
  assert.equal(hashSnapshotSecrets(snap), 2);
  assert.ok(isPasswordHash(snap.people[0].password) && verifyPassword("a", snap.people[0].password));
  assert.equal(snap.people[1].password, h);
  assert.equal(snap.people[2].password, "");
  assert.ok(verifyPassword("b", snap.logins.u1.password));
});

test("sign-in: APMS_DEFAULT_PIN on / off", () => {
  const people = [
    { id: "p-admin", username: "sunny.b", status: "active" },
    { id: "p1", username: "a.b", status: "active" },
    { id: "p2", username: "c.d", status: "active", password: hashPassword("Real-1") },
  ];
  assert.equal(defaultPinEnabled({}), true);
  assert.equal(defaultPinEnabled({ APMS_DEFAULT_PIN: "off" }), false);
  assert.equal(verifyLoginDetailed(people, {}, "sunny.b", "0000", { defaultPin: true }).person?.id, "p-admin");
  assert.equal(verifyLoginDetailed(people, {}, "a.b", "0000", { defaultPin: true }).person?.id, "p1");
  assert.equal(verifyLoginDetailed(people, {}, "sunny.b", "0000", { defaultPin: false }).reason, "default-pin-off");
  assert.equal(verifyLoginDetailed(people, {}, "a.b", "0000", { defaultPin: false }).reason, "default-pin-off");
  assert.equal(verifyLoginDetailed(people, {}, "c.d", "Real-1", { defaultPin: false }).person?.id, "p2");
  assert.equal(verifyLoginDetailed(people, {}, "c.d", "0000", { defaultPin: true }).person, null, "a stored password wins over 0000");
  const logins = { "a.b": { personId: "p1", password: hashPassword("Issued-1") } };
  assert.equal(verifyLoginDetailed(people, logins, "a.b", "Issued-1").person?.id, "p1");
  assert.equal(verifyLoginDetailed(people, logins, "a.b", "0000", { defaultPin: true }).person, null);
});

// ----------------------------------------------------------- permissions --

const PEOPLE = [
  { id: "p-admin", username: "sunny.b", access: "super_admin", accessRoleId: "super_admin" },
  { id: "fh", username: "f.h", access: "function_head", accessRoleId: "function_head", functionId: "fn1" },
  { id: "m", username: "m.m", access: "manager", accessRoleId: "manager", managerId: "fh", functionId: "fn1" },
  { id: "e", username: "e.e", access: "employee", accessRoleId: "employee", managerId: "m", functionId: "fn1", salary: 10, dob: "2000-01-01" },
  { id: "e2", username: "e2.e", access: "employee", accessRoleId: "employee", managerId: "x", functionId: "fn2", salary: 20 },
  { id: "e3", username: "e3.e", access: "employee", accessRoleId: "employee", managerId: "x", functionId: "fn1sub", salary: 30 },
  { id: "hr", username: "h.r", access: "hr", accessRoleId: "hr" },
];
const ctx = buildOrgContext({
  people: PEOPLE,
  accessRoles: [
    { id: "employee", base: "employee", scope: "own", grants: { apms: { view: true }, rewards: { view: true } } },
    { id: "manager", base: "manager", scope: "team" },
  ],
  functions: [{ id: "fn1sub", parentId: "fn1" }],
});
const V = (id: string) => viewerFor(id, ctx);

test("packs match the SPA's packForBase (grants and flags per base)", () => {
  const e = packForBase("employee");
  assert.equal(e.scope, "own");
  assert.ok(e.grants.apms.view && !e.grants.apms.edit && !e.grants["org-people"].view);
  const m = packForBase("manager");
  assert.equal(m.scope, "team");
  assert.ok(m.grants.rewards.create && m.grants.rewards.edit && !m.grants.rewards.delete && m.flags.lock_rewards && !m.flags.pay);
  const f = packForBase("function_head");
  assert.equal(f.scope, "function");
  assert.ok(f.grants["org-people"].edit && !f.grants["org-people"].create && f.grants.targets.create && !f.flags.pay && !f.flags.personal);
  const h = packForBase("hr");
  assert.ok(h.flags.pay && h.flags.personal && h.scope === "company" && h.grants["org-people"].delete);
  assert.ok(can(V("p-admin"), "settings-backup", "delete"));
  assert.ok(readsEverything(V("hr")) && readsEverything(V("p-admin")) && !readsEverything(V("m")));
});

test("scope sets: own / team (recursive) / function (subtree) / company", () => {
  assert.deepEqual([...(scopeSet(V("e"), "apms") as Set<string>)], ["e"]);
  assert.deepEqual([...(scopeSet(V("m"), "rewards") as Set<string>)].sort(), ["e", "m"]);
  const f = scopeSet(V("fh"), "apms") as Set<string>;
  assert.ok(f.has("m") && f.has("e") && f.has("e3") && !f.has("e2"), "function subtree + team, not another function");
  assert.equal(scopeSet(V("hr"), "apms"), "all");
  assert.deepEqual([...(scopeSet(V("e"), "targets") as Set<string>)], ["e"], "no grant → self only");
});

test("filterSnapshot: pay / personal / records / trash / logins / roles by viewer", () => {
  const snap = {
    people: PEOPLE,
    records: { "2026-09": { e: { a: 1 }, e2: { a: 2 }, m: { a: 3 } } },
    rewardRecords: { "2026-09": { e: { r: 1 }, e2: { r: 2 } } },
    trash: [{ id: "t1", snapshot: { people: [{ id: "e2", salary: 20 }] } }],
    logins: { "e.e": { personId: "e", password: "h" }, "e2.e": { personId: "e2" } },
    roles: { r1: { id: "r1", name: "R", slabs: { M1: 1 }, salaryFrom: 1, kras: [] } },
  };
  const e = filterSnapshot(V("e"), snap) as typeof snap;
  assert.equal(e.people.find((p) => p.id === "e")?.salary, 10, "own salary visible");
  assert.ok(!("salary" in (e.people.find((p) => p.id === "e2") || {})));
  assert.deepEqual(Object.keys(e.records["2026-09"]), ["e"]);
  assert.deepEqual(Object.keys(e.rewardRecords["2026-09"]), ["e"]);
  assert.equal(e.trash.length, 0);
  assert.deepEqual(Object.keys(e.logins), ["e.e"]);
  assert.ok(!("password" in (e.logins["e.e"] as Record<string, unknown>)));
  assert.ok(!("slabs" in e.roles.r1) && "kras" in e.roles.r1);
  const m = filterSnapshot(V("m"), snap) as typeof snap;
  assert.deepEqual(Object.keys(m.records["2026-09"]).sort(), ["e", "m"]);
  const a = filterSnapshot(V("p-admin"), snap);
  assert.equal(a, snap, "admins share the unfiltered snapshot");
});

test("person writes: Me fields, access, pay, hidden fields kept, scope", () => {
  const stored = { id: "e", name: "E", phone: "1", salary: 10, access: "employee", location: "X" };
  assert.equal(checkPersonWrite(V("e"), "e", { ...stored, phone: "2", name: "E2" }, stored, "edit").refused, null);
  assert.equal(checkPersonWrite(V("e"), "e", { ...stored, location: "Y" }, stored, "edit").refused?.field, "location");
  assert.equal(checkPersonWrite(V("e"), "e", { ...stored, phone: "3", brands: [], buIds: [], note: "" }, stored, "edit").refused, null, "empty defaults the app fills in are not changes");
  assert.equal(checkPersonWrite(V("e"), "e", { ...stored, salary: 99 }, stored, "edit").refused?.field, "salary");
  assert.equal(checkPersonWrite(V("e"), "e", { ...stored, access: "admin" }, stored, "edit").refused?.field, "access");
  assert.equal(checkPersonWrite(V("e"), "e2", { id: "e2", title: "x" }, { id: "e2" }, "edit").refused?.kind, "people");
  // Function head: edits a member; salary hidden → placeholder 0 kept as the stored value, real value refused.
  const member = { id: "e", salary: 10, rewardsSlabs: { M1: 5 }, dob: "2000", location: "X" };
  const ok = checkPersonWrite(V("fh"), "e", { id: "e", salary: 0, rewardsSlabs: { M1: 0 }, location: "Y" }, member, "edit");
  assert.equal(ok.refused, null);
  assert.equal(ok.payload.salary, 10);
  assert.deepEqual(ok.payload.rewardsSlabs, { M1: 5 });
  assert.equal(ok.payload.dob, "2000", "a field missing from the write keeps the stored value");
  assert.equal(checkPersonWrite(V("fh"), "e", { id: "e", salary: 99 }, member, "edit").refused?.field, "salary");
  assert.equal(checkPersonWrite(V("fh"), "e2", { id: "e2", location: "Y" }, { id: "e2" }, "edit").refused?.field, "location", "outside the function");
  assert.equal(checkPersonWrite(V("m"), "e", { id: "e", location: "Y" }, { id: "e" }, "edit").refused?.field, "location", "manager: People view only");
  assert.equal(checkPersonWrite(V("m"), "e", { id: "e", targetNodeId: "t2" }, { id: "e", targetNodeId: "t1" }, "edit").refused, null, "Unlock against on a team member (rewards edit)");
  assert.equal(checkPersonWrite(V("p-admin"), "e", { id: "e", salary: 99 }, member, "edit").refused, null);
});

test("record writes: self comments only for the person, grants + scope + lock flag for managers", () => {
  const rec = { status: "plan_open", notes: "n", selfNotes: "", values: [{ id: "v", score: 3, selfScore: null }] };
  assert.equal(checkRecordWrite(V("e"), "month_records", "e", { ...rec, selfNotes: "mine", values: [{ id: "v", score: 3, selfScore: 4 }] }, rec, "edit"), null);
  assert.equal(checkRecordWrite(V("e"), "month_records", "e", { ...rec, notes: "x" }, rec, "edit")?.field, "notes");
  assert.equal(checkRecordWrite(V("e"), "month_records", "e", rec, null, "create")?.error, "forbidden");
  assert.equal(checkRecordWrite(V("m"), "reward_records", "e", { ...rec, notes: "x" }, rec, "edit"), null);
  assert.equal(checkRecordWrite(V("m"), "reward_records", "e", { ...rec, status: "plan_locked" }, rec, "edit"), null, "manager has lock_rewards");
  assert.equal(checkRecordWrite(V("m"), "reward_records", "e2", { ...rec, notes: "x" }, rec, "edit")?.error, "forbidden", "outside the team");
  assert.equal(checkRecordWrite(V("m"), "reward_records", "e", rec, rec, "delete")?.error, "forbidden", "no delete grant");
  assert.ok(onlySelfChanges({ a: 1, selfX: 2, n: [{ selfY: 1 }] }, { a: 1, selfX: 1, n: [{ selfY: 0 }] }));
  assert.ok(!onlySelfChanges({ a: 2 }, { a: 1 }));
});

test("entity writes: module grants, open kinds, settings, logins, trash, roles hidden fields", () => {
  const E = V("e");
  assert.equal(checkEntityWrite(E, "kpi-master", "k", { id: "k" }, null, false).refused?.kind, "kpi-master");
  assert.equal(checkEntityWrite(E, "notices", "n", { id: "n" }, null, false).refused, null);
  assert.equal(checkEntityWrite(E, "trash", "t", { id: "t" }, null, false).refused, null, "filing a trash row is open");
  assert.equal(checkEntityWrite(E, "trash", "t", {}, { payload: { id: "t" } }, true).refused?.kind, "trash", "restore / delete forever needs Settings → Trash");
  assert.equal(checkEntityWrite(E, "settings", "companyFactor", { value: 2 }, null, false).refused?.field, "companyFactor");
  assert.equal(checkEntityWrite(E, "logins", "e.e", { personId: "e" }, null, false).refused, null);
  assert.equal(checkEntityWrite(E, "logins", "e2.e", { personId: "e2" }, null, false).refused?.kind, "logins");
  const F = V("fh");
  assert.equal(checkEntityWrite(F, "functions", "f", { id: "f" }, null, false).refused?.kind, "functions", "FH: functions edit, not create");
  assert.equal(checkEntityWrite(F, "functions", "f", { id: "f", name: "x" }, { payload: { id: "f" } }, false).refused, null);
  assert.equal(checkEntityWrite(F, "target-members", "g", { groupId: "g" }, null, false).refused, null, "memberships are an edit of the target");
  const role = checkEntityWrite(F, "roles", "r", { id: "r", slabs: null, name: "R2" }, { payload: { id: "r", slabs: { M1: 9 }, name: "R" } }, false);
  assert.equal(role.refused, null);
  assert.deepEqual(role.payload.slabs, { M1: 9 }, "hidden role pay kept");
  assert.equal(checkEntityWrite(V("m"), "access-roles", "x", {}, null, false).refused?.kind, "access-roles");
});

test("book PATCH tombstones: restricted callers cannot wipe a month or delete people", () => {
  const got = filterTombstones(V("e"), { records: { "2026-09": 1 }, people: { e2: 1, known: 1 }, targetCells: { c: 1 } }, { people: { known: 1 } });
  assert.deepEqual(got.tombs, { records: {}, people: { known: 1 }, targetCells: {} });
  assert.equal(got.dropped.length, 3);
  const h = filterTombstones(V("hr"), { people: { e2: 1 }, records: { "2026-09": 1 } }, {});
  assert.deepEqual(h.tombs, { people: { e2: 1 }, records: {} }, "HR may trash people, never a whole month");
});

test("change feed + hints filtered per viewer", () => {
  const E = V("e");
  assert.equal(filterChange(E, { kind: "reward-records", k1: "e2", k2: "2026-09", payload: {} }), null);
  assert.ok(filterChange(E, { kind: "reward-records", k1: "e", k2: "2026-09", payload: {} }));
  const p = filterChange(E, { kind: "people", k1: "e2", payload: { id: "e2", salary: 1, name: "x" } });
  assert.deepEqual(p?.payload, { id: "e2", name: "x" });
  assert.equal(filterChange(E, { kind: "trash", k1: "t", payload: {} }), null);
  assert.ok(filterChange(E, { kind: "*", k1: "resync" }));
  assert.deepEqual(filterHints(E, [{ type: "reward-records", id: "e2" }, { type: "people", id: "e2" }, { type: "reward-records", id: "e" }]).map((h) => h.id), ["e2", "e"]);
  assert.ok(isEmptyish({ M1: 0, M2: null }) && !isEmptyish({ M1: 1 }));
  assert.ok(flag(V("m"), "lock_rewards") && !flag(V("m"), "pay"));
});

// ------------------------------------------------------ database-backed --

const probe = await openTestDb();
if (probe) probe.close();
const skip = !probe ? { skip: "no test database" } : undefined;

test("lock-out: 5 wrong → locked, right password refused, admin unlock, per-IP 30", skip, async () => {
  const db = (await openTestDb())!;
  const g = await import("./apms-signin-guard.ts");
  g.useSigninSqlForTests(db.sql);
  try {
    for (let i = 0; i < 4; i++) assert.equal(await g.recordSigninFailure("u1", `ip${i}`), null);
    const lock = await g.recordSigninFailure("u1", "ip9");
    assert.equal(lock?.scope, "user");
    assert.equal((await g.signinLock("u1", "other"))?.scope, "user");
    assert.equal((await g.listLockedUsernames())[0].username, "u1");
    assert.equal(await g.unlockUsername("u1"), true);
    assert.equal(await g.signinLock("u1", "other"), null);
    let ipLock = null;
    for (let i = 0; i < 30; i++) ipLock = await g.recordSigninFailure(`x${i}`, "10.0.0.1");
    assert.equal(ipLock?.scope, "ip");
    assert.equal((await g.signinLock("someone", "10.0.0.1"))?.scope, "ip");
    await g.recordSigninSuccess("u2");
    assert.equal(g.clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), null), "1.2.3.4", "last proxy-appended entry");
  } finally {
    g.useSigninSqlForTests(null);
    db.close();
  }
});

test("one-time conversion: backs up, hashes everything, idempotent", skip, async () => {
  const db = (await openTestDb())!;
  const { sweepPlaintextPasswords } = await import("./apms-password-migrate.ts");
  try {
    await db.sql.query(`create table if not exists issued_logins (username text primary key, person_id text, password text not null, updated_at timestamptz not null default now())`);
    await db.sql.query(`create table if not exists company_books (book text primary key, snapshot_json text not null, content_hash text not null default '', updated_at timestamptz not null default now())`);
    await db.sql.query(`insert into issued_logins (username, person_id, password) values ('a', 'p1', 'Plain-1')`);
    await db.sql.query(`insert into people (id, payload) values ('p1', '{"id":"p1","password":"Plain-2"}'::jsonb)`);
    await db.sql.query(`insert into entities (kind, id, k1, payload) values ('logins', 'a', 'a', '{"personId":"p1","password":"Plain-3"}'::jsonb)`);
    await db.sql.query(`insert into company_books (book, snapshot_json) values ('org', $1)`, [JSON.stringify({ people: [{ id: "p1", password: "Plain-4" }], logins: { a: { password: "Plain-5" } } })]);
    const lines: string[] = [];
    const r1 = await sweepPlaintextPasswords(db.sql, (l) => lines.push(l));
    assert.ok(r1.converted >= 5, lines.join(" | "));
    assert.ok(r1.backupTable);
    const bk = await db.sql.query<{ password: string }>(`select password from ${r1.backupTable}`);
    assert.deepEqual(bk.map((r) => r.password).sort(), ["Plain-1", "Plain-2", "Plain-3", "Plain-4", "Plain-5"]);
    const iss = await db.sql.query<{ password: string }>(`select password from issued_logins`);
    assert.ok(verifyPassword("Plain-1", iss[0].password));
    const book = await db.sql.query<{ snapshot_json: string }>(`select snapshot_json from company_books`);
    assert.ok(!book[0].snapshot_json.includes("Plain-"));
    const r2 = await sweepPlaintextPasswords(db.sql, () => undefined);
    assert.equal(r2.converted, 0);
  } finally {
    db.close();
  }
});

test("first hot-table import is atomic and complete", skip, async () => {
  const db = (await openTestDb())!;
  const { importHotTablesAtomic, liveHotTableCounts } = await import("./company-hot-tables.ts");
  try {
    const snap = {
      people: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      records: { "2026-09": { p1: { a: 1 }, p2: { a: 2 } } },
      rewardRecords: { "2026-09": { p1: { r: 1 } } },
      targetCells: { "n1::2026-09": { value: 1 } },
    };
    const counts = await importHotTablesAtomic(db.sql, snap as never);
    assert.equal(counts.people, 50);
    assert.equal(counts.monthRecords, 2);
    assert.equal(counts.rewardRecords, 1);
    assert.equal(counts.targetCells, 1);
    const again = await importHotTablesAtomic(db.sql, snap as never);
    assert.equal(again.people, 50);
    assert.deepEqual(await liveHotTableCounts(db.sql), again);
  } finally {
    db.close();
  }
});
