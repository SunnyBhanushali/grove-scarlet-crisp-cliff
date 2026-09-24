/**
 * Settings screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs),
 * plus the sign-in page's forgot password and first-sign-in password.
 *
 * A = sunny.b (super admin), B = floyd.dsil (super admin), C = ronlind.mene
 * (admin); nikhil.pati is a plain employee. Data: the imported seed (fresh
 * database). Every scenario makes its own `run`-suffixed records and removes
 * them; passwords it changes are put back (B = Floyd-e2e-1), the restore
 * scenario restores the backup it takes at its start. Purge is not run.
 */
import { pwEq, ScreenResult, realWrites, brief } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  dialog, field, openSettings, accessRoleRow, accessRoleShown, accessRoleNote, createAccessRole, openEditAccessRole,
  grantBox, flagBox, saveDialog, deleteAccessRole, accessRoleDb, searchAssign, assignRow, assignRole, setAssignRole,
  mustSetShown, resetLogin, personDb, personIdByName, issuedDb, apiSignIn, apiPost, freshPage, uiSignIn,
  setFirstPassword, setupStep, setupStepShown, setupDb, trashRow, trashShown, trashDb, addFunction, functionRow,
  functionShown, deleteFunction, openFunctionEdit, functionDb, esc,
} from "./settings-page.mjs";

const ROLE_NAME = { super_admin: "Super admin", admin: "Admin", hr: "HR", function_head: "Function head", manager: "Manager", employee: "Employee" };
const secs = (ms) => (ms === null ? "not within 5 s" : `${(ms / 1000).toFixed(1)} s`);

/** Every page, tab, view, dialog and button in this area that saves data. */
export const SCREENS = [
  { module: "Settings", screen: "Settings → Access roles list (Edit / Delete per row)", saves: "access-roles rows (delete; optional move of people)", scenario: "settings-access-roles", reached: true },
  { module: "Settings", screen: "Create access role dialog (Name, Start from, Scope, Note, module grants grid, Extra flags) → Create", saves: "new access-roles row", scenario: "settings-access-roles", reached: true },
  { module: "Settings", screen: "Edit access role dialog → Save", saves: "access-roles row: name, base, note, scope, grants, flags (+ people.access when the base changes)", scenario: "settings-access-roles", reached: true },
  { module: "Settings", screen: "Delete access role dialog (Move N people to …)", saves: "access-roles row deleted; people re-pointed when a target is picked", scenario: "settings-access-roles", reached: true, why: "delete covered; the 'Move people to' branch only for a role with people (not exercised)" },
  { module: "Settings", screen: "Assign people → per-row Access role select", saves: "people.accessRoleId / access", scenario: "settings-assign", reached: true },
  { module: "Settings", screen: "Setup → Access → Assign in bulk dialog (Give <role> to N)", saves: "people.accessRoleId / access for the ticked people + setupDone 'access'", scenario: "settings-assign", reached: true },
  { module: "Settings", screen: "Assign people → Reset / Create access (row) + one-time login dialog (Email login / Download / Done)", saves: "people.username/password/mustResetPassword, issued_logins, /api/provision-logins", scenario: "settings-logins", reached: true },
  { module: "Settings", screen: "Assign people → Issue remaining → Issue logins in bulk (missing / everyone)", saves: "people logins + issued_logins for every person without a real login; CSV download", scenario: "settings-logins", reached: true, why: "'Everyone' option not run (it resets B's and C's passwords too)" },
  { module: "Settings", screen: "Assign people → Upload logins (CSV email, username, password, access)", saves: "people.accessRoleId / username / password / mustResetPassword", scenario: "settings-logins", reached: true },
  { module: "Settings", screen: "Assign people → Download sheet", saves: "nothing (CSV download)", scenario: "settings-logins", reached: true },
  { module: "Settings", screen: "Assign people → Password reset requests → Issue new password", saves: "as Reset", scenario: null, reached: false, why: "needs an open password_reset notice; the sign-in page does not raise one in this build (forgot password goes to /api/password-reset)" },
  { module: "Sign-in", screen: "First sign-in: Set a new password (mustResetPassword)", saves: "people.password / mustResetPassword=false, issued_logins (own row)", scenario: "settings-logins", reached: true },
  { module: "Sign-in", screen: "Forgot password → Email me a password → Contact HR / Check your email", saves: "nothing unless the temp password was emailed (no mail in this sandbox)", scenario: "forgot-password", reached: true },
  { module: "Sign-in", screen: "Reset link ?reset=<token> → Set a new password", saves: "password via /api/password-reset/apply", scenario: null, reached: false, why: "a token only exists after a mailed reset (no mail configured, APMS_RESET_PREVIEW off)" },
  { module: "Settings", screen: "Setup → step Done (Company/brands/SBUs, Functions, Roles, People, Access)", saves: "settings/setupDone", scenario: "settings-setup", reached: true },
  { module: "Settings", screen: "Setup → step Import (CSV upload dialog)", saves: "functions / roles / SBUs / people / access rows + setupDone", scenario: "settings-setup", reached: true, why: "Functions import run; Units / Roles / People / Access imports mapped, same dialog" },
  { module: "Settings", screen: "Setup → step Template", saves: "nothing (CSV download)", scenario: "settings-setup", reached: true },
  { module: "Settings", screen: "Setup complete → Show setup again", saves: "settings/setupDone = []", scenario: "settings-setup", reached: true },
  { module: "Settings", screen: "Trash → Restore (row)", saves: "trash row removed, item re-created", scenario: "settings-trash", reached: true },
  { module: "Settings", screen: "Trash → Delete forever (row) + confirm", saves: "trash row deleted", scenario: "settings-trash", reached: true },
  { module: "Settings", screen: "Trash → Empty trash + confirm", saves: "every trash row deleted", scenario: "settings-restore", reached: true, why: "run inside settings-restore after the start-of-scenario backup, so the restore puts the seed trash back" },
  { module: "Settings", screen: "Backup → Back up now", saves: "company_backups row (manual)", scenario: "settings-backup", reached: true },
  { module: "Settings", screen: "Backup → copy → Download", saves: "nothing (JSON download)", scenario: "settings-backup", reached: true },
  { module: "Settings", screen: "Backup → copy → Restore → Restore this copy", saves: "whole company replaced from the server copy (+ 'Before restore' copy)", scenario: "settings-restore", reached: true },
  { module: "Settings", screen: "Backup → Restore (file) → progress overlay → Reload", saves: "whole company replaced from the file (/api/company-restore)", scenario: "settings-backup", reached: true },
  { module: "Settings", screen: "Backup → Date filter", saves: "nothing (list filter)", scenario: "settings-backup", reached: true },
  { module: "Settings", screen: "Backup → Testing → Purge all data + confirm", saves: "wipes the company (POST /api/company allowEmpty)", scenario: null, reached: false, why: "destructive for every other scenario sharing this server; cannot be proven safe in a shared pass" },
];

