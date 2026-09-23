/**
 * APMS → EO (execution outcomes across plans) × the six checks.
 * An EO is an item of a person's month plan (month_records.payload.priorities).
 */
import { ScreenResult } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";

const ALLAN = "p-1787993618279";
const FAWAZ = "p-1788172782481";
// Stored status → the label the list shows ("Started" is stored as "ongoing").
const LABEL = { live: "PLANNED", planned: "PLANNED", ongoing: "STARTED", started: "STARTED", complete: "COMPLETE", overdue: "OVERDUE", dropped: "DROPPED" };

export async function openEO(ctx, p) {
  await ctx.nav(p, "APMS", "EO");
  await p.locator("main").getByRole("button", { name: "List", exact: true }).click();
  await p.waitForTimeout(600);
}
/** The EO editor (click its title in the list). */
async function eoDialog(p, name) {
  // List rows: "<title> <status> · <person · months>" with Edit (this editor) and Open (the plan).
  await p.locator("main li").filter({ hasText: name }).first().getByRole("button", { name: "Edit", exact: true }).click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: new RegExp("^" + name) }).last();
  await d.waitFor({ timeout: 10000 });
  return d;
}
async function closeDialog(p, d) {
  await d.getByRole("button", { name: "Close", exact: true }).last().click();
  await p.waitForTimeout(300);
}
export async function eoSet(p, name, { status, rating, note } = {}) {
  const d = await eoDialog(p, name);
  if (status) await d.locator("select").nth(0).selectOption({ label: status });
  if (rating) await d.locator("select").nth(1).selectOption({ label: String(rating) });
  if (note) {
    await d.locator("textarea").fill(note);
    await d.getByRole("button", { name: "Add", exact: true }).click();
  }
  await p.waitForTimeout(300);
  await closeDialog(p, d);
}
export async function eoTrash(p, name) {
  const d = await eoDialog(p, name);
  await d.getByRole("button", { name: "Move to trash", exact: true }).click();
  await p.waitForTimeout(400);
  const conf = p.locator("div.fixed.inset-0 button", { hasText: /^(Move to trash|Delete|Yes|Trash)/ }).last();
  if (await conf.isVisible().catch(() => false)) await conf.click();
  await p.waitForTimeout(500);
  if (await d.isVisible().catch(() => false)) await closeDialog(p, d);
}
/** Status label the list shows under an EO ("STARTED"), or null when not listed. */
export async function eoShown(p, name) {
  const t = await p.locator("main").innerText();
  const m = t.match(new RegExp(`\\n${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n(PLANNED|STARTED|COMPLETE|OVERDUE|DROPPED)\\n`, "i"));
  return m ? m[1].toUpperCase() : null;
}
export async function eoRow(ctx, pid, name) {
  const r = await ctx.sql("select payload->'priorities' as p from month_records where person_id = $1 and period = '2026-09' and deleted_at is null", [pid]);
  return (r[0]?.p || []).find((x) => String(x.name || "").trim() === name) || null;
}

