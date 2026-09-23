import assert from "node:assert/strict";
import test from "node:test";
import {
  applySession,
  loadPeopleListUi,
  loadSession,
  peopleFiltersStartOpen,
  resetPeopleListUiForTests,
  resetSessionForTests,
  savePeopleListUi,
  saveSession,
} from "./apms-nav-ui.ts";

test("people list search/SBU filters survive a remount (session cache, not DB)", () => {
  resetPeopleListUiForTests();
  savePeopleListUi({ q: "tushar", sbus: ["bu-school"], status: "active" });
  const again = loadPeopleListUi();
  assert.equal(again.q, "tushar");
  assert.deepEqual(again.sbus, ["bu-school"]);
  assert.equal(again.status, "active");
});

test("empty cache is a blank list, not a wipe of company people", () => {
  resetPeopleListUiForTests();
  assert.deepEqual(loadPeopleListUi(), {});
});

test("only admin and super-admin start with People filters open", () => {
  assert.equal(peopleFiltersStartOpen({ access: "manager" }), false);
  assert.equal(peopleFiltersStartOpen({ access: "function_head" }), false);
  assert.equal(peopleFiltersStartOpen({ access: "hr" }), false);
  assert.equal(peopleFiltersStartOpen({ access: "employee" }), false);
  assert.equal(peopleFiltersStartOpen({ access: "admin" }), true);
  assert.equal(peopleFiltersStartOpen({ access: "super_admin" }), true);
  assert.equal(peopleFiltersStartOpen({ access: "manager" }, true), true);
  assert.equal(peopleFiltersStartOpen({ access: "admin" }, false), false);
});

test("refresh restores view/selection from sessionStorage, not Home", () => {
  resetSessionForTests();
  saveSession({
    view: "org-people",
    kind: "apms",
    selectedPersonId: "p-tushar",
    currentMonth: "2026-09",
  });
  const again = loadSession();
  assert.equal(again.view, "org-people");
  assert.equal(again.selectedPersonId, "p-tushar");
  assert.equal(again.currentMonth, "2026-09");
  assert.equal(again.people, undefined);
});

test("applySession wins over persisted localStorage view:home", () => {
  resetSessionForTests();
  saveSession({
    view: "org-people",
    selectedPersonId: "p-tushar",
    selectedFunctionId: "fn-ops",
  });
  const persisted = {
    people: [{ id: "p-tushar" }],
    view: "home",
    kind: "apms",
    currentUserId: "p-admin",
    selectedPersonId: null,
  };
  const merged = applySession(persisted) as typeof persisted & { selectedFunctionId?: unknown };
  assert.equal(merged.view, "org-people");
  assert.equal(merged.selectedPersonId, "p-tushar");
  assert.equal(merged.selectedFunctionId, "fn-ops");
  assert.equal(merged.currentUserId, "p-admin");
  assert.equal(merged.people[0].id, "p-tushar");
});

test("boot session survives a hydrate that writes home into sessionStorage", () => {
  resetSessionForTests();
  saveSession({ view: "rewards", selectedAwardId: "aw-1" });
  saveSession({ view: "home", selectedAwardId: null });
  const merged = applySession({ view: "home", people: [] }) as { view: string; selectedAwardId?: unknown };
  assert.equal(merged.view, "rewards");
  assert.equal(merged.selectedAwardId, "aw-1");
});
