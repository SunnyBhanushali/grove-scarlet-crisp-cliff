import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fyMonths, fyQuarter, fyStartYear, FY_QUARTER_LABELS } from "./apms-fy.ts";

test("FY year starts in April: Jan is previous FY, Apr is new FY", () => {
  assert.equal(fyStartYear("2026-01"), 2025);
  assert.equal(fyStartYear("2026-03"), 2025);
  assert.equal(fyStartYear("2026-04"), 2026);
  assert.equal(fyStartYear("2026-12"), 2026);
  assert.equal(fyStartYear("2027-03"), 2026);
});

test("FY quarters match Rewards (Apr=Q1, Jan=Q4)", () => {
  assert.equal(fyQuarter("2026-04"), 1);
  assert.equal(fyQuarter("2026-06"), 1);
  assert.equal(fyQuarter("2026-07"), 2);
  assert.equal(fyQuarter("2026-10"), 3);
  assert.equal(fyQuarter("2027-01"), 4);
  assert.equal(fyQuarter("2026-03"), 4);
});

test("FY month list is Apr → Mar, not Jan → Dec", () => {
  assert.deepEqual(fyMonths(2026)[0], "2026-04");
  assert.deepEqual(fyMonths(2026)[11], "2027-03");
  assert.equal(fyMonths(2026).includes("2026-01"), false);
});

test("APMS month UI uses April FY, not Jan-Mar Q1", () => {
  const src = readFileSync(
    new URL("../../recovered-site/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(src.includes("Q1 · Jan-Mar"), false);
  assert.equal(src.includes(FY_QUARTER_LABELS[1]), true);
  assert.equal(src.includes("Q1 · Apr-Jun"), true);
  const login = readFileSync(
    new URL("../../recovered-site/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url),
    "utf8",
  );
  assert.equal(login.includes("||`2026-01`"), false);
  assert.equal(login.includes("||`2026-04`"), true);
});
