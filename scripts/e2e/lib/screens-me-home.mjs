/**
 * Me and Home × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * A = sunny.b (super admin), B = floyd.dsil, C = ronlind.mene, plus a fourth
 * browser D = nikhil.pati (plain employee) where a check needs the person
 * whose own page it is. Passwords are put back through the UI at the end.
 */
import { ScreenResult, realWrites, brief, pwEq } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  personByName, personById, waitDb, openFile, openPeople, search, rowShown, trashPerson, restoreFromTrash, detail, startEdit, setField,
  saveEdit, signInAny, changeOwnPassword, openMe, openHome, alertRow, alertShown, bellCount, tryPassword, uiSignInWorks, waitQuiet,
  watchWrites, esc, trayTitles,
} from "./people-page.mjs";

const NIK = { user: "nikhil.pati", name: "Nikhil Patil", pw: ["Nikhil-e2e-1", "Nikhil-e2e-2", "Nikhil-e2e-3", "Nikhil-e2e-4"] };
const FLOYD = { user: "floyd.dsil", name: "Floyd Dsilva", pw: "Floyd-e2e-1" };
const SUNNY = { name: "Sunny" };
const peopleRe = (id) => new RegExp(`/api/people/${esc(id)}([?]|$)`);

async function dPage(ctx) {
  const browser = ctx.A.context().browser();
  const d = await signInAny(browser, ctx.base, NIK.user, NIK.pw, "Nikhil-e2e-2");
  return d;
}

