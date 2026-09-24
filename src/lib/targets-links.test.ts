/**
 * BATCH-3 part C: Targets ↔ Rewards links.
 *
 *  - broken-link computation, linked rewards, relink candidates
 *    (src/lib/targets-links.ts AND the SPA copy TL_PURE_JS on the same cases);
 *  - import: a blank cell keeps the stored value, 0 is a value, the summary
 *    counts (src/lib/targets-import.ts AND the bundled TargetsX after the stamp);
 *  - second group in a month leaves the first group intact (the shipping store
 *    actions, taken from the login-view chunk).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  targetLinkBroken,
  rewardsLinkedTo,
  relinkCandidates,
  nodeNameAnyway,
  describeReward,
  annotateRewardMonth,
  stripComputedRewardFields,
  type LinkState,
} from "./targets-links.ts";
import { applyTargetImport, mergeImportRow, parseCsv, type TargetImportRow } from "./targets-import.ts";
// plain .mjs build script (@ts-nocheck); its exports are untyped
import { TL_PURE_JS, TARGETS_ROUTES_FIXES } from "../../scripts/stamp-p0as82-targets.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");

// ---------------------------------------------------------------------------
// The SPA copy of the pure helpers
// ---------------------------------------------------------------------------
type Fn = (...a: unknown[]) => unknown;
const SPA = new Function(`${TL_PURE_JS}; return { __tlBroken, __tlLinked, __tlCands, __tlName, __tlWho, __tlCellIn };`)() as Record<string, Fn>;

const cell = (nodeId: string, month: string) => ({ nodeId, month, ladder: { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5 }, actual: null, mode: "set", status: "open" });

function base(): LinkState {
  return {
    targetNodes: {
      ahd: { id: "ahd", name: "Ahmedabad", kind: "leaf", sbuId: "bu-ahd", metric: "rupees" },
      goa: { id: "goa", name: "Goa", kind: "leaf", sbuId: "bu-goa", metric: "rupees" },
      g1: { id: "g1", name: "West", kind: "group", sbuId: null, metric: "rupees" },
    },
    targetCells: {
      "ahd::2026-09": cell("ahd", "2026-09"),
      "goa::2026-09": cell("goa", "2026-09"),
      "goa::2026-08": cell("goa", "2026-08"),
      "g1::2026-09": cell("g1", "2026-09"),
    },
    rewardRecords: {
      "2026-09": {
        nevil: { targetNodeId: "ahd", status: "plan_open" },
        biri: { targetNodeId: "ahd" },
        aman: { targetNodeId: "goa" },
        rohan: { status: "plan_open" },
      },
      "2026-08": { nevil: { targetNodeId: "ahd" }, aman: { targetNodeId: "goa" } },
    },
    rewardRoleMonths: { r1: { "2026-09": { targetNodeId: "ahd" } } },
    people: [
      { id: "nevil", name: "Nevil Prajapati" },
      { id: "biri", name: "Biri tahu" },
      { id: "aman", name: "Aman Vishwakarma" },
    ],
    roles: { r1: { name: "Studio Manager" } },
    trash: [],
  };
}

/** What deleteTargetFromMonth leaves: the cell gone; the node gone when no month uses it any more. */
function deleteFromMonth(st: LinkState, id: string, month: string): LinkState {
  const cells = { ...st.targetCells };
  delete cells[`${id}::${month}`];
  const nodes = { ...st.targetNodes };
  const still = Object.values(cells).some((c) => c && c.nodeId === id);
  const node = st.targetNodes![id];
  if (!still) delete nodes[id];
  return {
    ...st,
    targetCells: cells,
    targetNodes: nodes,
    trash: [...(st.trash || []), { kind: "target", snapshot: { targetNodes: node ? { [id]: node } : {} } }],
  };
}

