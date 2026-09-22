import assert from "node:assert/strict";
import { loginEmail, loginEmails, matchPerson } from "./auth-login-match.ts";

const people = [
  { id: "p-sunny", username: "sunny.b", email: "sunny.b@aliens.local", name: "Sunny" },
  { id: "p-allan", username: "allan.g", email: "allan.gois@alienstattoo.com", name: "Allan" },
  { id: "p-bhanu", username: "bhanu.p", email: "", name: "Bhanu" },
];

assert.deepEqual(loginEmails({ username: "allan.g", email: "allan.gois@alienstattoo.com" }), [
  "allan.g@aliens.local",
  "allan.gois@alienstattoo.com",
]);
assert.equal(loginEmail({ username: "allan.g", email: "allan.gois@alienstattoo.com" }), "allan.g@aliens.local");
assert.equal(loginEmail({ username: "bhanu.p" }), "bhanu.p@aliens.local");

assert.equal(matchPerson(people, { email: "allan.g@aliens.local" })?.id, "p-allan");
assert.equal(matchPerson(people, { username: "allan.g" })?.id, "p-allan");
assert.equal(matchPerson(people, { email: "allan.gois@alienstattoo.com" })?.id, "p-allan");
assert.equal(matchPerson(people, { email: "nobody@aliens.local", username: "ghost" }), null);

console.log("auth-logins matching ok");
