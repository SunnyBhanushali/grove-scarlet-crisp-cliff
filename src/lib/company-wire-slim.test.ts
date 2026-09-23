import assert from "node:assert/strict";
import test from "node:test";
import { slimForWire, slimPersonForWire, slimLoginsForWire } from "./company-wire-slim.ts";
import { preservePersonSecrets } from "./company-entities.ts";
import { redactEntityPayload } from "./company-entity-store.ts";

test("wire: no password or hash on any person, no password in logins", () => {
  const slim = slimForWire({
    people: [
      { id: "p1", name: "A", password: "secret", passwordHash: "h" },
      { id: "p2", name: "B" },
    ],
    logins: { a: { personId: "p1", password: "secret" }, b: { personId: "p2" } },
    roles: { r: { id: "r" } },
  });
  assert.deepEqual(slim.people, [{ id: "p1", name: "A" }, { id: "p2", name: "B" }]);
  assert.deepEqual(slim.logins, { a: { personId: "p1" }, b: { personId: "p2" } });
  assert.deepEqual(slim.roles, { r: { id: "r" } });
  assert.equal(JSON.stringify(slim).includes("secret"), false);
});

test("wire: slimmers return the same object when there is nothing to strip", () => {
  const row = { id: "p", name: "n" };
  assert.equal(slimPersonForWire(row), row);
  assert.deepEqual(slimLoginsForWire({ a: { personId: "x" } }), { a: { personId: "x" } });
  assert.equal(slimPersonForWire(null), null);
});

test("people PATCH: a client that never saw the password cannot erase it; a new one replaces it", () => {
  const stored = { id: "p1", name: "A", password: "old", passwordHash: "h1" };
  assert.deepEqual(preservePersonSecrets({ id: "p1", name: "A renamed" }, stored), {
    id: "p1",
    name: "A renamed",
    password: "old",
    passwordHash: "h1",
  });
  assert.deepEqual(preservePersonSecrets({ id: "p1", name: "A", password: "" }, stored).password, "old");
  assert.deepEqual(preservePersonSecrets({ id: "p1", name: "A", password: "new" }, stored).password, "new");
  // brand-new person with no stored row and no password: nothing invented
  assert.deepEqual(preservePersonSecrets({ id: "p9", name: "New" }, null), { id: "p9", name: "New" });
});

test("entity rows: logins payload is redacted on the way out", () => {
  assert.deepEqual(redactEntityPayload("logins", { personId: "p1", password: "x" }), { personId: "p1" });
  assert.deepEqual(redactEntityPayload("roles", { id: "r", password: "not-a-secret-field" }), { id: "r", password: "not-a-secret-field" });
});
