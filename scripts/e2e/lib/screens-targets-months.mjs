/**
 * Targets month list (Add target · Duplicate · Edit · Delete), Copy month,
 * Import, the Target / Group tabs (one target across months) and deleting a
 * target that rewards are linked to. Six checks per screen; see
 * scripts/e2e/rows-v2-three-users.mjs.
 */
import { ScreenResult } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  SEP, NODE, openTargetsList, openTargetMonth, showMonthRow, dialog, setCell, cellValue, cellRow, targetRow,
  newTarget, nodeByName, inMonth, rowDelete, shownTargets,
} from "./screens-targets.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const label = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

/** Live target cells of a month in the DB. */
export async function monthCells(ctx, month) {
  const r = await ctx.sql("select count(*)::int as n from target_cells where split_part(id, '::', 2) = $1 and deleted_at is null", [month]);
  return r[0].n;
}
/** Months with live cells, newest first. */
export async function liveMonths(ctx) {
  // The list counts cells that carry a target (two seeded UAT cells are empty: "0 items").
  const r = await ctx.sql("select split_part(id, '::', 2) as period, count(*) filter (where payload ? 'nodeId')::int as n from target_cells where deleted_at is null group by 1 order by 1 desc");
  return r.map((x) => `${label(x.period)}:${x.n}`);
}
/** Month rows on the list ("September 2026 · 19 items"), all year groups opened. */
export async function listedMonths(p) {
  // Year groups ("2099 · 1 month") start collapsed; open the closed ones.
  for (const g of await p.locator("main button").filter({ hasText: /^\d{4}\s*\d+ months?$/ }).all()) {
    const y = ((await g.textContent()) || "").slice(0, 4);
    const open = await p.locator("main button").filter({ hasText: new RegExp(`^\\w+ ${y}`) }).count();
    if (!open) {
      await g.click().catch(() => {});
      await p.waitForTimeout(250);
    }
  }
  const txt = await p.locator("main button").filter({ hasText: /items?$/ }).allInnerTexts();
  return txt
    .map((t) => t.replace(/\s+/g, " ").match(/^(\w+ \d{4}) .*?(\d+) items?$/))
    .filter(Boolean)
    .map((m) => `${m[1]}:${m[2]}`);
}

/** List → Add target, into an existing month ("2026-10") or a new one ({ newMonth: "2026-11" }). */
export async function addTarget(p, { month, newMonth }, name, m1 = 1000000, m5 = 1500000) {
  await p.locator("main").getByRole("button", { name: "Add target", exact: true }).first().click();
  const d = await dialog(p, "Add target");
  if (newMonth) {
    await d.getByRole("button", { name: "New month", exact: true }).click();
    await p.waitForTimeout(200);
    const sels = d.locator("select");
    await sels.nth(0).selectOption(String(Number(newMonth.slice(5))));
    await sels.nth(1).selectOption(newMonth.slice(0, 4));
  } else {
    await d.locator("select").first().selectOption(month);
  }
  await d.locator('input[placeholder="Type a name"]').fill(name);
  const floors = d.locator('input[placeholder="₹"]');
  await floors.nth(0).fill(String(m1));
  await floors.nth(4).fill(String(m5));
  const compute = d.getByRole("button", { name: "Compute" });
  if (await compute.isEnabled().catch(() => false)) await compute.click();
  await d.getByRole("button", { name: "Create target" }).click();
  await p.waitForTimeout(700);
}

/** List → Duplicate <from> into <to> ("2026-10"). */
export async function duplicateMonth(p, fromLabel, to) {
  const row = await showMonthRow(p, fromLabel);
  await row.locator("xpath=..").getByRole("button", { name: "Duplicate", exact: true }).click();
  const d = await dialog(p, `Duplicate ${fromLabel}`);
  const sels = d.locator("select");
  await sels.nth(0).selectOption({ label: MONTHS[Number(to.slice(5)) - 1] });
  await sels.nth(1).selectOption(to.slice(0, 4));
  await d.getByRole("button", { name: new RegExp("^Duplicate into") }).click();
  await p.waitForTimeout(700);
  // Some builds ask to confirm when the month already exists.
  const conf = p.locator("div.fixed.inset-0 button", { hasText: /^(Replace|Duplicate|Yes)/ }).last();
  if (await conf.isVisible().catch(() => false)) await conf.click();
  await p.waitForTimeout(400);
}