const both = (name: string, fn: (impl: { broken: Fn; linked: Fn; cands: Fn; name: Fn }) => void) => {
  it(`${name} (src/lib)`, () => fn({ broken: targetLinkBroken as Fn, linked: rewardsLinkedTo as Fn, cands: relinkCandidates as Fn, name: nodeNameAnyway as Fn }));
  it(`${name} (SPA copy)`, () => fn({ broken: SPA.__tlBroken, linked: SPA.__tlLinked, cands: SPA.__tlCands, name: SPA.__tlName }));
};

describe("targetLinkBroken", () => {
  both("live node with a cell in the reward's month is not broken", ({ broken }) => {
    const st = base();
    assert.equal(broken(st.rewardRecords!["2026-09"].nevil, "2026-09", st), false);
    assert.equal(broken(st.rewardRecords!["2026-09"].aman, "2026-09", st), false);
  });
  both("no link is not broken", ({ broken }) => {
    const st = base();
    assert.equal(broken(st.rewardRecords!["2026-09"].rohan, "2026-09", st), false);
    assert.equal(broken(undefined, "2026-09", st), false);
    assert.equal(broken({ targetNodeId: null }, "2026-09", st), false);
  });
  both("node missing → broken", ({ broken }) => {
    const st = deleteFromMonth(base(), "ahd", "2026-09");
    assert.equal(st.targetNodes!.ahd, undefined);
    assert.equal(broken(st.rewardRecords!["2026-09"].nevil, "2026-09", st), true);
  });
  both("node alive but no cell in that month → broken (other months unaffected)", ({ broken }) => {
    const st = deleteFromMonth(base(), "goa", "2026-09");
    assert.ok(st.targetNodes!.goa, "Goa still has August");
    assert.equal(broken(st.rewardRecords!["2026-09"].aman, "2026-09", st), true);
    assert.equal(broken(st.rewardRecords!["2026-08"].aman, "2026-08", st), false);
  });
  both("a cell stored under another key (nodeId + month) still counts", ({ broken }) => {
    const st = base();
    st.targetCells = { weird: { nodeId: "ahd", month: "2026-09" } };
    assert.equal(broken({ targetNodeId: "ahd" }, "2026-09", st), false);
  });
});

describe("computed, never stored", () => {
  it("annotate adds targetLinkBroken to copies; strip removes it before a write", () => {
    const st = deleteFromMonth(base(), "ahd", "2026-09");
    const rows = st.rewardRecords!["2026-09"] as Record<string, Record<string, unknown>>;
    const out = annotateRewardMonth(rows, "2026-09", st);
    assert.equal(out.nevil.targetLinkBroken, true);
    assert.equal(out.aman.targetLinkBroken, false);
    assert.equal("targetLinkBroken" in rows.nevil, false, "input rows untouched");
    const w = stripComputedRewardFields(out.nevil);
    assert.equal("targetLinkBroken" in w, false);
    assert.equal(w.targetNodeId, "ahd");
  });
});

describe("delete guard: rewards linked to a target", () => {
  both("lists person and role months that unlock against the node, only in the deleted months", ({ linked }) => {
    const st = base();
    const l = linked(st, ["ahd"], ["2026-09"]) as { kind: string; personId?: string; roleId?: string; period: string }[];
    assert.deepEqual(l.map((x) => x.personId || x.roleId).sort(), ["biri", "nevil", "r1"]);
    assert.ok(l.every((x) => x.period === "2026-09"));
    const all = linked(st, null, ["2026-09"]) as unknown[];
    assert.equal(all.length, 4);
    assert.equal((linked(st, ["ahd"], ["2026-10"]) as unknown[]).length, 0);
  });
  it("names read 'Person · month'", () => {
    const st = base();
    const l = rewardsLinkedTo(st, ["ahd"], ["2026-09"]);
    const names = l.map((r) => describeReward(st, r));
    assert.ok(names.includes("Nevil Prajapati · 2026-09"));
    assert.ok(names.includes("Studio Manager · 2026-09"));
    assert.deepEqual(l.map((r) => SPA.__tlWho(st, r)), l.map((r) => describeReward(st, r).split(" · ")[0]));
  });
});

