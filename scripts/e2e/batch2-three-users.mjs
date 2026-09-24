#!/usr/bin/env node
/**
 * BATCH-2 three-user check: Org, People, Me, Home and Settings screens × the
 * six checks (same harness and semantics as rows-v2-three-users.mjs).
 *
 *   BASE_URL=http://127.0.0.1:3010 DATABASE_URL=postgres://…/aliens_apms_test \
 *   A_USER=sunny.b A_PASS=0000 B_USER=floyd.dsil B_PASS=… C_USER=ronlind.mene C_PASS=… \
 *   node scripts/e2e/batch2-three-users.mjs [scenario …]
 *
 * Needs the built server on a FRESH database and B / C issued logins
 * (scripts/e2e/seed-logins.mjs). Writes OUT (default e2e-batch2.json) with the
 * screen list (every page / tab / dialog / button that saves, reached or not)
 * and the screens × checks table.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { makeCtx, realWrites, brief, ScreenResult } from "./lib/harness.mjs";
import * as org from "./lib/screens-org.mjs";
import * as people from "./lib/screens-people.mjs";
import * as meHome from "./lib/screens-me-home.mjs";
import * as settings from "./lib/screens-settings.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const DATABASE_URL = process.env.DATABASE_URL || "";
const OUT = process.env.OUT || "e2e-batch2.json";
const USERS = {
  A: [process.env.A_USER || "sunny.b", process.env.A_PASS || "0000"],
  B: [process.env.B_USER || "floyd.dsil", process.env.B_PASS || ""],
  C: [process.env.C_USER || "ronlind.mene", process.env.C_PASS || ""],
};
if (!DATABASE_URL || !USERS.B[1] || !USERS.C[1]) {
  console.error("DATABASE_URL, B_PASS and C_PASS are required.");
  process.exit(2);
}

/**
 * Run order. Settings last: restore puts the database back to the copy taken
 * at the start of its own scenario, and logins/passwords are put back.
 */
export const SCENARIOS = [...org.SCENARIOS, ...people.SCENARIOS, ...meHome.SCENARIOS, ...settings.SCENARIOS];
export const SCREENS = [...org.SCREENS, ...people.SCREENS, ...meHome.SCREENS, ...settings.SCREENS];

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
    const bc = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    pages[t] = await bc.newPage();
  }
  const ctx = await makeCtx({ ...pages, base: BASE, databaseUrl: DATABASE_URL });
  ctx.browser = browser;
  ctx.users = USERS;
  ctx.signIn = signIn;
  const results = [];

  const signin = new ScreenResult("All", "sign-in", "Sign in (three admins at once)");
  const m = ctx.mark();
  await Promise.all(Object.entries(pages).map(([t, p]) => signIn(p, USERS[t])));
  await ctx.sleep(5000);
  const w = ["A", "B", "C"].flatMap((t) => realWrites(m.writes(t)).map((n) => `${t}: ${brief([n])[0]}`));
  const fives = ["A", "B", "C"].flatMap((t) => brief(m.fives(t)).map((s) => `${t}: ${s}`));
  signin.expect(6, !w.length && !fives.length, w.length ? `writes on sign-in: ${w.join("; ")}` : fives.length ? `5xx: ${fives.join("; ")}` : "no writes, no 5xx");
  results.push(signin);

  /**
   * Between scenarios: wait until no browser has sent a write for 3 s (max
   * 30 s), so a save still finishing from the previous scenario (e.g. the org
   * book carrying the tombstones of the people it trashed at its end) is not
   * counted as a write caused by opening the next screen (check 6).
   */
  async function quiesce() {
    const t0 = Date.now();
    for (;;) {
      await Promise.all(Object.values(pages).map((p) => ctx.settled(p, 5000)));
      const last = Math.max(0, ...["A", "B", "C"].flatMap((t) => ctx.net[t].filter((n) => n.m !== "GET").map((n) => n.t)));
      if (Date.now() - last >= 3000 || Date.now() - t0 > 30000) return;
      await ctx.sleep(500);
    }
  }

  const run = Date.now().toString(36);
  for (const [name, fn] of SCENARIOS) {
    if (only.length && !only.includes(name)) continue;
    await quiesce();
    console.log(`\n== ${name}`);
    try {
      results.push(await fn(ctx, run + name.length));
    } catch (err) {
      const r = new ScreenResult("?", name, name);
      r.fail(0, `scenario stopped: ${String((err && err.message) || err).split("\n")[0].slice(0, 300)}`);
      results.push(r);
    }
  }

  await ctx.close();
  await browser.close();

  console.log("\nmodule    screen                         1     2     3     4     5     6");
  for (const r of results) {
    const cells = [1, 2, 3, 4, 5, 6].map((n) => String(r.checks[n] ? r.checks[n].status : "-").padEnd(5)).join(" ");
    console.log(`${String(r.module).padEnd(9)} ${String(r.id).padEnd(30)} ${cells}${r.checks[0] ? "  STOPPED: " + r.checks[0].detail : ""}`);
  }
  // Non-GET and 5xx requests per browser (the evidence behind each failure).
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), screens: SCREENS, results, net: ctx.net }, null, 1));
  const failed = results.some((r) => Object.values(r.checks).some((c) => c.status === "fail"));
  console.log(failed ? "\nFAIL" : "\nPASS", "— report:", OUT);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
