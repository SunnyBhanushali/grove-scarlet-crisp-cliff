import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);

test("employee status options are Active / Paused / Exited", () => {
  assert.match(
    routes,
    /id:`plans-states`,items:\[\{id:`active`,name:`Active`\},\{id:`paused`,name:`Paused`\},\{id:`left`,name:`Exited`\}\]/,
  );
  assert.equal(routes.includes("children:`Left`"), false);
  assert.equal(routes.includes("children:`Exited`"), true);
  assert.equal(routes.includes("children:`Paused`"), true);
  assert.equal(routes.includes("children:`Active`"), true);
  assert.equal(routes.includes("label:`Exited on`"), true);
  assert.equal(routes.includes("label:`Left on`"), false);
  assert.match(routes, /function hitEmp\(/);
});

test("plans-states is employee status, not plan-cycle states", () => {
  const i = routes.indexOf("id:`plans-states`");
  assert.ok(i > 0);
  const slice = routes.slice(i, i + 280);
  assert.equal(slice.includes("plan_open"), false);
  assert.equal(slice.includes("Assigned"), false);
  assert.equal(slice.includes("Draft"), false);
});