describe("relink offer after a re-create", () => {
  both("same node id reused → links whole again, nothing offered", ({ cands, broken }) => {
    let st = deleteFromMonth(base(), "goa", "2026-09");
    assert.equal(broken(st.rewardRecords!["2026-09"].aman, "2026-09", st), true);
    st = { ...st, targetCells: { ...st.targetCells, "goa::2026-09": cell("goa", "2026-09") } };
    assert.equal(broken(st.rewardRecords!["2026-09"].aman, "2026-09", st), false);
    assert.deepEqual(cands(st, "goa", ["2026-09"]), []);
  });
  both("new node id with the same name → the broken rewards of that month are offered", ({ cands, name }) => {
    let st = deleteFromMonth(base(), "ahd", "2026-09");
    assert.deepEqual(name(st, "ahd"), { name: "Ahmedabad", kind: "leaf" }, "name from the Trash snapshot");
    st = {
      ...st,
      targetNodes: { ...st.targetNodes, ahd2: { id: "ahd2", name: " ahmedabad ", kind: "leaf", sbuId: null, metric: "rupees" } },
      targetCells: { ...st.targetCells, "ahd2::2026-09": cell("ahd2", "2026-09") },
    };
    const c = cands(st, "ahd2", ["2026-09"]) as { personId?: string; roleId?: string; fromName: string; nodeId: string }[];
    assert.deepEqual(c.map((x) => x.personId || x.roleId).sort(), ["biri", "nevil", "r1"]);
    assert.ok(c.every((x) => x.fromName === "Ahmedabad" && x.nodeId === "ahd"));
    // August's link to the old node is not in the created months: not offered.
    assert.ok(!c.some((x) => (x as { period?: string }).period === "2026-08"));
  });
  both("other name, other kind, or a link that is not broken → not offered", ({ cands }) => {
    let st = deleteFromMonth(base(), "ahd", "2026-09");
    st = {
      ...st,
      targetNodes: {
        ...st.targetNodes,
        x: { id: "x", name: "Surat", kind: "leaf" },
        grp: { id: "grp", name: "Ahmedabad", kind: "group" },
      },
      targetCells: { ...st.targetCells, "x::2026-09": cell("x", "2026-09"), "grp::2026-09": cell("grp", "2026-09") },
    };
    assert.deepEqual(cands(st, "x", ["2026-09"]), []);
    assert.deepEqual(cands(st, "grp", ["2026-09"]), []);
    // Goa: its rewards are not broken.
    const st2 = { ...base(), targetNodes: { ...base().targetNodes, goa2: { id: "goa2", name: "Goa", kind: "leaf" } }, targetCells: { ...base().targetCells, "goa2::2026-09": cell("goa2", "2026-09") } };
    assert.deepEqual(cands(st2, "goa2", ["2026-09"]), []);
  });
  both("the new target must have a cell in the reward's month", ({ cands }) => {
    let st = deleteFromMonth(base(), "ahd", "2026-09");
    st = { ...st, targetNodes: { ...st.targetNodes, ahd2: { id: "ahd2", name: "Ahmedabad", kind: "leaf" } }, targetCells: { ...st.targetCells, "ahd2::2026-10": cell("ahd2", "2026-10") } };
    assert.deepEqual(cands(st, "ahd2", ["2026-09"]), []);
  });
});

