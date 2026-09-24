/**
 * BATCH-2 security: server-issued session tokens, admin-only login writes,
 * admin-only people / access-role / login row writes.
 * The HTTP version against the built server is scripts/e2e/security-batch2.mjs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  issueSessionToken,
  looksIssued,
  personIdForSessionToken,
  revokeSessionToken,
  useMemorySessionsForTests,
} from "./apms-sessions.ts";
import { hasValidSession, sessionPersonId } from "./apms-request-auth.ts";
import { rowsAreOwn } from "./apms-admin-auth.ts";
import { patchPayload, peopleWriteRefusal } from "./apms-write-guard.ts";

useMemorySessionsForTests();

function headers(h: Record<string, string>) {
  return new Headers(h);
}

test("only tokens the server issued resolve to a person", async () => {
  const token = await issueSessionToken("p-42");
  assert.ok(looksIssued(token));
  assert.equal(await personIdForSessionToken(token), "p-42");
  assert.equal(await sessionPersonId(headers({ authorization: `Bearer ${token}` })), "p-42");
  assert.equal(await sessionPersonId(headers({ cookie: `better-auth.session_token=${encodeURIComponent(token)}` })), "p-42");
  for (const forged of [
    "abcdefghijklmnopqrstuvwxyz",
    "apms-login.p-42",
    "apms-login.p-admin",
    "apms-preview-sunny",
    "apms-s." + "A".repeat(43),
    token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"),
    "",
  ]) {
    assert.equal(await hasValidSession(headers({ authorization: `Bearer ${forged}` })), false, forged);
    assert.equal(await hasValidSession(headers({ cookie: `better-auth.session_token=${forged}` })), false, forged);
  }
  assert.equal(await hasValidSession(headers({})), false);
});

test("a stale bearer does not hide a valid cookie session", async () => {
  const token = await issueSessionToken("p-7");
  const h = headers({ authorization: "Bearer apms-login.p-admin", cookie: `better-auth.session_token=${token}` });
  assert.equal(await sessionPersonId(h), "p-7");
});

test("sign-out revokes the token", async () => {
  const token = await issueSessionToken("p-9");
  assert.equal(await personIdForSessionToken(token), "p-9");
  await revokeSessionToken(token);
  assert.equal(await personIdForSessionToken(token), null);
});

test("a non-admin may post only their own login row", () => {
  const me = { id: "p-1", username: "nikhil.pati", email: "n@x.com", access: "employee", accessRoleId: "employee" };
  assert.equal(rowsAreOwn([{ username: "nikhil.pati", password: "x", personId: "p-1" }], me), true);
  assert.equal(rowsAreOwn([{ username: "Nikhil.Pati", password: "x" }], me), true);
  assert.equal(rowsAreOwn([{ username: "sunny.b", password: "x" }], me), false);
  assert.equal(rowsAreOwn([{ username: "nikhil.pati", password: "x", personId: "p-admin" }], me), false);
  assert.equal(rowsAreOwn([{ username: "nikhil.pati", password: "x" }, { username: "sunny.b", password: "y" }], me), false);
  assert.equal(rowsAreOwn([], me), false);
});

test("people writes: access roles and other people's passwords are admin-only", () => {
  const stored = { id: "p-1", access: "employee", accessRoleId: "employee", password: "old", phone: "1" };
  // Ordinary edits (own or someone else's) are fine.
  assert.equal(peopleWriteRefusal("p-1", "p-1", { ...stored, phone: "2" }, stored), "");
  assert.equal(peopleWriteRefusal("p-2", "p-1", { ...stored, phone: "2" }, stored), "");
  // Own password (Me → change password) is fine; someone else's is not.
  assert.equal(peopleWriteRefusal("p-1", "p-1", { ...stored, password: "new" }, stored), "");
  assert.notEqual(peopleWriteRefusal("p-2", "p-1", { ...stored, password: "new" }, stored), "");
  // A re-save without a password (the wire never carries it) is fine.
  assert.equal(peopleWriteRefusal("p-2", "p-1", { id: "p-1", access: "employee", accessRoleId: "employee" }, stored), "");
  // Raising an access role — own or anyone's — is not.
  assert.notEqual(peopleWriteRefusal("p-1", "p-1", { ...stored, access: "super_admin", accessRoleId: "super_admin" }, stored), "");
  assert.notEqual(peopleWriteRefusal("p-1", "p-1", { ...stored, accessRoleId: "admin" }, stored), "");
  // Missing fields fall back to the stored role, not to a change.
  assert.equal(peopleWriteRefusal("p-1", "p-1", { phone: "3" }, { phone: "1" }), "");
  // A new hire: default employee is fine, an admin hire is not.
  assert.equal(peopleWriteRefusal("p-1", "p-new", { id: "p-new", access: "employee", accessRoleId: "employee" }, null), "");
  assert.notEqual(peopleWriteRefusal("p-1", "p-new", { id: "p-new", access: "admin", accessRoleId: "admin" }, null), "");
});

test("patchPayload reads both body shapes", () => {
  assert.deepEqual(patchPayload({ payload: { a: 1 }, baseRev: 2 }), { a: 1 });
  assert.deepEqual(patchPayload({ data: { payload: { b: 2 } } }), { b: 2 });
  assert.deepEqual(patchPayload(null), {});
});

// ---------------------------------------------------------------------------
// BATCH-2 sibling order (drag-reorder is saved as `sortKey` on sibling rows).
// ---------------------------------------------------------------------------
test("sibling order: lists and maps sort by sortKey, stable, same object when nothing moves", async () => {
  const { collections } = await import("./apms-collections.ts");
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(collections.sortBySortKey(list), list, "no keys → untouched");
  const moved = collections.sortBySortKey([{ id: "a", sortKey: 2 }, { id: "x" }, { id: "b", sortKey: 0 }, { id: "c", sortKey: 1 }]);
  assert.deepEqual(moved.map((x) => x.id), ["b", "c", "a", "x"]);
  const snap = { people: [{ id: "p1", sortKey: 1 }, { id: "p2", sortKey: 0 }], roles: { r1: { sortKey: 1 }, r2: { sortKey: 0 } }, notices: [{ id: "n" }] };
  const out = collections.orderSiblings(snap);
  assert.deepEqual(out.people.map((x) => x.id), ["p2", "p1"]);
  assert.deepEqual(Object.keys(out.roles), ["r2", "r1"]);
  assert.equal(out.notices, snap.notices);
  assert.equal(collections.orderSiblings(out), out, "already ordered → same object");
  // A feed row with a new sortKey moves in place.
  const spec = collections.specForKind("functions")!;
  const fns = [{ id: "f1", sortKey: 0 }, { id: "f2", sortKey: 1 }];
  const next = collections.applyRow(spec, fns, { kind: "functions", id: "f2", k1: "f2", k2: null, payload: { id: "f2", sortKey: -1 } }, false) as Array<{ id: string }>;
  assert.deepEqual(next.map((x) => x.id), ["f2", "f1"]);
});

test("sibling order: the SPA reorder writes sortKey 0..n-1 on the moved row's siblings only", async () => {
  const { stampLogin } = await import("../../scripts/stamp-p0as81-batch2.mjs");
  const { readFileSync } = await import("node:fs");
  const login = readFileSync(new URL("../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url), "utf8");
  assert.equal(stampLogin(login), login, "login-view chunk carries the stamp (idempotent)");
  const m = login.match(/function _sk\(a,t,k\)\{[^]*?\}\}\)\}/);
  assert.ok(m, "helper present");
  const _sk = new Function(`${m![0]}; return _sk;`)() as (a: Array<Record<string, unknown>>, t: string, k: (x: Record<string, unknown>) => string) => Array<Record<string, unknown>>;
  const people = [
    { id: "boss" },
    { id: "t3", managerId: "boss" },
    { id: "other", managerId: "x" },
    { id: "t1", managerId: "boss" },
    { id: "t2", managerId: "boss", sortKey: 2 },
  ];
  const out = _sk(people, "t3", (x) => String(x.managerId || ""));
  assert.deepEqual(out.filter((x) => x.managerId === "boss").map((x) => [x.id, x.sortKey]), [["t3", 0], ["t1", 1], ["t2", 2]]);
  assert.equal(out[4], people[4], "an unchanged sibling keeps its object (no write)");
  assert.equal(out[2], people[2], "other managers' people untouched");
});
