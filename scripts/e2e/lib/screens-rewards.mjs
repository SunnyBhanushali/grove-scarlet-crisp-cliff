/**
 * Rewards screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * Data: the imported seed (fresh database), September 2026:
 *   open plans   — Rohan Jadhav, Nevil Prajapati
 *   locked plans — Sachin Yadav, Vikas Kumar, Sunny Kumar, Aman Vishwakarma, …
 */
import { ScreenResult } from "./harness.mjs";
import {
  openPerson, textareaAfter, setInput, kpiWeight, rowWith, pageHas, statusBadge, notesValue, actualInputs, closePlan,
  openPlansList, expandMonth, monthButton, personRow, deleteFromList, addPeople, sectionTextarea,
} from "./plan-page.mjs";
import { monthRecord, openWithoutWrites, endChecks, staleDeleteCheck, apmsMonthList } from "./screens-apms.mjs";

const SEP = "September 2026";
export const RP = {
  rohan: { name: "Rohan Jadhav", month: SEP, id: "p-1788353125641-e4k6ut", period: "2026-09" },
  nevil: { name: "Nevil Prajapati", month: SEP, id: "p-1788353125697-i2ke0d", period: "2026-09" },
  sachin: { name: "Sachin Yadav", month: SEP, id: "p-1788353125644-1y98s3", period: "2026-09" },
  vikas: { name: "Vikas Kumar", month: SEP, id: "p-1788353125592-43ge5h", period: "2026-09" },
  sunny: { name: "Sunny Kumar", month: SEP, id: "p-1788353125590-0pnuk9", period: "2026-09" },
  aman: { name: "Aman Vishwakarma", month: SEP, id: "p-1788353125629-20nz92", period: "2026-09" },
  priti: { name: "Priti Thombre", month: SEP, id: "p-1788353125711-l81nj2", period: "2026-09" },
  // August 2026 has ended: its targets month (and so these plans) can be closed.
  sunnyAug: { name: "Sunny Kumar", month: "August 2026", id: "p-1788353125590-0pnuk9", period: "2026-08" },
  vikasAug: { name: "Vikas Kumar", month: "August 2026", id: "p-1788353125592-43ge5h", period: "2026-08" },
};
const rec = async (ctx, who) => (await monthRecord(ctx, who, "reward_records"))?.payload;

function kraWeight(r, name) {
  for (const b of r?.brands || []) for (const k of b.kras || []) if (k.name === name) return k.weight;
  return undefined;
}
function flag(r, name) {
  return (r?.rewardFlags || []).find((f) => f.name === name);
}
export function targetSelect(p) {
  return p.locator("xpath=//main//*[normalize-space(text())='Unlock against']/following::select[1]").first();
}
/** The KRA header row (badge "KRA" + name), not a KPI that has the same name. */
/** The linked target's name as the screen shows it (select on open plans, text on locked ones). */
export async function targetName(p) {
  const sel = targetSelect(p);
  if (await sel.count()) {
    const t = await sel.evaluate((e) => (e.selectedOptions[0] ? e.selectedOptions[0].textContent : ""));
    return t.split(">").pop().trim();
  }
  const text = await p.locator("main").innerText();
  const m = text.match(/Unlock against\n[\s\S]*?Numbers live in Targets\.\n+([^\n]+)/);
  return m ? m[1].split(">").pop().trim() : null;
}
async function nodeName(ctx, id) {
  const r = await ctx.sql("select payload->>'name' as name from entities where kind = 'target-nodes' and id = $1", [id]);
  return r[0] ? String(r[0].name || "").split(">").pop().trim() : null;
}

export async function kraWeightInput(p, kraName) {
  return p
    .locator("main div")
    .filter({ has: p.getByText("KRA", { exact: true }) })
    .filter({ has: p.getByText(kraName, { exact: true }) })
    .filter({ has: p.locator('input[aria-label="Weightage %"]') })
    .last()
    .locator('input[aria-label="Weightage %"]')
    .first();
}
export async function flagBox(p, name) {
  return rowWith(p, name, 'input[type="checkbox"]').locator('input[type="checkbox"]').first();
}

