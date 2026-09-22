import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const login = readFileSync(
  new URL("../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

test("opening yourself goes to My Rewards, not the person-year page", () => {
  assert.match(
    login,
    /view=t\?t===me\?r===`rewards`\?`rewards-me`:`apms-me`:r===`rewards`\?`rewards-person`:`apms-person`/,
  );
  assert.equal(login.includes("view:t?r===`rewards`?`rewards-person`:`apms-person`"), false);
});

test("self year page renders My Rewards; All Rewards no longer forces rewards-person", () => {
  assert.match(routes, /if\(isSelf\)return\(0,Q\.jsx\)\(Km,\{\}\)/);
  assert.equal(routes.includes("setView(`rewards-person`)"), false);
  assert.equal(
    routes.includes("r.setSelectedPerson(e.id),r.setView(r.kind===`rewards`?`rewards-person`:`apms-person`)"),
    false,
  );
  assert.match(routes, /u\(`rewards-me`,\{replace:!0\}\)/);
  assert.match(routes, /function yearView\(/);
});

test("stamp p0as68; fallbackPost absent", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0ar\.js\?v=p0as68/);
  assert.match(routes, /login-view-f2j6t0x4-11a3-p0ar\.js\?v=p0as68/);
  assert.equal(routes.includes("fallbackPost"), false);
});
