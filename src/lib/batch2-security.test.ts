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
