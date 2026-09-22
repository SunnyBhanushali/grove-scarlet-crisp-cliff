import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

const dollarO = routes.slice(
  routes.indexOf("function $o("),
  routes.indexOf("function es("),
);
const drawer = routes.slice(
  routes.indexOf("function $oDrawer("),
  routes.indexOf("function $o("),
);

test("quarter Details opens a drawer under the grid, not inside the card", () => {
  assert.match(drawer, /data-q-drawer/);
  assert.match(drawer, /How earn-back is worked/);
  assert.match(dollarO, /\$oDrawer,\{openQ,setOpenQ/);
  assert.equal(dollarO.includes("How earn-back is worked"), false);
  assert.equal(dollarO.includes("mt-2 space-y-3 border-t border-border pt-2"), false);
  assert.match(dollarO, /grid items-start gap-3/);
  assert.equal(dollarO.includes("grid items-stretch"), false);
  assert.equal(dollarO.includes("flex h-full flex-col rounded-xl"), false);
});

test("stamp p0as68; fallbackPost absent", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0ar\.js\?v=p0as68/);
  assert.equal(routes.includes("fallbackPost"), false);
});
