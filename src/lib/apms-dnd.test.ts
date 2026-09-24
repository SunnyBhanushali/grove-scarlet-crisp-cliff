import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyPlanDrop,
  dndHitMode,
  nestAtTop,
  nestMemberAtTop,
  parseWeightPct,
  projectSlot,
  shiftsFor,
  slotToDrop,
} from "./apms-dnd.ts";

test("dndHitMode: edges reorder, middle nests", () => {
  assert.equal(dndHitMode(10, 0, 100), "before");
  assert.equal(dndHitMode(50, 0, 100), "inside");
  assert.equal(dndHitMode(90, 0, 100), "after");
});

test("nestAtTop puts the dropped row first among existing children", () => {
  const people = [
    { id: "boss", managerId: null },
    { id: "a", managerId: "boss" },
    { id: "b", managerId: "boss" },
    { id: "c", managerId: null },
  ];
  const next = nestAtTop(people, "c", "boss", "managerId");
  const kids = next.filter((p) => p.managerId === "boss").map((p) => p.id);
  assert.deepEqual(kids, ["c", "a", "b"]);
});

test("nestMemberAtTop prepends to an existing sublist", () => {
  const rows = [
    { groupId: "g", memberId: "old", month: "2026-09" },
    { groupId: "g", memberId: "older", month: "2026-09" },
  ];
  const next = nestMemberAtTop(rows, "fresh", "g", { month: "2026-09" });
  assert.deepEqual(
    next.filter((r) => r.groupId === "g").map((r) => r.memberId),
    ["fresh", "old", "older"],
  );
});

test("projectSlot never inserts above the root and indent nests under the row above", () => {
  const rows = [
    { id: "sunny", key: "person:sunny", depth: 0 },
    { id: "ami", key: "person:ami", depth: 1 },
    { id: "allan", key: "person:allan", depth: 1 },
  ];
  const h = 52;
  const rects = rows.map((_, i) => ({ top: i * h, bottom: (i + 1) * h, height: h }));
  const a = 2;
  const same = projectSlot(rows, rects, a, 2 * h + 10, 0);
  assert.ok(same);
  assert.equal(same.t >= 1, true);
  const nest = projectSlot(rows, rects, a, 2 * h + 10, 40);
  assert.ok(nest);
  assert.equal(nest.depth, 2);
  assert.equal(nest.parentId, "ami");
  const drop = slotToDrop(rows, a, nest);
  assert.deepEqual(drop, { overKey: "person:ami", mode: "inside" });
});

test("shiftsFor slides neighbours by one row height, does not reorder ids", () => {
  const sh = shiftsFor(2, 1, 4, 50);
  assert.equal(sh.length, 4);
  assert.equal(sh[0], 0);
});

const css = readFileSync(new URL("../../public/assets/apms-dnd.css", import.meta.url), "utf8");
const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);

test("source row stays in layout (no height:0 collapse of the tree)", () => {
  assert.equal(css.includes("height: 0"), false);
  assert.equal(css.includes("visibility: hidden"), true);
  assert.equal(css.includes("apms-rt--dragging"), true);
});

test("drag uses pointer slot physics, not HTML5 drag or FLIP", () => {
  assert.equal(routes.includes("prevY"), false);
  assert.equal(routes.includes("if(i===`root`){e.nestPerson(t,null);return}"), false);
  assert.equal(routes.includes("if(i===`root`){return}"), true);
  const rc = routes.slice(routes.indexOf("function rc("), routes.indexOf("function ic("));
  assert.equal(rc.includes("document.documentElement.style.overflow"), false);
  assert.equal(rc.includes("translate3d"), true);
  assert.equal(rc.includes("pointermove"), true);
  assert.equal(rc.includes("Escape"), true);
  assert.equal(routes.includes("apms-dnd-engine.js"), true);
  assert.equal(rc.includes("paddingTop"), false);
  assert.equal(rc.includes("pointercancel"), false);
  assert.equal(rc.includes("},[])"), true);
});