// ============================================================================
// Settings → Access roles
// ============================================================================
export async function settingsAccessRoles(ctx, run) {
  const R = new ScreenResult("Settings", "settings-access-roles", "Settings → Access roles: create, edit grants / flags, delete");
  const { A, B, C } = ctx;
  const m0 = await openWithoutWrites(ctx, R, "Settings → Access roles", (p) => openSettings(ctx, p, "Access roles"));
  const nA = `E2E AR-A ${run}`;
  const nB = `E2E AR-B ${run}`;

  // Check 1 (+3): A and B create two different roles at the same time.
  let t0 = Date.now();
  await Promise.all([
    createAccessRole(A, { name: nA, base: "Manager" }),
    createAccessRole(B, { name: nB, base: "Employee", scope: "Company", note: `B note ${run}` }),
  ]);
  const c1 = await ctx.waitUntil(async () => (await accessRoleShown(C, nA)) && (await accessRoleShown(C, nB)), 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  let rA = await accessRoleDb(ctx, nA);
  let rB = await accessRoleDb(ctx, nB);
  const both = async (p) => (await accessRoleShown(p, nA)) && (await accessRoleShown(p, nB));
  const ab1 = (await ctx.waitUntil(() => both(A), 5000)) !== null && (await ctx.waitUntil(() => both(B), 5000)) !== null;
  R.expect(1, !!rA && !rA.deleted_at && rA.payload.base === "manager" && !!rB && !rB.deleted_at && rB.payload.scope === "company" && ab1,
    `DB: ${nA} ${rA ? `base ${rA.payload.base}` : "missing"}, ${nB} ${rB ? `scope ${rB.payload.scope}` : "missing"}; A and B list both: ${ab1}; C showed both ${secs(tC1)} after the create`);

  // Check 2 (+3): both open Edit on the same role; A: note + flag, B: a module grant. Save together.
  const noteA = `A note ${run}`;
  const [dA, dB] = await Promise.all([openEditAccessRole(A, nA), openEditAccessRole(B, nA)]);
  await field(dA, "Note").fill(noteA);
  await flagBox(dA, "See change log").check();
  await grantBox(dB, "KPI", "view").check();
  t0 = Date.now();
  await Promise.all([saveDialog(A), saveDialog(B)]);
  const c2 = await ctx.waitUntil(async () => (await accessRoleNote(C, nA)) === noteA, 5000);
  const tC2 = c2 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  rA = await accessRoleDb(ctx, nA);
  const step1 = { note: rA?.payload?.note === noteA, flag: rA?.payload?.flags?.changelog === true, grant: rA?.payload?.grants?.kpi?.view === true };
  // Same record, B's dialog opened BEFORE A's next save and saved AFTER it
  // reached B (two people editing the same role in the Edit dialog).
  const noteA2 = `A note 2 ${run}`;
  const dB2 = await openEditAccessRole(B, nA);
  const dA2 = await openEditAccessRole(A, nA);
  await field(dA2, "Note").fill(noteA2);
  await saveDialog(A);
  await ctx.settled(A);
  const bGot = await ctx.waitUntil(async () => (await accessRoleDb(ctx, nA))?.payload?.note === noteA2 && (await accessRoleNote(C, nA)) === noteA2, 5000);
  await ctx.sleep(1500);
  await grantBox(dB2, "MIS", "view").check();
  await saveDialog(B);
  await ctx.settled(B);
  await ctx.sleep(2000);
  rA = await accessRoleDb(ctx, nA);
  const step2 = { note: rA?.payload?.note === noteA2, grant: rA?.payload?.grants?.mis?.view === true, kpi: rA?.payload?.grants?.kpi?.view === true, flag: rA?.payload?.flags?.changelog === true };
  const screens2 = [];
  for (const p of [A, B, C]) screens2.push((await ctx.waitUntil(async () => (await accessRoleNote(p, nA)) === rA?.payload?.note, 5000)) !== null);
  const ok2 = Object.values(step1).every(Boolean) && Object.values(step2).every(Boolean) && screens2.every(Boolean);
  R.expect(2, ok2,
    `same time: DB note ${step1.note}, flag changelog ${step1.flag}, grant KPI view ${step1.grant}; ` +
    `B's dialog open while A saved note 2 (${bGot === null ? "A's note did not reach C/DB in 5 s" : "reached"}), B then ticked MIS view and saved: DB note is ${JSON.stringify(rA?.payload?.note)} (want ${JSON.stringify(noteA2)}), MIS view ${step2.grant}, KPI view ${step2.kpi}, flag ${step2.flag}; A/B/C list the DB note: ${screens2.join("/")}`);
  R.expect(3, tC1 !== null && tC2 !== null, `C showed the two new roles ${secs(tC1)} after the create, the note ${secs(tC2)} after the save`);

  // Check 4: A deletes nB; B (feed held) still lists it, edits it and saves.
  await ctx.holdFeed(B, /\/api\/(org|e\/access-roles)/);
  await deleteAccessRole(A, nB);
  await ctx.settled(A);
  await ctx.sleep(1500);
  const del = await accessRoleDb(ctx, nB);
  const bStill = await accessRoleShown(B, nB);
  let editErr = "";
  try {
    const d = await openEditAccessRole(B, nB);
    await field(d, "Note").fill(`STALE ${run}`);
    await grantBox(d, "Awards", "view").check();
    await saveDialog(B);
  } catch (e) { editErr = String(e.message || e).split("\n")[0].slice(0, 100); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(4000);
  await ctx.settled(B);
  const afterStale = await ctx.sql("select k1, rev, deleted_at, payload->>'note' note from entities where kind = 'access-roles' and payload->>'name' = $1", [nB]);
  const liveNow = afterStale.filter((r) => !r.deleted_at);
  // Give every screen up to 10 s after the release to drop the deleted role.
  const shownNow = [];
  for (const p of [A, B, C]) shownNow.push((await ctx.waitUntil(async () => !(await accessRoleShown(p, nB)), 10000)) === null);
  await ctx.reloadAll();
  const shownAfter = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Access roles");
    shownAfter.push(await accessRoleShown(p, nB));
  }
  R.expect(4, !!del?.deleted_at && bStill && !liveNow.length && shownNow.every((x) => !x) && shownAfter.every((x) => !x),
    `deleted in DB ${!!del?.deleted_at}; B still listed it ${bStill}${editErr ? ` (stale edit: ${editErr})` : ""}; after B's stale save live rows ${JSON.stringify(liveNow)}; still listed on A/B/C 10 s after the release (before reload) ${shownNow.join("/")}, after reload ${shownAfter.join("/")}`);

  // Check 5: after the reload, every screen lists the DB's roles (name + note).
  const db = await ctx.sql("select payload->>'name' n, coalesce(payload->>'note','') note from entities where kind = 'access-roles' and deleted_at is null and payload->>'name' like $1 order by 1", [`E2E AR-%${run}`]);
  const want = db.map((r) => `${r.n}|${r.note}`).join(";");
  const got = [];
  for (const p of [A, B, C]) {
    const rows = await p.locator("main tbody tr").allInnerTexts();
    got.push(rows.filter((t) => t.includes(run)).map((t) => { const [n, ...rest] = t.split("\t")[0].split("\n"); return `${n.trim()}|${rest.join(" ").trim()}`; }).sort().join(";"));
  }
  R.expect(5, got.every((g) => g === want) && db.length === 1, `DB ${want}; screens ${got.map((g) => (g === want ? "same" : g)).join(" / ")}`);

  // Clean up: A deletes its role.
  await deleteAccessRole(A, nA);
  await ctx.settled(A);
  await endChecks(ctx, R, m0);
  return R;
}

// ============================================================================
// Settings → Assign people (per-row select, Assign in bulk)
// ============================================================================
const X = { name: "Aakash Popalkar" };
const Y = { name: "Abhishek Gawai" };

/** Put setupDone back to what the seed had (["people"]) through the Setup tab. */
export async function resetSetupTo(ctx, p, want = ["people"]) {
  const same = (a) => JSON.stringify([...a].sort()) === JSON.stringify([...want].sort());
  if (same(await setupDb(ctx))) return want;
  // Fixture write (like seed-logins): the Setup "Done" / "Show setup again"
  // buttons do not send their change on their own (settings-setup check 1),
  // so the marks are put back through the row API with A's session.
  const row = (await ctx.sql("select rev from entities where kind = 'settings' and k1 = 'setupDone'"))[0];
  const c = (await p.context().cookies()).find((x) => x.name === "better-auth.session_token");
  await fetch(ctx.base + "/api/e/settings/setupDone", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `better-auth.session_token=${c ? c.value : ""}` },
    body: JSON.stringify({ payload: { value: want }, baseRev: row ? Number(row.rev) : 0, clientOpId: `e2e-setup-${Date.now()}` }),
  });
  await ctx.sleep(2500);
  return setupDb(ctx);
}

async function resetSetupOnce(ctx, p, want) {
  await openSettings(ctx, p, "Setup");
  // Finish every open step, then "Show setup again" clears the list.
  for (let i = 0; i < 6; i++) {
    const done = p.locator("main ol > li").getByRole("button", { name: "Done", exact: true }).first();
    if (!(await done.count())) break;
    await done.click();
    await p.waitForTimeout(400);
  }
  const again = p.locator("main").getByRole("button", { name: "Show setup again", exact: true });
  if (await again.count()) await again.click();
  await p.waitForTimeout(600);
  const labels = { people: "People", units: "Company, brands & SBUs", function: "Functions", role: "Roles", access: "Access" };
  for (const k of want) {
    await setupStep(p, labels[k]).getByRole("button", { name: "Done", exact: true }).click();
    await p.waitForTimeout(400);
  }
  // A Setup "Done" alone is not sent (see settings-setup); a reload flushes it.
  await ctx.settled(p, 4000);
  await p.reload({ waitUntil: "load" });
  await p.locator("aside, nav").first().getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
  await ctx.settled(p, 8000);
}

export async function settingsAssign(ctx, run) {
  const R = new ScreenResult("Settings", "settings-assign", "Settings → Assign people: access role per row, Assign in bulk");
  const { A, B, C } = ctx;
  X.id = await personIdByName(ctx, X.name);
  Y.id = await personIdByName(ctx, Y.name);
  const setup0 = await setupDb(ctx);
  const m0 = await openWithoutWrites(ctx, R, "Settings → Assign people", (p) => openSettings(ctx, p, "Assign people"));

  // Check 1 (+3): A sets X's role on the row; B gives Y a role with Setup → Assign in bulk.
  await openSettings(ctx, B, "Setup");
  await setupStep(B, "Access").getByRole("button", { name: "Assign in bulk", exact: true }).click();
  await B.waitForTimeout(500);
  const bulk = dialog(B);
  await field(bulk, "Access role").selectOption("function_head");
  await field(bulk, "Search").fill(Y.name);
  await B.waitForTimeout(300);
  await bulk.locator("li label").filter({ hasText: Y.name }).locator('input[type="checkbox"]').check();
  let t0 = Date.now();
  await Promise.all([
    setAssignRole(A, X.name, "Manager"),
    bulk.getByRole("button", { name: /^Give / }).click(),
  ]);
  const c1 = await ctx.waitUntil(async () => (await assignRole(C, X.name)) === "Manager" && (await assignRole(C, Y.name)) === "Function head", 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  let px = await personDb(ctx, X.id);
  let py = await personDb(ctx, Y.id);
  await openSettings(ctx, B, "Assign people");
  const ab = [];
  for (const p of [A, B]) ab.push((await ctx.waitUntil(async () => (await assignRole(p, X.name)) === "Manager" && (await assignRole(p, Y.name)) === "Function head", 5000)) !== null);
  const setup1 = await setupDb(ctx);
  R.expect(1, px?.payload?.accessRoleId === "manager" && px?.payload?.access === "manager" && py?.payload?.accessRoleId === "function_head" && ab.every(Boolean),
    `DB: ${X.name} ${px?.payload?.accessRoleId}/${px?.payload?.access}, ${Y.name} ${py?.payload?.accessRoleId}/${py?.payload?.access}; A/B show both ${ab.join("/")}; Assign in bulk marked the Access step (setupDone ${JSON.stringify(setup1)}); C showed both ${secs(tC1)} after the change`);

  // Check 2 (+3): same person, different fields: A changes X's access role, B resets X's login.
  t0 = Date.now();
  const [, cred] = await Promise.all([setAssignRole(A, X.name, "HR"), resetLogin(B, X.name)]);
  const c2 = await ctx.waitUntil(async () => (await assignRole(C, X.name)) === "HR", 5000);
  const tC2 = c2 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1000);
  px = await personDb(ctx, X.id);
  const uname = px?.payload?.username || cred.username;
  const iss = await issuedDb(ctx, uname);
  const sNew = await apiSignIn(ctx.base, uname, cred.password);
  const shows = [];
  for (const p of [A, B, C]) shows.push((await ctx.waitUntil(async () => (await assignRole(p, X.name)) === "HR", 5000)) !== null);
  R.expect(2, px?.payload?.accessRoleId === "hr" && px?.payload?.mustResetPassword === true && pwEq(iss?.password, cred.password) && sNew.status === 200 && shows.every(Boolean),
    `DB: role ${px?.payload?.accessRoleId}, mustResetPassword ${px?.payload?.mustResetPassword}, issued password = B's new one ${pwEq(iss?.password, cred.password)}; sign-in with it ${sNew.status}; A/B/C show HR ${shows.join("/")}`);
  R.expect(3, tC1 !== null && tC2 !== null, `C showed A's row change and B's bulk assign ${secs(tC1)} after, the same-person role change ${secs(tC2)} after`);
  R.na(4, "Assign people has no delete; a person is deleted under Org → People (not this area). The stale edit of a deleted access role is check 4 of settings-access-roles");

  // Check 5: reload; the three screens and the DB agree on X and Y.
  await ctx.reloadAll();
  px = await personDb(ctx, X.id);
  py = await personDb(ctx, Y.id);
  const want = `${ROLE_NAME[px.payload.accessRoleId] || px.payload.accessRoleId}|${ROLE_NAME[py.payload.accessRoleId] || py.payload.accessRoleId}`;
  const got = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Assign people");
    got.push(`${await assignRole(p, X.name)}|${await assignRole(p, Y.name)}`);
  }
  R.expect(5, got.every((g) => g === want), `DB ${want}; screens ${got.map((g) => (g === want ? "same" : g)).join(" / ")}`);

  // Clean up: both back to Employee; setup marks as before.
  await setAssignRole(A, X.name, "Employee");
  await setAssignRole(A, Y.name, "Employee");
  await ctx.settled(A);
  await resetSetupTo(ctx, A, setup0);
  R.note(`${X.name}'s login was reset by B (new temporary password, must set password) — test data`);
  await endChecks(ctx, R, m0);
  return R;
}

