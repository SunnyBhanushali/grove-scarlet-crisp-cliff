import assert from "node:assert/strict";
import test from "node:test";
import {
  dottedManagerIds,
  hasMultipleReportees,
  isMultiReporting,
  viewerBosses,
} from "./apms-people-marks.ts";

const people = [
  { id: "arjun", managerId: "vishal", dottedLine: [{ managerId: "anish" }] },
  { id: "vishal", managerId: null },
  { id: "anish", managerId: null },
  { id: "a", managerId: "arjun" },
  { id: "b", managerId: "arjun" },
  { id: "c", managerId: "other", dottedLine: [{ managerId: "arjun" }] },
];

test("list marks only for multi-reporting people", () => {
  assert.equal(isMultiReporting(people[0]), true);
  assert.equal(isMultiReporting(people[3]), false);
  assert.equal(isMultiReporting(people[1]), false);
});

test("dotted managers exclude the primary", () => {
  assert.deepEqual(dottedManagerIds(people[0]), ["anish"]);
});

test("string dottedLine entries still count as dual reporting", () => {
  assert.equal(
    isMultiReporting({ id: "x", managerId: "vishal", dottedLine: ["anish"] as never }),
    true,
  );
});

test("having many reportees is not multi-reporting", () => {
  assert.equal(hasMultipleReportees(people, "arjun"), true);
  assert.equal(isMultiReporting(people.find((p) => p.id === "arjun")!), true);
  assert.equal(isMultiReporting({ id: "boss", managerId: null }), false);
  assert.equal(hasMultipleReportees(people, "vishal"), false);
});

test("My team bar is only who the viewer reports to", () => {
  const bosses = viewerBosses(people, people[0]);
  assert.equal(bosses.primary?.id, "vishal");
  assert.deepEqual(
    bosses.dotted.map((p) => p.id),
    ["anish"],
  );
  const ceo = viewerBosses(people, people[1]);
  assert.equal(ceo.primary, null);
  assert.deepEqual(ceo.dotted, []);
});