test("nest drop opens the parent list so the nested row is visible", () => {
  assert.equal(routes.includes("apms-expand-person"), true);
  assert.equal(
    routes.includes("e.nestPerson(t,i);try{window.dispatchEvent(new CustomEvent(`apms-expand-person`,{detail:{id:i}}))}catch{}}"),
    true,
  );
  const fl = routes.slice(routes.indexOf("function Fl("), routes.indexOf("function Fl(") + 2200);
  assert.equal(fl.includes("window.addEventListener(`apms-expand-person`"), true);
  assert.equal(fl.includes("if(ev&&ev.detail&&ev.detail.id===e.id)d(!0)"), true);
});

test("plan drop reorders KRAs and moves a KPI across KRAs", () => {
  const kras = [
    { id: "k1", name: "A", kpis: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }] },
    { id: "k2", name: "B", kpis: [{ id: "p3", name: "three" }] },
  ];
  const after = applyPlanDrop(kras, "k1", "kra:k2", "after");
  assert.deepEqual(after.map((k) => k.id), ["k2", "k1"]);
  const first = applyPlanDrop(kras, "k2", "kra:k1", "before");
  assert.deepEqual(first.map((k) => k.id), ["k2", "k1"]);
  const moved = applyPlanDrop(kras, "p2", "kra:k2", "inside");
  assert.deepEqual(moved[0]!.kpis!.map((p) => p.id), ["p1"]);
  assert.deepEqual(moved[1]!.kpis!.map((p) => p.id), ["p2", "p3"]);
  const reorder = applyPlanDrop(kras, "p2", "kpi:p1", "before");
  assert.deepEqual(reorder[0]!.kpis!.map((p) => p.id), ["p2", "p1"]);
});

test("weight field empty stays empty (does not coerce to 0 while typing)", () => {
  assert.deepEqual(parseWeightPct(""), { empty: true, ok: true, weight: 0 });
  assert.deepEqual(parseWeightPct("20"), { empty: false, ok: true, weight: 0.2 });
  assert.equal(parseWeightPct("02").weight, 0.02);
  assert.equal(parseWeightPct("abc").ok, false);
});

test("plans KRA/KPI rows use people-style pointer dnd", () => {
  assert.equal(routes.includes("applyPlanDrop as __pd"), true);
  assert.equal(routes.includes("data-drop"), true);
  assert.equal(routes.includes("`kra:`+t.id"), true);
  assert.equal(routes.includes("`kpi:`+e.id"), true);
  assert.equal(routes.includes("minFloor:0"), true);
  assert.equal(routes.includes("Move KRA"), false);
  assert.equal(routes.includes("Move KPI"), false);
  assert.equal(routes.includes("apms-rt--dragging-kra"), true);
  assert.equal(routes.includes("plan-kra-body"), true);
  assert.equal(css.includes("apms-rt--dragging-kra"), true);
  assert.equal(css.includes(".plan-kra-body"), true);
});

test("slotToDrop: drag left after the last child of a subtree takes the ancestor's parent", async () => {
  // sunny > t3 > (t1, t2); t1 dragged left one level into the slot after t2 (end of the list).
  const rows = [
    { id: "sunny", key: "person:sunny", depth: 1 },
    { id: "t3", key: "person:t3", depth: 2 },
    { id: "t1", key: "person:t1", depth: 3 },
    { id: "t2", key: "person:t2", depth: 3 },
  ];
  const h = 52;
  const rects = rows.map((_, i) => ({ top: i * h, bottom: (i + 1) * h, height: h }));
  const target = projectSlot(rows, rects, 2, 3 * h + 30, -30);
  assert.ok(target);
  assert.equal(target.depth, 2);
  assert.equal(target.parentId, "sunny");
  const want = { overKey: "person:t3", mode: "after" };
  assert.deepEqual(slotToDrop(rows, 2, target), want);
  // Same maths in the browser engine the SPA loads.
  // (URL import: the engine is plain browser JS, not type-checked.)
  const engineUrl = new URL("../../recovered-site/assets/apms-dnd-engine.js", import.meta.url).href;
  const engine = (await import(engineUrl)) as {
    slotToDrop: (...a: unknown[]) => unknown;
    projectSlot: (...a: unknown[]) => unknown;
  };
  assert.deepEqual(engine.slotToDrop(rows, 2, engine.projectSlot(rows, rects, 2, 3 * h + 30, -30, 28, 1)), want);
  // Still "after prev" when prev is at the target depth.
  assert.deepEqual(slotToDrop(rows, 2, { t: 3, depth: 3, parentId: "t3" }), { overKey: "person:t2", mode: "after" });
});