export async function apmsEO(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("APMS", "apms-eo", "EO: execution outcomes (status, manager rating, notes, trash)");
  const tag = run.slice(-4);
  const SCHOOL = "Test for School";
  const STUDIO = "Test for Studio";
  const PIPE = "Pipeline Design and Function Development";
  const m0 = await openWithoutWrites(ctx, R, "the EO list", (p) => openEO(ctx, p));

  // Check 1 + 3: different plans: A sets Allan's "Test for School" to Started, B rates Fawaz's EO 3.
  await Promise.all([eoSet(A, SCHOOL, { status: "Started" }), eoSet(B, PIPE, { rating: 3 })]);
  const t0 = Date.now();
  await ctx.settled(A);
  await ctx.settled(B);
  const school = await eoRow(ctx, ALLAN, SCHOOL);
  const pipe = await eoRow(ctx, FAWAZ, PIPE);
  R.expect(1, LABEL[school?.status] === "STARTED" && Number(pipe?.score) === 3, `DB: ${SCHOOL} ${school?.status}; ${PIPE.slice(0, 20)}… rating ${pipe?.score}`);
  const c1 = await ctx.waitUntil(async () => (await eoShown(C, SCHOOL)) === "STARTED", 12000);
  const tC1 = c1 === null ? null : Date.now() - t0;

  // Check 2 + 3: same EO: A sets "Test for Studio" to Overdue while B adds a note to it.
  const NOTE = `B note ${tag}`;
  await Promise.all([eoSet(A, STUDIO, { status: "Overdue" }), eoSet(B, STUDIO, { note: NOTE })]);
  const t1 = Date.now();
  await ctx.settled(A);
  await ctx.settled(B);
  const studio = await eoRow(ctx, ALLAN, STUDIO);
  const hasNote = (studio?.notes || []).some((n) => n.text === NOTE);
  R.expect(2, studio?.status === "overdue" && hasNote, `DB ${STUDIO}: status ${studio?.status}, B's note ${hasNote}`);
  const c2 = await ctx.waitUntil(async () => (await eoShown(C, STUDIO)) === "OVERDUE", 12000);
  const tC2 = c2 === null ? null : Date.now() - t1;
  R.expect(3, tC1 !== null && tC1 <= 5000 && tC2 !== null && tC2 <= 5000, `C's EO list: Started ${tC1 === null ? "not shown" : (tC1 / 1000).toFixed(1) + " s"}; Overdue ${tC2 === null ? `not shown (${await eoShown(C, STUDIO)})` : (tC2 / 1000).toFixed(1) + " s"}`);

  // Check 4: A moves "Test for School" to trash; B (held stale) rates it 5.
  await ctx.holdFeed(B, /\/api\/month-records/);
  await eoTrash(A, SCHOOL);
  await ctx.settled(A);
  const goneA = !(await eoRow(ctx, ALLAN, SCHOOL));
  const bSees = (await eoShown(B, SCHOOL)) !== null;
  let err = "";
  try { await eoSet(B, SCHOOL, { rating: 5 }); } catch (e) { err = String(e).split("\n")[0].slice(0, 80); }
  await ctx.settled(B);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const back = await eoRow(ctx, ALLAN, SCHOOL);
  await ctx.reloadAll();
  const listed = [];
  for (const p of [A, B, C]) {
    await openEO(ctx, p);
    listed.push((await eoShown(p, SCHOOL)) !== null);
  }
  R.expect(4, goneA && bSees && !back && listed.every((x) => !x), `A's trash: gone ${goneA}; B still listed it ${bSees}; after B's stale rating${err ? " (" + err + ")" : ""}: in DB ${!!back}; listed after reload A/B/C ${listed.join("/")}`);

  // Check 5: list statuses on A/B/C = DB.
  const want = {};
  for (const [pid, name] of [[ALLAN, STUDIO], [FAWAZ, PIPE]]) {
    const r = await eoRow(ctx, pid, name);
    want[name] = r ? LABEL[r.status] || String(r.status).toUpperCase() : null;
  }
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    for (const [name, lab] of Object.entries(want)) {
      const s = await eoShown(p, name);
      if (s !== lab) bad.push(`${t} ${name.slice(0, 20)}: ${s} vs DB ${lab}`);
    }
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `EO list on A/B/C = DB (${Object.entries(want).map(([n, l]) => `${n.slice(0, 16)} ${l}`).join(", ")})`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Quarterly review (My APMS → Add review; Plans → Employee Name → All APMS)
// ---------------------------------------------------------------------------
const FLOYD = { name: "Floyd Dsilva", id: "p-1788350767356-zncdvn" };
const RONLIND = { name: "Ronlind Menezes", id: "p-1788156420676" };
const REVIEW_BTN = /^(Add|Continue|View) review$/;

/** A person's year view (Plans → Employee Name → All APMS), then quarter `q` (1–4). */
export async function openReviewOf(ctx, p, name, q) {
  await ctx.nav(p, "APMS", "Plans");
  await p.locator("main").getByRole("button", { name: "Employee Name", exact: true }).click();
  await p.waitForTimeout(400);
  await p.locator('main input[placeholder^="Search name"]').fill(name);
  await p.waitForTimeout(600);
  const row = p.locator("main *").filter({ has: p.getByText(name, { exact: true }) }).filter({ has: p.getByRole("button", { name: "All APMS", exact: true }) }).last();
  await row.getByRole("button", { name: "All APMS", exact: true }).click();
  await p.waitForTimeout(1000);
  await p.locator("main button").filter({ hasText: REVIEW_BTN }).nth(q - 1).click();
  await p.locator("main").getByText("Quarterly review", { exact: true }).first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
}
export async function openOwnReview(ctx, p, q) {
  await ctx.nav(p, "APMS", "My APMS");
  await p.locator("main button").filter({ hasText: REVIEW_BTN }).nth(q - 1).click();
  await p.locator("main").getByText("Quarterly review", { exact: true }).first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
}
export async function reviewRow(ctx, pid, period = "2026-Q2") {
  const r = await ctx.sql("select payload, deleted_at from entities where kind = 'period-reviews' and id = $1", [`${pid}:${period}`]);
  return r[0] && !r[0].deleted_at ? r[0].payload : null;
}
async function reviewNote(p, label) {
  const { notesValue } = await import("./plan-page.mjs");
  return notesValue(p, label);
}
async function typeNote(p, label, text) {
  const { sectionTextarea } = await import("./plan-page.mjs");
  const ta = sectionTextarea(p, label);
  await ta.scrollIntoViewIfNeeded();
  await ta.click();
  await ta.fill(text);
  await ta.press("Tab");
  await p.waitForTimeout(200);
}
async function openReviewBtn(p) {
  const b = p.locator("main").getByRole("button", { name: "Open review", exact: true });
  if (await b.count()) await b.first().click();
  await p.waitForTimeout(500);
}

export async function apmsQuarterReview(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("APMS", "apms-quarter-review", "Quarterly review: open · self comments · manager discussion notes");
  const tag = run.slice(-4);
  const m0 = await openWithoutWrites(ctx, R, "a quarterly review page", (p) => (p === B ? openOwnReview(ctx, p, 2) : openReviewOf(ctx, p, FLOYD.name, 2)));

  // Check 1: different reviews: A opens Floyd's Q2 review while B opens Ronlind's Q2 review.
  await openReviewOf(ctx, B, RONLIND.name, 2);
  await Promise.all([openReviewBtn(A), openReviewBtn(B)]);
  await ctx.settled(A);
  await ctx.settled(B);
  const f1 = await reviewRow(ctx, FLOYD.id);
  const r1 = await reviewRow(ctx, RONLIND.id);
  R.expect(1, !!f1 && f1.status !== "idle" && !!r1 && r1.status !== "idle", `DB: Floyd Q2 ${f1?.status}, Ronlind Q2 ${r1?.status}`);

  // Check 2 + 3: same review: Floyd (B) writes his self comments while A writes the manager discussion notes; C watches.
  await openOwnReview(ctx, B, 2);
  const SELF = `Self ${tag}`;
  const MGR = `Manager ${tag}`;
  await Promise.all([typeNote(B, "Self comments", SELF), typeNote(A, "Manager discussion notes", MGR)]);
  const t0 = Date.now();
  const cT = await ctx.waitUntil(async () => (await reviewNote(C, "Self comments")) === SELF && (await reviewNote(C, "Manager discussion notes")) === MGR, 12000);
  const tC = cT === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  const f2 = await reviewRow(ctx, FLOYD.id);
  R.expect(2, f2?.selfNote === SELF && f2?.managerNote === MGR, `DB Floyd Q2: selfNote "${f2?.selfNote}", managerNote "${f2?.managerNote}"`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? `C did not show both within 12 s (self "${await reviewNote(C, "Self comments")}", manager "${await reviewNote(C, "Manager discussion notes")}")` : `C showed both ${(tC / 1000).toFixed(1)} s after`);

  // Check 4: reviews have no delete in this build (open → self → lock only).
  const del = await A.locator("main").getByRole("button", { name: /delete|trash|remove/i }).count();
  R.na(4, del ? `a delete control exists (${del}) — not covered` : "a quarterly review cannot be deleted (no delete control on the page)");

  // Check 5: after reload, all three pages = DB.
  await ctx.reloadAll();
  await Promise.all([openReviewOf(ctx, A, FLOYD.name, 2), openOwnReview(ctx, B, 2), openReviewOf(ctx, C, FLOYD.name, 2)]);
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    const s = await reviewNote(p, "Self comments");
    const m = await reviewNote(p, "Manager discussion notes");
    if (s !== f2?.selfNote || m !== f2?.managerNote) bad.push(`${t}: self "${s}", manager "${m}"`);
  }
  R.expect(5, !bad.length, bad.length ? `DB self "${f2?.selfNote}", manager "${f2?.managerNote}" | ${bad.join("; ")}` : "Floyd's Q2 review on A/B/C = DB");
  await endChecks(ctx, R, m0);
  return R;
}
