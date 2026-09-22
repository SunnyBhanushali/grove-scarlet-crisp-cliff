import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const sync = readFileSync(new URL("../../public/assets/apms-sync.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

function asFlagList(v: unknown) {
  return Array.isArray(v)
    ? v
    : v && typeof v === "object"
      ? Object.values(v as object).filter((x) => x != null)
      : [];
}

function walkFlags(n: unknown) {
  const names: string[] = [];
  if (!n || typeof n !== "object") return names;
  for (const r of Object.values(n as object)) {
    if (!r || typeof r !== "object") continue;
    for (const rec of Object.values(r as object)) {
      if (!rec || typeof rec !== "object") continue;
      for (const fl of asFlagList((rec as { rewardFlags?: unknown }).rewardFlags)) {
        const flag = fl as { kind?: string; name?: string };
        if (flag && flag.name) names.push(flag.name);
      }
    }
  }
  return names;
}

test("Iu useMemo no longer for-ofs raw rewardFlags", () => {
  assert.match(routes, /function asFlagList\(/);
  assert.match(routes, /for\(let fl of asFlagList\(rec\.rewardFlags\)\)/);
  assert.equal(routes.includes("for(let r of n.rewardFlags||[])"), false);
  assert.match(routes, /try\{walk\(i\.rewardRecords\),walk\(i\.rewardRoleMonths\)\}catch/);
  assert.match(routes, /\[i\.rewardRecords,i\.rewardRoleMonths\]\);if\(!t\)return null;/);
});

test("object rewardFlags and a missing rec do not throw", () => {
  const tree = {
    "2026-09": {
      p1: { rewardFlags: { 0: { kind: "disqualifier", name: "DQ" } } },
      p2: { rewardFlags: [{ kind: "qualifier", name: "Q" }] },
      p3: { rewardFlags: null },
      p4: "oops",
    },
  };
  assert.deepEqual(walkFlags(tree).sort(), ["DQ", "Q"]);
  assert.deepEqual(walkFlags(null), []);
  assert.deepEqual(asFlagList({ 0: { name: "x" } }), [{ name: "x" }]);
  assert.deepEqual(asFlagList(undefined), []);
});

test("live merge listifies plan arrays", () => {
  assert.match(sync, /function normalizePlanRec\(/);
  assert.match(sync, /out\.rewardFlags = listify\(out\.rewardFlags\)/);
  assert.match(sync, /tree\[period\]\[pid\] = normalizePlanRec\(payload\)/);
  assert.match(sync, /Stamp: p0as65/);
});

test("stamp p0as65; fallbackPost absent; G9 path kept", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0ar\.js\?v=p0as68/);
  assert.match(html, /apms-sync\.js\?v=p0as65/);
  assert.equal(routes.includes("fallbackPost"), false);
  assert.equal(sync.includes("fallbackPost"), false);
  assert.equal(sync.includes("handleLiveEvent"), true);
  assert.equal(sync.includes("LIVE_ENTITY_CAP"), true);
});
