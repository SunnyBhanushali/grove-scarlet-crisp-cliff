/**
 * APMS screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * Data: the imported seed (fresh database). Person-months used:
 *   open plans   — Fawaz Ghansar July 2026, Ameesha Karnani September 2026
 *   locked plans — Allan Gois / Fawaz Ghansar / Hetal Soni September 2026
 */
import { ScreenResult, realWrites, brief } from "./harness.mjs";
import {
  openPerson, openPlansList, expandMonth, personRow, textareaAfter, setInput, kpiWeight, behaviourBox,
  addPriority, deletePersonMonth, pageHas, actualInputs, execSelects, scoreButton, scoreSelected, headerButton,
  statusBadge, closePlan, fillAllScores, prepareClose, notesValue, addPeople, deleteFromList, listedNames, dragOnto, screenOrder,
} from "./plan-page.mjs";

export const P = {
  fawazJul: { name: "Fawaz Ghansar", month: "July 2026", id: "p-1788172782481", period: "2026-07" },
  ameeshaSep: { name: "Ameesha Karnani", month: "September 2026", id: "p-1788350343290-pr5i2g", period: "2026-09" },
  allanSep: { name: "Allan Gois", month: "September 2026", id: "p-1787993618279", period: "2026-09" },
  fawazSep: { name: "Fawaz Ghansar", month: "September 2026", id: "p-1788172782481", period: "2026-09" },
  hetalSep: { name: "Hetal Soni", month: "September 2026", id: "p-1788171165466", period: "2026-09" },
  sohamSep: { name: "Soham Devasar", month: "September 2026", id: "p-1788170412177", period: "2026-09" },
  pritamSep: { name: "Pritam Borkar", month: "September 2026", id: "p-1788170992431", period: "2026-09" },
  hensonSep: { name: "Henson Sequeira", month: "September 2026", id: "p-1788171472216", period: "2026-09" },
  deeptiSep: { name: "Deepti solanki", month: "September 2026", id: "p-1788171322672", period: "2026-09" },
};

export async function monthRecord(ctx, who, table = "month_records") {
  const rows = await ctx.sql(`select payload, rev, deleted_at from ${table} where person_id = $1 and period = $2`, [who.id, who.period]);
  return rows[0] || null;
}

export function findKpi(rec, name) {
  for (const b of rec?.brands || []) for (const k of b.kras || []) for (const kpi of k.kpis || []) if (kpi.name === name) return kpi;
  for (const k of rec?.kras || []) for (const kpi of k.kpis || []) if (kpi.name === name) return kpi;
  return null;
}

export function findBehaviour(rec, name) {
  for (const v of rec?.values || []) for (const b of v.behaviours || []) if (b.name === name) return b;
  return null;
}

/**
 * The SPA raises month reminders (plan_due / plan_late / month_close_due) on
 * its own when a month passes; the first screen that notices creates it. That
 * is a new notice, not a re-save of data on screen, and it is reported apart.
 */