// ---------------------------------------------------------------------------
// Me: own profile (Edit on the personal file)
// ---------------------------------------------------------------------------
export async function meProfile(ctx, run) {
  const R = new ScreenResult("Me", "me-profile", "Me → Edit own profile (and the same person edited from People)");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = String(run).slice(-6);
  watchWrites(ctx);
  const sunny = await personByName(ctx, SUNNY.name);
  const floyd = await personByName(ctx, FLOYD.name);
  const m0 = await openWithoutWrites(ctx, R, "Me / Sunny's file", async (p) => {
    if (p === C) await openFile(ctx, C, SUNNY.name);
    else await openMe(p);
  });

  // Setup: the seeded super admin has no Employee ID / date of birth / mobile;
  // the form refuses to save without them, so A fills them once on Me.
  await startEdit(A);
  const req = [];
  const h = [...String(run)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 3);
  const fill = { "Employee ID": `ALN4${String(h).padStart(3, "0")}`, "Date of birth": "1980-01-01", Mobile: `98${String(h).padStart(3, "0")}12345` };
  for (let i = 0; i < 4; i++) {
    const err = await saveEdit(A);
    if (!err) break;
    const k = Object.keys(fill).find((x) => err.toLowerCase().includes(x.toLowerCase().replace("date of birth", "birth")));
    if (!k) throw new Error(`Me → Edit refused: ${err}`);
    req.push(`${k} ("${err}")`);
    await setField(A, k, fill[k]);
    delete fill[k];
  }
  if (req.length) R.note(`Sunny's own Me form refused to save until these were filled: ${req.join("; ")}`);
  await ctx.settled(A);
  await waitQuiet(ctx, 2000);

  // Check 2 + 3: A edits own Location on Me while B edits Sunny's Join date from People.
  await openFile(ctx, B, SUNNY.name);
  const locA = `MeLoc ${tag}`;
  const join = "2026-06-15";
  await Promise.all([
    (async () => { await startEdit(A); await setField(A, "Location", locA); await saveEdit(A); })(),
    (async () => { await startEdit(B); await setField(B, "Join date", join); await saveEdit(B); })(),
  ]);
  const t2 = Date.now();
  const shows = async (p) => (await detail(p, "Location")) === locA && /15\/06\/2026|2026-06-15/.test((await detail(p, "Join date")) || "");
  const c2 = await ctx.waitUntil(() => shows(C), 5000);
  const tC = c2 === null ? null : Date.now() - t2;
  await ctx.settled(A); await ctx.settled(B);
  const ps = (await personById(ctx, sunny.id))?.payload || {};
  const ab = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, ps.location === locA && ps.joinDate === join && ab, `DB Sunny location ${JSON.stringify(ps.location)} (A via Me), joinDate ${JSON.stringify(ps.joinDate)} (B via People); A's Me and B's file show both ${ab}`);
  R.expect(3, tC !== null, tC === null ? `C's open file of Sunny did not show both within 5 s (Location "${await detail(C, "Location")}", Join date "${await detail(C, "Join date")}")` : `C's file of Sunny showed A's and B's edits ${(tC / 1000).toFixed(1)} s after the saves`);

  // Check 1: A and B edit their own profiles on Me at the same time.
  await openMe(B);
  const locA1 = `MeA ${tag}`;
  const locB1 = `MeB ${tag}`;
  await Promise.all([
    (async () => { await startEdit(A); await setField(A, "Location", locA1); await saveEdit(A); })(),
    (async () => { await startEdit(B); await setField(B, "Location", locB1); await saveEdit(B); })(),
  ]);
  const cA = await ctx.waitUntil(async () => (await detail(C, "Location")) === locA1, 5000);
  await ctx.settled(A); await ctx.settled(B);
  const ps1 = (await personById(ctx, sunny.id))?.payload || {};
  const pf1 = (await personById(ctx, floyd.id))?.payload || {};
  R.expect(1, ps1.location === locA1 && pf1.location === locB1 && ps1.joinDate === join, `DB Sunny location ${JSON.stringify(ps1.location)}, Floyd location ${JSON.stringify(pf1.location)}, B's earlier join date kept ${ps1.joinDate === join}; C's file of Sunny ${cA === null ? "did not follow within 5 s" : `followed in ${(cA / 1000).toFixed(1)} s`}`);
  if (cA === null) R.fail(3, `C's file of Sunny did not show A's second Me edit within 5 s`);

  // Check 4: A trashes Nikhil (People); Nikhil (D, feed held) edits his own Me and saves.
  const D = await dPage(ctx);
  const nik = await personByName(ctx, NIK.name);
  try {
    await openMe(D.page);
    await ctx.holdFeed(D.page, peopleRe(nik.id));
    await trashPerson(ctx, A, NIK.name);
    const del1 = await waitDb(ctx, async () => (await personById(ctx, nik.id))?.deleted_at);
    const dStill = (await D.page.locator("main").getByText(NIK.name, { exact: true }).count()) > 0;
    let err4 = "";
    const dNet = [];
    D.page.on("response", (r) => { if (r.request().method() !== "GET" && /\/api\//.test(r.url())) dNet.push(`${r.request().method()} ${r.url().replace(ctx.base, "")} ${r.status()}`); });
    try { await startEdit(D.page); await setField(D.page, "Mobile", "9811100011"); await saveEdit(D.page); } catch (e) { err4 = String(e).slice(0, 80); }
    await ctx.sleep(3000);
    await ctx.releaseFeed(D.page);
    await ctx.sleep(3000);
    const after = await personById(ctx, nik.id);
    await ctx.reloadAll();
    const listed = [];
    for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], NIK.name); listed.push(await rowShown(ctx[t], NIK.name) ? 1 : 0); }
    const again = await personById(ctx, nik.id);
    R.expect(4, !!del1 && dStill && !!after?.deleted_at && !!again?.deleted_at && after?.payload?.phone !== "9811100011" && listed.every((n) => !n),
      `A's delete of ${NIK.name} in DB ${!!del1}; D (Nikhil, feed held) still saw his Me ${dStill}; after his stale Me edit${err4 ? ` (${err4})` : ""} [${dNet.join(", ")}] still deleted ${!!after?.deleted_at}, stale mobile kept out ${after?.payload?.phone !== "9811100011"}; after reload deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);
  } finally {
    await D.close();
  }
  // Put Nikhil back (Settings → Trash → Restore) for the other scenarios.
  await restoreFromTrash(ctx, A, NIK.name).catch(() => {});
  await ctx.settled(A);
  await ctx.sleep(3000);
  const back = await personById(ctx, nik.id);
  R.note(`Nikhil restored from Trash: DB live ${!back?.deleted_at}${back?.deleted_at ? " — Restore did not take (see people-trash-restore)" : ""}`);

  // Check 5: reloaded; A's Me, B's Me and C's file of Sunny agree with the DB.
  await ctx.reloadAll();
  const ws = (await personById(ctx, sunny.id))?.payload || {};
  const wf = (await personById(ctx, floyd.id))?.payload || {};
  await openMe(A); await openMe(B); await openFile(ctx, C, SUNNY.name);
  const got = { A: await detail(A, "Location"), B: await detail(B, "Location"), C: await detail(C, "Location") };
  R.expect(5, got.A === ws.location && got.C === ws.location && got.B === wf.location, `DB Sunny ${JSON.stringify(ws.location)}, Floyd ${JSON.stringify(wf.location)}; A's Me ${JSON.stringify(got.A)}, B's Me ${JSON.stringify(got.B)}, C's file of Sunny ${JSON.stringify(got.C)}`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Me → Password (and the forced first sign-in "Set a new password" screen)
// ---------------------------------------------------------------------------
export async function mePassword(ctx, run) {
  const R = new ScreenResult("Me", "me-password", "Me → Password → Update (own password), first sign-in Set a new password");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  watchWrites(ctx);
  const base = ctx.base;
  const nik = await personByName(ctx, NIK.name);
  const D = await dPage(ctx);
  try {
    if (D.forced) {
      const oldF = await tryPassword(base, NIK.user, D.forced.from);
      const newF = await tryPassword(base, NIK.user, D.forced.to);
      R.note(`first sign-in forced "Set a new password": old password → ${oldF}, new → ${newF}`);
      if (oldF === 200 || newF !== 200) R.fail(1, `forced first-sign-in password change: old password still ${oldF}, new ${newF}`);
    }
    let dPass = D.pass;
    const m0 = await openWithoutWrites(ctx, R, "Me / Nikhil's file", async (p) => {
      if (p === B) await openMe(B);
      else await openFile(ctx, p, NIK.name);
    });
    await openMe(D.page);

    // Check 1: Nikhil (D) and B change their own passwords at the same time.
    const nNew = dPass === "Nikhil-e2e-3" ? "Nikhil-e2e-4" : "Nikhil-e2e-3";
    const fNew = "Floyd-e2e-2";
    const [msgD, msgB] = await Promise.all([changeOwnPassword(D.page, nNew), changeOwnPassword(B, fNew)]);
    await ctx.settled(B); await ctx.settled(D.page);
    await ctx.sleep(1500);
    const s1 = {
      nOld: await tryPassword(base, NIK.user, dPass), nNew: await tryPassword(base, NIK.user, nNew),
      fOld: await tryPassword(base, FLOYD.user, FLOYD.pw), fNew: await tryPassword(base, FLOYD.user, fNew),
    };
    const il = await ctx.sql("select username, password from issued_logins where username = any($1)", [[NIK.user, FLOYD.user]]);
    R.expect(1, s1.nOld === 401 && s1.nNew === 200 && s1.fOld === 401 && s1.fNew === 200,
      `sign-in status after the change — Nikhil old ${s1.nOld} / new ${s1.nNew}; Floyd old ${s1.fOld} / new ${s1.fNew}; issued_logins ${il.map((r) => `${r.username}=${pwEq(r.password, nNew) || pwEq(r.password, fNew) ? "new" : "old"}`).join(", ")}; messages "${msgD.slice(-40)}" / "${msgB.slice(-40)}"`);
    dPass = s1.nNew === 200 ? nNew : dPass;

    // Check 2 + 3: same person: Nikhil changes his password on Me while A edits
    // his Location from People. C idle on Nikhil's file.
    await openFile(ctx, A, NIK.name);
    const nNew2 = dPass === "Nikhil-e2e-4" ? "Nikhil-e2e-2" : "Nikhil-e2e-4";
    const loc = `PwLoc ${String(run).slice(-6)}`;
    const t0 = Date.now();
    await Promise.all([
      changeOwnPassword(D.page, nNew2),
      (async () => { await startEdit(A); await setField(A, "Location", loc); await saveEdit(A); })(),
    ]);
    const cSeen = await ctx.waitUntil(async () => (await detail(C, "Location")) === loc, 5000);
    const tC = cSeen === null ? null : Date.now() - t0;
    await ctx.settled(A); await ctx.settled(D.page);
    await ctx.sleep(1500);
    const pn = (await personById(ctx, nik.id))?.payload || {};
    const s2 = { old: await tryPassword(base, NIK.user, dPass), neu: await tryPassword(base, NIK.user, nNew2) };
    R.expect(2, pn.location === loc && s2.old === 401 && s2.neu === 200, `DB location ${JSON.stringify(pn.location)} (A via People); Nikhil's password after both saves: previous ${s2.old}, new ${s2.neu} (A's people PATCH must not bring the old secret back)`);
    if (s2.neu === 200) dPass = nNew2;
    // C's screen must never carry a password (NO-SECRETS-WIRE).
    const wire = await C.evaluate(async (id) => { const r = await fetch(`/api/people/${id}`, { credentials: "include" }); return r.text(); }, nik.id);
    const leak = /"password"\s*:/.test(wire) || wire.includes(dPass);
    R.expect(3, tC !== null && !leak, `${tC === null ? "C's file of Nikhil did not show A's Location within 5 s" : `C's file showed A's Location ${(tC / 1000).toFixed(1)} s after the save`}; password on C's wire ${leak}`);
    R.na(4, "a password has no delete; deleting the person while he is on Me is checked in me-profile check 4");

    // Check 5: everyone reloads; the DB and fresh sign-ins agree.
    await ctx.reloadAll();
    await D.page.reload({ waitUntil: "load" });
    const dStill = await D.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    const browser = A.context().browser();
    const uiNew = await uiSignInWorks(browser, base, NIK.user, dPass);
    const uiOld = await uiSignInWorks(browser, base, NIK.user, nNew);
    const uiF = await uiSignInWorks(browser, base, FLOYD.user, fNew);
    const il5 = await ctx.sql("select password from issued_logins where username = $1", [NIK.user]);
    await openFile(ctx, C, NIK.name);
    const cLoc = await detail(C, "Location");
    R.expect(5, uiNew && !uiOld && uiF && pwEq(il5[0]?.password, dPass) && cLoc === pn.location && dStill,
      `fresh UI sign-in: Nikhil current ${uiNew}, previous ${uiOld}, Floyd new ${uiF}; issued_logins holds the current ${pwEq(il5[0]?.password, dPass)}; Nikhil's session survived reload ${dStill}; C's file Location ${JSON.stringify(cLoc)} = DB ${JSON.stringify(pn.location)}`);

    // Put the fixture passwords back through the same screen.
    const backB = await changeOwnPassword(B, FLOYD.pw);
    const backD = await changeOwnPassword(D.page, NIK.pw[0]);
    await ctx.settled(B); await ctx.settled(D.page);
    await ctx.sleep(1500);
    const okB = (await tryPassword(base, FLOYD.user, FLOYD.pw)) === 200;
    const okD = (await tryPassword(base, NIK.user, NIK.pw[0])) === 200;
    R.note(`passwords put back through Me: Floyd ${okB} ("${backB.slice(-30)}"), Nikhil ${okD} ("${backD.slice(-30)}")`);
    await endChecks(ctx, R, m0);
  } finally {
    await D.close();
  }
  return R;
}

// ---------------------------------------------------------------------------
// Home: alerts (Done) and notices
// ---------------------------------------------------------------------------
const OPS = ["People without role", "People without login", "People without APMS assigned", "People without Rewards assigned", "APMS overdue to close", "Rewards overdue to close"];

async function dismissed(ctx) {
  const r = await ctx.sql("select payload, rev from entities where kind = 'settings' and id = 'dismissedAlertIds' and deleted_at is null");
  const v = r[0]?.payload?.value;
  return Array.isArray(v) ? v : [];
}

export async function homeAlerts(ctx, run) {
  const R = new ScreenResult("Home", "home-alerts", "Home → Alerts: Done on company alerts (dismissedAlertIds) and on own notices");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  watchWrites(ctx);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "Home", (p) => openHome(p));
  const onC = [];
  for (const t of OPS) if (await alertShown(C, t)) onC.push(t);
  const onA = [];
  for (const t of OPS) if (await alertShown(A, t)) onA.push(t);
  R.note(`company alerts on A: ${onA.join(", ")}; on C: ${onC.join(", ")}`);
  const both = OPS.filter((t) => onA.includes(t) && onC.includes(t));
  if (both.length < 5) throw new Error(`need 5 company alerts shown to A and C, found ${both.join(", ")}`);
  const [x1, x2, y1, z1, z2] = both;

  // Check 2 + 3: same record (settings dismissedAlertIds): A and B mark two different alerts Done.
  const t0 = Date.now();
  await Promise.all([alertRow(A, x1).getByRole("button", { name: "Done" }).click(), alertRow(B, x2).getByRole("button", { name: "Done" }).click()]);
  const cGone = await ctx.waitUntil(async () => !(await alertShown(C, x1)) && !(await alertShown(C, x2)), 5000);
  const tC = cGone === null ? null : Date.now() - t0;
  await ctx.settled(A); await ctx.settled(B);
  const d2 = await dismissed(ctx);
  const abGone = (await ctx.waitUntil(async () => !(await alertShown(A, x2)) && !(await alertShown(B, x1)), 5000)) !== null;
  R.expect(2, d2.includes(`ops:${x1}`) && d2.includes(`ops:${x2}`) && abGone, `DB dismissedAlertIds ${JSON.stringify(d2)}; A no longer shows B's and B no longer shows A's ${abGone}`);
  R.expect(3, tC !== null, tC === null ? `C still showed "${x1}" or "${x2}" 5 s after A and B marked them Done` : `C dropped both alerts ${(tC / 1000).toFixed(1)} s after the clicks`);

  // Check 1: different records: A marks one of her own notices Done (notices row),
  // B marks a company alert Done (settings row).
  const nRow = A.locator("main li").filter({ has: A.getByRole("button", { name: "Done", exact: true }) }).filter({ hasText: /days to lock|is late|^\s*Close / }).first();
  const nTitle = ((await nRow.locator("span, p").first().innerText().catch(() => "")) || "").trim();
  await Promise.all([nRow.getByRole("button", { name: "Done" }).click(), alertRow(B, y1).getByRole("button", { name: "Done" }).click()]);
  await ctx.settled(A); await ctx.settled(B);
  await ctx.sleep(1000);
  const d1 = await dismissed(ctx);
  const nt = await ctx.sql("select id, payload from entities where kind = 'notices' and deleted_at is null and payload->>'title' = $1", [nTitle]);
  const aNotice = nt.find((r) => (r.payload.toIds || []).includes("p-admin") || (r.payload.doneIds || []).length);
  const noticeDone = !!aNotice && (aNotice.payload.status === "done" || (aNotice.payload.doneIds || []).length > 0);
  const cY = await ctx.waitUntil(async () => !(await alertShown(C, y1)), 5000);
  R.expect(1, noticeDone && d1.includes(`ops:${y1}`) && !(await alertShown(A, nTitle)), `A's notice "${nTitle}" done in DB ${noticeDone} (${nt.length} row(s)); B's "${y1}" in dismissedAlertIds ${d1.includes(`ops:${y1}`)}; C dropped B's alert ${cY === null ? "no (5 s)" : `in ${(cY / 1000).toFixed(1)} s`}`);

  // Check 4: "delete" = Done (the alert leaves every Home). A marks z1 Done; B
  // (feed held, still sees z1) marks z2 Done from its stale list.
  await ctx.holdFeed(B, /\/api\/e\/settings/);
  await alertRow(A, z1).getByRole("button", { name: "Done" }).click();
  await ctx.settled(A);
  const del1 = await waitDb(ctx, async () => (await dismissed(ctx)).includes(`ops:${z1}`));
  const bStill = await alertShown(B, z1);
  await alertRow(B, z2).getByRole("button", { name: "Done" }).click();
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const d4 = await dismissed(ctx);
  await ctx.reloadAll();
  for (const p of [A, B, C]) await openHome(p);
  const shown4 = [];
  for (const p of [A, B, C]) shown4.push(((await alertShown(p, z1)) ? 1 : 0) + ((await alertShown(p, z2)) ? 1 : 0));
  R.expect(4, !!del1 && bStill && d4.includes(`ops:${z1}`) && d4.includes(`ops:${z2}`) && shown4.every((n) => n === 0),
    `A's Done on "${z1}" in DB ${!!del1}; B still showed it ${bStill}; after B's stale Done on "${z2}" the DB keeps both ${d4.includes(`ops:${z1}`)}/${d4.includes(`ops:${z2}`)} (${JSON.stringify(d4)}); after reload z1+z2 shown on A/B/C ${shown4.join("/")}`);

  // Check 5: reloaded; every company alert is shown exactly when it is not dismissed.
  const d5 = await dismissed(ctx);
  const bad = [];
  for (const [tg, p] of [["A", A], ["B", B], ["C", C]]) {
    for (const t of OPS) {
      const s = await alertShown(p, t);
      if (d5.includes(`ops:${t}`) && s) bad.push(`${tg} shows dismissed "${t}"`);
    }
  }
  R.expect(5, bad.length === 0, bad.length ? bad.join("; ") : `no dismissed alert shown on A/B/C (dismissed ${d5.length})`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Home: notification bell badge (NOTICE-GLANCE — per browser, not in the DB)
// ---------------------------------------------------------------------------
export async function homeNoticeBadge(ctx, run) {
  const R = new ScreenResult("Home", "home-notice-badge", "Notification bell: badge drops for seen notices (not in the DB)");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  watchWrites(ctx);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "Home", (p) => openHome(p));
  const before = { A: await bellCount(A), B: await bellCount(B), C: await bellCount(C) };
  const mg = ctx.mark();
  await A.locator("button[aria-label='Notifications']").first().click();
  await A.waitForTimeout(2000);
  const aOpen = await bellCount(A);
  await A.keyboard.press("Escape");
  await A.mouse.click(700, 600);
  await A.waitForTimeout(1500);
  const w = ["A", "B", "C"].flatMap((t) => realWrites(mg.writes(t)).map((n) => `${t}: ${brief([n])[0]}`));
  if (w.length) R.fail(6, `opening the bell tray wrote: ${w.join("; ")}`);
  const aAfter = await bellCount(A);
  const others = { B: await bellCount(B), C: await bellCount(C) };
  const ls = await A.evaluate(() => Object.keys(localStorage).filter((k) => /glance/i.test(k)));
  const inDb = await ctx.sql("select kind, id from entities where payload::text ilike '%glance%' union all select 'people', id from people where payload::text ilike '%glance%'");
  R.note(`bell before A/B/C ${before.A}/${before.B}/${before.C}; A with the tray open ${aOpen}, after ${aAfter}; B/C after ${others.B}/${others.C}; A's localStorage ${ls.join(", ")}; DB rows mentioning glance ${inDb.length}`);
  R.na(1, "the badge is per-browser state (NOTICE-GLANCE: localStorage apms-glanced-v1:<person>), no record to edit");
  R.na(2, "same: nothing in the DB; marking a notice Done is checked in home-alerts");
  R.na(3, "another user never sees this browser's glance state by design; live notice changes are checked in home-alerts");
  R.na(4, "a badge has nothing to delete (Done on a notice is home-alerts check 1)");
  const dropOk = before.A > 0 ? aAfter < before.A : aAfter === 0;
  if (!dropOk) R.fail(5, `A's badge did not drop after the tray was seen (${before.A} → ${aAfter})`);

  // Check 5: reload; A keeps the lower count (browser storage), B/C unchanged, nothing in the DB.
  const glance0 = await A.evaluate(() => { const k = Object.keys(localStorage).find((x) => /glance/i.test(x)); return k ? JSON.parse(localStorage.getItem(k) || "[]") : []; });
  const notes0 = await ctx.sql("select id, payload->>'title' t from entities where kind = 'notices' and deleted_at is null");
  await ctx.reloadAll();
  for (const p of [A, B, C]) await openHome(p);
  await ctx.sleep(1500);
  const re = { A: await bellCount(A), B: await bellCount(B), C: await bellCount(C) };
  if (re.A !== aAfter) {
    const notes1 = await ctx.sql("select id, payload->>'title' t from entities where kind = 'notices' and deleted_at is null");
    const fresh = notes1.filter((n) => !notes0.some((o) => o.id === n.id)).map((n) => `${n.id} "${n.t}"`);
    R.note(`A's badge after reload ${re.A} vs ${aAfter}: glanced ids ${JSON.stringify(glance0)}; notice rows created meanwhile ${fresh.join(", ") || "none"}; tray now ${JSON.stringify(await trayTitles(A))}`);
  }
  R.expect(5, dropOk && re.A === aAfter && re.B === before.B && re.C === before.C && inDb.length === 0,
    `after reload A ${re.A} (was ${aAfter} after the tray), B ${re.B} (was ${before.B}), C ${re.C} (was ${before.C}); DB rows with glance state ${inDb.length}`);
  await endChecks(ctx, R, m0);
  return R;
}

/** Every page / tab / dialog / button in Me and Home that saves data. */
export const SCREENS = [
  { module: "Me", screen: "Me → Edit (own profile form; super admin sees the full person form, an employee sees first/last name, work email, mobile)", saves: "own people row", scenario: "me-profile", reached: true, why: "" },
  { module: "Me", screen: "Me → Password → New password → Update", saves: "own people row password + POST /api/issued-logins own row", scenario: "me-password", reached: true, why: "" },
  { module: "Me", screen: "First sign-in → Set a new password (forced, mustResetPassword)", saves: "issued_logins + people password/mustResetPassword + /api/auth/change-password", scenario: "me-password", reached: true, why: "only on the fresh DB's first Nikhil sign-in (reported as a note + check 1 when it happens)" },
  { module: "Me", screen: "Me → Core role select", saves: "own roleId", scenario: null, reached: false, why: "same select and handler as the person file's Core role (people-edit); changing the super admin's own role would change the rest of the run" },
  { module: "Me", screen: "Me → Change role", saves: "roleCases", scenario: null, reached: false, why: "role-change case workflow; not driven (see People SCREENS)" },
  { module: "Me", screen: "Me → Edit KROC / View KROC", saves: "role (KROC)", scenario: null, reached: false, why: "edits the job role — Org → Roles" },
  { module: "Me", screen: "Me → Add review (quarterly self review)", saves: "quarter review", scenario: null, reached: false, why: "covered by APMS apmsQuarterReview (screens-apms-eo.mjs)" },
  { module: "Me", screen: "Account page (gm, /account) password form", saves: "same changeOwnPassword", scenario: null, reached: false, why: "no nav entry reaches it in this build (Me carries the Password section); same handler as Me → Password" },
  { module: "Home", screen: "Home → Alerts → Done (company alerts: People without role/login/APMS/Rewards, overdue to close)", saves: "settings/dismissedAlertIds (one shared row)", scenario: "home-alerts", reached: true, why: "" },
  { module: "Home", screen: "Home → Alerts → Done (own plan notices: N days to lock / is late / Close month)", saves: "notices row (status done, doneIds)", scenario: "home-alerts", reached: true, why: "" },
  { module: "Home", screen: "Home → Alerts → Open", saves: "nothing (navigation)", scenario: null, reached: true, why: "navigation only" },
  { module: "Home", screen: "Notification bell (tray open / glance)", saves: "nothing in the DB (localStorage apms-glanced-v1)", scenario: "home-notice-badge", reached: true, why: "" },
  { module: "Home", screen: "Home period tabs (Last month / QTD / YTD), KPI tiles, Awards won, Your EOs", saves: "nothing", scenario: null, reached: true, why: "read-only dashboard" },
  { module: "Home", screen: "View as (impersonate a person)", saves: "nothing (session view)", scenario: null, reached: false, why: "view switch only; not driven" },
];

export const SCENARIOS = [
  ["homeNoticeBadge", homeNoticeBadge],
  ["homeAlerts", homeAlerts],
  ["mePassword", mePassword],
  ["meProfile", meProfile],
];
