/**
 * BATCH-3 screens (security part) × the six checks, A / B / C = admins,
 * D = nikhil.pati (plain employee, the low-permission fourth browser),
 * F = ravi.kuma (function head: People edit, no pay / personal flags).
 *
 *   signin-lockout       Sign-in screen lock-out message; Settings → Assign people
 *                        "Locked sign-ins" card; Unlock (two admins at once).
 *   session-ended        Assign people → Reset login ends the person's open
 *                        browsers (sign-in page + notice); Me → Password ends the
 *                        person's other browser, keeps this one.
 *   default-pin          APMS_DEFAULT_PIN=off → sign-in screen refuses 0000 with
 *                        a clear message (server restarted off, then on again).
 *   employee-d           D through the UI and direct API calls from D's page:
 *                        no salaries / personal fields / other people's plans /
 *                        trash / backups; writes refused; D's own saves keep every
 *                        field D cannot change; allowed live updates reach D < 1 s.
 *   restricted-editor    F edits a function member's file: salary / reward slabs /
 *                        personal fields are not shown and are kept on save, also
 *                        while an admin changes the salary at the same moment.
 */
import { ScreenResult, realWrites, brief, pwEq } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import { openSettings, resetLogin, freshPage, uiSignIn, setFirstPassword, apiSignIn, apiPost, personIdByName } from "./settings-page.mjs";
import { openFile, detail, startEdit, setField, saveEdit, openMe, changeOwnPassword, signInAny, waitQuiet, field } from "./people-page.mjs";

const NIK = { user: "nikhil.pati", name: "Nikhil Patil" };
const RAVI = { user: "ravi.kuma", name: "Ravi Kumar Bable", pw: "Ravi-e2e-1" };
const shotDir = () => (process.env.OUT || "e2e.json").replace(/[^/]*$/, "") || "./";
const shot = (p, name) => p.screenshot({ path: `${shotDir()}b3-${name}.png` }).catch(() => {});
const secs = (ms) => (ms === null ? "not within the limit" : `${(ms / 1000).toFixed(1)} s`);

async function adminToken(ctx) {
  const c = (await ctx.A.context().cookies()).find((x) => x.name === "better-auth.session_token");
  return c ? decodeURIComponent(c.value) : "";
}
/** Put a known password on a person (admin API) and return it. */
async function setPassword(ctx, username, name, password) {
  await apiPost(ctx.base, "/api/issued-logins", await adminToken(ctx), { rows: [{ username, password, personId: await personIdByName(ctx, name) }] });
  return password;
}
async function onSignInPage(p) {
  return (await p.getByRole("button", { name: "Continue" }).count().catch(() => 0)) > 0 && (await p.locator('input[type="password"]').count().catch(() => 0)) > 0;
}
async function signInMessage(p) {
  return (await p.locator("form").first().innerText().catch(() => "")).replace(/\s+/g, " ");
}
async function typeSignIn(p, user, pass) {
  await p.locator('input[type="text"]').first().fill(user);
  await p.locator('input[type="password"]').first().fill(pass);
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForTimeout(1200);
}
/** A signed-in page for `user` (handles the forced first-sign-in screen). */
async function userPage(ctx, user, candidates, resetTo) {
  return signInAny(ctx.A.context().browser(), ctx.base, user, candidates, resetTo);
}

