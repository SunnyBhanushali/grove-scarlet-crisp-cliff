/**
 * Page helpers for Settings (Setup · Access roles · Assign people · Backup ·
 * Trash), the sign-in page (forgot password, first-sign-in password) and the
 * few Org → Functions steps the Settings scenarios use to make their own
 * records. Selectors follow rendered text (no test ids in the recovered
 * bundle), except the Backup panel, which carries `data-backup*` attributes.
 */

export const dialog = (p) => p.locator("div.fixed.inset-0").last();

/** The control a `<label>Label …<input/></label>` wraps. */
export function field(scope, label) {
  return scope.locator("label").filter({ hasText: new RegExp("^\\s*" + label) }).locator("input, textarea, select").first();
}

export async function openSettings(ctx, p, tab) {
  await ctx.nav(p, "Settings");
  if (tab) {
    await p.locator("main").getByRole("button", { name: tab, exact: true }).first().click();
    await p.waitForTimeout(1200);
  }
}

// ---------------------------------------------------------------- access roles
export function accessRoleRow(p, name) {
  return p.locator("main tbody tr").filter({ has: p.locator("td div", { hasText: new RegExp(`^${esc(name)}$`) }) }).first();
}

export async function accessRoleShown(p, name) {
  return (await accessRoleRow(p, name).count()) > 0;
}

export async function accessRoleNote(p, name) {
  const r = accessRoleRow(p, name);
  if (!(await r.count())) return null;
  return (await r.locator("td").first().innerText()).split("\n").slice(1).join(" ").trim();
}

/** Create access role dialog → fill → Create. */
export async function createAccessRole(p, { name, base, scope, note }) {
  await p.locator("main").getByRole("button", { name: "Create access role", exact: true }).first().click();
  await p.waitForTimeout(600);
  const d = dialog(p);
  await field(d, "Name").fill(name);
  if (base) await field(d, "Start from").selectOption({ label: base });
  if (scope) await field(d, "Scope").selectOption({ label: scope });
  if (note) await field(d, "Note").fill(note);
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await p.waitForTimeout(500);
}

export async function openEditAccessRole(p, name) {
  await accessRoleRow(p, name).getByRole("button", { name: "Edit", exact: true }).click();
  await p.waitForTimeout(600);
  return dialog(p);
}

/** Module × action checkbox in the Create/Edit access role grid. */
export function grantBox(d, moduleLabel, action) {
  const i = ["view", "create", "edit", "delete"].indexOf(action);
  return d.locator("tbody tr").filter({ has: d.page().locator("td", { hasText: new RegExp(`^${esc(moduleLabel)}$`) }) }).locator('input[type="checkbox"]').nth(i);
}

export function flagBox(d, flagLabel) {
  return d.locator("label").filter({ hasText: new RegExp(`^\\s*${esc(flagLabel)}\\s*$`) }).locator('input[type="checkbox"]').first();
}

export async function saveDialog(p, label = "Save") {
  await dialog(p).getByRole("button", { name: label, exact: true }).click();
  await p.waitForTimeout(400);
}

export async function deleteAccessRole(p, name) {
  await accessRoleRow(p, name).getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForTimeout(500);
  await dialog(p).getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForTimeout(500);
}

export async function accessRoleDb(ctx, name) {
  const r = await ctx.sql("select k1, rev, payload, deleted_at from entities where kind = 'access-roles' and payload->>'name' = $1 order by deleted_at nulls first", [name]);
  return r[0] || null;
}

// ---------------------------------------------------------------- assign people
export async function searchAssign(p, text) {
  const s = p.locator('main input[placeholder^="Search name, email"]').first();
  await s.fill(text);
  await p.waitForTimeout(500);
}

export function assignRow(p, personName) {
  return p.locator("main tbody tr").filter({ has: p.locator("td div.font-medium", { hasText: new RegExp(`^${esc(personName)}$`) }) }).first();
}

export async function assignRole(p, personName) {
  const sel = assignRow(p, personName).locator("select").first();
  if (!(await sel.count())) return null;
  return sel.evaluate((s) => s.options[s.selectedIndex]?.text || "");
}

export async function setAssignRole(p, personName, roleName) {
  await assignRow(p, personName).locator("select").first().selectOption({ label: roleName });
  await p.waitForTimeout(300);
}

export async function mustSetShown(p, personName) {
  const r = assignRow(p, personName);
  if (!(await r.count())) return null;
  return /Must set password/.test(await r.innerText());
}

/** Row "Reset" (or "Create access") → the one-time dialog → { username, password }. */
export async function resetLogin(p, personName) {
  const b = p.locator(`main button[aria-label="Reset login for ${personName}"], main button[aria-label="Create access for ${personName}"]`).first();
  await b.click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: /Password: / }).last();
  await d.waitFor({ timeout: 30000 });
  const txt = await d.innerText();
  const username = (txt.match(/Username: (\S+)/) || [])[1] || "";
  const password = (txt.match(/Password: (\S+)/) || [])[1] || "";
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await p.waitForTimeout(300);
  return { username, password, text: txt.slice(0, 300) };
}