// ---------------------------------------------------------------------------
// Import: blank keeps, 0 is a value, summary counts — TS and bundled TargetsX
// ---------------------------------------------------------------------------
/** TargetsX as the p0as82 bundle ships it: the p0as81 IIFE + this batch's TargetsX stamp pairs. */
function bundledTargetsX() {
  const src = read("recovered-site/assets/routes-e2g7y5q8-13m-p0as81.js");
  const a = src.indexOf("var TargetsX = (() => {");
  const b = src.indexOf("})();", a) + 5;
  let iife = src.slice(a, b);
  let applied = 0;
  for (const f of TARGETS_ROUTES_FIXES as { old: string; new: string; n: number; what: string }[]) {
    const got = iife.split(f.old).length - 1;
    if (!got) continue;
    assert.equal(got, f.n, f.what);
    iife = iife.split(f.old).join(f.new);
    applied++;
  }
  assert.equal(applied, 8, "all TargetsX pairs apply inside the IIFE");
  return new Function(`${iife}; return TargetsX;`)() as { applyTargetImport: typeof applyTargetImport; parseCsv: typeof parseCsv; mergeImportRow: typeof mergeImportRow };
}
const TX = bundledTargetsX();

const HEAD = "month,kind,name,unit,parent_group,brand_or_sbu,mode,M1,M2,M3,M4,M5,actual";
const imports = [
  ["src/lib", { applyTargetImport, parseCsv }],
  ["bundle", TX],
] as const;