/** List → Delete a month (confirm). */
export async function deleteMonth(p, monthLabel) {
  const row = await showMonthRow(p, monthLabel);
  await row.locator("xpath=..").getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForTimeout(400);
  const conf = p.locator("div.fixed.inset-0 button", { hasText: /^Delete/ }).last();
  if (await conf.count()) await conf.click();
  await p.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Month list: Add target (new / existing month) · Duplicate · Edit · Delete
// ---------------------------------------------------------------------------
export async function targetsMonthList(ctx, run) {
  const R = new ScreenResult("Targets", "targets-month-list", "Month list: Add target · Duplicate · Edit · Delete month");
  const { A, B, C } = ctx;
  const tag = run.slice(-5);
  const OCT = "2026-10";
  const NOV = "2026-11";
  const m0 = await openWithoutWrites(ctx, R, "the Targets month list", (p) => openTargetsList(ctx, p));
  const where = async (p) => ((await p.locator("main").innerText()).match(/Targets · [^\n]+/) || ["list"])[0];
  const sepN = await monthCells(ctx, "2026-09");

  // Check 1 + 3: A duplicates September into October while B adds a target in a new month (November); C idle on the list.
  const TN = `E2E Nov ${tag}`;
  await Promise.all([duplicateMonth(A, SEP, OCT), addTarget(B, { newMonth: NOV }, TN)]);
  const t0 = Date.now();
  const cShows = async () => {
    const l = await listedMonths(C);
    return l.includes(`${label(OCT)}:${sepN}`) && l.some((x) => x.startsWith(label(NOV) + ":"));
  };
  const cT = await ctx.waitUntil(cShows, 12000);
  const tC = cT === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const octN = await monthCells(ctx, OCT);
  const nNode = await nodeByName(ctx, TN);
  const inNov = nNode ? await inMonth(ctx, nNode.id, NOV) : false;
  R.note(`after Duplicate A is on ${await where(A)}; after Add target B is on ${await where(B)}`);
  R.expect(1, octN === sepN && inNov, `DB: October has ${octN} of September's ${sepN} targets; ${TN} in November ${inNov}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C's list did not show both within 12 s (${(await listedMonths(C)).slice(0, 5).join(", ")})` : `C's list showed October (${sepN}) and November ${(tC / 1000).toFixed(1)} s after`);

  // Check 2: same month record: A and B each add a target to October from the list.
  const TA = `E2E OctA ${tag}`;
  const TB = `E2E OctB ${tag}`;
  // Duplicate / Add target may have taken A and B into the month.
  await Promise.all([openTargetsList(ctx, A), openTargetsList(ctx, B)]);
  await Promise.all([addTarget(A, { month: OCT }, TA), addTarget(B, { month: OCT }, TB, 2000000, 2500000)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const na = await nodeByName(ctx, TA);
  const nb = await nodeByName(ctx, TB);
  const both = !!na && !!nb && (await inMonth(ctx, na.id, OCT)) && (await inMonth(ctx, nb.id, OCT));
  const octN2 = await monthCells(ctx, OCT);
  const want2 = `${label(OCT)}:${octN2}`;
  await Promise.all([openTargetsList(ctx, A), openTargetsList(ctx, B)]);
  const seen2 = [];
  for (const p of [A, B, C]) seen2.push((await ctx.waitUntil(async () => (await listedMonths(p)).includes(want2), 5000)) !== null);
  // Edit on the list row opens that month with both new targets.
  const row = await showMonthRow(C, label(OCT));
  await row.locator("xpath=..").getByRole("button", { name: "Edit", exact: true }).click();
  await C.locator("main").getByText(`Targets · ${label(OCT)}`).first().waitFor({ timeout: 10000 });
  await C.waitForTimeout(800);
  const names = await shownTargets(C);
  R.expect(2, both && octN2 === sepN + 2 && seen2.every(Boolean) && names.includes(TA) && names.includes(TB), `DB: both in October ${both} (${octN2} targets); lists A/B/C show ${octN2}: ${seen2.join("/")}; C's Edit opens October with both: ${names.includes(TA) && names.includes(TB)}`);

  // Check 4: A deletes October; B (feed held, still listing it) adds a target to October.
  await Promise.all([openTargetsList(ctx, A), openTargetsList(ctx, B), openTargetsList(ctx, C)]);
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await deleteMonth(A, label(OCT));
  await ctx.sleep(1500);
  const goneA = (await monthCells(ctx, OCT)) === 0;
  const bStill = (await listedMonths(B)).some((x) => x.startsWith(label(OCT) + ":"));
  const TS = `STALE Oct ${tag}`;
  let err = "";
  try { await addTarget(B, { month: OCT }, TS); } catch (e) { err = String(e).split("\n")[0].slice(0, 80); await ctx.closeModal(B); }
  await ctx.sleep(2500);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await monthCells(ctx, OCT);
  await ctx.reloadAll();
  const listed = [];
  for (const p of [A, B, C]) {
    await openTargetsList(ctx, p);
    listed.push((await listedMonths(p)).some((x) => x.startsWith(label(OCT) + ":")));
  }
  R.expect(4, goneA && bStill && after === 0 && listed.every((x) => !x), `A's delete: October gone ${goneA}; B still lists it ${bStill}; after B's stale Add target${err ? " (" + err + ")" : ""}: October targets ${after}; listed after reload A/B/C ${listed.join("/")}`);

  // Check 5: every screen's month list = DB.
  const db = await liveMonths(ctx);
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    const l = await listedMonths(p);
    const missing = db.filter((x) => !l.includes(x));
    const extra = l.filter((x) => !db.includes(x));
    if (missing.length || extra.length) bad.push(`${t}: missing ${missing.join(", ") || "-"}; extra ${extra.join(", ") || "-"}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join(" | ") : `lists on A/B/C = DB (${db.join(", ")})`);
  await endChecks(ctx, R, m0);
  return R;
}