export async function personDb(ctx, id) {
  const r = await ctx.sql("select payload, rev, deleted_at from people where id = $1", [id]);
  return r[0] || null;
}

export async function personIdByName(ctx, name) {
  const r = await ctx.sql("select id from people where payload->>'name' = $1 and deleted_at is null", [name]);
  return r[0]?.id || null;
}

export async function issuedDb(ctx, username) {
  const r = await ctx.sql("select username, person_id, password, updated_at from issued_logins where username = $1", [username]);
  return r[0] || null;
}

// ---------------------------------------------------------------- sign in
/** Sign in through the API (what the sign-in page posts); returns the HTTP status and body. */
export async function apiSignIn(base, username, password) {
  const r = await fetch(base + "/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body, token: r.headers.get("set-auth-token") || body?.token || "" };
}

/** POST as a signed-in session token (the harness pages keep theirs in a cookie). */
export async function apiPost(base, path, token, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: token ? `better-auth.session_token=${encodeURIComponent(token)}` : "" },
    body: JSON.stringify(body),
  });
  let text = "";
  try { text = (await r.text()).slice(0, 300); } catch { /* ignore */ }
  return { status: r.status, body: text };
}

/** A fresh browser context on the sign-in page. */
export async function freshPage(ctx) {
  const bc = await ctx.A.context().browser().newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await bc.newPage();
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.goto(ctx.base + "/", { waitUntil: "load" });
  await p.locator('input[type="password"]').first().waitFor({ timeout: 30000 });
  return p;
}

/** Sign in through the page; → "app" | "must-reset" | "refused". */
export async function uiSignIn(p, user, pass) {
  await p.locator('input[type="text"]').first().fill(user);
  await p.locator('input[type="password"]').first().fill(pass);
  await p.getByRole("button", { name: "Continue" }).click();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (await p.getByText("Set a new password", { exact: true }).count()) return "must-reset";
    if (await p.locator("aside, nav").first().getByText("Org", { exact: true }).count().catch(() => 0)) return "app";
    const body = await p.locator("body").innerText().catch(() => "");
    if (/invalid|incorrect|not match|wrong/i.test(body)) return "refused";
    await p.waitForTimeout(250);
  }
  return "timeout";
}

/** First-sign-in screen: set the new password, wait for the app. */
export async function setFirstPassword(p, current, next) {
  await field(p.locator("form"), "Current password").fill(current);
  await field(p.locator("form"), "New password").fill(next);
  await p.getByRole("button", { name: "Save", exact: true }).click();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await p.locator("aside, nav").first().getByText("Org", { exact: true }).count().catch(() => 0)) return "app";
    await p.waitForTimeout(250);
  }
  return (await p.locator("body").innerText()).slice(0, 200);
}

// ---------------------------------------------------------------- setup
export function setupStep(p, label) {
  return p.locator("main ol > li").filter({ hasText: label }).first();
}

export async function setupStepShown(p, label) {
  return (await setupStep(p, label).count()) > 0;
}

export async function setupDb(ctx) {
  const r = await ctx.sql("select payload, rev from entities where kind = 'settings' and k1 = 'setupDone' and deleted_at is null");
  return r[0]?.payload?.value || [];
}

// ---------------------------------------------------------------- trash
export function trashRow(p, label) {
  return p.locator("main tbody tr").filter({ has: p.locator("td", { hasText: new RegExp(`^${esc(label)}$`) }) }).first();
}

export async function trashShown(p, label) {
  return (await trashRow(p, label).count()) > 0;
}

export async function trashDb(ctx, label) {
  return ctx.sql("select k1, rev, deleted_at, payload from entities where kind = 'trash' and payload->>'label' = $1 order by deleted_at nulls first", [label]);
}

// ---------------------------------------------------------------- org functions
export async function addFunction(ctx, p, name) {
  await ctx.nav(p, "Org", "Functions");
  await p.locator("main").getByRole("button", { name: "Add function", exact: true }).click();
  await p.waitForTimeout(600);
  const d = dialog(p);
  await field(d, "Name").fill(name);
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await p.waitForTimeout(800);
}

export function functionRow(p, name) {
  return p.locator("main div").filter({ has: p.getByText(name, { exact: true }) }).filter({ has: p.locator('button[title="Delete"]') }).last();
}

export async function functionShown(p, name) {
  return (await p.locator("main").getByText(name, { exact: true }).count()) > 0;
}

export async function deleteFunction(ctx, p, name) {
  await ctx.nav(p, "Org", "Functions");
  await functionRow(p, name).locator('button[title="Delete"]').first().click();
  await p.waitForTimeout(500);
  await dialog(p).getByRole("button", { name: "Delete function", exact: true }).click();
  await p.waitForTimeout(800);
}

export async function openFunctionEdit(ctx, p, name) {
  await ctx.nav(p, "Org", "Functions");
  await functionRow(p, name).locator('button[title="Edit"]').first().click();
  await p.locator("main").getByText(`Edit ${name}`, { exact: true }).first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(500);
}

export async function functionDb(ctx, name) {
  return ctx.sql("select k1, rev, deleted_at, payload from entities where kind = 'functions' and payload->>'name' = $1 order by deleted_at nulls first", [name]);
}

export function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