export function isAutoReminder(n) {
  if (!/^\/api\/e\/notices\//.test(n.u) || n.m !== "PATCH") return false;
  try {
    const body = JSON.parse(n.req);
    return body.baseRev === 0 && /^(plan_due|plan_late|month_close_due)$/.test(body.payload?.kind || "");
  } catch {
    return /"baseRev":0/.test(n.req) && /"kind":"(plan_due|plan_late|month_close_due)"/.test(n.req);
  }
}

/** Check 6 (part): three users open the screen; nothing may be written. */
export async function openWithoutWrites(ctx, R, label, openFn) {
  const m = ctx.mark();
  await Promise.all([ctx.A, ctx.B, ctx.C].map((p) => openFn(p)));
  await ctx.sleep(3000);
  const all = ["A", "B", "C"].flatMap((t) => realWrites(m.writes(t)).map((n) => ({ t, n })));
  const reminders = all.filter(({ n }) => isAutoReminder(n));
  const w = all.filter((x) => !reminders.includes(x)).map(({ t, n }) => `${t}: ${brief([n])[0]}`);
  if (reminders.length) R.note(`month reminder raised by the SPA on opening ${label} (${reminders.map(({ t, n }) => `${t}: ${n.s}`).join(", ")}; one stays live, duplicates are stored deleted)`);
  if (w.length) R.fail(6, `writes on opening ${label}: ${w.join("; ")}`);
  return m;
}

/** Check 6 (rest): no banner anywhere, no 5xx since `mark`. */
export async function endChecks(ctx, R, m) {
  const banners = await ctx.anyBanner(m.at);
  const fives = ["A", "B", "C"].flatMap((t) => brief(m.fives(t)).map((s) => `${t}: ${s}`));
  const errs = ["A", "B", "C"].flatMap((t) => m.errors(t).map((e) => `${t}: ${e.msg}`));
  if (errs.length) R.note(`page errors: ${[...new Set(errs)].join(" | ").slice(0, 300)}`);
  R.expect(6, !banners && !fives.length, banners ? `banner: ${JSON.stringify(banners).slice(0, 400)}` : fives.length ? `5xx: ${fives.join("; ")}` : "no writes on open, no banner, no 5xx");
}

// ---------------------------------------------------------------------------
// APMS person page, open plan: KPI structure, execution, values, manager notes
// ---------------------------------------------------------------------------
export async function apmsPlanEditor(ctx, run) {
  const R = new ScreenResult("APMS", "apms-plan-open", "Person page, open plan: KPI structure · Execution · Values · Manager notes");
  const { A, B, C } = ctx;
  const X = P.fawazJul;
  const Y = P.ameeshaSep;
  const m0 = await openWithoutWrites(ctx, R, "an open plan", (p) => openPerson(ctx, p, "apms", X.name, X.month));

  // Check 2 + 3: same record, different sections, at the same time; C idle.
  const prio = `E2E-A priority ${run}`;
  const notesB = `E2E-B notes ${run}`;
  const t0 = Date.now();
  await Promise.all([
    (async () => {
      await setInput(A, await kpiWeight(A, "Aliens Stuff"), 25);
      await setInput(A, await kpiWeight(A, "Advanced Booked by BC"), 15);
      await addPriority(A, prio, "Done means shipped");
    })(),
    (async () => {
      const bx = await behaviourBox(B, "Feedback is the fuel to growth");
      await bx.scrollIntoViewIfNeeded();
      await bx.click();
      await setInput(B, textareaAfter(B, "Manager notes"), notesB);
    })(),
  ]);
  const shows = async (p) => {
    const w1 = await (await kpiWeight(p, "Aliens Stuff")).inputValue();
    const w2 = await (await kpiWeight(p, "Advanced Booked by BC")).inputValue();
    const bx = await (await behaviourBox(p, "Feedback is the fuel to growth")).isChecked();
    const notes = await textareaAfter(p, "Manager notes").inputValue();
    const pr = await pageHas(p, prio) || (await p.locator(`main input[value="${prio}"]`).count()) > 0;
    return w1 === "25" && w2 === "15" && !bx && notes === notesB && pr;
  };
  const cSeen = await ctx.waitUntil(() => shows(C), 5000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const rec = (await monthRecord(ctx, X))?.payload;
  const dbOk =
    findKpi(rec, "Aliens Stuff")?.weight === 0.25 &&
    findKpi(rec, "Advanced Booked by BC")?.weight === 0.15 &&
    (rec?.priorities || []).some((x) => x.name === prio) &&
    findBehaviour(rec, "Feedback is the fuel to growth")?.inPlay === false &&
    rec?.notes === notesB;
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, dbOk && abOk, `DB weights ${findKpi(rec, "Aliens Stuff")?.weight}/${findKpi(rec, "Advanced Booked by BC")?.weight}, priority ${(rec?.priorities || []).some((x) => x.name === prio)}, value off ${findBehaviour(rec, "Feedback is the fuel to growth")?.inPlay === false}, notes ${rec?.notes === notesB}; A and B screens show both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? "C did not show both edits within 5 s of the edit" : `C showed both ${(tC / 1000).toFixed(1)} s after the edit`);

  // Check 1: different records at the same time (A: Fawaz July, B: Ameesha September).
  await openPerson(ctx, B, "apms", Y.name, Y.month);
  const nA = `E2E-A ${X.name} ${run}`;
  const nB = `E2E-B ${Y.name} ${run}`;
  await Promise.all([
    setInput(A, textareaAfter(A, "Manager notes"), nA),
    setInput(B, textareaAfter(B, "Manager notes"), nB),
  ]);
  await ctx.settled(A);
  await ctx.settled(B);
  const rx = (await monthRecord(ctx, X))?.payload;
  const ry = (await monthRecord(ctx, Y))?.payload;
  const cX = await ctx.waitUntil(async () => (await textareaAfter(C, "Manager notes").inputValue()) === nA, 5000);
  R.expect(1, rx?.notes === nA && ry?.notes === nB && findKpi(rx, "Aliens Stuff")?.weight === 0.25, `DB: X notes ${rx?.notes === nA}, Y notes ${ry?.notes === nB}, X keeps A's earlier weight ${findKpi(rx, "Aliens Stuff")?.weight === 0.25}; C saw X ${cX === null ? "no" : `in ${(cX / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes Y; B still has Y open (feed held), edits and saves.
  await ctx.holdFeed(B);
  await openPerson(ctx, A, "apms", Y.name, Y.month);
  await deletePersonMonth(A);
  await ctx.sleep(1500);
  const afterDel = await monthRecord(ctx, Y);
  const bStill = await pageHas(B, Y.name);
  await setInput(B, textareaAfter(B, "Manager notes"), `STALE ${run}`);
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const afterStale = await monthRecord(ctx, Y);
  await ctx.reloadAll();
  const listed = [];
  for (const p of [A, B, C]) {
    await openPlansList(ctx, p, "apms");
    await expandMonth(p, Y.month);
    listed.push(await personRow(p, Y.name, Y.month).count());
  }
  R.expect(4, !!afterDel?.deleted_at && bStill && !!afterStale?.deleted_at && afterStale?.payload?.notes !== `STALE ${run}` && listed.every((n) => n === 0),
    `deleted in DB ${!!afterDel?.deleted_at}; B still saw it ${bStill}; after B's stale save still deleted ${!!afterStale?.deleted_at}, stale notes kept out ${afterStale?.payload?.notes !== `STALE ${run}`}; rows after reload A/B/C ${listed.join("/")}`);

  // Check 5: all three reload and open X; screens and DB agree.
  const recX = (await monthRecord(ctx, X))?.payload;
  const want = {
    w1: String(Math.round((findKpi(recX, "Aliens Stuff")?.weight || 0) * 100)),
    w2: String(Math.round((findKpi(recX, "Advanced Booked by BC")?.weight || 0) * 100)),
    bx: !!findBehaviour(recX, "Feedback is the fuel to growth")?.inPlay,
    notes: recX?.notes || "",
  };
  const got = [];
  for (const p of [A, B, C]) {
    await openPerson(ctx, p, "apms", X.name, X.month);
    got.push({
      w1: await (await kpiWeight(p, "Aliens Stuff")).inputValue(),
      w2: await (await kpiWeight(p, "Advanced Booked by BC")).inputValue(),
      bx: await (await behaviourBox(p, "Feedback is the fuel to growth")).isChecked(),
      notes: await textareaAfter(p, "Manager notes").inputValue(),
    });
  }
  const agree = got.every((g) => JSON.stringify(g) === JSON.stringify(want));
  R.expect(5, agree && want.notes === nA, `DB ${JSON.stringify(want)}; screens ${got.map((g) => JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g)).join(" / ")}`);
  await endChecks(ctx, R, m0);
  return R;
}


/**
 * Check 4 for a person-month page: A deletes W; B (live feed held, so its
 * screen provably still shows W) makes `staleEdit`; the delete must stand in
 * the DB and after all three reload W must not be listed anywhere.
 */
export async function staleDeleteCheck(ctx, R, kind, W, staleEdit, table = "month_records", deleteFn = null) {
  const { A, B } = ctx;
  await openPerson(ctx, B, kind, W.name, W.month);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await ctx.holdFeed(B, new RegExp(`/api/${table === "reward_records" ? "reward-records" : "month-records"}/${esc(W.period)}(/${esc(W.id)})?([?]|$)`));
  if (deleteFn) await deleteFn(A);
  else {
    await openPerson(ctx, A, kind, W.name, W.month);
    await deletePersonMonth(A);
  }
  await ctx.sleep(1500);
  const afterDel = await monthRecord(ctx, W, table);
  const bStill = await pageHas(B, W.name);
  let editErr = "";
  try { await staleEdit(B); } catch (e) { editErr = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const afterStale = await monthRecord(ctx, W, table);
  await ctx.reloadAll();
  const listed = [];
  for (const p of [ctx.A, ctx.B, ctx.C]) {
    await openPlansList(ctx, p, kind);
    await expandMonth(p, W.month);
    listed.push(await personRow(p, W.name, W.month).count());
  }
  const again = await monthRecord(ctx, W, table);
  R.expect(4, !!afterDel?.deleted_at && bStill && !!afterStale?.deleted_at && !!again?.deleted_at && listed.every((n) => n === 0),
    `A's delete in DB ${!!afterDel?.deleted_at}; B still saw it ${bStill}; after B's stale ${editErr ? "edit (" + editErr + ")" : "edit"} still deleted ${!!afterStale?.deleted_at}; after reload still deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);
}

// ---------------------------------------------------------------------------
// APMS person page, locked plan: month-end actuals, execution + values scoring,
// manager notes
// ---------------------------------------------------------------------------
export async function apmsLockedPlan(ctx, run) {
  const R = new ScreenResult("APMS", "apms-plan-locked", "Person page, locked plan: KPI actuals · Execution scores · Values scores · Manager notes");
  const { A, B, C } = ctx;
  const X = P.allanSep;
  const Y = P.hetalSep;
  const m0 = await openWithoutWrites(ctx, R, "a locked plan", (p) => openPerson(ctx, p, "apms", X.name, X.month));

  const notesB = `E2E-B locked notes ${run}`;
  const t0 = Date.now();
  await Promise.all([
    (async () => {
      await setInput(A, actualInputs(A).nth(0), 7);
      await execSelects(A).nth(0).selectOption("4");
    })(),
    (async () => {
      await scoreButton(B, 0, 3).scrollIntoViewIfNeeded();
      await scoreButton(B, 0, 3).click();
      await setInput(B, textareaAfter(B, "Manager notes"), notesB);
    })(),
  ]);
  const shows = async (p) =>
    (await actualInputs(p).nth(0).inputValue()) === "7" &&
    (await execSelects(p).nth(0).inputValue()) === "4" &&
    (await scoreSelected(scoreButton(p, 0, 3))) &&
    (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 5000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const rec = (await monthRecord(ctx, X))?.payload;
  const kpi0 = rec?.brands?.[0]?.kras?.[0]?.kpis?.[0];
  const pr0 = (rec?.priorities || [])[0];
  const b0 = rec?.values?.[0]?.behaviours?.[0];
  const dbOk = Number(kpi0?.achieved) === 7 && Number(pr0?.score) === 4 && Number(b0?.score) === 3 && rec?.notes === notesB;
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, dbOk && abOk, `DB actual ${kpi0?.achieved}, exec score ${pr0?.score}, value score ${b0?.score}, notes ${rec?.notes === notesB}; A and B screens show both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? "C did not show both edits within 5 s" : `C showed both ${(tC / 1000).toFixed(1)} s after the edit`);

  // Check 1: A enters Allan's second actual; B enters Hetal's first actual.
  await openPerson(ctx, B, "apms", Y.name, Y.month);
  await Promise.all([setInput(A, actualInputs(A).nth(1), 9), setInput(B, actualInputs(B).nth(0), 5)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const rx = (await monthRecord(ctx, X))?.payload;
  const ry = (await monthRecord(ctx, Y))?.payload;
  const x1 = rx?.brands?.[1]?.kras?.[0]?.kpis?.[0]?.achieved ?? rx?.brands?.[0]?.kras?.[1]?.kpis?.[0]?.achieved;
  const y0 = ry?.brands?.[0]?.kras?.[0]?.kpis?.[0]?.achieved;
  const cX = await ctx.waitUntil(async () => (await actualInputs(C).nth(1).inputValue()) === "9", 5000);
  R.expect(1, Number(x1) === 9 && Number(y0) === 5 && Number(rx?.brands?.[0]?.kras?.[0]?.kpis?.[0]?.achieved) === 7,
    `DB: Allan 2nd actual ${x1}, Hetal actual ${y0}, Allan keeps 1st ${rx?.brands?.[0]?.kras?.[0]?.kpis?.[0]?.achieved}; C saw ${cX === null ? "no" : `in ${(cX / 1000).toFixed(1)} s`}`);

  // Check 4: delete vs stale actual.
  await staleDeleteCheck(ctx, R, "apms", P.sohamSep, async (p) => setInput(p, actualInputs(p).nth(0), 3));

  // Check 5
  const recX = (await monthRecord(ctx, X))?.payload;
  const got = [];
  for (const p of [A, B, C]) {
    await openPerson(ctx, p, "apms", X.name, X.month);
    got.push([await actualInputs(p).nth(0).inputValue(), await actualInputs(p).nth(1).inputValue(), await execSelects(p).nth(0).inputValue(), await scoreSelected(scoreButton(p, 0, 3)), await textareaAfter(p, "Manager notes").inputValue()].join("|"));
  }
  const want = [recX?.brands?.[0]?.kras?.[0]?.kpis?.[0]?.achieved, x1, recX?.priorities?.[0]?.score, recX?.values?.[0]?.behaviours?.[0]?.score === 3, recX?.notes].map((v) => (v === true || v === false ? v : String(v ?? ""))).join("|");
  R.expect(5, got.every((g) => g === want), `DB ${want}; screens ${got.map((g) => (g === want ? "same" : g)).join(" / ")}`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Lock plan (open → locked) and Close plan (Super admin, month ended)
// ---------------------------------------------------------------------------
const PAST = new Set(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
function badgeFor(status, period) {
  if (status === "closed") return "Closed";
  if (status === "plan_open") return "Plan open";
  if (status === "plan_locked") return PAST.has(period) ? "Closure pending" : "Plan locked";
  return status;
}

export async function apmsLockClose(ctx, run) {
  const R = new ScreenResult("APMS", "apms-lock-close", "Lock plan · Close plan (Super admin)");
  const { A, B, C } = ctx;
  const L = P.fawazJul;
  const m0 = await openWithoutWrites(ctx, R, "an open plan (lock)", (p) => openPerson(ctx, p, "apms", L.name, L.month));

  // Check 2 + 3: A locks Fawaz July while B writes its manager notes; C idle.
  const notesB = `E2E-B lock notes ${run}`;
  const t0 = Date.now();
  await Promise.all([
    (async () => {
      const b = A.locator("main").getByRole("button", { name: "Lock plan", exact: true }).last();
      await b.scrollIntoViewIfNeeded();
      await b.click();
    })(),
    setInput(B, textareaAfter(B, "Manager notes"), notesB),
  ]);
  const locked = (b) => b === "Plan locked" || b === "Closure pending";
  const shows = async (p) => locked(await statusBadge(p)) && (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  const cState = `badge ${await statusBadge(C)}, notes ${(await notesValue(C)) === notesB}`;
  await ctx.settled(A);
  await ctx.settled(B);
  const rl = (await monthRecord(ctx, L))?.payload;
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, rl?.status === "plan_locked" && rl?.notes === notesB && abOk, `DB status ${rl?.status}, notes ${rl?.notes === notesB}; A and B show both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show lock + notes within 12 s (${cState})` : `C showed lock + notes ${(tC / 1000).toFixed(1)} s after the click`);

  // Check 1: A closes Pritam September while B closes Henson September
  // (different records); C watches Pritam. Close needs every actual, one
  // rated execution outcome and rated values, so both are prepared first.
  const X = P.pritamSep;
  const Y = P.hensonSep;
  await Promise.all([openPerson(ctx, A, "apms", X.name, X.month), openPerson(ctx, B, "apms", Y.name, Y.month), openPerson(ctx, C, "apms", X.name, X.month)]);
  await Promise.all([prepareClose(A, `E2E outcome A ${run}`), prepareClose(B, `E2E outcome B ${run}`)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const [redA, redB] = await Promise.all([closePlan(A), closePlan(B)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const sx = (await monthRecord(ctx, X))?.payload?.status;
  const sy = (await monthRecord(ctx, Y))?.payload?.status;
  const cX = await ctx.waitUntil(async () => (await statusBadge(C)) === "Closed", 5000);
  R.expect(1, sx === "closed" && sy === "closed", `DB: Pritam ${sx}${redA ? " (A: " + redA + ")" : ""}, Henson ${sy}${redB ? " (B: " + redB + ")" : ""}; C saw Pritam closed ${cX === null ? "no" : `in ${(cX / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes Deepti September; B (stale) writes its manager notes.
  await staleDeleteCheck(ctx, R, "apms", P.deeptiSep, async (p) => setInput(p, textareaAfter(p, "Manager notes"), `STALE ${run}`));

  // Check 5: statuses on all three screens = DB.
  const bad = [];
  const want = {};
  for (const w of [X, Y, L]) want[w.id + w.period] = badgeFor((await monthRecord(ctx, w))?.payload?.status, w.period);
  for (const [t, p] of Object.entries({ A, B, C })) {
    for (const w of [X, Y, L]) {
      await openPerson(ctx, p, "apms", w.name, w.month);
      const b = await statusBadge(p);
      if (b !== want[w.id + w.period]) bad.push(`${t} ${w.name} ${w.month}: screen ${b}, DB ${want[w.id + w.period]}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `statuses agree: ${Object.values(want).join(", ")}`);
  await endChecks(ctx, R, m0);
  return R;
}


// ---------------------------------------------------------------------------
// APMS Plans month list: Add people, Delete from the list
// ---------------------------------------------------------------------------
export async function namedLive(ctx, period, table = "month_records") {
  const rows = await ctx.sql(
    `select p.payload->>'name' as name from ${table} m join people p on p.id = m.person_id
      where m.period = $1 and m.deleted_at is null and p.deleted_at is null order by 1`,
    [period],
  );
  return rows.map((r) => r.name.trim()).sort();
}

export async function apmsMonthList(ctx, run, kind = "apms") {
  const table = kind === "rewards" ? "reward_records" : "month_records";
  const R = new ScreenResult(kind === "rewards" ? "Rewards" : "APMS", `${kind}-month-list`, "Plans month list: Add people · Delete from list");
  const { A, B, C } = ctx;
  // Rewards has no October group yet: its second month is August.
  const OCT = kind === "rewards" ? "August 2026" : "October 2026";
  const OCT_P = kind === "rewards" ? "2026-08" : "2026-10";
  const SEP = "September 2026";
  // People not yet on those months in the seed.
  const N = kind === "rewards"
    ? { a2: "Fawaz Ghansar", b2: "Allan Gois", a1: "Jay Nikam", b1: "Hetal Soni" }
    : { a2: "Nevil Prajapati", b2: "Rohan Jadhav", a1: "Jay Nikam", b1: "Sachin Yadav" };
  const m0 = await openWithoutWrites(ctx, R, "the Plans month list", async (p) => {
    await openPlansList(ctx, p, kind);
    await expandMonth(p, OCT);
  });

  // Check 2 + 3: same month group, A and B each add a person at the same time; C idle on the list.
  await Promise.all([addPeople(A, OCT, [N.a2]), addPeople(B, OCT, [N.b2])]);
  const t0 = Date.now(); // both pressed Save
  const both = async (p) => {
    const n = await listedNames(p, OCT);
    return n.includes(N.a2) && n.includes(N.b2);
  };
  const cSeen = await ctx.waitUntil(() => both(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const oct = await namedLive(ctx, OCT_P, table);
  const abOk = (await ctx.waitUntil(() => both(A), 5000)) !== null && (await ctx.waitUntil(() => both(B), 5000)) !== null;
  R.expect(2, oct.includes(N.a2) && oct.includes(N.b2) && abOk, `DB ${OCT}: ${oct.join(", ")}; A and B list both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not list both within 12 s (${(await listedNames(C, OCT)).join(", ")})` : `C listed both ${(tC / 1000).toFixed(1)} s after the adds`);

  // Check 1: different months at the same time.
  await Promise.all([addPeople(A, SEP, [N.a1]), addPeople(B, OCT, [N.b1])]);
  await ctx.settled(A);
  await ctx.settled(B);
  const sep1 = await namedLive(ctx, "2026-09", table);
  const oct1 = await namedLive(ctx, OCT_P, table);
  const cBoth = await ctx.waitUntil(async () => (await listedNames(C, SEP)).includes(N.a1) && (await listedNames(C, OCT)).includes(N.b1), 5000);
  R.expect(1, sep1.includes(N.a1) && oct1.includes(N.b1) && oct1.includes(N.a2), `DB: ${SEP} has ${N.a1} ${sep1.includes(N.a1)}, ${OCT} has ${N.b1} ${oct1.includes(N.b1)} and keeps ${N.a2} ${oct1.includes(N.a2)}; C listed both ${cBoth === null ? "no" : `in ${(cBoth / 1000).toFixed(1)} s`}`);

  // Check 4: A deletes one of them from the list; B (stale) opens it and edits the notes.
  const W = { name: N.a2, month: OCT, id: "", period: OCT_P };
  const who = await ctx.sql("select id from people where payload->>'name' = $1 and deleted_at is null", [N.a2]);
  if (who[0]) W.id = who[0].id;
  await staleDeleteCheck(ctx, R, kind, W, async (p) => setInput(p, textareaAfter(p, "Manager notes"), `STALE ${run}`), table, async (a) => {
    await openPlansList(ctx, a, kind);
    await deleteFromList(a, W.name, W.month);
  });

  // Check 5: after reload the lists = DB (named people) for both months.
  const want = { [SEP]: await namedLive(ctx, "2026-09", table), [OCT]: await namedLive(ctx, OCT_P, table) };
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openPlansList(ctx, p, kind);
    for (const mon of [SEP, OCT]) {
      const got = await listedNames(p, mon);
      const w = want[mon];
      const missing = w.filter((n) => !got.includes(n));
      const extra = got.filter((n) => !w.includes(n));
      if (missing.length || extra.length) bad.push(`${t} ${mon}: missing ${missing.join("/") || "-"}, extra ${extra.join("/") || "-"}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `lists = DB (${SEP} ${want[SEP].length}, ${OCT} ${want[OCT].length})`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Plan editing: drag to reorder (KPIs in APMS, KRAs in Rewards)
// ---------------------------------------------------------------------------
export async function apmsPlanDrag(ctx, run) {
  const R = new ScreenResult("APMS", "apms-plan-drag", "Plan editing: drag to reorder KPIs / KRAs");
  const { A, B, C } = ctx;
  const X = P.fawazJul;
  const KPIS = ["Revenue By BC", "Aliens Stuff", "Advanced Booked by BC"];
  const kpiOrder = async (w, table = "month_records") => (await ctx.sql(`select jsonb_path_query_array(payload, '$.brands[0].kras[0].kpis[*].name') o from ${table} where person_id = $1 and period = $2`, [w.id, w.period]))[0]?.o || [];
  const m0 = await openWithoutWrites(ctx, R, "an open plan (drag)", (p) => openPerson(ctx, p, "apms", X.name, X.month));

  // Check 2 + 3: A drags "Advanced Booked by BC" to the top while B writes notes; C idle.
  const notesB = `E2E-B drag notes ${run}`;
  await Promise.all([dragOnto(A, "Advanced Booked by BC", "Revenue By BC"), setInput(B, textareaAfter(B, "Manager notes"), notesB)]);
  const t0 = Date.now();
  const want = ["Advanced Booked by BC", "Revenue By BC", "Aliens Stuff"];
  const shows = async (p) => JSON.stringify(await screenOrder(p, KPIS)) === JSON.stringify(want) && (await notesValue(p)) === notesB;
  const cSeen = await ctx.waitUntil(() => shows(C), 12000);
  const tC = cSeen === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const o = await kpiOrder(X);
  const n = (await monthRecord(ctx, X))?.payload?.notes;
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, JSON.stringify(o) === JSON.stringify(want) && n === notesB && abOk, `DB order ${o.join(" › ")}, notes ${n === notesB}; A and B show both: ${abOk}`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show the new order + notes within 12 s (${(await screenOrder(C, KPIS)).join(" › ")})` : `C showed both ${(tC / 1000).toFixed(1)} s after the drop`);

  // Check 1: A drags on Fawaz July (APMS) while B drags KRAs on Rohan September (Rewards).
  const rohan = { name: "Rohan Jadhav", month: "September 2026", id: "p-1788353125641-e4k6ut", period: "2026-09" };
  const KRAS = ["Art Score", "Studio Audit + Mystery Audit", "Consultation NPS Score"];
  await openPerson(ctx, B, "rewards", rohan.name, rohan.month);
  await Promise.all([dragOnto(A, "Aliens Stuff", "Advanced Booked by BC"), dragOnto(B, "Consultation NPS Score", "Art Score")]);
  await ctx.settled(A);
  await ctx.settled(B);
  const oa = await kpiOrder(X);
  const ob = (await ctx.sql("select jsonb_path_query_array(payload, '$.brands[0].kras[*].name') o from reward_records where person_id = $1 and period = $2", [rohan.id, rohan.period]))[0]?.o || [];
  R.expect(1, oa[0] === "Aliens Stuff" && ob[0] === "Consultation NPS Score", `DB: Fawaz July KPIs ${oa.join(" › ")}; Rohan September KRAs ${ob.join(" › ")}`);
  void KRAS;

  // Check 4: A deletes Ameesha's plan; B (stale) edits it (no second item to drag there, so notes).
  await staleDeleteCheck(ctx, R, "apms", P.ameeshaSep, async (p) => setInput(p, textareaAfter(p, "Manager notes"), `STALE ${run}`));

  // Check 5
  const dbo = await kpiOrder(X);
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openPerson(ctx, p, "apms", X.name, X.month);
    const so = await screenOrder(p, KPIS);
    if (JSON.stringify(so) !== JSON.stringify(dbo)) bad.push(`${t}: ${so.join(" › ")}`);
  }
  R.expect(5, !bad.length, bad.length ? `DB ${dbo.join(" › ")}; ${bad.join("; ")}` : `order on all screens = DB (${dbo.join(" › ")})`);
  await endChecks(ctx, R, m0);
  return R;
}
