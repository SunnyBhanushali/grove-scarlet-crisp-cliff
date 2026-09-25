import assert from "node:assert/strict";
import test from "node:test";
import { scrubJson, scrubText, stagingHash } from "../deploy/server/sanitize-staging-db.mjs";
import { verifyPassword, isPasswordHash } from "../src/lib/apms-password.ts";

test("staging hash signs in through the app's own verifyPassword", () => {
  const h = stagingHash("Staging-Only-1");
  assert.ok(isPasswordHash(h));
  assert.equal(verifyPassword("Staging-Only-1", h), true);
  assert.equal(verifyPassword("0000", h), false);
});

test("emails are blanked, @aliens.local placeholders stay", () => {
  assert.equal(scrubText("mail a.b@alienstattoos.com now"), "mail  now");
  assert.equal(scrubText("sunny.b@aliens.local"), "sunny.b@aliens.local");
  assert.equal(scrubText("no address"), "no address");
});

test("json: passwords -> hash, email fields -> '', people[] all get the hash", () => {
  const h = "scrypt$16384$8$1$x$y";
  const snap = {
    people: [
      { id: "p1", email: "p1@gmail.com", password: "scrypt$old" },
      { id: "p2", username: "p2", personalEmail: "x@y.in" },
    ],
    logins: { p1: { password: "plain", personId: "p1" } },
    notes: "ping hr@alienstattoos.com",
    mustResetPassword: true,
    counts: [1, 2],
  };
  const out = scrubJson(snap, h);
  assert.notEqual(out, snap);
  assert.equal(out.people[0].email, "");
  assert.equal(out.people[0].password, h);
  assert.equal(out.people[1].personalEmail, "");
  assert.equal(out.people[1].password, h);
  assert.equal(out.logins.p1.password, h);
  assert.equal(out.notes, "ping ");
  assert.equal(out.mustResetPassword, true);
  assert.deepEqual(out.counts, [1, 2]);
  // untouched documents keep their identity (no needless row rewrite)
  const clean = { a: 1, b: ["x"], people: [{ id: "p", password: h }] };
  assert.equal(scrubJson(clean, h), clean);
});