// ============================================================================
// Logins: Reset / Create access, Upload logins, first sign-in, Issue remaining,
// Download sheet — and A resets B's password (old stops, new works).
// ============================================================================
async function tokenOf(p) {
  const c = (await p.context().cookies()).find((x) => x.name === "better-auth.session_token");
  return c ? decodeURIComponent(c.value) : "";
}

/** Upload logins dialog on Assign people with a CSV body. */
async function uploadLogins(p, csv, name) {
  await p.locator("main").getByRole("button", { name: "Upload logins" }).click();
  await p.waitForTimeout(500);
  const d = dialog(p);
  await d.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.waitForTimeout(800);
  const msg = (await d.innerText()).split("\n").filter((l) => /^Updated|Skipped|not found|unknown/.test(l)).join(" ");
  await closeDialogs(p);
  return msg;
}

/** First sign-in in a fresh browser: temp password → Set a new password → app. */
async function firstSignIn(ctx, user, temp, next) {
  const p = await freshPage(ctx);
  try {
    const got = await uiSignIn(p, user, temp);
    if (got !== "must-reset") return { ok: false, why: `sign-in with the temporary password: ${got}` };
    const after = await setFirstPassword(p, temp, next);
    return { ok: after === "app", why: after === "app" ? "set a new password, app opened" : `after Save: ${after}` };
  } finally {
    await p.context().close();
  }
}

const P1 = { name: "Kiran Kumar Nayaka" };
const P2 = { name: "Sarvjeet Sandhu" };
const P4 = { name: "Aditi Lokhande" };

