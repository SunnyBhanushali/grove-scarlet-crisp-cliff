import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);

test("$o calls useState before any early return (React #318)", () => {
  const i = routes.indexOf("function $o({personId:e})");
  assert.ok(i > 0);
  const body = routes.slice(i, i + 500);
  const hook = body.indexOf("useState");
  const early = body.indexOf("if(!person)return");
  assert.ok(hook >= 0 && early >= 0 && hook < early, body.slice(0, 220));
  assert.match(body, /try\{r=ge\(/);
});

test("role picker does not call toLowerCase on a missing role name", () => {
  const i = routes.indexOf("function Pc(");
  assert.ok(i > 0);
  const body = routes.slice(i, i + 1200);
  assert.equal(body.includes("e.name.toLowerCase()"), false);
  assert.match(body, /String\(e&&e\.name\|\|``\)\.toLowerCase\(\)/);
});
