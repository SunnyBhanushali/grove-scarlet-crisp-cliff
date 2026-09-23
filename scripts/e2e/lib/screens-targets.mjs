/**
 * Targets screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * Data: the imported seed (fresh database), month September 2026 (plan
 * locked; floors and actuals can still be corrected) and a fresh month the
 * scenarios create where a plan must be open.
 */
import { ScreenResult } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";

export const SEP = "September 2026";
export const NODE = {
  pune: "tn-imp-2-xbvr8c",
  goa: "tn-imp-3-63t328",
  kochi: "tn-imp-7-8ixu98",
  hyderabad: "tn-imp-5-v0r0u3",
  chennai: "tn-imp-6-ulsxxi",
  bangalore: "tn-bu-1788158052564-bl73-os17",
  delhi: "tn-imp-8-ersn4t",
  gurgaon: "tn-imp-9-7cyman",
};

export async function openTargetsList(ctx, p) {
  await ctx.nav(p, "Rewards", "Targets");
}

export async function openTargetMonth(ctx, p, monthLabel = SEP) {
  await openTargetsList(ctx, p);
  await p.locator("main button", { hasText: new RegExp("^" + monthLabel) }).first().click();
  await p.locator("main").getByText(`Targets · ${monthLabel}`).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(1000);
}

/** The row of a target (found by its "Move <name>" drag handle). */
export function targetRow(p, name) {
  // The smallest block around the drag handle that has the row's own Edit button.
  return p.getByRole("button", { name: `Move ${name}`, exact: true }).locator("xpath=ancestor::*[.//button[@title='Edit' or @aria-label='Edit']][1]");
}
/** 0 = actual, 1..5 = M1..M5 */
export function cellInput(p, name, i) {
  return targetRow(p, name).locator('input[aria-label="Value"]').nth(i);
}

