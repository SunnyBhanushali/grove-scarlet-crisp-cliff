/**
 * APMS screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * Data: the imported seed (fresh database). Person-months used:
 *   open plans   — Fawaz Ghansar July 2026, Ameesha Karnani September 2026
 *   locked plans — Allan Gois / Fawaz Ghansar / Hetal Soni September 2026
 */
import { ScreenResult, realWrites, brief } from "./harness.mjs";
import {
  openPerson, openPlansList, expandMonth, personRow, textareaAfter, setInput, kpiWeight, behaviourBox,
  addPriority, deletePersonMonth, pageHas,
} from "./plan-page.mjs";

export const P = {
  fawazJul: { name: "Fawaz Ghansar", month: "July 2026", id: "p-1788172782481", period: "2026-07" },
  ameeshaSep: { name: "Ameesha Karnani", month: "September 2026", id: "p-1788350343290-pr5i2g", period: "2026-09" },
  allanSep: { name: "Allan Gois", month: "September 2026", id: "p-1787993618279", period: "2026-09" },
  fawazSep: { name: "Fawaz Ghansar", month: "September 2026", id: "p-1788172782481", period: "2026-09" },
  hetalSep: { name: "Hetal Soni", month: "September 2026", id: "p-1788171165466", period: "2026-09" },
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
  const banners = await ctx.anyBanner();
  const fives = ["A", "B", "C"].flatMap((t) => brief(m.fives(t)).map((s) => `${t}: ${s}`));
  const errs = ["A", "B", "C"].flatMap((t) => m.errors(t).map((e) => `${t}: ${e.msg}`));
  if (errs.length) R.note(`page errors: ${[...new Set(errs)].join(" | ").slice(0, 300)}`);
  R.expect(6, !banners && !fives.length, banners ? `banner: ${JSON.stringify(banners)}` : fives.length ? `5xx: ${fives.join("; ")}` : "no writes on open, no banner, no 5xx");
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
    await expandMonth(p, Y.month, P.allanSep.name);
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
