import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

test("Add plan still blocks creating for yourself", () => {
  assert.match(routes, /Can't add for yourself/);
  assert.match(routes, /You cannot create .* for yourself\. Your reporting manager does that/);
  assert.match(routes, /\$i\(i,a\)\.filter\(e=>e\.id!==a\?\.id\)/);
});

test("searching yourself in Assign to shows the cannot-create-for-self alert", () => {
  assert.match(routes, /selfHit=!!\(me&&q&&/);
  assert.match(routes, /"data-self-block":`1`/);
  assert.match(
    routes,
    /selfHit\?\(0,Q\.jsx\)\(`p`,\{className:`px-3 py-4 text-sm text-amber-950`,"data-self-block":`1`,children:`You cannot create \$\{noun\} for yourself/,
  );
  assert.match(routes, /No people match those filters/);
  assert.equal(
    routes.includes(
      "v.length===0&&(0,Q.jsx)(`p`,{className:`px-3 py-4 text-sm text-muted-foreground`,children:`No people match those filters.`})",
    ),
    false,
  );
});

test("stamp p0as68; fallbackPost absent", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0ar\.js\?v=p0as68/);
  assert.equal(routes.includes("fallbackPost"), false);
});