export function parseMoney(v) {
  const s = String(v || "").replace(/[₹,\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(-?[\d.]+)(Cr|L|K)?$/i);
  if (!m) return Number(s) || null;
  const mul = { cr: 1e7, l: 1e5, k: 1e3 }[String(m[2] || "").toLowerCase()] || 1;
  return Math.round(Number(m[1]) * mul);
}

export async function setCell(p, name, i, value) {
  const inp = cellInput(p, name, i);
  await inp.scrollIntoViewIfNeeded();
  await inp.click();
  await inp.fill(String(value));
  await inp.press("Tab");
  await p.waitForTimeout(150);
}

export async function cellValue(p, name, i) {
  return parseMoney(await cellInput(p, name, i).inputValue());
}

export async function cellRow(ctx, nodeId, month = "2026-09") {
  const r = await ctx.sql("select payload, rev, deleted_at from target_cells where id = $1", [`${nodeId}::${month}`]);
  return r[0] || null;
}

export async function nodeRow(ctx, nodeId) {
  const r = await ctx.sql("select payload, rev, deleted_at from entities where kind = 'target-nodes' and id = $1", [nodeId]);
  return r[0] || null;
}

/** Is the node on a month (in its root order, or a live member row of some group that month)? */
export async function inMonth(ctx, nodeId, month = "2026-09") {
  const root = await ctx.sql("select payload from entities where kind = 'target-root-order' and id = $1 and deleted_at is null", [month]);
  const order = root[0]?.payload?.value || [];
  const mem = await ctx.sql("select 1 from entities where kind = 'target-members' and deleted_at is null and payload->>'memberId' = $1 and payload->>'month' = $2", [nodeId, month]);
  return order.includes(nodeId) || mem.length > 0;
}

async function rowDelete(p, name) {
  const row = targetRow(p, name);
  await row.getByRole("button", { name: "Delete", exact: true }).first().click();
  await p.waitForTimeout(400);
  const confirm = p.locator("div.fixed.inset-0 button", { hasText: /^Delete/ }).last();
  if (await confirm.count()) await confirm.click();
  await p.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Month page: cells, ladders (M1–M5) and actuals
// ---------------------------------------------------------------------------
export async function targetsCells(ctx, run) {
  const R = new ScreenResult("Targets", "targets-cells", "Month page: actuals · ladders M1–M5 (cells)");
  const { A, B, C } = ctx;
  const m0 = await openWithoutWrites(ctx, R, "the Targets month page", (p) => openTargetMonth(ctx, p));
  void run;

  // Check 2 + 3: same cell (Pune), A sets M2 while B sets the actual; C idle.
  await Promise.all([setCell(A, "Pune", 2, 2800000), setCell(B, "Pune", 0, 2500000)]);
  const t0 = Date.now();
  const shows = async (p) => (await cellValue(p, "Pune", 2)) === 2800000 && (await cellValue(p, "Pune", 0)) === 2500000;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const pune = (await cellRow(ctx, NODE.pune))?.payload;
  const aT = await ctx.waitUntil(() => shows(A), 5000);
  const bT = await ctx.waitUntil(() => shows(B), 5000);
  const abOk = aT !== null && bT !== null;
  const st = async (p) => `M2 ${await cellValue(p, "Pune", 2)}, actual ${await cellValue(p, "Pune", 0)}`;
  R.expect(2, Number(pune?.ladder?.M2) === 2800000 && Number(pune?.actual) === 2500000 && abOk, `DB Pune M2 ${pune?.ladder?.M2}, actual ${pune?.actual}; A shows both ${aT !== null}${aT === null ? " (" + (await st(A)) + ")" : ""}, B shows both ${bT !== null}${bT === null ? " (" + (await st(B)) + ")" : ""}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show both within 12 s (M2 ${await cellValue(C, "Pune", 2)}, actual ${await cellValue(C, "Pune", 0)})` : `C showed both ${(tC / 1000).toFixed(1)} s after the edits`);

  // Check 1: different cells: A sets Goa's actual, B sets Kochi's actual.
  await Promise.all([setCell(A, "Goa", 0, 1200000), setCell(B, "Kochi", 0, 1300000)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const goa = (await cellRow(ctx, NODE.goa))?.payload;
  const kochi = (await cellRow(ctx, NODE.kochi))?.payload;
  const cG = await ctx.waitUntil(async () => (await cellValue(C, "Goa", 0)) === 1200000 && (await cellValue(C, "Kochi", 0)) === 1300000, 5000);
  R.expect(1, Number(goa?.actual) === 1200000 && Number(kochi?.actual) === 1300000 && Number(pune?.actual) === 2500000, `DB Goa ${goa?.actual}, Kochi ${kochi?.actual}; C saw both ${cG === null ? "no" : `in ${(cG / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes the Hyderabad target; B (feed held) still sees it and sets its actual.
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await rowDelete(A, "Hyderabad");
  await ctx.sleep(1500);
  const delIn = await inMonth(ctx, NODE.hyderabad);
  const bStill = (await B.getByRole("button", { name: "Move Hyderabad", exact: true }).count()) > 0;
  let err = "";
  try { await setCell(B, "Hyderabad", 0, 999000); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const inAfter = await inMonth(ctx, NODE.hyderabad);
  const cellAfter = await cellRow(ctx, NODE.hyderabad);
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openTargetMonth(ctx, p);
    shown.push(await p.getByRole("button", { name: "Move Hyderabad", exact: true }).count());
  }
  const inReload = await inMonth(ctx, NODE.hyderabad);
  R.expect(4, !delIn && bStill && !inAfter && !inReload && (!cellAfter || !!cellAfter.deleted_at) && shown.every((n) => n === 0),
    `A's delete: off September in DB ${!delIn}; B still saw it ${bStill}; after B's stale edit${err ? " (" + err + ")" : ""} still off ${!inAfter}, cell ${cellAfter ? (cellAfter.deleted_at ? "deleted" : "LIVE actual " + cellAfter.payload?.actual) : "none"}; after reload off ${!inReload}, shown A/B/C ${shown.join("/")}`);

  // Check 5: after reload, screens = DB for the edited cells.
  const want = {
    Pune: [(await cellRow(ctx, NODE.pune))?.payload],
    Goa: [(await cellRow(ctx, NODE.goa))?.payload],
    Kochi: [(await cellRow(ctx, NODE.kochi))?.payload],
  };
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    for (const [name, [pl]] of Object.entries(want)) {
      const a = await cellValue(p, name, 0);
      const m2 = await cellValue(p, name, 2);
      const wa = pl?.actual == null ? null : Math.round(Number(pl.actual));
      const wm2 = pl?.ladder?.M2 == null ? null : Math.round(Number(pl.ladder.M2));
      const near = (x, y) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) <= Math.max(1, Math.abs(y) * 0.006));
      if (!near(a, wa) || !near(m2, wm2)) bad.push(`${t} ${name}: screen ${a}/${m2}, DB ${wa}/${wm2}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : "actual and M2 on all screens = DB (Pune, Goa, Kochi)");
  await endChecks(ctx, R, m0);
  return R;
}

async function dialog(p, title) {
  const d = p.locator("div.fixed.inset-0").filter({ hasText: new RegExp("^" + title) }).last();
  await d.waitFor({ timeout: 10000 });
  return d;
}

/** New target: custom name, set floors (M1 + M5, Compute). */
export async function newTarget(p, name, m1 = 1000000, m5 = 1500000) {
  await p.getByRole("button", { name: "New target" }).click();
  const d = await dialog(p, "New target");
  await d.locator('input[placeholder="Type a name"]').fill(name);
  await d.locator('input[type="radio"]').nth(1).check();
  const floors = d.locator('input[placeholder="₹"]');
  await floors.nth(0).fill(String(m1));
  await floors.nth(4).fill(String(m5));
  const compute = d.getByRole("button", { name: "Compute" });
  if (await compute.count()) await compute.click();
  await d.getByRole("button", { name: "Create target" }).click();
  await p.waitForTimeout(600);
}

/** New group (roll up) with the given top-level members. */
export async function newGroup(p, name, members) {
  await p.getByRole("button", { name: "New group" }).click();
  const d = await dialog(p, "New group");
  await d.getByRole("button", { name: "Custom name", exact: true }).click();
  await p.waitForTimeout(200);
  const inp = d.locator('input:not([type="radio"]):not([type="checkbox"]):not([type="number"])').first();
  await inp.fill(name);
  for (const m of members) {
    await d.locator("label", { hasText: m }).locator('input[type="checkbox"]').first().check();
  }
  await d.getByRole("button", { name: "Create group" }).click();
  await p.waitForTimeout(600);
}

export async function renameTarget(p, oldName, newName) {
  await targetRow(p, oldName).getByRole("button", { name: "Edit", exact: true }).first().click();
  const d = await dialog(p, "Edit (target|group)");
  let inp = d.locator('input:not([type="radio"]):not([type="checkbox"]):not([type="number"])').first();
  if (!(await inp.count())) {
    // Opened in "Brand or SBU" mode (a picker): switch to a custom name.
    await d.getByRole("button", { name: "Custom name", exact: true }).click();
    await p.waitForTimeout(200);
    inp = d.locator('input:not([type="radio"]):not([type="checkbox"]):not([type="number"])').first();
  }
  await inp.fill(newName);
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(500);
  if (await d.isVisible().catch(() => false)) {
    const msg = (await d.innerText()).split("\n").filter((l) => /already|must|required|cannot|can't/i.test(l)).join(" · ");
    await d.getByRole("button", { name: "Cancel", exact: true }).click().catch(() => {});
    throw new Error(`Edit dialog refused the rename: ${msg || "stayed open"}`);
  }
}

/** Drag a row (by its "Move" handle) onto another row or the "top level" drop zone. */
export async function dragTarget(p, name, ontoText) {
  const h = p.getByRole("button", { name: `Move ${name}`, exact: true });
  await h.scrollIntoViewIfNeeded();
  const s = await h.boundingBox();
  await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(300);
  await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2 + 12, { steps: 4 });
  await p.waitForTimeout(200);
  const dst = p.locator("main").getByText(ontoText, { exact: true }).first();
  await dst.scrollIntoViewIfNeeded().catch(() => {});
  const d = await dst.boundingBox();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(s.x + s.width / 2 + ((d.x + 20 - s.x) * i) / steps, s.y + s.height / 2 + ((d.y + d.height / 2 - s.y - s.height / 2) * i) / steps);
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(500);
}

/** Un-nest a row one level: drag it left (pointer DnD, "drag left/right changes depth"). */
export async function dragLeft(p, name, dx = 90) {
  const h = p.getByRole("button", { name: `Move ${name}`, exact: true });
  await h.scrollIntoViewIfNeeded();
  const s = await h.boundingBox();
  const x = s.x + s.width / 2;
  const y = s.y + s.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.waitForTimeout(300);
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(x - (dx * i) / 12, y + 2);
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(500);
}

export async function nodeByName(ctx, name) {
  const r = await ctx.sql("select id, deleted_at from entities where kind = 'target-nodes' and payload->>'name' = $1 order by deleted_at nulls first", [name]);
  return r[0] || null;
}
export async function membersOf(ctx, groupId, month = "2026-09") {
  const r = await ctx.sql(
    "select n.payload->>'name' as name from entities m join entities n on n.kind = 'target-nodes' and n.id = m.payload->>'memberId' where m.kind = 'target-members' and m.deleted_at is null and m.payload->>'groupId' = $1 and m.payload->>'month' = $2 order by 1",
    [groupId, month],
  );
  return r.map((x) => x.name);
}
export async function rootOrder(ctx, month = "2026-09") {
  const r = await ctx.sql("select payload from entities where kind = 'target-root-order' and id = $1 and deleted_at is null", [month]);
  return r[0]?.payload?.value || [];
}
/** Names with a "Move" handle on screen, in order. */
export async function shownTargets(p) {
  return p.evaluate(() => [...document.querySelectorAll("main button[aria-label^='Move ']")].map((b) => b.getAttribute("aria-label").slice(5)));
}
/** "roll up · N nested" count for a group row. */
export async function nestedCount(p, name) {
  const t = await targetRow(p, name).innerText().catch(() => "");
  const m = t.match(/(\d+) nested/);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// New target · New group (members) · group 2 keeps group 1 · rename · ungroup by drag · delete
// ---------------------------------------------------------------------------
export async function targetsGroups(ctx, run) {
  const R = new ScreenResult("Targets", "targets-groups", "New target · New group with members · second group keeps the first · Switch to set floors · remove member · delete group");
  const { A, B, C } = ctx;
  const m0 = await openWithoutWrites(ctx, R, "the Targets month page (groups)", (p) => openTargetMonth(ctx, p));
  const tag = run.slice(-5);
  const A1 = `E2E A1 ${tag}`, A2 = `E2E A2 ${tag}`, B1 = `E2E B1 ${tag}`, B2 = `E2E B2 ${tag}`;
  const G1 = `E2E G1 ${tag}`, G2 = `E2E G2 ${tag}`, G1b = `E2E G1 renamed ${tag}`;

  // Check 1: A and B create different targets at the same time.
  await Promise.all([(async () => { await newTarget(A, A1); await newTarget(A, A2); })(), (async () => { await newTarget(B, B1); await newTarget(B, B2); })()]);
  await ctx.settled(A);
  await ctx.settled(B);
  const ids = {};
  for (const n of [A1, A2, B1, B2]) ids[n] = (await nodeByName(ctx, n))?.id;
  const root1 = await rootOrder(ctx);
  const cAll = await ctx.waitUntil(async () => { const s = await shownTargets(C); return [A1, A2, B1, B2].every((n) => s.includes(n)); }, 8000);
  R.expect(1, [A1, A2, B1, B2].every((n) => ids[n] && root1.includes(ids[n])), `DB: 4 targets created and on September ${[A1, A2, B1, B2].map((n) => (ids[n] && root1.includes(ids[n]) ? "✓" : "✗")).join("")}; C listed all ${cAll === null ? "no" : `in ${(cAll / 1000).toFixed(1)} s`}`);

  // Group 1 by A, then group 2 by B with other members: group 1 must stay intact.
  await newGroup(A, G1, [A1, A2]);
  await ctx.settled(A);
  await ctx.waitUntil(async () => (await shownTargets(B)).includes(G1), 8000);
  await newGroup(B, G2, [B1, B2]);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const g1 = (await nodeByName(ctx, G1))?.id;
  const g2 = (await nodeByName(ctx, G2))?.id;
  const m1 = await membersOf(ctx, g1);
  const m2 = await membersOf(ctx, g2);
  const root2 = await rootOrder(ctx);
  const g1ok = JSON.stringify(m1) === JSON.stringify([A1, A2].sort()) && JSON.stringify(m2) === JSON.stringify([B1, B2].sort()) && root2.includes(g1) && root2.includes(g2) && ![ids[A1], ids[A2], ids[B1], ids[B2]].some((x) => root2.includes(x));
  const cNest = await ctx.waitUntil(async () => (await nestedCount(C, G1)) === 2 && (await nestedCount(C, G2)) === 2, 8000);
  R.note(`group 1 then group 2: DB G1 = ${m1.join(", ")}; G2 = ${m2.join(", ")}; both groups top level, members nested: ${g1ok}; C shows 2 + 2 nested: ${cNest !== null}`);
  if (!g1ok) R.fail(1, `group 2 did not leave group 1 intact: G1 ${m1.join(", ")}; G2 ${m2.join(", ")}; root ${root2.length}`);

  // Check 2 + 3: same group: A switches G1 to "set floors" while B drags A2 out to the top level; C idle.
  const switchFloors = async (p) => {
    await targetRow(p, G1).getByRole("button", { name: "Switch to set floors" }).first().click();
    await p.waitForTimeout(300);
    const conf = p.locator("div.fixed.inset-0 button", { hasText: /^(Switch|Set floors|Yes)/ }).last();
    if (await conf.count()) await conf.click();
  };
  // B removes member A2 from G1 (row Delete: off the group and the month).
  const OUT = A2;
  const STAY = A1;
  await Promise.all([switchFloors(A), rowDelete(B, OUT)]);
  const t0 = Date.now();
  const setMode = async (p) => (await targetRow(p, G1).locator('input[aria-label="Value"]').count()) > 0;
  const shows = async (p) => (await nestedCount(p, G1)) === 1 && (await nestedCount(p, G2)) === 2 && (await setMode(p));
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const g1cell = (await cellRow(ctx, g1))?.payload;
  const m1b = await membersOf(ctx, g1);
  const root3 = await rootOrder(ctx);
  const aT = await ctx.waitUntil(() => shows(A), 5000);
  const bT = await ctx.waitUntil(() => shows(B), 5000);
  const outIn = await inMonth(ctx, ids[OUT]);
  R.expect(2, g1cell?.mode === "set" && JSON.stringify(m1b) === JSON.stringify([STAY]) && !outIn && aT !== null && bT !== null, `DB: G1 mode ${g1cell?.mode}, members ${m1b.join(", ") || "-"}, ${OUT} removed ${!outIn}; A shows both ${aT !== null}, B shows both ${bT !== null}`);
  void root3;
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show set floors + removal within 12 s (nested ${await nestedCount(C, G1)}, set mode ${await setMode(C)})` : `C showed both ${(tC / 1000).toFixed(1)} s after`);

  // Check 4: A deletes group 2; B (feed held) still sees it and renames it.
  await ctx.holdFeed(B, /\/api\/(target-cells|e\/target)/);
  await targetRow(A, G2).getByRole("button", { name: "Delete", exact: true }).first().click();
  await A.waitForTimeout(400);
  const conf = A.locator("div.fixed.inset-0 button", { hasText: /^Delete/ }).last();
  if (await conf.count()) await conf.click();
  await ctx.sleep(1500);
  const g2In = await inMonth(ctx, g2);
  const bStill = (await shownTargets(B)).includes(G2);
  let err = "";
  try { await setCell(B, B1, 0, 777000); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const g2After = await inMonth(ctx, g2);
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openTargetMonth(ctx, p);
    const s = await shownTargets(p);
    shown.push(s.includes(G2) || s.includes(`STALE ${tag}`) ? 1 : 0);
  }
  R.expect(4, !g2In && bStill && !g2After && shown.every((n) => n === 0), `A's delete: G2 off September ${!g2In}; B still saw it ${bStill}; after B's stale edit of a G2 member's actual${err ? " (" + err + ")" : ""} still off ${!g2After}; shown after reload A/B/C ${shown.join("/")}`);

  // Check 5: after reload the tree on every screen = DB (names shown, G1 nested count).
  const root = await rootOrder(ctx);
  const liveNames = [];
  for (const id of root) {
    const n = (await ctx.sql("select payload->>'name' as n from entities where kind = 'target-nodes' and id = $1", [id]))[0]?.n;
    if (n) liveNames.push(n);
  }
  const g1m = await membersOf(ctx, g1);
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    const s = await shownTargets(p);
    const missing = liveNames.filter((n) => !s.includes(n));
    const nc = await nestedCount(p, G1);
    if (missing.length || nc !== g1m.length) bad.push(`${t}: missing ${missing.join("/") || "-"}, G1 nested ${nc} vs DB ${g1m.length}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `top-level targets and G1 members on all screens = DB (${liveNames.length} top level, G1 ${g1m.length})`);
  void G1b;
  await endChecks(ctx, R, m0);
  return R;
}
