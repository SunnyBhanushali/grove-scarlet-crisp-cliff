import assert from "node:assert/strict";
import { findPerson, usernameKey, verifyLogin } from "./apms-credentials.ts";

const people = [
  { id: "p-admin", username: "sunny.b", email: "sunny.b@aliens.local", name: "Sunny", password: "0000" },
  { id: "p-allan", username: "allan.g", email: "allan.gois@alienstattoo.com", name: "Allan", password: "Ab3defghjk" },
  { id: "p-bhanu", username: "bhanu.p", email: "", name: "Bhanu", password: "" },
  { id: "p-left", username: "gone.x", email: "", name: "Gone", password: "0000", status: "left" },
];

assert.equal(usernameKey("Allan.G@aliens.local"), "allan.g");
assert.equal(findPerson(people, "allan.g")?.id, "p-allan");
assert.equal(findPerson(people, "allan.gois@alienstattoo.com")?.id, "p-allan");
assert.equal(findPerson(people, "gone.x"), null);

assert.equal(verifyLogin(people, {}, "sunny.b", "0000")?.id, "p-admin");
assert.equal(verifyLogin(people, {}, "allan.g", "Ab3defghjk")?.id, "p-allan");
assert.equal(verifyLogin(people, {}, "allan.g", "0000"), null);
assert.equal(verifyLogin(people, {}, "bhanu.p", "0000")?.id, "p-bhanu");
assert.equal(verifyLogin(people, {}, "bhanu.p", "nope"), null);
assert.equal(
  verifyLogin(people, { "bhanu.p": { personId: "p-bhanu", password: "Temp99ab" } }, "bhanu.p", "Temp99ab")?.id,
  "p-bhanu",
);
assert.equal(verifyLogin(people, {}, "gone.x", "0000"), null);

console.log("apms-credentials ok");
