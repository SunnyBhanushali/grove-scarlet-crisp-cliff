/**
 * Targets month list (Add target · Duplicate · Edit · Delete), Copy month,
 * Import, the Target / Group tabs (one target across months) and deleting a
 * target that rewards are linked to. Six checks per screen; see
 * scripts/e2e/rows-v2-three-users.mjs.
 */
import { ScreenResult } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  SEP, NODE, openTargetsList, openTargetMonth, showMonthRow, dialog, setCell, cellValue, cellRow, targetRow, parseMoney,
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

/** New target from the org picker ("Brand or SBU"), set floors. */
export async function newTargetSbu(p, sbuName, m1 = 500000, m5 = 700000) {
  await p.getByRole("button", { name: "New target" }).click();
  const d = await dialog(p, "New target");
  await d.getByRole("button", { name: "Brand or SBU", exact: true }).click();
  await p.waitForTimeout(300);
  await d.locator("button[aria-haspopup=listbox]").click();
  await p.waitForTimeout(300);
  await d.locator('input[placeholder^="Search companies"]').fill(sbuName);
  await p.waitForTimeout(500);
  await d.locator(`[role=radio][aria-label="Select ${sbuName}"]`).first().click();
  await p.waitForTimeout(300);
  const f = d.locator('input[placeholder="₹"]');
  await f.nth(0).fill(String(m1));
  await f.nth(4).fill(String(m5));
  const c = d.getByRole("button", { name: "Compute" });
  if (await c.isEnabled().catch(() => false)) await c.click();
  await d.getByRole("button", { name: "Create target" }).click();
  await p.waitForTimeout(800);
  if (await d.isVisible().catch(() => false)) {
    const msg = (await d.innerText()).split("\n").filter((l) => /already|must|required|cannot|can't/i.test(l)).join(" · ");
    await p.mouse.click(6, 994);
    throw new Error(`New target refused: ${msg || "dialog stayed open"}`);
  }
}

// ---------------------------------------------------------------------------
// Delete a target that rewards unlock against, then re-create it
// ---------------------------------------------------------------------------
export async function targetsDeleteRecreate(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-delete-recreate", "Delete a target with linked rewards · re-create it");
  const pp = await import("./plan-page.mjs");
  const sr = await import("./screens-rewards.mjs");
  const AHD = "tn-m-mu29qhpk";
  const NEVIL = { name: "Nevil Prajapati", id: "p-1788353125697-i2ke0d" };
  const BIRI = "p-1788353125743-u13lxd";
  void run;
  const links = async () => (await ctx.sql("select person_id, payload->>'targetNodeId' as t from reward_records where period = '2026-09' and person_id = any($1) and deleted_at is null order by 1", [[NEVIL.id, BIRI]])).map((r) => r.t);
  const cellDeleted = async (id) => ((await cellRow(ctx, id)) || {}).deleted_at != null;
  const openNevil = (p) => pp.openPerson(ctx, p, "rewards", NEVIL.name, SEP);

  const m0 = await openWithoutWrites(ctx, R, "the Targets month page and a Rewards page", (p) => (p === C ? openNevil(p) : openTargetMonth(ctx, p)));
  const links0 = await links();
  const cBefore = await sr.targetName(C);

  // Check 1 + 4: B's screen is held stale. A deletes Ahmedabad (two September
  // rewards unlock against it) while B sets Goa's M4; then B, still showing
  // Ahmedabad, types its actual.
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await Promise.all([rowDelete(A, "Ahmedabad"), setCell(B, "Goa", 4, 1650000)]);
  const t0 = Date.now();
  await ctx.settled(A);
  const bSees = (await targetRow(B, "Ahmedabad").count()) > 0;
  let staleErr = "";
  try { await setCell(B, "Ahmedabad", 0, 777000); } catch (e) { staleErr = String(e).split("\n")[0].slice(0, 80); }
  await ctx.settled(B);
  const goa = (await cellRow(ctx, NODE.goa))?.payload;
  const delNow = await cellDeleted(AHD);
  const links1 = await links();
  R.expect(1, delNow && Number(goa?.ladder?.M4) === 1650000, `DB: Ahmedabad's September cell deleted ${delNow}; Goa M4 ${goa?.ladder?.M4}; reward links kept on the node: ${links1.join(", ")}`);
  // C idle on Nevil's Rewards page: the deleted target leaves the "Unlock against" choice.
  const cGone = await ctx.waitUntil(async () => (await sr.targetName(C)) !== "Ahmedabad", 12000);
  const tGone = cGone === null ? null : Date.now() - t0;
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const stillDel = await cellDeleted(AHD);
  const staleActual = Number((await cellRow(ctx, AHD))?.payload?.actual);
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B]) {
    await openTargetMonth(ctx, p);
    shown.push((await targetRow(p, "Ahmedabad").count()) > 0);
  }
  R.expect(4, bSees && stillDel && staleActual !== 777000 && shown.every((x) => !x), `B still showed Ahmedabad ${bSees}; after B's stale actual${staleErr ? " (" + staleErr + ")" : ""}: still deleted ${stillDel}, actual ${staleActual}; on A/B after reload ${shown.join("/")}`);

  // Re-create from the org picker: same node, the rewards' links come back.
  await openNevil(C);
  const cMissing = await sr.targetName(C);
  await newTargetSbu(A, "Ahmedabad");
  const t1 = Date.now();
  await ctx.settled(A);
  const back = !(await cellDeleted(AHD));
  const nodes = await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = 'Ahmedabad' and deleted_at is null");
  const links2 = await links();
  const cBack = await ctx.waitUntil(async () => (await sr.targetName(C)) === "Ahmedabad", 12000);
  const tBack = cBack === null ? null : Date.now() - t1;
  R.note(`links: before ${links0.join(", ")} (Nevil's page: ${cBefore}); after the delete the rows keep targetNodeId ${links1.join(", ")} and the page shows "${cMissing}"; re-created from Brand or SBU → same node (${nodes.map((n) => n.id).join(", ")}), cell back ${back}, links ${links2.join(", ")}`);
  R.expect(3, tGone !== null && tGone <= 5000 && tBack !== null && tBack <= 5000, `C (idle on Nevil's Rewards page): target left the choice ${tGone === null ? "no" : (tGone / 1000).toFixed(1) + " s"} after the delete; showed Ahmedabad again ${tBack === null ? "no" : (tBack / 1000).toFixed(1) + " s"} after the re-create`);

  // Check 2: the re-created cell: A sets M2 while B sets the actual.
  await openTargetMonth(ctx, B);
  await Promise.all([setCell(A, "Ahmedabad", 2, 560000), setCell(B, "Ahmedabad", 0, 430000)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const ahd = (await cellRow(ctx, AHD))?.payload;
  const both = async (p) => (await cellValue(p, "Ahmedabad", 2)) === 560000 && (await cellValue(p, "Ahmedabad", 0)) === 430000;
  const aT = await ctx.waitUntil(() => both(A), 5000);
  const bT = await ctx.waitUntil(() => both(B), 5000);
  R.expect(2, Number(ahd?.ladder?.M2) === 560000 && Number(ahd?.actual) === 430000 && aT !== null && bT !== null, `DB Ahmedabad M2 ${ahd?.ladder?.M2}, actual ${ahd?.actual}; A shows both ${aT !== null}, B shows both ${bT !== null}`);

  // Re-create under a custom name instead (a new target that happens to have the same name).
  await rowDelete(A, "Ahmedabad");
  await ctx.settled(A);
  let customErr = "";
  try { await newTarget(A, "Ahmedabad", 500000, 700000); } catch (e) { customErr = String(e).split("\n")[0].slice(0, 100); }
  await ctx.settled(A);
  const nodes2 = await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = 'Ahmedabad' and deleted_at is null order by id");
  const links3 = await links();
  await openNevil(B);
  const bShows = await sr.targetName(B);
  R.note(`custom-name re-create${customErr ? " (" + customErr + ")" : ""}: nodes named Ahmedabad ${nodes2.map((n) => n.id).join(", ")}; reward links ${links3.join(", ")}; Nevil's page shows "${bShows}"`);
  // Put September back: the custom one off, the org one on.
  await openTargetMonth(ctx, A);
  const customRow = nodes2.find((n) => n.id !== AHD);
  if (customRow) {
    await rowDelete(A, "Ahmedabad");
    await ctx.settled(A);
  }
  if (await cellDeleted(AHD)) {
    await newTargetSbu(A, "Ahmedabad");
    await ctx.settled(A);
  }

  // Check 5: after reload, every screen = DB (month page row + Nevil's link).
  await ctx.reloadAll();
  const dbCell = (await cellRow(ctx, AHD))?.payload;
  const dbLive = !(await cellDeleted(AHD));
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openTargetMonth(ctx, p);
    const has = (await targetRow(p, "Ahmedabad").count()) > 0;
    if (has !== dbLive) bad.push(`${t} month page Ahmedabad ${has} vs DB ${dbLive}`);
    await openNevil(p);
    const n = await sr.targetName(p);
    if ((n === "Ahmedabad") !== dbLive) bad.push(`${t} Nevil's target "${n}"`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `DB Ahmedabad live ${dbLive} (M1 ${dbCell?.ladder?.M1}); month pages and Nevil's page agree on A/B/C`);
  await endChecks(ctx, R, m0);
  return R;
}

/** List → Import a CSV (the SPA reads .csv like .xlsx); returns the preview text. */
export async function importCsv(p, csv, opts = {}) {
  const { preview, commit } = await prepareImport(p, csv, opts);
  await commit();
  return preview;
}

/** Open Import and load the file (preview shown); `commit()` presses Import. */
export async function prepareImport(p, csv, { lockedToo = false } = {}) {
  await p.locator("main").getByRole("button", { name: "Import", exact: true }).first().click();
  const d = await dialog(p, "Targets spreadsheet");
  const box = d.locator('input[type="checkbox"]').first();
  if ((await box.isChecked()) !== lockedToo) await box.click();
  await d.locator('input[type="file"]').setInputFiles({ name: "targets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.waitForTimeout(1500);
  const preview = await d.innerText();
  return { preview, commit: () => commitImport(p, d) };
}

async function commitImport(p, d) {
  await d.getByRole("button", { name: "Import", exact: true }).last().click();
  await p.waitForTimeout(1000);
  const conf = p.locator("div.fixed.inset-0 button", { hasText: /^(Apply|Import|Replace|Confirm|Yes)/ }).last();
  if (await conf.isVisible().catch(() => false)) await conf.click();
  await p.waitForTimeout(800);
  if (await d.isVisible().catch(() => false)) await p.mouse.click(6, 994);
}

const CSV_HEAD = "month,kind,name,unit,parent_group,brand_or_sbu,mode,M1,M2,M3,M4,M5,actual";

// ---------------------------------------------------------------------------
// Import (spreadsheet) · Copy month
// ---------------------------------------------------------------------------
export async function targetsImport(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-import", "Import spreadsheet (new month, replace month)");
  const tag = run.slice(-4);
  const M = "2027-03";
  const X1 = `Imp One ${tag}`;
  const X2 = `Imp Two ${tag}`;
  const m0 = await openWithoutWrites(ctx, R, "the Targets list (import)", (p) => (p === B ? openTargetMonth(ctx, p) : openTargetsList(ctx, p)));

  // Check 1 + 3: A imports a new month (two targets) while B sets Pune's M4 in September; C idle on the list.
  const csv1 = [CSV_HEAD, `${M},target,${X1},rupees,,,set,100000,110000,120000,130000,140000,`, `${M},target,${X2},rupees,,,set,200000,210000,220000,230000,240000,`].join("\n");
  let preview = "";
  await Promise.all([(async () => { preview = await importCsv(A, csv1); })(), setCell(B, "Pune", 4, 3340000)]);
  const t0 = Date.now();
  const cT = await ctx.waitUntil(async () => (await listedMonths(C)).includes(`${label(M)}:2`), 12000);
  const tC = cT === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const n1 = await nodeByName(ctx, X1);
  const n2 = await nodeByName(ctx, X2);
  const c1 = n1 ? (await cellRow(ctx, n1.id, M))?.payload : null;
  const pune = (await cellRow(ctx, NODE.pune))?.payload;
  R.note(`import preview: ${preview.replace(/\s+/g, " ").match(/\d+ rows?[^.]*\./)?.[0] || preview.replace(/\s+/g, " ").slice(-160)}`);
  R.expect(1, !!n1 && !!n2 && Number(c1?.ladder?.M1) === 100000 && (await monthCells(ctx, M)) === 2 && Number(pune?.ladder?.M4) === 3340000, `DB: ${label(M)} has ${await monthCells(ctx, M)} targets (${X1} M1 ${c1?.ladder?.M1}); Pune M4 ${pune?.ladder?.M4}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C's list did not show ${label(M)} (2) within 12 s` : `C's list showed ${label(M)} with 2 targets ${(tC / 1000).toFixed(1)} s after`);

  // Check 2: the same cell: A re-imports the month with X1's M3 changed (actual blank) while B types X1's actual.
  await openTargetMonth(ctx, B, label(M));
  const csv2 = [CSV_HEAD, `${M},target,${X1},rupees,,,set,100000,110000,125000,130000,140000,`, `${M},target,${X2},rupees,,,set,200000,210000,220000,230000,240000,`].join("\n");
  // The file is loaded first; A presses Import as B types (A's screen has not seen B's actual).
  const imp = await prepareImport(A, csv2);
  await Promise.all([imp.commit(), setCell(B, X1, 0, 95000)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const x1 = n1 ? (await cellRow(ctx, n1.id, M))?.payload : null;
  const bSame = await ctx.waitUntil(async () => (await cellValue(B, X1, 3)) === Number(x1?.ladder?.M3) && (await cellValue(B, X1, 0)) === (x1?.actual == null ? null : Number(x1.actual)), 5000);
  // Import is a whole-month replace (the dialog says so before Import is pressed): it
  // never edits one field, so "different fields of the same record" cannot happen here.
  R.na(2, `import replaces whole months by design (warned in the dialog); measured: A's replace landed after B's actual, DB ${X1} M3 ${x1?.ladder?.M3}, actual ${x1?.actual} (B typed 95000 — replaced by the file's blank); B's screen = DB ${bSame !== null}`);

  // Check 4: A deletes the imported month; B (held stale, on it) edits X2's M2.
  await openTargetsList(ctx, A);
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await deleteMonth(A, label(M));
  await ctx.sleep(1500);
  const gone = (await monthCells(ctx, M)) === 0;
  let err = "";
  try { await setCell(B, X2, 2, 215000); } catch (e) { err = String(e).split("\n")[0].slice(0, 80); }
  await ctx.sleep(2500);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await monthCells(ctx, M);
  await ctx.reloadAll();
  const listed = [];
  for (const p of [A, B, C]) {
    await openTargetsList(ctx, p);
    listed.push((await listedMonths(p)).some((x) => x.startsWith(label(M) + ":")));
  }
  R.expect(4, gone && after === 0 && listed.every((x) => !x), `A's delete: ${label(M)} gone ${gone}; after B's stale M2${err ? " (" + err + ")" : ""}: ${after} targets; listed after reload A/B/C ${listed.join("/")}`);

  // Check 5: lists = DB after reload.
  const db = await liveMonths(ctx);
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    const l = await listedMonths(p);
    if (db.some((x) => !l.includes(x)) || l.some((x) => !db.includes(x))) bad.push(`${t}: ${l.join(", ")}`);
  }
  R.expect(5, !bad.length, bad.length ? `DB ${db.join(", ")} | ${bad.join(" | ")}` : `lists on A/B/C = DB (${db.length} months)`);
  await endChecks(ctx, R, m0);
  return R;
}

/** Month page → Copy month: copy all targets from `fromLabel` into this month. */
export async function copyMonth(p, fromLabel) {
  await p.getByRole("button", { name: "Copy month", exact: true }).click();
  await p.waitForTimeout(400);
  const sel = p.locator("main select").filter({ has: p.locator("option", { hasText: fromLabel }) }).first();
  await sel.selectOption({ label: fromLabel });
  await p.getByRole("button", { name: /^Copy into/ }).click();
  await p.waitForTimeout(800);
  const conf = p.locator("div.fixed.inset-0 button", { hasText: /^(Copy|Replace|Yes)/ }).last();
  if (await conf.isVisible().catch(() => false)) await conf.click();
  await p.waitForTimeout(500);
}

export async function targetsCopyMonth(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-copy-month", "Month page: Copy month (copy all targets from another month)");
  const tag = run.slice(-4);
  const M = "2026-12";
  // A new month with one target, made from the list (the month page needs a month).
  await openTargetsList(ctx, A);
  const SEED = `Dec seed ${tag}`;
  await addTarget(A, { newMonth: M }, SEED);
  await ctx.settled(A);
  const m0 = await openWithoutWrites(ctx, R, `the ${label(M)} month page`, (p) => openTargetMonth(ctx, p, label(M)));

  // Check 1 + 3: A copies August into December while B sets Pune's actual in September; C idle on December.
  await openTargetMonth(ctx, B);
  const augN = await monthCells(ctx, "2026-08");
  await Promise.all([copyMonth(A, "August 2026"), setCell(B, "Pune", 0, 2610000)]);
  const t0 = Date.now();
  const cT = await ctx.waitUntil(async () => (await shownTargets(C)).includes("Kochi") && (await shownTargets(C)).includes("Goa"), 12000);
  const tC = cT === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const decN = await monthCells(ctx, M);
  const pune = (await cellRow(ctx, NODE.pune))?.payload;
  const seed = await nodeByName(ctx, SEED);
  const seedCell = seed ? await cellRow(ctx, seed.id, M) : null;
  const seedKept = !!seedCell && seedCell.deleted_at == null;
  R.note(`Copy month into a month that already has a target: December has ${decN} (August ${augN}); the existing target is ${seedKept ? "kept" : "removed"}`);
  R.expect(1, decN >= augN && Number(pune?.actual) === 2610000, `DB: December ${decN} targets (August ${augN}); Pune actual ${pune?.actual}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show August's targets in December within 12 s` : `C showed the copied targets ${(tC / 1000).toFixed(1)} s after`);

  // Check 2: same copied cell (Goa · December): A sets M5 while B sets the actual.
  await openTargetMonth(ctx, B, label(M));
  await Promise.all([setCell(A, "Goa", 5, 1900000), setCell(B, "Goa", 0, 1100000)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const goa = (await cellRow(ctx, NODE.goa, M))?.payload;
  const shows = async (p) => (await cellValue(p, "Goa", 5)) === 1900000 && (await cellValue(p, "Goa", 0)) === 1100000;
  const aT = await ctx.waitUntil(() => shows(A), 5000);
  const bT = await ctx.waitUntil(() => shows(B), 5000);
  R.expect(2, Number(goa?.ladder?.M5) === 1900000 && Number(goa?.actual) === 1100000 && aT !== null && bT !== null, `DB Goa (December) M5 ${goa?.ladder?.M5}, actual ${goa?.actual}; A shows both ${aT !== null}, B shows both ${bT !== null}`);

  // Check 4: A deletes Kochi from December; B (held stale) sets Kochi's M1 there.
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await rowDelete(A, "Kochi");
  await ctx.settled(A);
  const bSees = (await targetRow(B, "Kochi").count()) > 0;
  let err = "";
  try { await setCell(B, "Kochi", 1, 999000); } catch (e) { err = String(e).split("\n")[0].slice(0, 80); }
  await ctx.sleep(2500);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const kochi = await cellRow(ctx, NODE.kochi, M);
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openTargetMonth(ctx, p, label(M));
    shown.push((await targetRow(p, "Kochi").count()) > 0);
  }
  R.expect(4, bSees && kochi?.deleted_at != null && Number(kochi?.payload?.ladder?.M1) !== 999000 && shown.every((x) => !x), `B still showed Kochi ${bSees}; after B's stale M1${err ? " (" + err + ")" : ""}: deleted ${kochi?.deleted_at != null}; on A/B/C after reload ${shown.join("/")}`);

  // Check 5: December on every screen = DB (targets and Goa's numbers).
  const want = (await ctx.sql("select n.payload->>'name' as name from target_cells c join entities n on n.kind = 'target-nodes' and n.id = c.payload->>'nodeId' where split_part(c.id, '::', 2) = $1 and c.deleted_at is null", [M])).map((r) => r.name).sort();
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    const s = (await shownTargets(p)).slice().sort();
    const miss = want.filter((n) => !s.includes(n));
    const extra = s.filter((n) => !want.includes(n));
    if (miss.length || extra.length) bad.push(`${t}: missing ${miss.join(", ") || "-"}; extra ${extra.join(", ") || "-"}`);
    if ((await cellValue(p, "Goa", 5)) !== Number(goa?.ladder?.M5)) bad.push(`${t}: Goa M5 ${await cellValue(p, "Goa", 5)}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join(" | ") : `December on A/B/C = DB (${want.length} targets, Goa M5 ${goa?.ladder?.M5})`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Target / Group tabs: one target (or group) across months
// ---------------------------------------------------------------------------
/** Targets list → a tab ("Target" / "Group"), with `names` expanded. */
export async function openTargetTab(ctx, p, tab, names) {
  await openTargetsList(ctx, p);
  await p.locator("main").getByRole("button", { name: tab, exact: true }).first().click();
  await p.waitForTimeout(600);
  for (const n of names) {
    // The SPA remembers which rows are open: click only a closed one.
    const open = await p.evaluate(({ n, tab }) => {
      const btns = [...document.querySelectorAll("main button")];
      const i = btns.findIndex((b) => { const l = (b.innerText || "").split("\n").map((x) => x.trim()); return l[0] === n && l[1] === tab; });
      if (i < 0) return null;
      return /^\w+ \d{4}\n/.test(btns[i + 1] ? btns[i + 1].innerText || "" : "");
    }, { n, tab });
    if (open === false) {
      const head = p.locator("main button").filter({ hasText: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${tab}`) }).first();
      await head.click();
      await p.waitForTimeout(400);
    }
  }
}
/** The month row under an expanded target: { m1, achieved } (null when not shown). */
export async function tabMonth(p, name, monthLabel) {
  return p.evaluate(({ name, monthLabel }) => {
    const btns = [...document.querySelectorAll("main button")];
    // The target's header reads "Name\nTarget|Group\nUnit".
    const i = btns.findIndex((b) => { const l = (b.innerText || "").split("\n").map((x) => x.trim()); return l[0] === name && (l[1] === "Target" || l[1] === "Group"); });
    if (i < 0) return null;
    for (let j = i + 1; j < btns.length; j++) {
      const raw = (btns[j].innerText || "").split("\n").map((x) => x.trim());
      if (raw[1] === "Target" || raw[1] === "Group") break; // next target
      const t = raw.join(" ");
      if (t.startsWith(monthLabel + " ")) {
        const m1 = (t.match(/M1 (₹[\d.,]+(?:Cr|L|K)?)/) || [])[1] || null;
        const ach = (t.match(/Achieved (₹[\d.,]+(?:Cr|L|K)?|—)/) || [])[1] || null;
        return { m1, achieved: ach === "—" ? null : ach };
      }
    }
    return { m1: null, achieved: null, missing: true };
  }, { name, monthLabel });
}

export async function targetsTargetTab(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-target-tab", "Target / Group tabs: one target across months");
  void run;
  const num = (s) => (s == null ? null : parseMoney(s));
  const m0 = await openWithoutWrites(ctx, R, "the Target tab", (p) => (p === C ? openTargetTab(ctx, p, "Target", ["Pune", "Goa", "Kolkatta"]) : openTargetMonth(ctx, p)));

  // Check 1 + 3: different targets: A sets Pune's M1, B sets Goa's M1; C watches the Target tab.
  await Promise.all([setCell(A, "Pune", 1, 2512000), setCell(B, "Goa", 1, 1234000)]);
  let t0 = Date.now();
  const c1 = await ctx.waitUntil(async () => num((await tabMonth(C, "Pune", SEP))?.m1) === 2512000 && num((await tabMonth(C, "Goa", SEP))?.m1) === 1234000, 12000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const pune = (await cellRow(ctx, NODE.pune))?.payload;
  const goa = (await cellRow(ctx, NODE.goa))?.payload;
  R.expect(1, Number(pune?.ladder?.M1) === 2512000 && Number(goa?.ladder?.M1) === 1234000, `DB Pune M1 ${pune?.ladder?.M1}, Goa M1 ${goa?.ladder?.M1}`);

  // Check 2 + 3: same target: A sets Pune's M1 again, B sets Pune's actual.
  await Promise.all([setCell(A, "Pune", 1, 2530000), setCell(B, "Pune", 0, 2745000)]);
  t0 = Date.now();
  const c2 = await ctx.waitUntil(async () => { const r = await tabMonth(C, "Pune", SEP); return num(r?.m1) === 2530000 && num(r?.achieved) === 2745000; }, 12000);
  const tC2 = c2 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const pune2 = (await cellRow(ctx, NODE.pune))?.payload;
  R.expect(2, Number(pune2?.ladder?.M1) === 2530000 && Number(pune2?.actual) === 2745000, `DB Pune M1 ${pune2?.ladder?.M1}, actual ${pune2?.actual}`);
  const c2r = await tabMonth(C, "Pune", SEP);
  R.expect(3, tC1 !== null && tC1 <= 5000 && tC2 !== null && tC2 <= 5000, `C's Target tab: two targets ${tC1 === null ? "not" : (tC1 / 1000).toFixed(1) + " s"}; same target (M1 + achieved) ${tC2 === null ? `not (shows M1 ${c2r?.m1}, achieved ${c2r?.achieved})` : (tC2 / 1000).toFixed(1) + " s"}`);

  // Check 4: A deletes Kolkatta from September; B (held stale on the month page) sets its actual.
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await rowDelete(A, "Kolkatta");
  await ctx.settled(A);
  const bSees = (await targetRow(B, "Kolkatta").count()) > 0;
  let err = "";
  try { await setCell(B, "Kolkatta", 0, 888000); } catch (e) { err = String(e).split("\n")[0].slice(0, 80); }
  await ctx.sleep(2500);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const kol = await cellRow(ctx, "tn-imp-10-rarour");
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openTargetTab(ctx, p, "Target", ["Kolkatta"]);
    const r = await tabMonth(p, "Kolkatta", SEP);
    shown.push(!!r && !r.missing);
  }
  R.expect(4, bSees && kol?.deleted_at != null && Number(kol?.payload?.actual) !== 888000 && shown.every((x) => !x), `B still showed Kolkatta ${bSees}; after B's stale actual${err ? " (" + err + ")" : ""}: deleted ${kol?.deleted_at != null}; September row on A/B/C's Target tab ${shown.join("/")}`);

  // Check 5: Target and Group tabs on every screen = DB.
  const vishal = await ctx.sql("select c.payload from target_cells c where c.id = $1", ["tn-imp-19-y8xqph::2026-09"]);
  const bad = [];
  // Nobody touched Pune after check 2: both values must still be there (a
  // focused value input used to write its stale copy back on the next click).
  const puneEnd = (await cellRow(ctx, NODE.pune))?.payload;
  if (Number(puneEnd?.ladder?.M1) !== 2530000 || Number(puneEnd?.actual) !== 2745000) bad.push(`DB Pune changed after check 2: M1 ${puneEnd?.ladder?.M1}, actual ${puneEnd?.actual}`);
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openTargetTab(ctx, p, "Target", ["Pune"]);
    const r = await tabMonth(p, "Pune", SEP);
    if (num(r?.m1) !== Number(pune2?.ladder?.M1) || num(r?.achieved) !== Number(pune2?.actual)) bad.push(`${t} Pune ${r?.m1}/${r?.achieved}`);
    await openTargetTab(ctx, p, "Group", ["Cluster > Vishal"]);
    const g = await tabMonth(p, "Cluster > Vishal", SEP);
    if (!g || g.missing) bad.push(`${t} Group tab: Cluster > Vishal has no September row`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `Target tab Pune (M1 ${pune2?.ladder?.M1}, achieved ${pune2?.actual}) and Group tab Vishal (${vishal.length ? "September row" : "-"}) on A/B/C = DB`);
  await endChecks(ctx, R, m0);
  return R;
}
