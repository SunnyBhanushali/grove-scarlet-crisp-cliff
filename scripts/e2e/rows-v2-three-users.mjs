#!/usr/bin/env node
/**
 * ROWS-V2 three-user check: APMS, Rewards and Targets screens × six checks,
 * then a smoke pass over every other module.
 *
 *   BASE_URL=http://127.0.0.1:3010 DATABASE_URL=postgres://…/aliens_apms_test \
 *   A_USER=sunny.b A_PASS=0000 B_USER=floyd.dsil B_PASS=… C_USER=ronlind.mene C_PASS=… \
 *   node scripts/e2e/rows-v2-three-users.mjs [scenario …]
 *
 * A, B and C are three admins in three browsers. Per screen:
 *   1. A and B edit different records at the same time → both persist.
 *   2. A and B edit different fields of the same record at the same time → both persist.
 *   3. C, idle on the screen, sees A's and B's changes within 5 s without reloading.
 *   4. A deletes a record; B (live feed held, so the screen is provably stale)
 *      still sees it, edits and saves → it stays deleted for everyone, after reload too.
 *   5. After everyone reloads, the screens and the database agree.
 *   6. No refresh / conflict banner, no writes on sign-in or on opening the
 *      screen, no 5xx.
 *
 * Needs the built server on a FRESH database (the seed the scenarios name
 * people, months and targets from) and B / C issued logins. The scenarios
 * run in one pass, in an order where one's edits do not disturb the next.
 * Writes a JSON report to OUT (default e2e-three-users.json).
 * CHROMIUM_PATH overrides the browser binary.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { makeCtx, realWrites, brief, ScreenResult } from "./lib/harness.mjs";
import * as apms from "./lib/screens-apms.mjs";
import * as eo from "./lib/screens-apms-eo.mjs";
import * as rewards from "./lib/screens-rewards.mjs";
import * as targets from "./lib/screens-targets.mjs";
import * as months from "./lib/screens-targets-months.mjs";
import * as smoke from "./lib/smoke-modules.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const DATABASE_URL = process.env.DATABASE_URL || "";
const OUT = process.env.OUT || "e2e-three-users.json";
const USERS = {
  A: [process.env.A_USER || "sunny.b", process.env.A_PASS || "0000"],
  B: [process.env.B_USER || "floyd.dsil", process.env.B_PASS || ""],
  C: [process.env.C_USER || "ronlind.mene", process.env.C_PASS || ""],
};
if (!DATABASE_URL || !USERS.B[1] || !USERS.C[1]) {
  console.error("DATABASE_URL, B_PASS and C_PASS are required.");
  process.exit(2);
}

/** Run order: each scenario leaves data the later ones do not depend on. */
export const SCENARIOS = [
  ["apmsMonthList", (c, r) => apms.apmsMonthList(c, r)],
  ["apmsPlanEditor", apms.apmsPlanEditor],
  ["apmsLockedPlan", apms.apmsLockedPlan],
  ["apmsPlanDrag", apms.apmsPlanDrag],
  ["apmsSelfComments", rewards.apmsSelfComments],
  ["apmsEO", eo.apmsEO],
  ["apmsQuarterReview", eo.apmsQuarterReview],
  ["apmsLockClose", apms.apmsLockClose],
  // Before Rewards: it needs Nevil's and Biri's September rewards still linked
  // to Ahmedabad (plan open deletes Nevil's, mass update moves Biri's). It puts
  // Ahmedabad back when it is done.
  ["targetsDeleteRecreate", months.targetsDeleteRecreate],
  ["rewardsMonthList", rewards.rewardsMonthList],
  ["rewardsPlanOpen", rewards.rewardsPlanOpen],
  ["rewardsMassUpdate", rewards.rewardsMassUpdate],
  ["rewardsMyRewards", (c, r) => rewards.rewardsMyRewards(c, r)],
  ["rewardsLockUnlock", rewards.rewardsLockUnlock],
  ["targetsCells", targets.targetsCells],
  ["targetsGroups", targets.targetsGroups],
  ["targetsDrag", targets.targetsDrag],
  ["targetsMonthList", months.targetsMonthList],
  ["targetsCopyMonth", months.targetsCopyMonth],
  ["targetsImport", months.targetsImport],
  ["targetsTargetTab", months.targetsTargetTab],
  ["targetsMonthStatus", targets.targetsMonthStatus],
];

async function signIn(p, [user, pass]) {
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.locator('input[type="text"]').fill(user);
  await p.locator('input[type="password"]').fill(pass);
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
}

async function main() {
  const only = process.argv.slice(2);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pages = {};
  for (const t of ["A", "B", "C"]) {
    const bc = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    pages[t] = await bc.newPage();
  }
  const ctx = await makeCtx({ ...pages, base: BASE, databaseUrl: DATABASE_URL });
  const results = [];

  // Signing in writes nothing (check 6, sign-in part).
  const signin = new ScreenResult("All", "sign-in", "Sign in (three admins at once)");
  const m = ctx.mark();
  await Promise.all(Object.entries(pages).map(([t, p]) => signIn(p, USERS[t])));
  await ctx.sleep(5000);
  const w = ["A", "B", "C"].flatMap((t) => realWrites(m.writes(t)).map((n) => `${t}: ${brief([n])[0]}`));
  const fives = ["A", "B", "C"].flatMap((t) => brief(m.fives(t)).map((s) => `${t}: ${s}`));
  signin.expect(6, !w.length && !fives.length, w.length ? `writes on sign-in: ${w.join("; ")}` : fives.length ? `5xx: ${fives.join("; ")}` : "no writes, no 5xx");
  results.push(signin);

  const run = Date.now().toString(36);
  for (const [name, fn] of SCENARIOS) {
    if (only.length && !only.includes(name)) continue;
    console.log(`\n== ${name}`);
    try {
      results.push(await fn(ctx, run + name.length));
    } catch (err) {
      const r = new ScreenResult("?", name, name);
      r.fail(0, `scenario stopped: ${String((err && err.message) || err).split("\n")[0].slice(0, 300)}`);
      // BATCH-3: keep where it stopped (stack + one screenshot per browser) next to the report.
      console.log(String((err && err.stack) || err).split("\n").slice(0, 8).join("\n"));
      const dir = (process.env.OUT || "e2e.json").replace(/[^/]*$/, "") || "./";
      for (const [t, p] of Object.entries(ctx.pages || {})) {
        await p.screenshot({ path: `${dir}stop-${name}-${t}.png` }).catch(() => {});
      }
      results.push(r);
    }
  }
  if (!only.length || only.includes("smoke")) {
    console.log("\n== smoke (other modules)");
    results.push(...(await smoke.smokeModules(ctx, run)));
  }

  await ctx.close();
  await browser.close();

  const table = results.map((r) => {
    const row = { module: r.module, screen: r.id, title: r.title };
    for (const n of [1, 2, 3, 4, 5, 6]) row[n] = r.checks[n] ? r.checks[n].status : "";
    if (r.checks[0]) row.stopped = r.checks[0].detail;
    return row;
  });
  console.log("\nmodule  screen                         1     2     3     4     5     6");
  for (const row of table) {
    console.log(`${row.module.padEnd(7)} ${row.screen.padEnd(30)} ${[1, 2, 3, 4, 5, 6].map((n) => String(row[n] || "-").padEnd(5)).join(" ")}${row.stopped ? "  STOPPED: " + row.stopped : ""}`);
  }
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
  const failed = results.some((r) => Object.values(r.checks).some((c) => c.status === "fail"));
  console.log(failed ? "\nFAIL" : "\nPASS", "— report:", OUT);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
