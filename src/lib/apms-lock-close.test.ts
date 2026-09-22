import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(
  new URL("../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

function loadGaps() {
  const start = login.indexOf("function valuesCloseGaps(");
  const end = login.indexOf("function ac(", start);
  assert.ok(start > 0 && end > start);
  const fn = new Function(`${login.slice(start, end)}; return valuesCloseGaps;`);
  return fn() as (e: {
    values?: { name?: string; inPlay?: boolean; behaviours?: { score?: number | null; inPlay?: boolean }[] }[];
  }) => string[];
}

test("locked APMS freezes values pick and EO add unless unlocked", () => {
  assert.match(login, /let locked=K\(n\)===`plan_locked`\|\|K\(n\)===`closed`;return\{targets:o&&\(!locked\|\|r\),scores:score/);
  assert.match(routes, /canStruct:D\.targets/);
  assert.match(routes, /function Au\(\{empId:e,rec:t,canEditMgr:n,canStruct:k,kind:r\}\)/);
  assert.match(routes, /k&&\(0,Q\.jsxs\)\(z,\{size:`sm`,variant:`outline`,onClick:f,/);
  assert.match(routes, /open=k&&\(!!editIds\[t\.id\]\|\|!\(t\.name\|\|``\)\.trim\(\)\)/);
  assert.match(
    routes,
    /targets:!!y&&y\.access!==`employee`&&\(!\(T===`plan_locked`\|\|zi\(T\)\)\|\|Br\(y\)\|\|e\.editUnlock\)/,
  );
});

test("cannot close APMS while selected values are unrated", () => {
  const gaps = loadGaps();
  assert.deepEqual(gaps({ values: [] }), ["Select and rate values before close."]);
  assert.deepEqual(
    gaps({
      values: [{ name: "Care", inPlay: true, behaviours: [{ score: null, inPlay: true }] }],
    }),
    ["Value “Care”: rate every selected behaviour before close."],
  );
  assert.deepEqual(
    gaps({
      values: [
        {
          name: "Care",
          inPlay: true,
          behaviours: [
            { score: 4, inPlay: true },
            { score: 5, inPlay: true },
          ],
        },
      ],
    }),
    [],
  );
  assert.match(login, /if\(o\.values>0\)n\.push\(\.\.\.valuesCloseGaps\(e\)\)/);
  assert.match(login, /if\(K\(r\)===`closed`&&i\.kind!==`rewards`\)\{let rec=\(i\.records\|\|\{\}\)\[a\]\?\.\[n\],errs=ic\(rec,`apms`\)/);
});

test("stamp p0as68; fallbackPost absent", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0ar\.js\?v=p0as68/);
  assert.match(routes, /login-view-f2j6t0x4-11a3-p0ar\.js\?v=p0as68/);
  assert.equal(routes.includes("fallbackPost"), false);
});
