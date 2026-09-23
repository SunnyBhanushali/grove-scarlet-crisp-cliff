import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sbuUnitsForViewer, personSbuIds } from "../../public/assets/apms-org-scope-p0ao.js";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);

test("FH with no own SBU still sees SBUs of people on their team", () => {
  const units = [
    { id: "at", name: "AT", parentId: null },
    { id: "goa", name: "Goa", parentId: "at" },
    { id: "del", name: "Delhi", parentId: "at" },
  ];
  const allan = { id: "allan", access: "function_head", buId: "", buIds: [] };
  const team = [
    allan,
    { id: "a", buId: "goa", managerId: "allan" },
    { id: "b", buId: "del", managerId: "allan" },
    { id: "c", buId: "", managerId: "allan" },
  ];
  const shown = sbuUnitsForViewer(allan, units, team.filter((p) => p.id !== "allan"));
  assert.deepEqual(
    shown.map((u: { id: string }) => u.id).sort(),
    ["at", "del", "goa"],
  );
  assert.deepEqual(personSbuIds(allan), []);
});

test("People SBU view wraps the current user and never paints empty-match when people exist", () => {
  const i = routes.indexOf("if(e===`sbu`)");
  assert.ok(i > 0);
  const body = routes.slice(i, routes.indexOf("let l=(r||[]).filter", i));
  assert.equal(body.includes("No people match."), false);
  assert.equal(body.includes("ViewerSbu"), true);
  assert.equal(body.includes("name:`Unassigned`"), true);
});