// ---------------------------------------------------------------------------
// Sign-in lock-out + Settings → Assign people "Locked sign-ins" / Unlock
// ---------------------------------------------------------------------------
export async function signinLockout(ctx, run) {
  const R = new ScreenResult("Sign-in", "signin-lockout", "Sign-in lock-out message · Settings → Assign people → Locked sign-ins → Unlock");
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const victim = { user: "hetal.soni", name: "Hetal Soni" };
  const pw = await setPassword(ctx, victim.user, victim.name, `Hetal-${run}-1`);
  const m0 = await openWithoutWrites(ctx, R, "Settings → Assign people", (p) => openSettings(ctx, p, "Assign people"));
  const P = await freshPage(ctx);
  try {
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      await typeSignIn(P, victim.user, `wrong-${i}`);
      msgs.push(await signInMessage(P));
    }
    await typeSignIn(P, victim.user, pw);
    const lockedMsg = await signInMessage(P);
    await shot(P, "signin-locked");
    const lockedUi = /locked/i.test(msgs[4]) && /locked/i.test(lockedMsg) && (await onSignInPage(P));
    const t0 = Date.now();
    const cardC = await ctx.waitUntil(async () => (await C.locator("main [data-apms-locks]").innerText().catch(() => "")).includes(victim.user), 8000);
    await shot(C, "locked-card");
    R.expect(3, lockedUi && cardC !== null,
      `sign-in screen after 5 wrong: "${(msgs[4].match(/Too many[^.]*\./) || [msgs[4].slice(-90)])[0]}"; right password while locked: ${/locked/i.test(lockedMsg) ? "refused with the lock message" : `"${lockedMsg.slice(-80)}"`}; C's idle Assign people showed "Locked sign-ins: ${victim.user}" ${secs(cardC === null ? null : Date.now() - t0)} after the lock (card re-reads every 5 s)`);
    // Check 1 + 2: A and B press Unlock at the same moment.
    await Promise.all([A, B].map((p) => ctx.waitUntil(async () => (await p.locator("main [data-apms-locks]").innerText().catch(() => "")).includes(victim.user), 8000)));
    const pre = await ctx.sql("select key, fails, locked_until from apms_signin_failures where key = $1", [`u:${victim.user}`]);
    const cards = [];
    for (const p of [A, B]) cards.push((await p.locator("main [data-apms-locks]").innerText().catch(() => "(no card)")).replace(/\s+/g, " ").slice(0, 120));
    R.note(`before Unlock: DB ${JSON.stringify(pre)}; A card "${cards[0]}"; B card "${cards[1]}"`);
    const posts = await Promise.all([A, B].map(async (p) => {
      const resp = p.waitForResponse((r) => /\/api\/login-locks$/.test(r.url()) && r.request().method() === "POST", { timeout: 10000 }).then((r) => String(r.status()), () => "no request");
      await p.locator("main [data-apms-locks] li").filter({ hasText: victim.user }).getByRole("button", { name: "Unlock" }).click({ timeout: 5000 }).catch(() => {});
      return resp;
    }));
    await ctx.sleep(1500);
    const dbLock = await ctx.sql("select locked_until from apms_signin_failures where key = $1 and locked_until > now()", [`u:${victim.user}`]);
    const still = async () => {
      const out = [];
      for (const [t, p] of Object.entries({ A, B, C })) if ((await p.locator("main [data-apms-locks]").count()) > 0 && (await p.locator("main [data-apms-locks]").innerText().catch(() => "")).includes(victim.user)) out.push(t);
      return out;
    };
    const gone = await ctx.waitUntil(async () => (await still()).length === 0, 12000);
    if (gone === null) R.note(`card still on ${(await still()).join(",")} 12 s after the unlock`);
    R.expect(1, dbLock.length === 0 && posts.some((s) => s === "200") && posts.every((s) => s === "200" || s === "no request"), `A and B pressed Unlock together: POST /api/login-locks A ${posts[0]}, B ${posts[1]}; DB lock rows ${dbLock.length}`);
    R.expect(2, gone !== null, `the card left A, B and C ${secs(gone)} after the unlock`);
    const after = await uiSignIn(P, victim.user, pw);
    if (after !== "app" && after !== "must-reset") R.fail(1, `after the unlock the right password → ${after}`);
    else R.note(`after the unlock the right password signs in (${after})`);
    R.na(4, "a sign-in lock has no edit or delete of its own; a second Unlock of an unlocked name is a no-op (check 1 has both at once)");
    await ctx.reloadAll();
    for (const p of [A, B, C]) await openSettings(ctx, p, "Assign people");
    await ctx.sleep(1500);
    const stale = [];
    for (const [t, p] of Object.entries({ A, B, C })) if ((await p.locator("main [data-apms-locks]").count()) > 0) stale.push(t);
    R.expect(5, !stale.length, stale.length ? `card still shown after reload on ${stale.join(",")}` : "after reload no Locked sign-ins card on A/B/C; DB has no lock");
  } finally {
    await P.context().close();
  }
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Sessions ended: admin Reset login, own password change
// ---------------------------------------------------------------------------
export async function sessionEnded(ctx, run) {
  const R = new ScreenResult("Settings", "session-ended", "Assign people → Reset login / Me → Password: the person's other browsers land on sign-in");
  await waitQuiet(ctx);
  const { A } = ctx;
  const base0 = await setPassword(ctx, NIK.user, NIK.name, `Nik-${run}-0`);
  const D1 = await userPage(ctx, NIK.user, [base0], `Nik-${run}-1`);
  const cur = D1.pass;
  const D2 = await userPage(ctx, NIK.user, [cur], `Nik-${run}-1`);
  const m0 = await openWithoutWrites(ctx, R, "Settings → Assign people", (p) => openSettings(ctx, p, "Assign people"));
  try {
    await openMe(D1.page);
    await openMe(D2.page);
    // Admin reset: both of Nikhil's browsers end.
    const cred = await resetLogin(A, NIK.name);
    const t0 = Date.now();
    const out1 = await ctx.waitUntil(() => onSignInPage(D1.page), 15000, 250);
    const out2 = await ctx.waitUntil(() => onSignInPage(D2.page), 15000, 250);
    const s1 = Date.now() - t0;
    const note = await signInMessage(D1.page);
    await shot(D1.page, "session-ended");
    const oldPw = (await apiSignIn(ctx.base, NIK.user, cur)).status;
    R.expect(1, out1 !== null && out2 !== null && /signed out because your password was changed/i.test(note) && oldPw === 401 && !!cred.password,
      `A reset ${NIK.name}: temporary password shown once in the dialog ${cred.password ? "yes" : "no"}; D1 on sign-in ${out1 === null ? "no" : "yes"}, D2 ${out2 === null ? "no" : "yes"} (both within ${(s1 / 1000).toFixed(1)} s); D1 says "${(note.match(/You were signed out[^.]*\./) || ["(no notice)"])[0]}"; old password → ${oldPw}`);
    R.expect(3, out1 !== null && out2 !== null && s1 <= 10000, `open browsers left the app ${(s1 / 1000).toFixed(1)} s after the reset (limit 10 s)`);
    // D1 signs in with the temporary password → forced new password.
    const r1 = await uiSignIn(D1.page, NIK.user, cred.password);
    const next = `Nik-${run}-2`;
    if (r1 === "must-reset") await setFirstPassword(D1.page, cred.password, next);
    await D1.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 });
    // Own change in D1: D2 (signed in again) must end, D1 stays.
    const r2 = await uiSignIn(D2.page, NIK.user, next);
    await D2.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {});
    const own = `Nik-${run}-3`;
    const msg = await changeOwnPassword(D1.page, own);
    const t1 = Date.now();
    const out3 = await ctx.waitUntil(() => onSignInPage(D2.page), 15000, 250);
    const s2 = Date.now() - t1;
    await ctx.sleep(3000);
    const d1In = (await D1.page.locator("aside, nav").first().getByText("Me", { exact: true }).count()) > 0 && !(await onSignInPage(D1.page));
    const iss = (await ctx.sql("select password from issued_logins where username = $1", [NIK.user]))[0];
    R.expect(2, r2 !== "refused" && out3 !== null && d1In && pwEq(iss?.password, own),
      `own change on Me ("${msg.slice(-30)}"): the other browser D2 on sign-in ${out3 === null ? "no" : `after ${(s2 / 1000).toFixed(1)} s`}; D1 (made the change) still in the app ${d1In}; issued_logins holds the new password (hash) ${pwEq(iss?.password, own)}`);
    R.na(4, "a password or session has no delete; sign-out is covered by the security suite (token 401 after sign-out)");
    await D1.page.reload({ waitUntil: "load" });
    const d1After = await D1.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    const sess = Number((await ctx.sql("select count(*) n from apms_sessions where person_id = $1 and expires_at > now()", [await personIdByName(ctx, NIK.name)]))[0].n);
    R.expect(5, d1After && sess >= 1, `after reload D1 is still signed in ${d1After}; ${NIK.name} has ${sess} live session(s) in apms_sessions`);
  } finally {
    await D1.close();
    await D2.close();
  }
  // Put Nikhil's fixture password back.
  await setPassword(ctx, NIK.user, NIK.name, "Nikhil-e2e-1");
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// APMS_DEFAULT_PIN=off / on (server restarted)
// ---------------------------------------------------------------------------
export async function defaultPin(ctx) {
  const R = new ScreenResult("Sign-in", "default-pin", "APMS_DEFAULT_PIN=off: sign-in refuses 0000 with a message; on again: sunny.b / 0000 works");
  if (!ctx.restart) {
    R.na(1, "runner cannot restart the server (no PORT / OUTPUT given)");
    return R;
  }
  await waitQuiet(ctx);
  const m0 = ctx.mark();
  const noPw = (await ctx.sql(`select payload->>'username' u from people p where deleted_at is null and payload->>'status'='active'
      and coalesce(payload->>'password','') = '' and coalesce(payload->>'username','') <> ''
      and not exists (select 1 from issued_logins i where i.username = p.payload->>'username' or i.person_id = p.id) order by id limit 1`))[0].u;
  await ctx.restart({ APMS_DEFAULT_PIN: "off" });
  const P = await freshPage(ctx);
  try {
    await typeSignIn(P, "sunny.b", "0000");
    const offS = await signInMessage(P);
    await shot(P, "default-pin-off");
    await typeSignIn(P, noPw, "0000");
    const offN = await signInMessage(P);
    const b = await uiSignIn(P, ctx.users.B[0], ctx.users.B[1]);
    R.expect(1, /0000 is switched off/i.test(offS) && /0000 is switched off/i.test(offN) && (await onSignInPage(P) || b === "app"),
      `off: sunny.b / 0000 → "${(offS.match(/The starter password[^.]*\./) || [offS.slice(-80)])[0]}"; ${noPw} (no password) / 0000 → ${/switched off/.test(offN) ? "same message" : `"${offN.slice(-60)}"`}; ${ctx.users.B[0]} with a real password → ${b}`);
  } finally {
    await P.context().close();
  }
  await ctx.restart({ APMS_DEFAULT_PIN: "on" });
  const P2 = await freshPage(ctx);
  try {
    const on = await uiSignIn(P2, "sunny.b", "0000");
    R.expect(2, on === "app", `switched back on: sunny.b / 0000 → ${on} (never locked out)`);
  } finally {
    await P2.context().close();
  }
  // The three open admin browsers kept working across both restarts.
  const alive = [];
  for (const t of ["A", "B", "C"]) alive.push((await ctx[t].evaluate(async () => (await fetch("/api/people?limit=1", { credentials: "include" })).status)) === 200 ? t : `${t}✗`);
  R.expect(3, alive.every((x) => !x.includes("✗")), `A/B/C sessions after two restarts: ${alive.join(" ")}`);
  R.na(4, "a server switch has no record to delete");
  R.na(5, "nothing saved");
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// D: the low-permission employee (UI + direct API calls from D's page)
// ---------------------------------------------------------------------------
export async function employeeD(ctx, run) {
  const R = new ScreenResult("All", "employee-d", "Fourth browser D (employee): reads, writes, own saves, live updates");
  await waitQuiet(ctx);
  const { A, C } = ctx;
  const nikId = await personIdByName(ctx, NIK.name);
  const D = await userPage(ctx, NIK.user, ["Nikhil-e2e-1", `Nik-${run}-d`], `Nik-${run}-d`);
  const seen = [];
  const dWrites = [];
  D.page.on("response", async (r) => {
    if (r.request().method() !== "GET" && /\/api\//.test(r.url())) dWrites.push(`${r.request().method()} ${r.url().replace(ctx.base, "")} ${r.status()} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
  D.page.on("response", async (r) => {
    const u = r.url();
    if (!/\/api\/(company|changes|people|e\/|org|month-records|reward-records|company-tick)/.test(u)) return;
    const body = await r.text().catch(() => "");
    seen.push({ u: u.replace(ctx.base, ""), s: r.status(), body });
  });
  const m0 = await openWithoutWrites(ctx, R, "People (A/B/C) while D signs in", (p) => ctx.nav(p, "Org"));
  try {
    const nav = (await D.page.locator("aside, nav").first().innerText()).replace(/\s+/g, " ");
    const forbiddenNav = ["Org", "Settings", "KPI", "MIS", "Roster"].filter((x) => new RegExp(`\\b${x}\\b`).test(nav));
    for (const [top, sub] of [["APMS", "My APMS"], ["Rewards", "My rewards"], ["Home"], ["Me"]]) {
      await ctx.nav(D.page, top, sub);
      await shot(D.page, `employee-${(sub || top).replace(/\W+/g, "_")}`);
    }
    // Direct API calls from D's own page (the browser's session).
    const api = await D.page.evaluate(async ({ nikId }) => {
      const j = async (u, o) => {
        const r = await fetch(u, { credentials: "include", ...(o || {}) });
        let b = null;
        try { b = await r.json(); } catch { /* */ }
        return { s: r.status, b };
      };
      // XHR, not fetch: the sync layer answers a repeat fetch of /api/company
      // from its cache ({ unchanged: true }); this must hit the server.
      const w = await new Promise((res) => {
        const x = new XMLHttpRequest();
        x.open("GET", "/api/company");
        x.withCredentials = true;
        x.onload = () => { let b = null; try { b = JSON.parse(x.responseText); } catch { /* */ } res({ s: x.status, b }); };
        x.onerror = () => res({ s: 0, b: null });
        x.send();
      });
      const snap = w.b?.snapshotJson ? JSON.parse(w.b.snapshotJson) : { people: [] };
      const others = snap.people.filter((p) => p.id !== nikId);
      const recs = Object.values(snap.records || {}).flatMap((m) => Object.keys(m));
      const rrs = Object.values(snap.rewardRecords || {}).flatMap((m) => Object.keys(m));
      const firstOther = others[0]?.id;
      const person = await j(`/api/people/${firstOther}`);
      const feed = await j("/api/changes?since=0&payload=1&limit=2000");
      const leak = (feed.b?.changes || []).filter((c) => c.kind === "people" && c.k1 !== nikId && c.payload && ("salary" in c.payload || "dob" in c.payload)).length;
      const trash = await j("/api/e/trash");
      const back = await j("/api/company-backups");
      const org = await j("/api/org?kind=trash");
      const wOther = await j(`/api/people/${firstOther}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRev: person.b?.rev || 1, payload: { ...(person.b?.payload || {}), title: "D was here" } }) });
      const wKpi = await j("/api/e/kpi-master/d-x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRev: 0, payload: { id: "d-x", name: "x" } }) });
      return {
        salaries: others.filter((p) => "salary" in p || "rewardsSlabs" in p).length,
        personal: others.filter((p) => "dob" in p || "phone" in p).length,
        others: others.length,
        recs: [...new Set([...recs, ...rrs])].filter((id) => id !== nikId).length,
        trash: (snap.trash || []).length,
        personSalary: "salary" in (person.b?.payload || {}),
        feedLeak: leak,
        trashRows: trash.b?.rows?.length ?? -1,
        backups: back.s,
        orgTrash: org.s,
        writeOther: `${wOther.s} ${wOther.b?.error || ""} ${wOther.b?.kind || ""} ${wOther.b?.field || ""}`.trim(),
        writeKpi: `${wKpi.s} ${wKpi.b?.error || ""} ${wKpi.b?.kind || ""}`.trim(),
      };
    }, { nikId });
    R.expect(1, !forbiddenNav.length && api.salaries === 0 && api.personal === 0 && api.recs === 0 && api.trash === 0 && !api.personSalary && api.feedLeak === 0 && api.trashRows === 0 && api.backups === 403 && api.orgTrash === 403,
      `D's nav: ${nav.slice(0, 90)}${forbiddenNav.length ? ` (should not show ${forbiddenNav.join(",")})` : ""}; from D's page: wire ${api.others} other people, with salary ${api.salaries}, with dob/phone ${api.personal}, other people's plans ${api.recs}, trash ${api.trash}; /api/people/:other salary ${api.personSalary}; feed rows with others' salary ${api.feedLeak}; /api/e/trash rows ${api.trashRows}; backups ${api.backups}; /api/org?kind=trash ${api.orgTrash}`);
    const wr = /^403 forbidden people/.test(api.writeOther) && /^403 forbidden kpi-master/.test(api.writeKpi);
    // D's own save (Me → Edit → Mobile) keeps every field D cannot change.
    const before = (await ctx.sql("select payload from people where id = $1", [nikId]))[0].payload;
    await openMe(D.page);
    await startEdit(D.page);
    const mobile = `98${String(Date.now()).slice(-8)}`;
    await setField(D.page, "Mobile", mobile);
    const err = await saveEdit(D.page);
    await ctx.settled(D.page);
    await ctx.sleep(1500);
    await ctx.waitUntil(async () => (await ctx.sql("select payload->>'phone' p from people where id = $1", [nikId]))[0].p === mobile, 8000);
    const afterRow = (await ctx.sql("select payload from people where id = $1", [nikId]))[0].payload;
    if (afterRow.phone !== mobile) R.note(`D's writes around the Me save: ${dWrites.slice(-6).join(" | ")}`);
    const keep = ["salary", "bandMidpoint", "rewardsSlabs", "access", "accessRoleId", "password", "roleId", "managerId", "dob", "employeeCode"];
    const changed = keep.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(afterRow[k]));
    R.expect(2, wr && afterRow.phone === mobile && !changed.length && !err,
      `D's writes to others refused: people ${api.writeOther}, kpi-master ${api.writeKpi}; D's Me save ${err ? `refused "${err}"` : "saved"} (mobile in DB ${afterRow.phone === mobile}); fields D cannot change kept: ${changed.length ? `CHANGED ${changed.join(",")}` : keep.join(", ")}`);
    // Live: A edits Nikhil's Location; D idle on Me and C idle on his file must follow (< 1 s for D).
    await openMe(D.page);
    await openFile(ctx, C, NIK.name);
    await openFile(ctx, A, NIK.name);
    const loc = `D-live ${String(run).slice(-5)}`;
    await startEdit(A);
    await setField(A, "Location", loc);
    let tSave = 0;
    const saveP = A.waitForResponse((r) => /\/api\/people\//.test(r.url()) && r.request().method() === "PATCH", { timeout: 15000 }).then(() => (tSave = Date.now())).catch(() => {});
    await saveEdit(A);
    await saveP;
    const dMs = await ctx.waitUntil(async () => (await detail(D.page, "Location")) === loc, 8000, 50);
    const dLat = dMs === null ? null : Date.now() - (tSave || Date.now());
    const cMs = await ctx.waitUntil(async () => (await detail(C, "Location")) === loc, 8000, 50);
    const cLat = cMs === null ? null : Date.now() - (tSave || Date.now());
    R.expect(3, dLat !== null && dLat <= 1000, `A's Location edit on ${NIK.name} (allowed for D to see): D's idle Me showed it ${dLat === null ? "not within 8 s" : `${(dLat / 1000).toFixed(2)} s`} after A's save returned; C (admin) ${cLat === null ? "not within 8 s" : `${(cLat / 1000).toFixed(2)} s`}`);
    // A changes someone else's salary: nothing of it reaches D.
    const other = (await ctx.sql("select id, payload, rev from people where deleted_at is null and id <> $1 and (payload->>'salary')::numeric > 0 limit 1", [nikId]))[0];
    const mark = seen.length;
    const tokenA = await adminToken(ctx);
    await fetch(`${ctx.base}/api/people/${other.id}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ baseRev: other.rev, payload: { ...other.payload, salary: Number(other.payload.salary) + 1 } }) });
    await ctx.sleep(4000);
    const leaks = seen.slice(mark).filter((x) => x.body.includes(other.id) && /"salary"\s*:/.test(x.body.slice(Math.max(0, x.body.indexOf(other.id) - 3000), x.body.indexOf(other.id) + 3000)));
    const allLeaks = seen.filter((x) => /"password"\s*:\s*"[^"]|scrypt\$/.test(x.body));
    R.expect(4, !leaks.length && !allLeaks.length, `A changed ${other.payload.name}'s salary: D received ${seen.length - mark} feed / row responses after it, none with that salary${leaks.length ? ` — LEAK in ${leaks.map((x) => x.u).join(", ")}` : ""}; responses to D with a password / hash: ${allLeaks.length}`);
    // Reload: D's screens agree with the DB.
    await D.page.reload({ waitUntil: "load" });
    await D.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 });
    await openMe(D.page);
    const dLoc = await detail(D.page, "Location");
    const dbLoc = (await ctx.sql("select payload->>'location' l from people where id = $1", [nikId]))[0].l;
    R.expect(5, dLoc === dbLoc, `after reload D's Me Location "${dLoc}" = DB "${dbLoc}"`);
  } finally {
    await D.close();
  }
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// F: a restricted editor keeps hidden fields
// ---------------------------------------------------------------------------
export async function restrictedEditor(ctx, run) {
  const R = new ScreenResult("Org", "restricted-editor", "Function head edits a member's file: salary / slabs / personal fields not shown, kept on save");
  await waitQuiet(ctx);
  const { A, C } = ctx;
  const raviId = (await ctx.sql("select id from people where payload->>'username' = $1 and deleted_at is null", [RAVI.user]))[0]?.id;
  const member = (await ctx.sql(`select id, payload->>'name' as name from people where deleted_at is null and payload->>'managerId' = $1 and (payload->>'salary')::numeric > 0 order by id limit 1`, [raviId]))[0];
  await setPassword(ctx, RAVI.user, RAVI.name, RAVI.pw);
  const F = await userPage(ctx, RAVI.user, [RAVI.pw], `Ravi-${run}-1`);
  const m0 = await openWithoutWrites(ctx, R, `${member.name}'s file`, (p) => openFile(ctx, p, member.name));
  try {
    await openFile(ctx, F.page, member.name);
    await shot(F.page, "restricted-editor-file");
    const fText = await F.page.locator("main").innerText();
    const before = (await ctx.sql("select payload from people where id = $1", [member.id]))[0].payload;
    const salShown = String(before.salary) !== "0" && fText.replace(/[,\s]/g, "").includes(String(before.salary));
    // Check 1: F edits Location, A (admin) edits the same person's Mobile at the same time.
    const locF = `F-loc ${String(run).slice(-5)}`;
    const mobA = `97${String(Date.now()).slice(-8)}`;
    await Promise.all([
      (async () => { await startEdit(F.page); await setField(F.page, "Location", locF); return saveEdit(F.page); })(),
      (async () => { await startEdit(A); await setField(A, "Mobile", mobA); return saveEdit(A); })(),
    ]);
    await ctx.settled(F.page);
    await ctx.settled(A);
    await ctx.sleep(1500);
    const after = (await ctx.sql("select payload from people where id = $1", [member.id]))[0].payload;
    const keep = ["salary", "bandMidpoint", "rewardsSlabs", "dob"];
    const lost = keep.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    R.expect(1, after.location === locF && after.phone === mobA && !lost.length && !salShown,
      `F's file of ${member.name} shows the salary ${salShown}; after F (Location) and A (Mobile) saved together: location ${JSON.stringify(after.location)}, mobile ${JSON.stringify(after.phone)}; hidden fields kept: ${lost.length ? `LOST ${lost.join(",")}` : keep.join(", ")}`);
    // Check 2: A raises the salary while F's form is open (F's copy is stale) → F saves → A's salary stands.
    await startEdit(F.page);
    const locF2 = `F-loc2 ${String(run).slice(-5)}`;
    await setField(F.page, "Location", locF2);
    const row = (await ctx.sql("select payload, rev from people where id = $1", [member.id]))[0];
    const newSal = Number(row.payload.salary) + 1111;
    await fetch(`${ctx.base}/api/people/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${await adminToken(ctx)}` }, body: JSON.stringify({ baseRev: row.rev, payload: { ...row.payload, salary: newSal } }) });
    await ctx.sleep(300);
    const m2 = ctx.mark();
    await saveEdit(F.page);
    await ctx.settled(F.page);
    await ctx.sleep(2000);
    const a2 = (await ctx.sql("select payload from people where id = $1", [member.id]))[0].payload;
    R.expect(2, a2.salary === newSal && a2.location === locF2, `A raised the salary to ${newSal} while F had the form open; F saved Location: DB salary ${a2.salary} (A's value kept ${a2.salary === newSal}), location ${JSON.stringify(a2.location)}`);
    const cMs = await ctx.waitUntil(async () => (await detail(C, "Location")) === locF2, 5000);
    R.expect(3, cMs !== null, `C (idle on the file) showed F's Location ${secs(cMs)} after the save`);
    R.na(4, "delete vs a stale edit of a person is checked in batch 2 people-edit / people-hire (same row path)");
    await ctx.reloadAll();
    await F.page.reload({ waitUntil: "load" });
    await F.page.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 20000 });
    await openFile(ctx, C, member.name);
    await openFile(ctx, F.page, member.name);
    const cLoc = await detail(C, "Location");
    // A function head's read-only card has no Location row; the Edit form shows it.
    let fLoc = await detail(F.page, "Location");
    if (fLoc === null) {
      await startEdit(F.page);
      fLoc = await field(F.page, "Location").inputValue().catch(() => null);
    }
    await shot(F.page, "restricted-editor-after-reload");
    R.expect(5, cLoc === a2.location && fLoc === a2.location, `after reload C "${cLoc}", F "${fLoc}", DB "${a2.location}"`);
  } finally {
    await F.close();
  }
  await endChecks(ctx, R, m0);
  return R;
}

export const SCENARIOS = [
  ["signin-lockout", signinLockout],
  ["session-ended", sessionEnded],
  ["employee-d", employeeD],
  ["restricted-editor", restrictedEditor],
  ["default-pin", defaultPin],
];

export const SCREENS = [
  { module: "Sign-in", screen: "Sign in: 5 wrong passwords → lock message; right password refused while locked", saves: "apms_signin_failures", scenario: "signin-lockout", reached: true },
  { module: "Settings", screen: "Assign people → Locked sign-ins card → Unlock", saves: "apms_signin_failures (row removed)", scenario: "signin-lockout", reached: true },
  { module: "Settings", screen: "Assign people → Reset login (one-time password dialog)", saves: "issued_logins, people password (hash) + mustResetPassword; ends the person's sessions", scenario: "session-ended", reached: true },
  { module: "Sign-in", screen: "Signed out because the password was changed (notice)", saves: "nothing", scenario: "session-ended", reached: true },
  { module: "Sign-in", screen: "First sign-in: Set a new password (after a reset)", saves: "issued_logins (hash), mustResetPassword=false", scenario: "session-ended", reached: true },
  { module: "Me", screen: "Me → Password → Update (ends the person's other browsers)", saves: "issued_logins + people password (hash)", scenario: "session-ended", reached: true },
  { module: "Me", screen: "Me → Edit → Save (employee; was a TDZ crash)", saves: "own people row", scenario: "employee-d", reached: true },
  { module: "Sign-in", screen: "APMS_DEFAULT_PIN=off: 0000 refused with a message", saves: "nothing", scenario: "default-pin", reached: true },
  { module: "Org", screen: "Person file edit by a function head (no pay / personal)", saves: "people row (hidden fields kept)", scenario: "restricted-editor", reached: true },
  { module: "All", screen: "Employee D: My APMS, My rewards, Home, Me + API reads/writes from D's page", saves: "own people row", scenario: "employee-d", reached: true },
];