for (const [where, X] of imports) {
  describe(`import: blank cell keeps the stored value (${where})`, () => {
    const first = () =>
      X.applyTargetImport(
        {},
        X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,100,200,300,400,500,150", "2026-04,target,Pune,rupees,,,set,10,20,30,40,50,7"].join("\n")).rows,
        { allowClosed: true },
      ).state;

    it("blank floors / actual keep; explicit values (0 included) change; counts", () => {
      const s0 = first();
      const goa = Object.values(s0.targetNodes!).find((n) => n.name === "Goa")!;
      const pune = Object.values(s0.targetNodes!).find((n) => n.name === "Pune")!;
      const p = X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,,,350,,,", "2026-04,target,Pune,rupees,,,set,10,20,30,40,50,0"].join("\n"));
      assert.deepEqual(p.errors, []);
      const { state, report } = X.applyTargetImport(s0, p.rows, { allowClosed: true });
      assert.deepEqual(report.errors, []);
      const g = state.targetCells![`${goa.id}::2026-04`];
      assert.deepEqual(g.ladder, { M1: 100, M2: 200, M3: 350, M4: 400, M5: 500 });
      assert.equal(g.actual, 150, "blank actual keeps 150");
      const pc = state.targetCells![`${pune.id}::2026-04`];
      assert.equal(pc.actual, 0, "explicit 0 replaces 7");
      assert.deepEqual(pc.ladder, { M1: 10, M2: 20, M3: 30, M4: 40, M5: 50 });
      // Goa: M3 changed; M1 M2 M4 M5 actual blank-kept. Pune: 5 floors unchanged, actual changed.
      assert.equal(report.changed, 2);
      assert.equal(report.unchanged, 5);
      assert.equal(report.blankKept, 5);
      assert.equal(report.removed, 0);
      assert.equal(report.updated, 2);
    });

    it("a new target with a blank floor is refused (nothing to keep) and the month is not touched for it", () => {
      const s0 = first();
      const p = X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,100,200,300,400,500,", "2026-04,target,Kochi,rupees,,,set,1,,3,4,5,"].join("\n"));
      assert.deepEqual(p.errors, []);
      const { state, report } = X.applyTargetImport(s0, p.rows, { allowClosed: true });
      assert.equal(report.errors.length, 1);
      assert.match(report.errors[0].message, /needs M1/);
      assert.ok(!Object.values(state.targetNodes!).some((n) => n.name === "Kochi"), "no half-made Kochi");
    });

    it("merged floors must still go up", () => {
      const s0 = first();
      const r = X.applyTargetImport(s0, X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,,250,,,,"].join("\n")).rows, { allowClosed: true });
      assert.equal(r.report.errors.length, 0, "250 fits between 100 and 300");
      const bad = X.applyTargetImport(s0, X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,,450,,,,"].join("\n")).rows, { allowClosed: true });
      assert.equal(bad.report.errors.length, 1);
      assert.match(bad.report.errors[0].message, /higher than the one before/);
      // Parse still refuses floors that go down within the file.
      assert.match(X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,5,4,,,,"].join("\n")).errors[0].message, /higher/);
    });

    it("the month's list is still replaced: a target not in the file leaves (counted)", () => {
      const s0 = first();
      const pune = Object.values(s0.targetNodes!).find((n) => n.name === "Pune")!;
      const r = X.applyTargetImport(s0, X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,,,,,,"].join("\n")).rows, { allowClosed: true });
      assert.equal(r.report.removed, 1);
      assert.equal(r.state.targetCells![`${pune.id}::2026-04`], undefined);
      assert.deepEqual(r.report.replaced, ["2026-04"]);
      assert.equal(r.report.blankKept, 6);
    });

    it("a roll group keeps its actual when blank and rolls floors from members", () => {
      const s0 = X.applyTargetImport(
        {},
        X.parseCsv([HEAD, "2026-04,target,Goa,rupees,West,,set,100,200,300,400,500,", "2026-04,group,West,rupees,,,roll,,,,,,77"].join("\n")).rows,
        { allowClosed: true },
      ).state;
      const west = Object.values(s0.targetNodes!).find((n) => n.name === "West")!;
      assert.equal(s0.targetCells![`${west.id}::2026-04`].actual, 77);
      const r = X.applyTargetImport(s0, X.parseCsv([HEAD, "2026-04,target,Goa,rupees,West,,set,110,200,300,400,500,", "2026-04,group,West,rupees,,,roll,,,,,,"].join("\n")).rows, { allowClosed: true });
      const w = r.state.targetCells![`${west.id}::2026-04`];
      assert.equal(w.ladder.M1, 110);
      assert.equal(w.actual, 77);
    });

    it("unmapped rewards confirm stays", () => {
      const s0 = first();
      const pune = Object.values(s0.targetNodes!).find((n) => n.name === "Pune")!;
      const r = X.applyTargetImport({ ...s0, rewardRecords: { "2026-04": { p1: { targetNodeId: pune.id } } } }, X.parseCsv([HEAD, "2026-04,target,Goa,rupees,,,set,,,,,,"].join("\n")).rows, { allowClosed: true });
      assert.equal(r.report.needsConfirm, true);
      assert.equal(r.report.unmapped, 1);
    });
  });
}

describe("import: TS and bundle agree", () => {
  it("mergeImportRow gives the same result on a table of cases", () => {
    const prev = { ladder: { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5 }, actual: 9 };
    const cases: Pick<TargetImportRow, "mode" | "M1" | "M2" | "M3" | "M4" | "M5" | "actual">[] = [
      { mode: "set", M1: null, M2: null, M3: null, M4: null, M5: null, actual: null },
      { mode: "set", M1: 0, M2: null, M3: null, M4: null, M5: null, actual: 0 },
      { mode: "set", M1: 1, M2: 2, M3: 3, M4: 4, M5: 6, actual: 9 },
      { mode: "set", M1: null, M2: 7, M3: null, M4: null, M5: null, actual: null },
      { mode: "roll", M1: null, M2: null, M3: null, M4: null, M5: null, actual: 3 },
    ];
    for (const c of cases) {
      for (const p of [prev, undefined]) assert.deepEqual(TX.mergeImportRow(c, p), mergeImportRow(c, p), JSON.stringify(c));
    }
  });
});

// ---------------------------------------------------------------------------
// Second group in a month leaves the first intact (shipping store actions)
// ---------------------------------------------------------------------------
/** Source of `function name(` … its closing brace, from minified code. */
function fnSource(src: string, head: string): string {
  const a = src.indexOf(head);
  assert.ok(a >= 0, `missing ${head}`);
  return src.slice(a, matchBrace(src, src.indexOf("{", a + head.length - 1)) + 1);
}
function matchBrace(s: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    const top = stack[stack.length - 1];
    if (top === "`") {
      if (ch === "\\") i++;
      else if (ch === "`") stack.pop();
      else if (ch === "$" && s[i + 1] === "{") { stack.push("${"); i++; }
      continue;
    }
    if (top === '"' || top === "'") {
      if (ch === "\\") i++;
      else if (ch === top) stack.pop();
      continue;
    }
    if (ch === "`" || ch === '"' || ch === "'") stack.push(ch);
    else if (ch === "{") stack.push("{");
    else if (ch === "}") {
      const t = stack.pop();
      if (!stack.length && t === "{") return i;
    }
  }
  throw new Error("unbalanced");
}
/** `name:(args)=>{…}` store action source from the login-view chunk. */
function actionSource(src: string, name: string) {
  const a = src.indexOf(`${name}:(`);
  assert.ok(a >= 0, `missing action ${name}`);
  const body = src.indexOf("=>{", a) + 2;
  return src.slice(a, matchBrace(src, body) + 1);
}

function storeFromBundle() {
  const lv = read("recovered-site/assets/login-view-f2j6t0x4-11a3-p0ar.js");
  const helpers = ["function Y(", "function nu(", "function lu(", "function ms(", "function Kl(", "function ql(", "function us(", "function ds(", "function trashId(", "function trashPurge(", "function trashPush(", "function trashWho(", "function cloneJson("]
    .map((h) => fnSource(lv, h))
    .join("\n");
  const acts = ["addTargetLeaf", "addTargetGroup", "nestTarget", "deleteTargetFromMonth"].map((n) => actionSource(lv, n)).join(",");
  const lsDef = lv.slice(lv.indexOf("var ls=["), lv.indexOf("];", lv.indexOf("var ls=[")) + 2);
  const make = new Function(
    "init",
    `${lsDef}${helpers}
     function targetMonthBlocked(){return null}
     function __tmade(r){return r}
     let S=init;const t=()=>S;const e=(f)=>{S={...S,...(typeof f==="function"?f(S):f)}};
     const api={${acts}};
     return {api,get:()=>S};`,
  );
  return make({ targetNodes: {}, targetCells: {}, targetMembers: [], targetRootOrder: {}, trash: [], people: [] }) as {
    api: Record<string, (...a: unknown[]) => { ok: boolean; id?: string; reason?: string }>;
    get: () => { targetNodes: Record<string, { kind: string; name: string }>; targetCells: Record<string, unknown>; targetMembers: { groupId: string; memberId: string; month: string }[]; targetRootOrder: Record<string, string[]> };
  };
}

describe("second group in a month (shipping store actions)", () => {
  const M = "2026-09";
  const L = { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5 };
  const setup = () => {
    const s = storeFromBundle();
    const leaf = (name: string) => s.api.addTargetLeaf({ name, sbuId: null, metric: "rupees", brandId: "b", months: [M], ladder: L }).id!;
    const ids = { a1: leaf("A1"), a2: leaf("A2"), b1: leaf("B1"), b2: leaf("B2") };
    return { s, ids };
  };
  const membersOf = (s: ReturnType<typeof storeFromBundle>, g: string, m = M) => s.get().targetMembers.filter((x) => x.groupId === g && x.month === m).map((x) => x.memberId).sort();

  it("group 2 with other members leaves group 1's members, cell and place intact", () => {
    const { s, ids } = setup();
    const g1 = s.api.addTargetGroup({ name: "G1", metric: "rupees", brandId: "b", memberIds: [ids.a1, ids.a2], months: [M], mode: "roll" });
    assert.ok(g1.ok, g1.reason);
    const before = JSON.stringify({ m: membersOf(s, g1.id!), c: s.get().targetCells[`${g1.id}::${M}`] });
    const g2 = s.api.addTargetGroup({ name: "G2", metric: "rupees", brandId: "b", memberIds: [ids.b1, ids.b2], months: [M], mode: "roll" });
    assert.ok(g2.ok, g2.reason);
    assert.deepEqual(membersOf(s, g1.id!), [ids.a1, ids.a2].sort());
    assert.deepEqual(membersOf(s, g2.id!), [ids.b1, ids.b2].sort());
    assert.equal(JSON.stringify({ m: membersOf(s, g1.id!), c: s.get().targetCells[`${g1.id}::${M}`] }), before);
    const root = s.get().targetRootOrder[M];
    assert.ok(root.includes(g1.id!) && root.includes(g2.id!));
    for (const id of Object.values(ids)) assert.ok(!root.includes(id), "members are not at the top level");
    for (const id of Object.values(ids)) assert.ok(s.get().targetCells[`${id}::${M}`], "member cells stay");
  });

  it("group 2 with the same name as group 1 is a second group; group 1 untouched", () => {
    const { s, ids } = setup();
    const g1 = s.api.addTargetGroup({ name: "West", metric: "rupees", brandId: "b", memberIds: [ids.a1], months: [M], mode: "roll" });
    const g2 = s.api.addTargetGroup({ name: "West", metric: "rupees", brandId: "b", memberIds: [ids.b1], months: [M], mode: "roll" });
    assert.notEqual(g1.id, g2.id);
    assert.deepEqual(membersOf(s, g1.id!), [ids.a1]);
    assert.deepEqual(membersOf(s, g2.id!), [ids.b1]);
  });

  it("group 2 that nests group 1 keeps group 1's members", () => {
    const { s, ids } = setup();
    const g1 = s.api.addTargetGroup({ name: "G1", metric: "rupees", brandId: "b", memberIds: [ids.a1, ids.a2], months: [M], mode: "roll" });
    const g2 = s.api.addTargetGroup({ name: "G2", metric: "rupees", brandId: "b", memberIds: [g1.id!, ids.b1], months: [M], mode: "roll" });
    assert.ok(g2.ok, g2.reason);
    assert.deepEqual(membersOf(s, g1.id!), [ids.a1, ids.a2].sort());
    assert.deepEqual(membersOf(s, g2.id!), [g1.id!, ids.b1].sort());
    assert.ok(!s.get().targetRootOrder[M].includes(g1.id!));
  });

  it("group 2 in another month does not touch group 1's month", () => {
    const { s, ids } = setup();
    const g1 = s.api.addTargetGroup({ name: "G1", metric: "rupees", brandId: "b", memberIds: [ids.a1, ids.a2], months: [M], mode: "roll" });
    s.api.addTargetLeaf({ name: "A1", sbuId: null, metric: "rupees", brandId: "b", months: ["2026-10"], ladder: L });
    const g2 = s.api.addTargetGroup({ name: "G2", metric: "rupees", brandId: "b", memberIds: [ids.a1], months: ["2026-10"], mode: "roll" });
    assert.ok(g2.ok, g2.reason);
    assert.deepEqual(membersOf(s, g1.id!), [ids.a1, ids.a2].sort());
    assert.deepEqual(membersOf(s, g2.id!, "2026-10"), [ids.a1]);
  });

  it("deleting group 2 leaves group 1 and group 2's members stay in the month", () => {
    const { s, ids } = setup();
    const g1 = s.api.addTargetGroup({ name: "G1", metric: "rupees", brandId: "b", memberIds: [ids.a1, ids.a2], months: [M], mode: "roll" });
    const g2 = s.api.addTargetGroup({ name: "G2", metric: "rupees", brandId: "b", memberIds: [ids.b1, ids.b2], months: [M], mode: "roll" });
    assert.ok(s.api.deleteTargetFromMonth(g2.id!, M).ok);
    assert.deepEqual(membersOf(s, g1.id!), [ids.a1, ids.a2].sort());
    assert.equal(s.get().targetCells[`${g2.id}::${M}`], undefined);
    assert.ok(s.get().targetCells[`${ids.b1}::${M}`]);
  });
});