// ---------------------------------------------------------------------------
// Rewards person page, open plan: target link · KPI structure · disqualifiers · notes
// ---------------------------------------------------------------------------
export async function rewardsPlanOpen(ctx, run) {
  const R = new ScreenResult("Rewards", "rewards-plan-open", "Person page, open plan: Unlock against (target link) · KPI structure · Disqualifiers · Manager notes");
  const { A, B, C } = ctx;
  const X = RP.rohan;
  const Y = RP.nevil;
  const m0 = await openWithoutWrites(ctx, R, "an open Rewards plan", (p) => openPerson(ctx, p, "rewards", X.name, X.month));

  // Pick a target the plan is not linked to yet.
  const opts = await targetSelect(A).locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })).filter((o) => o.v));
  const cur = await targetSelect(A).inputValue();
  const pick = opts.find((o) => o.v !== cur && /Bandra|Pune|Goa/.test(o.t)) || opts.find((o) => o.v !== cur);
  const notesB = `E2E-B reward notes ${run}`;
  const t0 = Date.now();
  await Promise.all([
    (async () => {
      await targetSelect(A).selectOption(pick.v);
      await setInput(A, await kraWeightInput(A, "Art Score"), 50);
      await setInput(A, await kraWeightInput(A, "Studio Audit + Mystery Audit"), 30);
    })(),
    (async () => {
      const bx = await flagBox(B, "Warning Letter Issued");
      await bx.scrollIntoViewIfNeeded();
      await bx.click();
      await setInput(B, textareaAfter(B, "Manager notes"), notesB);
    })(),
  ]);
  const shows = async (p) =>
    (await targetSelect(p).inputValue()) === pick.v &&
    (await (await kraWeightInput(p, "Art Score")).inputValue()) === "50" &&
    (await (await kraWeightInput(p, "Studio Audit + Mystery Audit")).inputValue()) === "30" &&
    (await (await flagBox(p, "Warning Letter Issued")).isChecked()) &&
    (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const r = await rec(ctx, X);
  const dbOk = r?.targetNodeId && pick.v.endsWith(r.targetNodeId) && kraWeight(r, "Art Score") === 0.5 && kraWeight(r, "Studio Audit + Mystery Audit") === 0.3 && flag(r, "Warning Letter Issued")?.on === true && r?.notes === notesB;
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, dbOk && abOk, `DB target ${r?.targetNodeId} (picked ${pick.t}), weights ${kraWeight(r, "Art Score")}/${kraWeight(r, "Studio Audit + Mystery Audit")}, disqualifier ${flag(r, "Warning Letter Issued")?.on}, notes ${r?.notes === notesB}; A and B screens show both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? "C did not show both edits within 12 s" : `C showed both ${(tC / 1000).toFixed(1)} s after the edit`);

  // Check 1: A edits Rohan's notes, B edits Nevil's notes.
  await openPerson(ctx, B, "rewards", Y.name, Y.month);
  const nA = `E2E-A ${X.name} ${run}`;
  const nB = `E2E-B ${Y.name} ${run}`;
  await Promise.all([setInput(A, textareaAfter(A, "Manager notes"), nA), setInput(B, textareaAfter(B, "Manager notes"), nB)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const rx = await rec(ctx, X);
  const ry = await rec(ctx, Y);
  const cX = await ctx.waitUntil(async () => (await notesValue(C)) === nA, 5000);
  R.expect(1, rx?.notes === nA && ry?.notes === nB && kraWeight(rx, "Art Score") === 0.5, `DB: Rohan notes ${rx?.notes === nA}, Nevil notes ${ry?.notes === nB}, Rohan keeps A's weight ${kraWeight(rx, "Art Score") === 0.5}; C saw Rohan ${cX === null ? "no" : `in ${(cX / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes Nevil's plan; B (stale) ticks a disqualifier on it.
  await staleDeleteCheck(ctx, R, "rewards", Y, async (p) => {
    const bx = await flagBox(p, "Warning Letter Issued");
    await bx.scrollIntoViewIfNeeded();
    await bx.click();
  }, "reward_records");

  // Check 5: reload; all three screens = DB for Rohan.
  const rr = await rec(ctx, X);
  const want = [rr?.targetNodeId, String(Math.round((kraWeight(rr, "Art Score") || 0) * 100)), String(Math.round((kraWeight(rr, "Studio Audit + Mystery Audit") || 0) * 100)), !!flag(rr, "Warning Letter Issued")?.on, rr?.notes || ""].join("|");
  const got = [];
  for (const p of [A, B, C]) {
    await openPerson(ctx, p, "rewards", X.name, X.month);
    const tv = await targetSelect(p).inputValue();
    got.push([tv.replace(/^node:/, ""), await (await kraWeightInput(p, "Art Score")).inputValue(), await (await kraWeightInput(p, "Studio Audit + Mystery Audit")).inputValue(), await (await flagBox(p, "Warning Letter Issued")).isChecked(), await notesValue(p)].join("|"));
  }
  R.expect(5, got.every((g) => g === want), `DB ${want}; screens ${got.map((g) => (g === want ? "same" : g)).join(" / ")}`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Rewards lock / unlock
// ---------------------------------------------------------------------------
export async function rewardsLockUnlock(ctx, run) {
  const R = new ScreenResult("Rewards", "rewards-lock-close", "Lock plan · locked plan: Month-end actuals · Close plan");
  const { A, B, C } = ctx;
  const X = RP.rohan;
  const U1 = RP.sunnyAug;
  const U2 = RP.vikasAug;
  const m0 = await openWithoutWrites(ctx, R, "an open Rewards plan (lock)", (p) => openPerson(ctx, p, "rewards", X.name, X.month));

  // Check 2 + 3: A locks Rohan while B writes its notes; C idle.
  const notesB = `E2E-B lock ${run}`;
  const t0 = Date.now();
  await Promise.all([
    (async () => {
      const b = A.locator("main").getByRole("button", { name: "Lock plan", exact: true }).last();
      await b.scrollIntoViewIfNeeded();
      await b.click();
    })(),
    setInput(B, textareaAfter(B, "Manager notes"), notesB),
  ]);
  const shows = async (p) => (await statusBadge(p)) === "Plan locked" && (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  const cState = `badge ${await statusBadge(C)}, notes ${(await notesValue(C)) === notesB}`;
  await ctx.settled(A);
  await ctx.settled(B);
  const rl = await rec(ctx, X);
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  const lockMsg = A.__dialogs.slice(-1)[0]?.msg || "";
  R.expect(2, rl?.status === "plan_locked" && rl?.notes === notesB && abOk, `DB status ${rl?.status}, notes ${rl?.notes === notesB}; A and B show both: ${abOk}${lockMsg ? "; alert: " + lockMsg : ""}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show lock + notes within 12 s (${cState})` : `C showed lock + notes ${(tC / 1000).toFixed(1)} s after the click`);

  // Check 1: locked plans, different records at the same time: A enters every
  // month-end actual on Sunny and closes it, B does the same on Aman; C watches Sunny.
  await Promise.all([openPerson(ctx, A, "rewards", U1.name, U1.month), openPerson(ctx, B, "rewards", U2.name, U2.month), openPerson(ctx, C, "rewards", U1.name, U1.month)]);
  const fill = async (p, base) => {
    const n = await actualInputs(p).count();
    for (let i = 0; i < n; i++) await setInput(p, actualInputs(p).nth(i), base + i);
    await ctx.settled(p);
  };
  await Promise.all([fill(A, 4), fill(B, 85)]);
  // Closing a Rewards plan first asks for the month's target actuals ("Close
  // Targets · September 2026"); A enters them there, then B's close goes straight through.
  const closeRewards = async (p, base) => {
    let red = await closePlan(p);
    const d = p.locator("div.fixed.inset-0").filter({ hasText: /^Close Targets/ }).last();
    if (await d.count()) {
      const ins = d.locator("input");
      const k = await ins.count();
      for (let i = 0; i < k; i++) {
        await ins.nth(i).fill(String(base + i));
        await ins.nth(i).press("Tab");
      }
      await d.getByRole("button", { name: /^Close (targets|plan)$/ }).click();
      await p.waitForTimeout(800);
      const left = p.locator("div.fixed.inset-0").filter({ hasText: /^Close Targets/ });
      if (await left.count()) red = (await left.last().innerText()).split("\n").filter((l) => /enter|need|must/i.test(l)).join(" · ") || "Close Targets dialog stayed open";
    }
    await ctx.settled(p);
    return red;
  };
  const redA = await closeRewards(A, 4500000);
  const redB = await closeRewards(B, 4600000);
  await ctx.settled(A);
  await ctx.settled(B);
  const r1 = await rec(ctx, U1);
  const r2 = await rec(ctx, U2);
  const a1 = (r1?.brands?.[0]?.kras || []).flatMap((k) => k.kpis || []).map((k) => k.achieved);
  const a2 = (r2?.brands?.[0]?.kras || []).flatMap((k) => k.kpis || []).map((k) => k.achieved);
  const cU = await ctx.waitUntil(async () => (await statusBadge(C)) === "Closed", 5000);
  R.expect(1, r1?.status === "closed" && r2?.status === "closed" && a1.every((x) => x != null) && a2.every((x) => x != null),
    `DB: ${U1.name} ${U1.month} ${r1?.status} actuals ${a1.join("/")}${redA ? " (A: " + redA + ")" : ""}; ${U2.name} ${r2?.status} actuals ${a2.join("/")}${redB ? " (B: " + redB + ")" : ""}; C saw ${U1.name} closed ${cU === null ? `no (${await statusBadge(C)})` : `in ${(cU / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes Priti's plan; B (stale) presses Unlock on it.
  await staleDeleteCheck(ctx, R, "rewards", RP.priti, async (p) => setInput(p, actualInputs(p).nth(0), 3), "reward_records");

  // Check 5
  const label = { plan_open: "Plan open", plan_locked: "Plan locked", closed: "Closed" };
  const labelFor = (st, period) => (st === "plan_locked" && period < "2026-09" ? "Closure pending" : label[st] || st);
  void run;
  const bad = [];
  const want = {};
  for (const w of [X, U1, U2]) want[w.id + w.period] = labelFor((await rec(ctx, w))?.status, w.period);
  for (const [t, p] of Object.entries({ A, B, C })) {
    for (const w of [X, U1, U2]) {
      await openPerson(ctx, p, "rewards", w.name, w.month);
      const b = await statusBadge(p);
      if (b !== want[w.id + w.period]) bad.push(`${t} ${w.name} ${w.month}: screen ${b}, DB ${want[w.id + w.period]}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `statuses agree: ${Object.values(want).join(", ")}`);
  await endChecks(ctx, R, m0);
  return R;
}

export async function rewardsMonthList(ctx, run) {
  return apmsMonthList(ctx, run, "rewards");
}

/** Rewards month list → Mass update: tick `names`, pick the target labelled `target`, Update. */
export async function massUpdate(p, monthLabel, names, target) {
  await expandMonth(p, monthLabel);
  const grp = monthButton(p, monthLabel).locator("xpath=..");
  const mu = grp.getByRole("button", { name: "Mass update" });
  await mu.click();
  await p.waitForTimeout(400);
  for (const name of names) {
    const row = personRow(p, name, monthLabel).locator("xpath=..");
    await row.locator('input[type="checkbox"]').first().check();
  }
  await mu.click();
  await p.waitForTimeout(500);
  const d = p.locator("div.fixed.inset-0").filter({ hasText: /^Mass update/ }).last();
  await d.locator("select").selectOption({ label: target });
  await d.getByRole("button", { name: /^Update \d+/ }).click();
  await p.waitForTimeout(600);
}

async function nodeIdFor(ctx, label) {
  const rows = await ctx.sql("select id, payload->>'name' as name from entities where kind = 'target-nodes' and deleted_at is null");
  const last = label.split(">").pop().trim();
  const hit = rows.find((r) => (r.name || "").trim() === last);
  return hit ? hit.id : null;
}

// ---------------------------------------------------------------------------
// Rewards month list → Mass update (target for many people)
// ---------------------------------------------------------------------------
export async function rewardsMassUpdate(ctx, run) {
  const R = new ScreenResult("Rewards", "rewards-mass-update", "Month list → Mass update (Unlock against for several people)");
  const { A, B, C } = ctx;
  const aman = RP.aman;
  const m0 = await openWithoutWrites(ctx, R, "the Rewards month list (mass update)", async (p) => {
    await openPlansList(ctx, p, "rewards");
    await expandMonth(p, SEP);
  });

  // Check 2 + 3: A mass-updates Aman + Bhupendra to Goa while B writes Aman's notes on his page; C idle on Aman.
  await openPerson(ctx, B, "rewards", aman.name, aman.month);
  await openPerson(ctx, C, "rewards", aman.name, aman.month);
  const goa = await nodeIdFor(ctx, "Goa");
  const notesB = `E2E-B mass notes ${run}`;
  await Promise.all([
    massUpdate(A, SEP, [aman.name, "Bhupendra Kumar"], "Goa"),
    setInput(B, textareaAfter(B, "Manager notes"), notesB),
  ]);
  const t0 = Date.now();
  const shows = async (p) => (await targetName(p)) === "Goa" && (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const ra = await rec(ctx, aman);
  const rb = (await monthRecord(ctx, { id: "p-1788353125597-7aas1e", period: "2026-09" }, "reward_records"))?.payload;
  const bOk = (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, ra?.targetNodeId === goa && rb?.targetNodeId === goa && ra?.notes === notesB && bOk, `DB: Aman target ${ra?.targetNodeId === goa ? "Goa" : ra?.targetNodeId}, notes ${ra?.notes === notesB}; Bhupendra target ${rb?.targetNodeId === goa ? "Goa" : rb?.targetNodeId}; B's screen shows both: ${bOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? "C did not show target + notes within 12 s" : `C showed target + notes ${(tC / 1000).toFixed(1)} s after the update`);

  // Check 1: A mass-updates Biri + Dinesh to Pune while B mass-updates Gaurav + Grishita to Delhi.
  await openPlansList(ctx, B, "rewards");
  const pune = await nodeIdFor(ctx, "Pune");
  const delhi = await nodeIdFor(ctx, "Delhi");
  await Promise.all([
    massUpdate(A, SEP, ["Biri tahu", "Dinesh Murkar"], "Pune"),
    massUpdate(B, SEP, ["Gaurav Mokale", "Grishita Suthar"], "Delhi"),
  ]);
  await ctx.settled(A);
  await ctx.settled(B);
  const tgt = async (name) => (await ctx.sql("select r.payload->>'targetNodeId' t from reward_records r join people p on p.id = r.person_id where p.payload->>'name' = $1 and r.period = '2026-09'", [name]))[0]?.t;
  const got1 = { biri: await tgt("Biri tahu"), dinesh: await tgt("Dinesh Murkar"), gaurav: await tgt("Gaurav Mokale"), grishita: await tgt("Grishita Suthar") };
  R.expect(1, got1.biri === pune && got1.dinesh === pune && got1.gaurav === delhi && got1.grishita === delhi && (await tgt(aman.name)) === goa,
    `DB: Biri ${got1.biri === pune}, Dinesh ${got1.dinesh === pune} (Pune); Gaurav ${got1.gaurav === delhi}, Grishita ${got1.grishita === delhi} (Delhi); Aman still Goa ${(await tgt(aman.name)) === goa}`);

  // Check 4: A deletes Priti from the list; B (stale list) mass-updates her target.
  const W = RP.priti;
  await openPlansList(ctx, B, "rewards");
  await expandMonth(B, SEP);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await ctx.holdFeed(B, new RegExp(`/api/reward-records/${esc(W.period)}(/${esc(W.id)})?([?]|$)`));
  await openPlansList(ctx, A, "rewards");
  await deleteFromList(A, W.name, W.month);
  await ctx.sleep(1500);
  const afterDel = await monthRecord(ctx, W, "reward_records");
  const bStill = (await personRow(B, W.name, W.month).count()) > 0;
  let err = "";
  try { await massUpdate(B, SEP, [W.name], "Goa"); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const afterStale = await monthRecord(ctx, W, "reward_records");
  await ctx.reloadAll();
  const listed = [];
  for (const p of [A, B, C]) {
    await openPlansList(ctx, p, "rewards");
    await expandMonth(p, SEP);
    listed.push(await personRow(p, W.name, W.month).count());
  }
  R.expect(4, !!afterDel?.deleted_at && bStill && !!afterStale?.deleted_at && listed.every((n) => n === 0),
    `A's delete in DB ${!!afterDel?.deleted_at}; B still listed it ${bStill}; after B's stale mass update${err ? " (" + err + ")" : ""} still deleted ${!!afterStale?.deleted_at}; listed after reload A/B/C ${listed.join("/")}`);

  // Check 5: every touched person's target on all three screens = DB.
  const names = [aman.name, "Bhupendra Kumar", "Biri tahu", "Dinesh Murkar", "Gaurav Mokale", "Grishita Suthar"];
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    for (const n of names.slice(0, 3)) {
      await openPerson(ctx, p, "rewards", n, SEP);
      const v = await targetName(p);
      const w = await nodeName(ctx, await tgt(n));
      if (v !== w) bad.push(`${t} ${n}: screen ${v}, DB ${w}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : "targets on screen = DB for the people checked (A, B, C)");
  await endChecks(ctx, R, m0);
  return R;
}

/** "My rewards" month cell (e.g. "Sep") as shown: "—" when there is no plan. */
export async function myMonthCell(p, mon) {
  const b = p.locator("main button", { hasText: new RegExp(`^${mon}(?![a-z])`) }).first();
  if (!(await b.count())) return null;
  const t = (await b.innerText()).split("\n").map((x) => x.trim()).filter(Boolean);
  return t.slice(1).join(" ");
}

// ---------------------------------------------------------------------------
// My rewards (C's own view) + Self comments (C) vs Manager notes (B)
// ---------------------------------------------------------------------------
export async function rewardsMyRewards(ctx, run, kind = "rewards") {
  const isR = kind === "rewards";
  const table = isR ? "reward_records" : "month_records";
  const R = new ScreenResult(isR ? "Rewards" : "APMS", isR ? "rewards-my-rewards" : "apms-self-comments",
    isR ? "My rewards · Self comments (employee) vs Manager notes" : "Self comments (employee) vs Manager notes");
  const { A, B, C } = ctx;
  const cMe = { name: "Ronlind Menezes", month: SEP, id: "p-1788156420676", period: "2026-09" };
  // B adds someone else at the same time (the picker does not list the signed-in user).
  const bMe = { name: "Siddhesh Gawde", month: isR ? "August 2026" : "July 2026", id: "p-1788353125607-dh3zfb", period: isR ? "2026-08" : "2026-07" };
  const myView = async (p) => (isR ? ctx.nav(p, "Rewards", "My rewards") : ctx.nav(p, "APMS", "My APMS"));
  const m0 = await openWithoutWrites(ctx, R, isR ? "My rewards" : "My APMS", myView);

  // Check 1: A adds C (Ronlind) to September while B adds Siddhesh to another month.
  await openPlansList(ctx, A, kind);
  await openPlansList(ctx, B, kind);
  await Promise.all([addPeople(A, SEP, [cMe.name]), addPeople(B, bMe.month, [bMe.name])]);
  const t1 = Date.now();
  await ctx.settled(A);
  await ctx.settled(B);
  const rc = await monthRecord(ctx, cMe, table);
  const rbm = await monthRecord(ctx, bMe, table);
  const cSees = isR ? await ctx.waitUntil(async () => (await myMonthCell(C, "Sep")) !== "—", 8000) : null;
  R.expect(1, !!rc && !rc.deleted_at && !!rbm && !rbm.deleted_at, `DB: ${cMe.name} ${cMe.month} ${rc && !rc.deleted_at ? "created" : "missing"}, ${bMe.name} ${bMe.month} ${rbm && !rbm.deleted_at ? "created" : "missing"}${isR ? `; C's My rewards showed September ${cSees === null ? "no" : `in ${((Date.now() - t1 - 0) / 1000).toFixed(1)} s`}` : ""}`);

  // Check 2 + 3: C writes Self comments on his own plan while B writes Manager notes on it; A idle on it.
  if (isR) {
    await C.locator("main button", { hasText: /^Sep(?![a-z])/ }).first().click();
    await C.waitForTimeout(1200);
  } else {
    await openPerson(ctx, C, kind, cMe.name, cMe.month).catch(async () => {
      // An employee reaches his own plan from My APMS.
      await myView(C);
      await C.locator("main").getByText("September 2026").first().click();
      await C.waitForTimeout(1200);
    });
  }
  await openPerson(ctx, B, kind, cMe.name, cMe.month);
  await openPerson(ctx, A, kind, cMe.name, cMe.month);
  const selfC = `E2E-C self ${run}`;
  const notesB = `E2E-B mgr ${run}`;
  await Promise.all([setInput(C, sectionTextarea(C, "Self comments"), selfC), setInput(B, textareaAfter(B, "Manager notes"), notesB)]);
  const t0 = Date.now();
  const shows = async (p) => (await notesValue(p, "Self comments")) === selfC && (await notesValue(p, "Manager notes")) === notesB;
  const aSeen = await ctx.waitUntil(() => shows(A), 12000);
  const tA = aSeen === null ? null : Date.now() - t0;
  await ctx.settled(B);
  await ctx.settled(C);
  const r2 = (await monthRecord(ctx, cMe, table))?.payload;
  const bcOk = (await ctx.waitUntil(() => shows(B), 5000)) !== null && (await ctx.waitUntil(() => shows(C), 5000)) !== null;
  R.expect(2, r2?.selfNotes === selfC && r2?.notes === notesB && bcOk, `DB selfNotes ${r2?.selfNotes === selfC}, notes ${r2?.notes === notesB}; B and C screens show both: ${bcOk}`);
  R.expect(3, tA !== null && tA <= 5000, tA === null ? `A did not show both within 12 s (self "${await notesValue(A, "Self comments")}", mgr "${await notesValue(A, "Manager notes")}")` : `A (idle) showed both ${(tA / 1000).toFixed(1)} s after the edits`);

  // Check 4: A deletes C's September plan from the list; B (stale) edits its notes.
  await staleDeleteCheck(ctx, R, kind, cMe, async (p) => setInput(p, textareaAfter(p, "Manager notes"), `STALE ${run}`), table, async (a) => {
    await openPlansList(ctx, a, kind);
    await deleteFromList(a, cMe.name, cMe.month);
  });

  // Check 5: after reload, C's own view and the DB agree.
  const live = await monthRecord(ctx, cMe, table);
  let detail = `DB: ${cMe.name} September ${live?.deleted_at ? "deleted" : "live"}`;
  let ok = !!live?.deleted_at;
  if (isR) {
    await myView(C);
    const cell = await myMonthCell(C, "Sep");
    ok = ok && cell === "—";
    detail += `; C's My rewards September "${cell}"`;
  }
  R.expect(5, ok, detail);
  await endChecks(ctx, R, m0);
  return R;
}

export async function apmsSelfComments(ctx, run) {
  return rewardsMyRewards(ctx, run, "apms");
}
