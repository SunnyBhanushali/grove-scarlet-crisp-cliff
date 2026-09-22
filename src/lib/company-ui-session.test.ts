import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUiSessionKeys,
  stripUiSessionKeys,
  UI_SESSION_KEYS,
} from "./company-ui-session.ts";

test("stripUiSessionKeys drops nav keys and keeps company data", () => {
  const incoming = {
    people: [{ id: "p-admin" }],
    roles: { ceo: { name: "CEO" } },
    currentMonth: "2026-08",
    view: "rewards",
    kind: "month",
    selectedPersonId: "p-1",
    selectedMonth: "2026-08",
    selectedRoleId: "ceo",
    selectedTargetMonth: "2026-09",
    notebookUpdatedAt: 99,
  };
  const stripped = stripUiSessionKeys(incoming);
  assert.equal(stripped.people.length, 1);
  assert.equal(stripped.notebookUpdatedAt, 99);
  for (const key of UI_SESSION_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(stripped, key), false);
  }
  assert.equal(hasUiSessionKeys(incoming), true);
  assert.equal(hasUiSessionKeys(stripped), false);
});