export async function settingsLogins(ctx, run) {
  const R = new ScreenResult("Settings", "settings-logins", "Logins: Reset / Create access, Upload logins, first sign-in password, Issue remaining, Download sheet");
  const { A, B, C, base } = ctx;
  for (const P of [P1, P2, P4]) {
    P.id = await personIdByName(ctx, P.name);
    P.username = (await personDb(ctx, P.id))?.payload?.username;
    P.email = (await personDb(ctx, P.id))?.payload?.email;
    P.role0 = (await personDb(ctx, P.id))?.payload?.accessRoleId;
  }
  const m0 = await openWithoutWrites(ctx, R, "Settings → Assign people", (p) => openSettings(ctx, p, "Assign people"));
  const before = { p1: await apiSignIn(base, P1.username, "0000"), p4: await apiSignIn(base, P4.username, "0000") };
  R.note(`before: ${P1.username} signs in with the starter 0000 → ${before.p1.status}; ${P4.username} with 0000 → ${before.p4.status} (people with no issued login and an empty stored password sign in with 0000, apms-credentials.ts verifyLogin)`);

  // Check 1 (+3): A resets P1's login; B uploads a password for P4 (CSV) — same time.
  const upPw = `Upl-${run}-x`;
  const mustBefore = await mustSetShown(C, P1.name);
  let t0 = Date.now();
  const [cred1, upMsg] = await Promise.all([
    resetLogin(A, P1.name),
    uploadLogins(B, `email,username,password,access\n${P4.email},,${upPw},\n`, `logins-${run}.csv`),
  ]);
  const c1 = await ctx.waitUntil(async () => (await mustSetShown(C, P1.name)) === true, 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1000);
  const p1 = await personDb(ctx, P1.id);
  const p4 = await personDb(ctx, P4.id);
  const i1 = await issuedDb(ctx, P1.username);
  const s1 = { temp: (await apiSignIn(base, P1.username, cred1.password)).status, old: (await apiSignIn(base, P1.username, "0000")).status };
  const s4 = { up: (await apiSignIn(base, P4.username, upPw)).status, old: (await apiSignIn(base, P4.username, "0000")).status };
  R.expect(1, pwEq(i1?.password, cred1.password) && p1?.payload?.mustResetPassword === true && s1.temp === 200 && s1.old === 401 && s4.up === 200 && s4.old === 401,
    `A reset ${P1.name}: issued_logins = shown password ${pwEq(i1?.password, cred1.password)}, mustResetPassword ${p1?.payload?.mustResetPassword}, sign-in new ${s1.temp} / old 0000 ${s1.old}. ` +
    `B uploaded a password for ${P4.name} ("${upMsg}"): mustResetPassword ${p4?.payload?.mustResetPassword}, sign-in with the uploaded password ${s4.up} (want 200) / old 0000 ${s4.old} (want 401)`);

  // First sign-in (mustResetPassword): P1 signs in with the temp password and must set a new one.
  const new1 = `Kiran-${run}-1`;
  t0 = Date.now();
  const f1 = await firstSignIn(ctx, P1.username, cred1.password, new1);
  const c1b = await ctx.waitUntil(async () => (await mustSetShown(C, P1.name)) === false, 5000);
  const tC1b = c1b === null ? null : Date.now() - t0;
  await ctx.sleep(1500);
  const p1b = await personDb(ctx, P1.id);
  const i1b = await issuedDb(ctx, P1.username);
  const s1b = { next: (await apiSignIn(base, P1.username, new1)).status, temp: (await apiSignIn(base, P1.username, cred1.password)).status };
  const firstOk = f1.ok && p1b?.payload?.mustResetPassword === false && pwEq(i1b?.password, new1) && s1b.next === 200 && s1b.temp === 401;
  R.set("must-reset", firstOk ? "pass" : "fail",
    `${P1.name} signed in with the temporary password: ${f1.why}; DB mustResetPassword ${p1b?.payload?.mustResetPassword}, issued = new ${pwEq(i1b?.password, new1)}; sign-in new ${s1b.next} / temporary ${s1b.temp}; C dropped "Must set password" ${secs(tC1b)} after`);

  // Check 2 (+3): same person P2 — A resets the login, B uploads a new access role for P2.
  t0 = Date.now();
  const [cred2, upMsg2] = await Promise.all([
    resetLogin(A, P2.name),
    uploadLogins(B, `email,access\n${P2.email},function_head\n`, `access-${run}.csv`),
  ]);
  const c2 = await ctx.waitUntil(async () => (await assignRole(C, P2.name)) === "Function head" && (await mustSetShown(C, P2.name)) === true, 5000);
  const tC2 = c2 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1000);
  const p2 = await personDb(ctx, P2.id);
  const i2 = await issuedDb(ctx, P2.username);
  const s2 = (await apiSignIn(base, P2.username, cred2.password)).status;
  const shows2 = [];
  for (const p of [A, B, C]) shows2.push((await ctx.waitUntil(async () => (await assignRole(p, P2.name)) === "Function head", 5000)) !== null);
  R.expect(2, p2?.payload?.accessRoleId === "function_head" && p2?.payload?.mustResetPassword === true && pwEq(i2?.password, cred2.password) && s2 === 200 && shows2.every(Boolean),
    `DB: access ${p2?.payload?.accessRoleId} (B's upload "${upMsg2}"), mustResetPassword ${p2?.payload?.mustResetPassword}, issued = A's password ${pwEq(i2?.password, cred2.password)}; sign-in ${s2}; A/B/C show Function head ${shows2.join("/")}`);
  R.expect(3, tC1 !== null && tC1b !== null && tC2 !== null,
    `C showed "Must set password" on ${P1.name} ${secs(tC1)} after A's reset, dropped it ${secs(tC1b)} after ${P1.name} set a password, showed B's access change + A's reset on ${P2.name} ${secs(tC2)} after`);
  const f2 = await firstSignIn(ctx, P2.username, cred2.password, `Sarv-${run}-1`);
  R.note(`${P2.name} first sign-in: ${f2.why}`);
  R.na(4, "logins cannot be deleted from Settings (no delete control); Reset replaces the password");

  // Check 5: reload; the three screens and the DB agree on P1 / P2 / P4 (role, must-set flag).
  await ctx.reloadAll();
  const want = [];
  for (const P of [P1, P2, P4]) {
    const d = (await personDb(ctx, P.id)).payload;
    want.push(`${ROLE_NAME[d.accessRoleId] || d.accessRoleId}|${d.mustResetPassword === true}`);
  }
  const got = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Assign people");
    const g = [];
    for (const P of [P1, P2, P4]) g.push(`${await assignRole(p, P.name)}|${await mustSetShown(p, P.name)}`);
    got.push(g.join(";"));
  }
  R.expect(5, got.every((g) => g === want.join(";")), `DB ${want.join(";")}; screens ${got.map((g) => (g === want.join(";") ? "same" : g)).join(" / ")}`);

  // SPECIAL: A resets B's password → B's old password stops, the new one works.
  const bUser = "floyd.dsil";
  const bOld = "Floyd-e2e-1";
  const bId = await personIdByName(ctx, "Floyd Dsilva");
  const credB = await resetLogin(A, "Floyd Dsilva");
  await ctx.settled(A);
  await ctx.sleep(1500);
  const sOld = await apiSignIn(base, bUser, bOld);
  const sNew = await apiSignIn(base, bUser, credB.password);
  const bSess = await fetch(base + "/api/auth/get-session", { headers: { cookie: `better-auth.session_token=${encodeURIComponent(await tokenOf(B))}` } }).then((r) => r.json()).catch(() => null);
  // BATCH-3: an admin reset ends every session of that person; B's open
  // browser must land on the sign-in page within seconds.
  const tB0 = Date.now();
  const onSignIn = async () => (await B.getByRole("button", { name: "Continue" }).count()) > 0 && (await B.locator('input[type="password"]').count()) > 0;
  const bOut = await ctx.waitUntil(onSignIn, 15000, 250);
  const bOutSecs = bOut === null ? null : (Date.now() - tB0) / 1000;
  const bScreen = bOut !== null ? `the sign-in page ${bOutSecs.toFixed(1)} s after the reset` : (await B.getByText("Set a new password", { exact: true }).count()) ? "the first-sign-in 'Set a new password' screen" : "the app as before";
  // Browser check too: a fresh browser signing in with the old password is refused.
  const pOld = await freshPage(ctx);
  const uiOld = await uiSignIn(pOld, bUser, bOld);
  await pOld.context().close();
  // Put B back: B signs in with the temporary password and sets Floyd-e2e-1 again.
  const fb = await firstSignIn(ctx, bUser, credB.password, bOld);
  await ctx.sleep(1500);
  const sBack = await apiSignIn(base, bUser, bOld);
  const sTempAfter = await apiSignIn(base, bUser, credB.password);
  const pb = await personDb(ctx, bId);
  if (await B.getByText("Set a new password", { exact: true }).count()) {
    await B.reload({ waitUntil: "load" });
  }
  // B's own browser was signed out by the reset: sign it back in.
  if (!(await B.locator("aside, nav").first().getByText("Org", { exact: true }).count())) {
    await ctx.signIn(B, [bUser, bOld]).catch(() => {});
    await ctx.sleep(1500);
  }
  const bBack = (await B.locator("aside, nav").first().getByText("Org", { exact: true }).count()) > 0;
  const revoked = !(bSess && bSess.user) && bOut !== null && bOutSecs <= 10;
  R.set("special", revoked && sOld.status === 401 && sNew.status === 200 && uiOld !== "app" && fb.ok && sBack.status === 200 && sTempAfter.status === 401 && pb?.payload?.mustResetPassword === false && bBack ? "pass" : "fail",
    `A reset B (${bUser}): old password → ${sOld.status} (want 401), browser sign-in with the old password → ${uiOld}; new password → ${sNew.status}. ` +
    `B's open session after the reset: get-session ${bSess && bSess.user ? "still valid (NOT revoked)" : "gone (revoked)"}, B's screen showed ${bScreen}. ` +
    `B then signed in with the new password → ${fb.why}; put back ${bOld} → ${sBack.status}, temporary → ${sTempAfter.status}, mustResetPassword ${pb?.payload?.mustResetPassword}; B's browser back in the app ${bBack}`);

  // Non-admin / anonymous login writes (server rule: admin only, except own row on issued-logins).
  const nik = await apiSignIn(base, "nikhil.pati", "Nikhil-e2e-1");
  const sec = {
    anon: (await apiPost(base, "/api/issued-logins", "", { rows: [{ username: P1.username, password: "x-" + run }] })).status,
    other: (await apiPost(base, "/api/issued-logins", nik.token, { rows: [{ username: P1.username, password: "x-" + run }] })).status,
    prov: (await apiPost(base, "/api/provision-logins", nik.token, { rows: [{ username: "nikhil.pati", email: "adminteam@alienstattoos.com", password: "Nikhil-e2e-1" }] })).status,
    own: (await apiPost(base, "/api/issued-logins", nik.token, { rows: [{ username: "nikhil.pati", personId: await personIdByName(ctx, "Nikhil Patil"), password: "Nikhil-e2e-1" }] })).status,
  };
  const p1Still = (await apiSignIn(base, P1.username, new1)).status;
  R.set("security", sec.anon === 401 && sec.other === 403 && sec.prov === 403 && sec.own === 200 && p1Still === 200 ? "pass" : "fail",
    `anonymous POST /api/issued-logins ${sec.anon} (want 401); employee POST another person's row ${sec.other} (want 403), POST /api/provision-logins ${sec.prov} (want 403), own row ${sec.own} (want 200); ${P1.name}'s password unchanged: sign-in ${p1Still}`);

  // Download sheet.
  const [dl] = await Promise.all([A.waitForEvent("download", { timeout: 15000 }), A.locator("main").getByRole("button", { name: "Download sheet" }).click()]);
  const sheet = await readDownload(dl);
  const lines = sheet.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const pwCol = head.findIndex((h) => /password/i.test(h));
  const withPw = lines.slice(1).filter((l) => (l.split(",")[pwCol] || "").replace(/"/g, "").trim()).length;
  R.note(`Download sheet: ${lines.length - 1} rows, columns ${head.join("|")}; rows with a password: ${withPw} (passwords are stripped from the wire since NO-SECRETS-WIRE, so the sheet the UI calls "it has passwords" has them only for logins issued in this session)`);

  // Issue remaining (only people without a real login).
  const issuedBefore = Number((await ctx.sql("select count(*) n from issued_logins"))[0].n);
  const btn = A.locator("main").getByRole("button", { name: /^Issue remaining/ });
  const nMissing = Number(((await btn.innerText()).match(/\((\d+)\)/) || [])[1] || 0);
  await btn.click();
  await A.waitForTimeout(500);
  const [dl2] = await Promise.all([
    A.waitForEvent("download", { timeout: 180000 }),
    dialog(A).getByRole("button", { name: /^Issue \d+ login/ }).click(),
  ]);
  const csv2 = await readDownload(dl2);
  const drain0 = Date.now();
  const drained = await ctx.settled(A, 400000);
  R.note(`Issue remaining: A's page took ${((Date.now() - drain0) / 1000).toFixed(0)} s to send every person's save (${drained ? "done" : "still pending after 400 s"})`);
  await ctx.sleep(3000);
  const rows2 = csv2.trim().split(/\r?\n/);
  const h2 = rows2[0].split(",");
  const ui = h2.findIndex((h) => /username/i.test(h));
  const pi = h2.findIndex((h) => /password/i.test(h));
  const sample = rows2.slice(1).map((l) => l.split(",")).find((c) => c[ui] && c[ui] !== "nikhil.pati" && c[pi]);
  const issuedAfter = Number((await ctx.sql("select count(*) n from issued_logins"))[0].n);
  const issuedMap = new Map((await ctx.sql("select username, password from issued_logins")).map((r) => [r.username, r.password]));
  const csvRows = rows2.slice(1).map((l) => l.split(",").map((x) => x.replace(/"/g, "")));
  const mismatched = csvRows.filter((c) => c[ui] !== "nikhil.pati" && !pwEq(issuedMap.get(c[ui].toLowerCase()), c[pi])).map((c) => c[ui]);
  const sSample = sample ? (await apiSignIn(base, sample[ui].replace(/"/g, ""), sample[pi].replace(/"/g, ""))).status : 0;
  const sSample0 = sample ? (await apiSignIn(base, sample[ui].replace(/"/g, ""), "0000")).status : 0;
  const msg2 = await A.locator("main p.text-sm").filter({ hasText: /^Issued / }).first().innerText().catch(() => "");
  // Put nikhil.pati back (other scenarios use Nikhil-e2e-1).
  const putBack = await apiPost(base, "/api/issued-logins", await tokenOf(A), { rows: [{ username: "nikhil.pati", personId: await personIdByName(ctx, "Nikhil Patil"), password: "Nikhil-e2e-1" }] });
  const keep = {
    nikhil: (await apiSignIn(base, "nikhil.pati", "Nikhil-e2e-1")).status,
    floyd: (await apiSignIn(base, "floyd.dsil", "Floyd-e2e-1")).status,
    ronlind: (await apiSignIn(base, "ronlind.mene", "Ronlind-e2e-1")).status,
    sunny: (await apiSignIn(base, "sunny.b", "0000")).status,
  };
  R.set("issue-remaining", rows2.length - 1 === nMissing && !mismatched.length && sSample === 200 && sSample0 === 401 ? "pass" : "fail",
    `Issue remaining (${nMissing}): message "${msg2}"; CSV rows ${rows2.length - 1}; issued_logins ${issuedBefore} → ${issuedAfter}, CSV rows whose issued password differs ${mismatched.length}${mismatched.length ? ` (${mismatched.slice(0, 5).join(", ")})` : ""}; sample ${sample ? sample[ui] : "-"} signs in with its CSV password ${sSample}, with 0000 ${sSample0}; put back nikhil.pati (${putBack.status}); B/C/A/nikhil still sign in: floyd ${keep.floyd}, ronlind ${keep.ronlind}, sunny ${keep.sunny}, nikhil ${keep.nikhil}`);

  // Clean up: P2 back to its access role.
  await openSettings(ctx, A, "Assign people");
  await setAssignRole(A, P2.name, ROLE_NAME[P2.role0] || "Manager");
  await ctx.settled(A);
  R.note(`test data left: ${P1.name}, ${P2.name}, ${P4.name} and the ${nMissing} people without a login now have new passwords (${P1.name} ${new1}, ${P2.name} Sarv-${run}-1, ${P4.name} uploaded ${upPw}); floyd.dsil is back on Floyd-e2e-1, nikhil.pati on Nikhil-e2e-1 (still must set password)`);
  await endChecks(ctx, R, m0);
  return R;
}

async function closeDialogs(p) {
  for (let i = 0; i < 4 && (await p.locator("div.fixed.inset-0").count()); i++) {
    const b = p.locator("div.fixed.inset-0").last().locator("button", { hasText: /^(Close|Cancel|Done)$/ }).last();
    if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {});
    else await p.mouse.click(6, 994);
    await p.waitForTimeout(300);
  }
}

async function readDownload(dl) {
  const { readFile } = await import("node:fs/promises");
  const path = await dl.path();
  return path ? readFile(path, "utf8") : "";
}

// ============================================================================
// Sign-in page → Forgot password
// ============================================================================
export async function forgotPassword(ctx, run) {
  const R = new ScreenResult("Sign-in", "forgot-password", "Sign-in page → Forgot password (needHr / public email without mail)");
  const { base } = ctx;
  const p = await freshPage(ctx);
  const net = [];
  p.on("response", async (r) => {
    const u = r.url().replace(base, "");
    if (!u.startsWith("/api/") && !u.startsWith("/_serverFn")) return;
    if (r.request().method() === "GET" && r.status() < 500) return;
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch { /* ignore */ }
    net.push({ m: r.request().method(), u: u.slice(0, 120), s: r.status(), body });
  });
  await p.waitForTimeout(1500);
  const openWrites = net.filter((n) => !/\/api\/(auth|provision-logins|issued-logins)/.test(n.u));
  const state = async (username, id) => {
    const iss = await issuedDb(ctx, username);
    const pr = await personDb(ctx, id);
    const resets = await ctx.sql("select count(*) n from password_resets where person_id = $1", [id]).catch(() => [{ n: 0 }]);
    return JSON.stringify({ iss: iss ? `${iss.password}@${iss.updated_at?.toISOString?.()}` : null, rev: pr?.rev, pw: pr?.payload?.password || "", must: pr?.payload?.mustResetPassword, resets: Number(resets[0].n) });
  };
  async function ask(login) {
    net.length = 0;
    await p.goto(base + "/", { waitUntil: "load" });
    await p.getByRole("button", { name: "Forgot password" }).click();
    await p.waitForTimeout(400);
    await field(p.locator("form"), "Username or email").fill(login);
    await p.getByRole("button", { name: "Email me a password" }).click();
    await p.getByRole("button", { name: "Back to sign in" }).waitFor({ timeout: 20000 });
    await p.waitForTimeout(500);
    const text = await p.locator("body").innerText();
    const call = net.find((n) => /password-reset|_serverFn/.test(n.u) && n.m === "POST");
    return { text, call };
  }

  // 1. No public mailbox (@aliens.local) → Contact HR, nothing changes.
  const hrId = await personIdByName(ctx, "Aaynar Kumar");
  const hrUser = (await personDb(ctx, hrId)).payload.username;
  const hrBefore = await state(hrUser, hrId);
  const a1 = await ask(hrUser);
  await ctx.sleep(1500);
  const hrAfter = await state(hrUser, hrId);
  const hrOk = /Contact HR/.test(a1.text) && a1.text.includes("Contact HR to reset this password.") && !/Temporary password/.test(a1.text) && hrBefore === hrAfter;
  R.set("needHr", hrOk ? "pass" : "fail",
    `${hrUser} (@aliens.local): screen "${a1.text.split("\n").filter((l) => /HR|email/i.test(l)).slice(0, 2).join(" / ")}"; request ${a1.call ? `${a1.call.m} ${a1.call.u} ${a1.call.s} ${a1.call.body.slice(0, 120)}` : "none seen"}; password / mustReset / reset tokens unchanged ${hrBefore === hrAfter}`);

  // 2. Public mailbox, but no mail configured here → no change, no temp password on screen.
  const pubId = await personIdByName(ctx, "Ronlind Menezes");
  const pubBefore = await state("ronlind.mene", pubId);
  const a2 = await ask("ronlind.mene");
  await ctx.sleep(1500);
  const pubAfter = await state("ronlind.mene", pubId);
  const still = (await apiSignIn(base, "ronlind.mene", "Ronlind-e2e-1")).status;
  const pubOk = !/Temporary password|Set a new password/.test(a2.text) && !/previewPassword|previewLink/.test(a2.call?.body || "") && pubBefore === pubAfter && still === 200;
  R.set("public-email", pubOk ? "pass" : "fail",
    `ronlind.mene (public email, no mail server): screen "${a2.text.split("\n").filter((l) => /HR|email|Temporary/i.test(l)).slice(0, 2).join(" / ")}"; response ${a2.call ? a2.call.body.slice(0, 160) : "none seen"}; password unchanged ${pubBefore === pubAfter}, Ronlind-e2e-1 still signs in ${still}`);

  // 3. Unknown login → the same neutral screen, nothing written.
  const a3 = await ask(`nobody.e2e.${run}`);
  R.note(`unknown login: screen "${a3.text.split("\n").filter((l) => /HR|email/i.test(l)).slice(0, 1).join("")}", response ${a3.call ? a3.call.body.slice(0, 100) : "none"}`);
  R.note("no person in the seed has an empty email (the @aliens.local case covers 'no public mailbox')");
  await p.context().close();

  for (const n of [1, 2, 4, 5]) R.na(n, "anonymous single-person request on the sign-in page; it saves nothing another user edits, shares or deletes");
  R.na(3, "nothing changes, so there is nothing for an idle admin to see");
  const fives = net.filter((n) => n.s >= 500);
  R.expect(6, hrOk && pubOk && !openWrites.length && !fives.length,
    openWrites.length ? `writes on opening the sign-in page: ${openWrites.map((n) => `${n.m} ${n.u} ${n.s}`).join("; ")}` : fives.length ? `5xx: ${fives.map((n) => n.u).join("; ")}` : `no writes on opening the sign-in page, no 5xx; forgot password changed nothing (needHr ${hrOk}, public email ${pubOk})`);
  return R;
}

// ============================================================================
// Settings → Setup (step Done, Import, Template)
// ============================================================================
export async function settingsSetup(ctx, run) {
  const R = new ScreenResult("Settings", "settings-setup", "Settings → Setup: step Done, Import (Functions CSV), Template");
  const { A, B, C } = ctx;
  const setup0 = ["people"]; // the seed's marks
  const pre = await resetSetupTo(ctx, A, setup0);
  if (JSON.stringify(pre) !== JSON.stringify(setup0)) R.note(`could not put setupDone back to the seed's ${JSON.stringify(setup0)} before the test (DB ${JSON.stringify(pre)})`);
  for (const p of [A, B, C]) await ctx.settled(p, 120000);
  const m0 = await openWithoutWrites(ctx, R, "Settings → Setup", (p) => openSettings(ctx, p, "Setup"));
  const fn = `E2E setup fn ${run}`;

  // Template (download only).
  const [tdl] = await Promise.all([A.waitForEvent("download", { timeout: 10000 }).catch(() => null), setupStep(A, "Functions").getByText("Template").first().click()]);
  const tpl = tdl ? await readDownload(tdl) : "";
  R.note(`Functions Template download: ${tdl ? `"${tpl.split(/\r?\n/)[0]}"` : "no download event"}`);

  // Check 1 (+3): A marks "Roles" done; B imports a Functions CSV (a new function row + the Functions mark).
  await setupStep(B, "Functions").getByRole("button", { name: "Import" }).click();
  await B.waitForTimeout(400);
  const imp = dialog(B);
  let t0 = Date.now();
  await Promise.all([
    setupStep(A, "Roles").getByRole("button", { name: "Done", exact: true }).click(),
    imp.locator('input[type="file"]').setInputFiles({ name: `functions-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(`name,description\n${fn},E2E setup import\n`) }),
  ]);
  const c1 = await ctx.waitUntil(async () => !(await setupStepShown(C, "Roles")) && !(await setupStepShown(C, "Functions")), 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  const pendA = await A.evaluate(() => (window.__apmsSync?.pendingOps?.() || []).map((o) => o.url)).catch(() => []);
  await ctx.settled(A, 8000);
  await ctx.settled(B, 8000);
  await ctx.sleep(1500);
  const done1 = await setupDb(ctx);
  const f1 = (await functionDb(ctx, fn)).filter((r) => !r.deleted_at);
  const ab = [];
  for (const p of [A, B]) ab.push((await ctx.waitUntil(async () => !(await setupStepShown(p, "Roles")) && !(await setupStepShown(p, "Functions")), 5000)) !== null);
  R.expect(1, done1.includes("role") && done1.includes("function") && f1.length === 1 && ab.every(Boolean),
    `DB setupDone ${JSON.stringify(done1)} (want role + function), function "${fn}" rows ${f1.length}; A/B hide both steps ${ab.join("/")}; A's pending saves ~10 s after its Done: ${JSON.stringify(pendA)}`);
  R.na(2, "the Setup marks are one list value (settings/setupDone); the two concurrent marks in check 1 are the same row");
  R.expect(3, tC1 !== null, `C hid both steps ${secs(tC1)} after the Done / import`);
  R.na(4, "setup marks have no delete (only 'Show setup again', which clears the whole list; used in the clean-up)");

  // Check 5: reload; the steps shown agree with the DB.
  await ctx.reloadAll();
  const dbNow = await setupDb(ctx);
  const labels = [["units", "Company, brands & SBUs"], ["function", "Functions"], ["role", "Roles"], ["people", "People"], ["access", "Access"]];
  const unitsDone = (d) => d.includes("units") || (d.includes("company") && d.includes("brand") && d.includes("sbu"));
  const want = labels.filter(([k]) => !(k === "units" ? unitsDone(dbNow) : dbNow.includes(k))).map(([, l]) => l).join(",");
  const got = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Setup");
    const shown = [];
    for (const [, l] of labels) if (await setupStepShown(p, l)) shown.push(l);
    got.push(shown.join(","));
  }
  R.expect(5, got.every((g) => g === want), `DB setupDone ${JSON.stringify(dbNow)} → steps ${want}; screens ${got.map((g) => (g === want ? "same" : g)).join(" / ")}`);

  // Clean up: remove the imported function; setup marks back to the seed.
  await deleteFunction(ctx, A, fn);
  await ctx.settled(A);
  const tr = (await trashDb(ctx, fn)).filter((r) => !r.deleted_at);
  if (tr.length) {
    await openSettings(ctx, A, "Trash");
    await trashRow(A, fn).locator('button[aria-label="Delete forever"]').click();
    await dialog(A).getByRole("button", { name: "Delete forever", exact: true }).click();
    await ctx.settled(A);
  }
  await resetSetupTo(ctx, A, setup0);
  const setupEnd = await setupDb(ctx);
  if (JSON.stringify([...setupEnd].sort()) !== JSON.stringify([...setup0].sort())) R.note(`clean-up: setupDone is ${JSON.stringify(setupEnd)}, was ${JSON.stringify(setup0)}`);
  await endChecks(ctx, R, m0);
  return R;
}

// ============================================================================
// Settings → Trash (Restore, Delete forever)
// ============================================================================
export async function settingsTrash(ctx, run) {
  const R = new ScreenResult("Settings", "settings-trash", "Settings → Trash: Restore, Delete forever");
  const { A, B, C } = ctx;
  const f = [1, 2, 3].map((i) => `E2E trash f${i} ${run}`);
  for (const n of f) {
    await addFunction(ctx, A, n);
    await ctx.settled(A);
  }
  for (const n of f) {
    await deleteFunction(ctx, A, n);
    await ctx.settled(A);
  }
  const m0 = await openWithoutWrites(ctx, R, "Settings → Trash", (p) => openSettings(ctx, p, "Trash"));
  const liveTrash = async (label) => (await trashDb(ctx, label)).filter((r) => !r.deleted_at);
  const liveFn = async (name) => (await functionDb(ctx, name)).filter((r) => !r.deleted_at);

  // Check 1 (+3): A restores f1 while B deletes f2 forever.
  let t0 = Date.now();
  await Promise.all([
    (async () => { await trashRow(A, f[0]).locator('button[aria-label="Restore"]').click(); })(),
    (async () => {
      await trashRow(B, f[1]).locator('button[aria-label="Delete forever"]').click();
      await dialog(B).getByRole("button", { name: "Delete forever", exact: true }).click();
    })(),
  ]);
  const c1 = await ctx.waitUntil(async () => !(await trashShown(C, f[0])) && !(await trashShown(C, f[1])), 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const msgA = await A.locator("main p.text-amber-800").first().innerText().catch(() => "");
  const traceA = await A.evaluate(() => { const t = window.__apmsSync?.mergeTrace; const v = typeof t === "function" ? t() : t; return JSON.stringify((v || []).filter((x) => /functions/.test(x.revKey || "")).slice(-3)); }).catch(() => "");
  if (traceA && traceA !== "[]") R.note(`A's sync merge trace for functions after the restore: ${traceA.slice(0, 300)}`);
  const db1 = { t1: (await liveTrash(f[0])).length, t2: (await liveTrash(f[1])).length, fn1: (await liveFn(f[0])).length, fn2: (await liveFn(f[1])).length };
  const gone = [];
  for (const p of [A, B]) gone.push((await ctx.waitUntil(async () => !(await trashShown(p, f[0])) && !(await trashShown(p, f[1])), 5000)) !== null);
  await ctx.nav(A, "Org", "Functions");
  const aSeesFn1 = await functionShown(A, f[0]);
  R.expect(1, db1.t1 === 0 && db1.t2 === 0 && db1.fn1 === 1 && db1.fn2 === 0 && gone.every(Boolean) && aSeesFn1,
    `DB: trash ${f[0]} ${db1.t1}, ${f[1]} ${db1.t2} (want 0/0); function ${f[0]} live ${db1.fn1} (want 1, restored), ${f[1]} live ${db1.fn2}; A/B trash rows gone ${gone.join("/")}; A's Org → Functions lists the restored one ${aSeesFn1}${msgA ? `; A's message "${msgA}"` : ""}`);
  R.na(2, "a trash item has no editable fields; Restore and Delete forever act on the whole item (check 1 has the two actions at once)");
  R.expect(3, tC1 !== null, `C dropped both rows ${secs(tC1)} after the restore / delete`);
  await openSettings(ctx, A, "Trash");

  // Check 4: A deletes f3 forever; B (feed held) still lists it and clicks Restore.
  await ctx.holdFeed(B, /\/api\/org(\?|\/|$)/);
  await trashRow(A, f[2]).locator('button[aria-label="Delete forever"]').click();
  await dialog(A).getByRole("button", { name: "Delete forever", exact: true }).click();
  await ctx.settled(A);
  await ctx.sleep(1500);
  const del = await trashDb(ctx, f[2]);
  const bStill = await trashShown(B, f[2]);
  let err = "";
  try { await trashRow(B, f[2]).locator('button[aria-label="Restore"]').click(); } catch (e) { err = String(e.message || e).split("\n")[0].slice(0, 80); }
  const msgB = await B.locator("main p.text-amber-800").first().innerText().catch(() => "");
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(4000);
  await ctx.settled(B);
  const t3 = (await liveTrash(f[2])).length;
  const fn3 = (await liveFn(f[2])).length;
  const shownNow = [];
  for (const p of [A, B, C]) shownNow.push((await ctx.waitUntil(async () => !(await trashShown(p, f[2])), 10000)) === null);
  await ctx.reloadAll();
  const shownAfter = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Trash");
    shownAfter.push(await trashShown(p, f[2]));
  }
  await ctx.nav(A, "Org", "Functions");
  const aFn3 = await functionShown(A, f[2]);
  R.expect(4, !del.filter((r) => !r.deleted_at).length && bStill && t3 === 0 && fn3 === 0 && shownNow.every((x) => !x) && shownAfter.every((x) => !x) && !aFn3,
    `deleted in DB ${!del.filter((r) => !r.deleted_at).length}; B still listed it ${bStill}${err ? ` (${err})` : ""}${msgB ? `, B's message "${msgB}"` : ""}; after B's stale Restore: trash rows ${t3}, function re-created ${fn3} (want 0/0); still listed on A/B/C 10 s after the release ${shownNow.join("/")}, after reload ${shownAfter.join("/")}; function on A's Org list ${aFn3}`);

  // Check 5: after the reload the trash on screen agrees with the DB.
  const dbRows = (await ctx.sql("select payload->>'label' l from entities where kind = 'trash' and deleted_at is null order by 1")).map((r) => r.l);
  const got = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Trash");
    const rows = (await p.locator("main tbody tr").allInnerTexts()).map((t) => t.split("\t")[0].trim()).sort();
    got.push(rows.join("|"));
  }
  const want = [...dbRows].sort().join("|");
  R.expect(5, got.every((g) => g === want), `DB ${dbRows.length} trash rows; screens ${got.map((g) => (g === want ? "same" : `${g.split("|").length} rows: ${g.slice(0, 160)}`)).join(" / ")}`);

  // Clean up: the restored function goes back to trash and out of it.
  if ((await liveFn(f[0])).length) {
    await deleteFunction(ctx, A, f[0]);
    await ctx.settled(A);
    await openSettings(ctx, A, "Trash");
    if (await trashShown(A, f[0])) {
      await trashRow(A, f[0]).locator('button[aria-label="Delete forever"]').click();
      await dialog(A).getByRole("button", { name: "Delete forever", exact: true }).click();
      await ctx.settled(A);
    }
  }
  await endChecks(ctx, R, m0);
  return R;
}

// ============================================================================
// Settings → Backup (Back up now, Download, Restore from a FILE, empty targets)
// ============================================================================
async function backupIds(p) {
  return p.locator("[data-backup-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-backup-row")));
}

async function targetCounts(ctx) {
  const cells = await ctx.sql("select count(*) n from target_cells where deleted_at is null").catch(() => [{ n: -1 }]);
  const nodes = await ctx.sql("select count(*) n from entities where kind = 'target-nodes' and deleted_at is null");
  const members = await ctx.sql("select count(*) n from entities where kind = 'target-members' and deleted_at is null");
  return { cells: Number(cells[0].n), nodes: Number(nodes[0].n), members: Number(members[0].n) };
}

/** Settings → Backup → Restore (file) → overlay result; Reload clicked when offered. */
async function restoreFile(ctx, p, path) {
  await openSettings(ctx, p, "Backup");
  const t0 = Date.now();
  await p.locator("#backup-restore-file").setInputFiles(path);
  const title = p.locator("#apms-restore-title");
  for (let i = 0; i < 600; i++) {
    const t = await title.innerText().catch(() => "");
    if (/^Restored$|^Restore failed$/.test(t)) break;
    await p.waitForTimeout(250);
  }
  const res = { title: await title.innerText().catch(() => ""), step: await p.locator("#apms-restore-step").innerText().catch(() => ""), ms: Date.now() - t0 };
  const close = p.locator("#apms-restore-close");
  if (await close.isVisible().catch(() => false)) {
    res.button = await close.innerText();
    await close.click();
    await p.waitForLoadState("load");
    await p.locator("aside, nav").first().getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(1500);
  }
  return res;
}

export async function settingsBackup(ctx, run) {
  const R = new ScreenResult("Settings", "settings-backup", "Settings → Backup: Back up now, Download, Restore from a file (incl. empty targets)");
  const { A, B, C } = ctx;
  const { writeFile } = await import("node:fs/promises");
  const dir = process.env.E2E_TMP || "/tmp";
  const m0 = await openWithoutWrites(ctx, R, "Settings → Backup", (p) => openSettings(ctx, p, "Backup"));
  const before = new Set((await ctx.sql("select id from company_backups")).map((r) => r.id));

  // Check 1 (+3): A and B click Back up now at the same time.
  let t0 = Date.now();
  await Promise.all([A.locator('[data-backup="save-now"]').click(), B.locator('[data-backup="save-now"]').click()]);
  await ctx.waitUntil(async () => (await ctx.sql("select count(*) n from company_backups where kind = 'manual'")).length && (await ctx.sql("select id from company_backups")).filter((r) => !before.has(r.id)).length >= 2, 15000);
  const fresh = (await ctx.sql("select id, kind, people_count from company_backups order by created_at")).filter((r) => !before.has(r.id));
  const ids = fresh.map((r) => r.id);
  const c1 = await ctx.waitUntil(async () => { const s = await backupIds(C); return ids.length === 2 && ids.every((id) => s.includes(id)); }, 5000);
  const tC1 = c1 === null ? null : Date.now() - t0;
  const ab = [];
  for (const p of [A, B]) ab.push((await ctx.waitUntil(async () => { const s = await backupIds(p); return ids.every((id) => s.includes(id)); }, 5000)) !== null);
  R.expect(1, fresh.length === 2 && fresh.every((r) => r.kind === "manual" && r.people_count > 100) && ab.every(Boolean),
    `DB: ${fresh.length} new copies ${JSON.stringify(fresh.map((r) => `${r.kind}/${r.people_count} people`))}; A/B list both ${ab.join("/")}`);
  R.na(2, "a backup copy is immutable (no fields to edit)");
  R.expect(3, tC1 !== null, tC1 === null ? "C's Backup list did not show the two new copies within 5 s without a reload (the list is read once when the tab opens)" : `C listed both ${secs(tC1)} after`);
  R.na(4, "copies cannot be deleted from the UI (they expire after 30 days)");

  // Download A's copy.
  const mine = ids[0];
  const [dl] = await Promise.all([A.waitForEvent("download", { timeout: 20000 }), A.locator(`[data-backup-download="${mine}"]`).click()]);
  const raw = await readDownload(dl);
  let file = null;
  try { file = JSON.parse(raw); } catch { file = null; }
  const snap = file && (file.state || file.snapshot || file);
  const full = `${dir}/apms-e2e-backup-${run}.json`;
  await writeFile(full, raw);
  R.note(`Download: ${dl.suggestedFilename()}, ${Math.round(raw.length / 1024)} KB, ${Array.isArray(snap?.people) ? snap.people.length : "?"} people`);

  // Date filter (list filter only).
  await A.locator('[data-backup="date-filter"]').fill("2000-01-01");
  await A.waitForTimeout(400);
  const noneMsg = await A.getByText("No copies on that date.").count();
  await A.locator('[data-backup="date-filter"]').fill("");
  R.note(`Date filter 2000-01-01 → "No copies on that date." shown ${noneMsg > 0}`);

  // Restore from a FILE: A adds a function after the download; B and C watch Org → Functions.
  const fn = `E2E bk fn ${run}`;
  await addFunction(ctx, A, fn);
  await ctx.settled(A);
  await ctx.nav(B, "Org", "Functions");
  await ctx.nav(C, "Org", "Functions");
  await ctx.waitUntil(async () => (await functionShown(C, fn)) && (await functionShown(B, fn)), 5000);
  const cGets = [];
  const trace = (r) => { const u = r.url().replace(ctx.base, ""); if (u.startsWith("/api/") && !/company-tick|company-live/.test(u)) cGets.push(`${r.request().method()} ${u.slice(0, 90)} ${r.status()}`); };
  C.on("response", trace);
  t0 = Date.now();
  const rf = restoreFile(ctx, A, full);
  const cGone = ctx.waitUntil(async () => !(await functionShown(C, fn)), 60000);
  const bGone = ctx.waitUntil(async () => !(await functionShown(B, fn)), 60000);
  const res = await rf;
  const [tc, tb] = await Promise.all([cGone, bGone]);
  C.off("response", trace);
  const cFeed = await C.evaluate(() => JSON.stringify((window.__apmsSync?.feedLog?.() || []).slice(-4))).catch(() => "");
  const cStore = await C.evaluate((n) => { const s = window.__apmsSync; return s && typeof s.lastAckedBooks === "function" ? JSON.stringify(s.lastAckedBooks()?.org?.functions?.some?.((f) => f.name === n)) : "?"; }, fn).catch(() => "?");
  R.note(`file restore: C's API calls while waiting: ${cGets.slice(0, 12).join(" | ") || "none"}; C feedLog tail ${cFeed.slice(0, 400)}; C acked org book still has the function: ${cStore}`);
  const fnLive = (await functionDb(ctx, fn)).filter((r) => !r.deleted_at).length;
  const people = Number((await ctx.sql("select count(*) n from people where deleted_at is null"))[0].n);
  R.set("restore-file", res.title === "Restored" && fnLive === 0 && people === (snap?.people?.length || -1) && tc !== null && tb !== null && tc <= 5000 + res.ms && tb <= 5000 + res.ms ? "pass" : "fail",
    `overlay "${res.title}: ${res.step.slice(0, 140)}" after ${(res.ms / 1000).toFixed(1)} s (button ${res.button || "-"}); DB: "${fn}" live rows ${fnLive} (want 0), people ${people}; ` +
    `B dropped it ${tb === null ? "not within 60 s" : `${(tb / 1000).toFixed(1)} s`}, C ${tc === null ? "not within 60 s" : `${(tc / 1000).toFixed(1)} s`} after the file was picked (without reload)`);

  // Restore a file whose targets are EMPTY (RESTORE-EMPTY-OK): restore must proceed, live targets stay.
  const tBefore = await targetCounts(ctx);
  const empty = JSON.parse(raw);
  const es = empty.state || empty.snapshot || empty;
  es.targetCells = {};
  es.targetNodes = [];
  const emptyPath = `${dir}/apms-e2e-backup-empty-targets-${run}.json`;
  await writeFile(emptyPath, JSON.stringify(empty));
  const re = await restoreFile(ctx, A, emptyPath);
  const tAfter = await targetCounts(ctx);
  R.set("restore-empty-targets", re.title === "Restored" && tAfter.cells === tBefore.cells && tAfter.nodes === tBefore.nodes ? "pass" : "fail",
    `file with targetCells {} and targetNodes []: overlay "${re.title}: ${re.step.slice(0, 160)}"; live targets before ${JSON.stringify(tBefore)} → after ${JSON.stringify(tAfter)} (contract: restore proceeds, live interiors kept)`);
  // Put the full copy back (targets graph included).
  const rb = await restoreFile(ctx, A, full);
  const tBack = await targetCounts(ctx);
  R.note(`full file restored again: "${rb.title}", targets ${JSON.stringify(tBack)}`);

  // Check 5: reload; every Backup list shows the DB's copies.
  await ctx.reloadAll();
  const dbIds = (await ctx.sql("select id from company_backups where expires_at > now() order by created_at desc")).map((r) => r.id).join(",");
  const got = [];
  for (const p of [A, B, C]) {
    await openSettings(ctx, p, "Backup");
    await p.locator("[data-backup-row]").first().waitFor({ timeout: 10000 }).catch(() => {});
    got.push((await backupIds(p)).join(","));
  }
  R.expect(5, got.every((g) => g === dbIds), `DB ${dbIds.split(",").length} copies; screens ${got.map((g) => (g === dbIds ? "same" : g.split(",").length + " copies")).join(" / ")}`);
  await endChecks(ctx, R, m0);
  return R;
}

// ============================================================================
// SPECIAL: A restores a server copy while B has an unsaved edit open
// ============================================================================
async function fnDesc(ctx, name) {
  return (await functionDb(ctx, name)).filter((r) => !r.deleted_at)[0]?.payload?.description ?? null;
}

async function restoreServerCopy(ctx, p, id) {
  await openSettings(ctx, p, "Backup");
  await p.locator(`[data-backup-restore="${id}"]`).waitFor({ timeout: 15000 });
  await p.locator(`[data-backup-restore="${id}"]`).click();
  await p.waitForTimeout(300);
  const t0 = Date.now();
  await p.locator('[data-backup="confirm-restore"]').click();
  await p.locator("[data-backup-msg]").filter({ hasText: /^Restored|Could not|Reload/ }).first().waitFor({ timeout: 120000 }).catch(() => {});
  return { t0, ms: Date.now() - t0, msg: await p.locator("[data-backup-msg]").first().innerText().catch(() => "") };
}

export async function settingsRestore(ctx, run) {
  const R = new ScreenResult("Settings", "settings-restore", "Settings → Backup → Restore a server copy while B has an unsaved edit");
  const { A, B, C } = ctx;
  const G = "Expansion";
  const H = "Training";
  const m0 = await openWithoutWrites(ctx, R, "Settings → Backup", (p) => openSettings(ctx, p, "Backup"));

  // The copy this scenario returns to (taken at its start).
  const before = new Set((await ctx.sql("select id from company_backups")).map((r) => r.id));
  await A.locator('[data-backup="save-now"]').click();
  await ctx.waitUntil(async () => (await ctx.sql("select id from company_backups")).some((r) => !before.has(r.id)), 15000);
  const K = (await ctx.sql("select id from company_backups order by created_at desc limit 1"))[0].id;
  const g0 = await fnDesc(ctx, G);
  const h0 = await fnDesc(ctx, H);
  const trash0 = Number((await ctx.sql("select count(*) n from entities where kind = 'trash' and deleted_at is null"))[0].n);

  // Changes after the copy: a new function, G's description, and Empty trash.
  const fn = `E2E rs fn ${run}`;
  const aDesc = `E2E A after-backup ${run}`;
  await addFunction(ctx, A, fn);
  await ctx.settled(A);
  await openFunctionEdit(ctx, A, G);
  await field(A.locator("main"), "Description").fill(aDesc);
  await A.locator("main").getByRole("button", { name: "Save", exact: true }).first().click();
  await ctx.settled(A);
  await openSettings(ctx, C, "Trash");
  await openSettings(ctx, A, "Trash");
  const e0 = Date.now();
  await A.locator("main").getByRole("button", { name: "Empty trash", exact: true }).click();
  await dialog(A).getByRole("button", { name: "Empty trash", exact: true }).click();
  await ctx.settled(A);
  await ctx.sleep(1500);
  const trashEmptied = Number((await ctx.sql("select count(*) n from entities where kind = 'trash' and deleted_at is null"))[0].n);
  const cEmpty = await ctx.waitUntil(async () => (await C.getByText("Trash is empty.").count()) > 0, 8000);
  R.note(`Empty trash: live trash rows ${trash0} → ${trashEmptied}; C (idle on Trash) showed "Trash is empty." ${cEmpty === null ? "not within 8 s" : `${((Date.now() - e0) / 1000).toFixed(1)} s after the click`}`);
  const preDesc = await fnDesc(ctx, G);

  // C idle on Org → Functions; B has G open and types without leaving the field.
  await ctx.nav(C, "Org", "Functions");
  await ctx.waitUntil(() => functionShown(C, fn), 5000);
  const bDesc = `E2E B unsaved ${run}`;
  await openFunctionEdit(ctx, B, G);
  await field(B.locator("main"), "Description").click();
  await field(B.locator("main"), "Description").fill(bDesc);

  // A restores the copy (C's API reads are traced for the report).
  const cGets = [];
  const trace = (r) => { const u = r.url().replace(ctx.base, ""); if (u.startsWith("/api/") && !/company-tick|company-live/.test(u)) cGets.push(`${r.request().method()} ${u.slice(0, 90)} ${r.status()}`); };
  C.on("response", trace);
  const r1 = await restoreServerCopy(ctx, A, K);
  const t0 = r1.t0;
  const cSw = await ctx.waitUntil(async () => !(await functionShown(C, fn)), 30000);
  const tC = cSw === null ? null : Date.now() - t0;
  C.off("response", trace);
  const cFeed = await C.evaluate(() => JSON.stringify((window.__apmsSync?.feedLog?.() || []).slice(-4))).catch(() => "");
  R.note(`C's API calls in the 30 s after the restore: ${cGets.slice(0, 12).join(" | ") || "none"}; C feedLog tail ${cFeed.slice(0, 400)}`);
  const bForm = await field(B.locator("main"), "Description").inputValue().catch(() => "(form closed)");
  // B leaves the field and presses Save if the form is still open.
  await B.keyboard.press("Tab").catch(() => {});
  const bSave = B.locator("main").getByRole("button", { name: "Save", exact: true }).first();
  const bSaved = (await bSave.count()) > 0;
  if (bSaved) await bSave.click().catch(() => {});
  await ctx.settled(B, 10000);
  await ctx.nav(B, "Org", "Functions");
  const bSw = await ctx.waitUntil(async () => !(await functionShown(B, fn)), 30000);
  const tB = bSw === null ? null : Date.now() - t0;
  await ctx.sleep(3000);
  const db = { fn: (await functionDb(ctx, fn)).filter((r) => !r.deleted_at).length, g: await fnDesc(ctx, G), trash: Number((await ctx.sql("select count(*) n from entities where kind = 'trash' and deleted_at is null"))[0].n) };
  R.set("special", r1.msg.startsWith("Restored") && db.fn === 0 && db.g === g0 && db.trash === trash0 && tC !== null && tC <= 5000 && tB !== null ? "pass" : "fail",
    `restore: "${r1.msg}" after ${(r1.ms / 1000).toFixed(1)} s; C dropped the after-backup function ${tC === null ? "NOT within 30 s (no reload)" : `${(tC / 1000).toFixed(1)} s`} after; ` +
    `B's open form then held ${JSON.stringify(bForm)}, B pressed Tab${bSaved ? " + Save" : ""}; B's Functions list without the function ${tB === null ? "NOT within 30 s" : `${(tB / 1000).toFixed(1)} s`} after the restore; ` +
    `DB: after-backup function live ${db.fn} (want 0), ${G} description ${JSON.stringify(db.g)} (want the copy's ${JSON.stringify(g0)}; A's after-backup ${JSON.stringify(preDesc)}, B's unsaved ${JSON.stringify(bDesc)}), trash rows ${db.trash} (copy had ${trash0})`);

  // Check 4: nothing from before the restore comes back — B's unsaved edit and the pruned function, after reload too.
  await ctx.reloadAll();
  const after = { fn: (await functionDb(ctx, fn)).filter((r) => !r.deleted_at).length, g: await fnDesc(ctx, G) };
  const shown = [];
  for (const p of [A, B, C]) {
    await ctx.nav(p, "Org", "Functions");
    shown.push(await functionShown(p, fn));
  }
  R.expect(4, db.fn === 0 && after.fn === 0 && db.g === g0 && after.g === g0 && shown.every((x) => !x),
    `after B left the field${bSaved ? " and saved" : ""}: ${G} description ${JSON.stringify(db.g)}, after reload ${JSON.stringify(after.g)} (want ${JSON.stringify(g0)}); after-backup function live ${db.fn}/${after.fn}, listed on A/B/C after reload ${shown.join("/")}`);

  // Checks 1–3 after the restore: the sync still works for everyone.
  const a1 = `E2E A post-restore ${run}`;
  const b1 = `E2E B post-restore ${run}`;
  await Promise.all([openFunctionEdit(ctx, A, G), openFunctionEdit(ctx, B, H)]);
  let s0 = Date.now();
  await Promise.all([
    (async () => { await field(A.locator("main"), "Description").fill(a1); await A.locator("main").getByRole("button", { name: "Save", exact: true }).first().click(); })(),
    (async () => { await field(B.locator("main"), "Description").fill(b1); await B.locator("main").getByRole("button", { name: "Save", exact: true }).first().click(); })(),
  ]);
  await openFunctionEdit(ctx, C, G);
  const c3a = await ctx.waitUntil(async () => (await field(C.locator("main"), "Description").inputValue()) === a1, 5000);
  const tC3a = c3a === null ? null : Date.now() - s0;
  await ctx.settled(A);
  await ctx.settled(B);
  const d1 = { g: await fnDesc(ctx, G), h: await fnDesc(ctx, H) };
  R.expect(1, d1.g === a1 && d1.h === b1, `after the restore, A edits ${G} and B edits ${H} at the same time: DB ${JSON.stringify(d1)}`);
  // Same function, different fields: A the description, B the name.
  await ctx.nav(C, "Org", "Functions");
  await Promise.all([openFunctionEdit(ctx, A, G), openFunctionEdit(ctx, B, G)]);
  const a2 = `E2E A2 post-restore ${run}`;
  const gName = `${G} E2E ${run}`;
  s0 = Date.now();
  await Promise.all([
    (async () => { await field(A.locator("main"), "Description").fill(a2); await A.locator("main").getByRole("button", { name: "Save", exact: true }).first().click(); })(),
    (async () => { await field(B.locator("main"), "Name").fill(gName); await B.locator("main").getByRole("button", { name: "Save", exact: true }).first().click(); })(),
  ]);
  const c3b = await ctx.waitUntil(() => functionShown(C, gName), 5000);
  const tC3b = c3b === null ? null : Date.now() - s0;
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const d2 = (await functionDb(ctx, gName)).filter((r) => !r.deleted_at)[0]?.payload;
  R.expect(2, d2?.description === a2, `same function ${G}: A's description + B's name → DB name ${JSON.stringify(d2?.name)}, description ${JSON.stringify(d2?.description)} (want ${JSON.stringify(a2)})`);
  R.expect(3, tC !== null && tC <= 5000 && tC3a !== null && tC3b !== null,
    `C showed the restored data ${tC === null ? "NOT within 30 s" : `${(tC / 1000).toFixed(1)} s`} after the restore, A's post-restore description ${secs(tC3a)} after, B's rename ${secs(tC3b)} after`);

  // Check 5: everyone reloads; screens and DB agree (function names on the list).
  await ctx.reloadAll();
  const want = (await ctx.sql("select payload->>'name' n from entities where kind = 'functions' and deleted_at is null and (payload->>'parentId') is null order by 1")).map((r) => r.n);
  const got = [];
  for (const p of [A, B, C]) {
    await ctx.nav(p, "Org", "Functions");
    const miss = [];
    for (const n of want) if (!(await functionShown(p, n))) miss.push(n);
    const extra = (await functionShown(p, fn)) ? [fn] : [];
    got.push(miss.length || extra.length ? `missing ${miss.join(",")} extra ${extra.join(",")}` : "same");
  }
  R.expect(5, got.every((g) => g === "same"), `DB ${want.length} top functions; screens ${got.join(" / ")}`);

  // Back to the copy taken at the start (later scenarios see the same data).
  await ctx.nav(A, "Settings");
  const r2 = await restoreServerCopy(ctx, A, K);
  await ctx.sleep(3000);
  const end = { g: await fnDesc(ctx, G), h: await fnDesc(ctx, H), renamed: (await functionDb(ctx, gName)).filter((r) => !r.deleted_at).length, trash: Number((await ctx.sql("select count(*) n from entities where kind = 'trash' and deleted_at is null"))[0].n) };
  R.note(`restored the start copy again: "${r2.msg}"; ${G} ${JSON.stringify(end.g)} (copy ${JSON.stringify(g0)}), ${H} ${JSON.stringify(end.h)} (copy ${JSON.stringify(h0)}), renamed rows ${end.renamed}, trash ${end.trash}/${trash0}`);
  await ctx.reloadAll();
  await endChecks(ctx, R, m0);
  return R;
}

/** Run order: logins before forgot-password (it reads the same people); restore last. */
export const SCENARIOS = [
  ["settingsAccessRoles", settingsAccessRoles],
  ["settingsAssign", settingsAssign],
  ["settingsLogins", settingsLogins],
  ["forgotPassword", forgotPassword],
  ["settingsSetup", settingsSetup],
  ["settingsTrash", settingsTrash],
  ["settingsBackup", settingsBackup],
  ["settingsRestore", settingsRestore],
];
