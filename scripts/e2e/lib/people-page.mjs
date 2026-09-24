/**
 * Page helpers for Org → People, the person file (org-person / Me), Settings →
 * Trash and Home (scripts/e2e/lib/screens-people.mjs, screens-me-home.mjs).
 * Selectors follow rendered text (the SPA has no test ids).
 */
import { chromium } from "playwright";

export const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s) => new RegExp(`^\\s*${esc(s)}\\s*$`);

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
export async function personByName(ctx, name) {
  const r = await ctx.sql("select id, payload, rev, deleted_at from people where payload->>'name' = $1 order by updated_at desc", [name]);
  return r[0] || null;
}
export async function personById(ctx, id) {
  const r = await ctx.sql("select id, payload, rev, deleted_at from people where id = $1", [id]);
  return r[0] || null;
}
export async function waitDb(ctx, fn, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await ctx.sleep(300);
  }
}

/** Track in-flight writes per page (a late book save must not land in the next screen's "open" window). */
function trackWrites(p) {
  if (p.__wq) return p.__wq;
  const st = { inflight: new Set(), last: 0 };
  const isW = (r) => r.method() !== "GET" && /\/api\//.test(r.url());
  p.on("request", (r) => { if (isW(r)) { st.inflight.add(r); st.last = Date.now(); } });
  const done = (r) => { if (st.inflight.delete(r)) st.last = Date.now(); };
  p.on("requestfinished", done);
  p.on("requestfailed", done);
  p.__wq = st;
  return st;
}
export function watchWrites(ctx) {
  for (const t of ["A", "B", "C"]) trackWrites(ctx[t]);
}
/** Wait until no page has a write in flight and none started for `quietMs`. */
export async function waitQuiet(ctx, quietMs = 3000, max = 20000) {
  const sts = ["A", "B", "C"].map((t) => trackWrites(ctx[t]));
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const busy = sts.some((s) => s.inflight.size > 0);
    const last = Math.max(0, ...sts.map((s) => s.last));
    if (!busy && Date.now() - last >= quietMs) return true;
    await ctx.sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------------------
// People list
// ---------------------------------------------------------------------------
export const searchBox = (p) => p.locator("main input[placeholder^='Search name']").first();

/** Org → People on `view` (List / My team / Company / SBU / Function / Summary). */
export async function openPeople(ctx, p, view = "List") {
  const side = p.locator("aside, nav").first();
  const sub = side.getByText("People", { exact: true }).first();
  if (!(await sub.isVisible().catch(() => false))) {
    await ctx.nav(p, "Org");
    if (!(await sub.isVisible().catch(() => false))) await ctx.nav(p, "Org");
  }
  await sub.click();
  await p.waitForTimeout(1000);
  await p.locator("main").getByRole("button", { name: "Add person", exact: true }).waitFor({ timeout: 15000 });
  if (view) await setView(p, view);
}
export async function setView(p, view) {
  await p.locator("main").getByRole("button", { name: view, exact: true }).first().click();
  await p.waitForTimeout(700);
}
export async function search(p, q) {
  await searchBox(p).fill(q);
  await p.waitForTimeout(1200);
}
/** A reporting-tree row (search results render as tree rows). */
export function treeRow(p, name) {
  // The name span also holds the MR mark and manager chips; "Sunny" must not match "Sunny Kumar".
  return p.locator("main div[data-dnd-row]").filter({ has: p.locator("button span.font-medium", { hasText: new RegExp(`^\\s*${esc(name)}(?!\\s*(?!MR|EXITED|Exited|exited|PAUSED|Paused|paused)\\w)`) }) }).first();
}
export async function rowShown(p, name) {
  return (await treeRow(p, name).count()) > 0;
}
/** The row's name line shows the bold blue MR mark. */
export async function rowHasMR(p, name) {
  const r = treeRow(p, name);
  if (!(await r.count())) return false;
  const t = await r.locator("button span.font-medium").first().innerText();
  return /(^|\s)MR(\s|$)/.test(t);
}
export async function countLine(p) {
  const t = await p.locator("main").innerText();
  const m = t.match(/(\d+) people/);
  return m ? Number(m[1]) : null;
}

/** People → Add person. `v`: first, last, email, dob (yyyy-mm-dd), code (ALN####), phone. */
export async function hire(ctx, p, v) {
  await p.locator("main").getByRole("button", { name: "Add person", exact: true }).click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: "Create person" }).last();
  await d.waitFor();
  const ins = d.locator("input");
  await ins.nth(0).fill(v.first);
  await ins.nth(1).fill(v.last);
  await ins.nth(2).fill(v.email);
  await ins.nth(3).fill(v.dob || "1995-05-05");
  await ins.nth(4).fill(v.code);
  await d.locator("input[type=tel]").fill(v.phone);
  await d.getByRole("button", { name: "Create person" }).click();
  await p.waitForTimeout(400);
  const err = d.locator("p.text-red-700");
  if ((await d.count()) && (await err.count())) throw new Error(`Add person refused: ${await err.innerText()}`);
  // The SPA opens the new person's file.
  await p.locator("main").getByText("Compensation plan", { exact: true }).waitFor({ timeout: 10000 });
  await p.locator("main").getByText(`${v.first} ${v.last}`, { exact: true }).first().waitFor({ timeout: 5000 });
  await p.waitForTimeout(500);
}

/** The People status filter (Active / Paused / Exited / All). */
export async function statusFilter(p, label) {
  const sel = p.locator("main select").filter({ has: p.locator("option", { hasText: /^Exited$/ }) }).filter({ hasNot: p.locator("option", { hasText: /^Full time$/ }) }).first();
  await sel.selectOption({ label });
  await p.waitForTimeout(700);
}

/** People → search → the row's pencil → person file (any status). */
export async function openFile(ctx, p, name) {
  await openPeople(ctx, p, "List");
  await search(p, name);
  if (!(await treeRow(p, name).waitFor({ timeout: 4000 }).then(() => true, () => false))) {
    await statusFilter(p, "All");
    await search(p, "");
    await search(p, name);
  }
  await treeRow(p, name).locator("button[title='Edit']").click();
  await p.locator("main").getByText("Compensation plan", { exact: true }).waitFor({ timeout: 10000 });
  await p.waitForTimeout(700);
}

/** Row trash button → "Delete person". */
export async function trashPerson(ctx, p, name) {
  await openPeople(ctx, p, "List");
  await search(p, name);
  if (!(await treeRow(p, name).waitFor({ timeout: 4000 }).then(() => true, () => false))) {
    await statusFilter(p, "All");
    await search(p, "");
    await search(p, name);
  }
  await p.locator(`main button[aria-label='Delete ${name}'], main button[title='Delete ${name}']`).first().click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: `Delete ${name}?` }).last();
  await d.getByRole("button", { name: "Delete person" }).click();
  await p.waitForTimeout(800);
}

/** Settings → Trash → Restore on the row labelled `label`. */
export async function openTrash(ctx, p) {
  await ctx.nav(p, "Settings");
  await p.locator("main").getByRole("button", { name: "Trash", exact: true }).first().click();
  await p.waitForTimeout(1200);
}
export function trashRow(p, label) {
  return p.locator("main tr").filter({ has: p.locator("td", { hasText: exact(label) }) }).first();
}
export async function restoreFromTrash(ctx, p, label) {
  await openTrash(ctx, p);
  await trashRow(p, label).getByRole("button", { name: "Restore" }).click();
  await p.waitForTimeout(800);
  const d = p.locator("div.fixed.inset-0").last();
  if (await d.count()) {
    const b = d.getByRole("button", { name: /^Restore/ }).last();
    if (await b.count()) await b.click();
  }
  await p.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Person file (org-person and Me): the details card and its Edit form
// ---------------------------------------------------------------------------
/** A value on the read-only details card (dt/dd style pairs). */
export async function detail(p, label) {
  return p.evaluate((lab) => {
    const main = document.querySelector("main");
    if (!main) return null;
    const els = [...main.querySelectorAll("dt, span, div, p")].filter((e) => e.children.length === 0 && (e.textContent || "").trim() === lab);
    for (const e of els) {
      const next = e.nextElementSibling;
      if (next) return (next.innerText || next.value || "").trim();
    }
    return null;
  }, label);
}
export async function editOpen(p) {
  return (await p.locator("main").getByRole("button", { name: "Save", exact: true }).count()) > 0;
}
export async function startEdit(p) {
  if (await editOpen(p)) return;
  await p.locator("main").getByRole("button", { name: "Edit", exact: true }).first().click();
  await p.locator("main").getByRole("button", { name: "Save", exact: true }).waitFor({ timeout: 8000 });
}
/** Text / date / select control of the edit form, by its label. */
export function field(p, label) {
  if (label === "Mobile") return p.locator("main label").filter({ hasText: /^\s*Mobile/ }).locator("input[type=tel]").first();
  return p.locator("main label").filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }).locator("input:not([type=checkbox]), select").first();
}
export async function setField(p, label, value) {
  const f = field(p, label);
  const tag = await f.evaluate((e) => e.tagName);
  if (tag === "SELECT") await f.selectOption(value);
  else await f.fill(String(value));
}
/** Save the edit form; the form's refusal text if it stays open with an error, else "". */
export async function saveEdit(p) {
  await p.locator("main").getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(600);
  if (!(await editOpen(p))) return "";
  const err = p.locator("main .text-red-700, main [role=alert]");
  return (await err.count()) ? (await err.first().innerText()).trim() : "";
}
/** Edit form picker (Role / Reports to / Direct reportees / Brand / SBU / Function) by its title. */
export function picker(p, title) {
  const ph = { "Reports to": 0, "Direct reportees": 1 };
  if (title in ph) return p.locator("main input[placeholder='Search people…']").nth(ph[title]);
  const map = { Role: "Search roles…", Brand: "Search brands…", SBU: "Search SBUs…", Function: "Search functions…" };
  return p.locator(`main input[placeholder='${map[title]}']`).first();
}
/** Tick / untick `name` in an open picker (the list renders in a portal). */
export async function pickerToggle(p, title, name) {
  const inp = picker(p, title);
  await inp.click();
  await p.waitForTimeout(300);
  await inp.fill(name.split(" ")[0]);
  await p.waitForTimeout(600);
  await p.locator("div[role=button]").filter({ has: p.locator("span.min-w-0.truncate", { hasText: exact(name) }) }).first().click();
  await p.waitForTimeout(500);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
/** Summary text a closed picker shows (its input value). */
export async function pickerValue(p, title) {
  return picker(p, title).inputValue().catch(() => "");
}

// ---------------------------------------------------------------------------
// Row "Reports to" dialog (tick who reports to this person)
// ---------------------------------------------------------------------------
export async function reportsToDialog(ctx, p, manager, tick) {
  await openPeople(ctx, p, "List");
  await search(p, manager);
  await treeRow(p, manager).locator("button[title='Reports to']").click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: `Reports to · ${manager}` }).last();
  await d.waitFor();
  for (const name of tick) {
    const s = d.locator("input").first();
    await s.fill(name);
    await p.waitForTimeout(500);
    await d.locator("div[role=button], button, label").filter({ has: p.locator("span", { hasText: exact(name) }) }).first().click();
    await p.waitForTimeout(300);
  }
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await p.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Mass update
// ---------------------------------------------------------------------------
export async function massSelect(ctx, p, names) {
  await openPeople(ctx, p, "List");
  const mu = p.locator("main").getByRole("button", { name: "Mass update", exact: true });
  if (await mu.count()) await mu.click();
  await p.waitForTimeout(500);
  for (const n of names) {
    await search(p, n);
    await p.locator(`main input[aria-label='Select ${n}']`).check();
  }
}
/** Update dialog: `fields` = { Location: "x", Status: "paused", … } (select → option value). */
export async function massApply(p, fields) {
  await p.locator("main").getByRole("button", { name: "Update", exact: true }).click();
  const d = p.locator("div.fixed.inset-0").filter({ hasText: /^Update \d+ (person|people)/ }).last();
  await d.waitFor();
  for (const [title, value] of Object.entries(fields)) {
    const sec = d.locator("div.rounded-lg.border").filter({ has: p.locator("label", { hasText: exact(title) }) }).first();
    await sec.locator("label input[type=checkbox]").first().check();
    const ctl = sec.locator("input:not([type=checkbox]), select").first();
    const tag = await ctl.evaluate((e) => e.tagName);
    if (tag === "SELECT") await ctl.selectOption(value);
    else await ctl.fill(String(value));
  }
  await d.getByRole("button", { name: /^Apply to/ }).click();
  await p.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Extra signed-in browsers (a fourth user, or a password check)
// ---------------------------------------------------------------------------
export async function signInPage(browser, base, user, pass) {
  const bc = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await bc.newPage();
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.goto(base + "/", { waitUntil: "load" });
  await p.locator('input[type="text"]').fill(user);
  await p.locator('input[type="password"]').fill(pass);
  await p.getByRole("button", { name: "Continue" }).click();
  await p.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  return p;
}
/** POST /api/auth/sign-in/username from a fresh context; the HTTP status. */
export async function tryPassword(base, user, pass) {
  const r = await fetch(base + "/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  return r.status;
}
/**
 * Sign in `user` in a new context with whichever of `candidates` the server
 * accepts; a forced "Set a new password" screen is completed with `resetTo`.
 */
export async function signInAny(browser, base, user, candidates, resetTo) {
  let pass = null;
  for (const c of candidates) if ((await tryPassword(base, user, c)) === 200) { pass = c; break; }
  if (!pass) throw new Error(`no working password for ${user}`);
  const bc = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await bc.newPage();
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.goto(base + "/", { waitUntil: "load" });
  await p.locator('input[type="text"]').fill(user);
  await p.locator('input[type="password"]').fill(pass);
  await p.getByRole("button", { name: "Continue" }).click();
  const me = p.locator("aside, nav").first().getByText("Me", { exact: true }).first();
  const reset = p.getByRole("heading", { name: "Set a new password" });
  await Promise.race([me.waitFor({ timeout: 30000 }), reset.waitFor({ timeout: 30000 })]).catch(() => {});
  let forced = null;
  if (await reset.isVisible().catch(() => false)) {
    const pw = p.locator('input[type="password"]');
    await pw.nth(0).fill(pass);
    await pw.nth(1).fill(resetTo);
    await p.getByRole("button", { name: "Save" }).click();
    await me.waitFor({ timeout: 30000 });
    forced = { from: pass, to: resetTo };
    pass = resetTo;
  }
  await p.waitForTimeout(1500);
  return { page: p, pass, forced, close: () => bc.close() };
}
/** Me → Password → New password → Update; the message shown ("Saved." or the refusal). */
export async function changeOwnPassword(p, pw) {
  await openMe(p);
  const inp = p.locator("main label").filter({ hasText: /^\s*New password/ }).locator("input").first();
  await inp.scrollIntoViewIfNeeded();
  await inp.fill(pw);
  await p.locator("main").getByRole("button", { name: "Update", exact: true }).click();
  await p.waitForTimeout(800);
  const sec = p.locator("main section").filter({ hasText: "Change the password you use to sign in." }).first();
  return (await sec.innerText().catch(() => "")).replace(/\n+/g, " | ");
}
export async function openMe(p) {
  await p.locator("aside, nav").first().getByText("Me", { exact: true }).first().click();
  await p.locator("main").getByText("Your personal file", { exact: false }).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
}
export async function openHome(p) {
  await p.locator("aside, nav").first().getByText("Home", { exact: true }).first().click();
  await p.locator("main").getByText("Alerts", { exact: true }).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
}
/** Home → Alerts: the alert row whose title starts with `title`. */
export function alertRow(p, title) {
  return p.locator("main li").filter({ has: p.getByRole("button", { name: "Done", exact: true }) }).filter({ hasText: new RegExp(`^\\s*${esc(title)}`) }).first();
}
export async function alertShown(p, title) {
  return (await alertRow(p, title).count()) > 0;
}
export async function bellCount(p) {
  const b = p.locator("button[aria-label='Notifications']").first();
  const t = ((await b.innerText().catch(() => "")) || "").match(/\d+/);
  return t ? Number(t[0]) : 0;
}

/** Bell tray item titles (opens and closes the tray). */
export async function trayTitles(p) {
  await p.locator("button[aria-label='Notifications']").first().click();
  await p.waitForTimeout(1500);
  const t = await p.evaluate(() => {
    const h = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "Notifications");
    let box = h;
    for (let i = 0; i < 4 && box && box.parentElement; i++) box = box.parentElement;
    return box ? [...box.querySelectorAll("button, li, a")].map((e) => (e.innerText || "").split("\n")[0].trim()).filter(Boolean) : [];
  });
  await p.keyboard.press("Escape");
  await p.mouse.click(700, 600);
  await p.waitForTimeout(800);
  return [...new Set(t)].filter((x) => x !== "Notifications");
}

/** UI sign-in in a brand-new browser context: true when it lands in the app. */
export async function uiSignInWorks(browser, base, user, pass) {
  const bc = await browser.newContext();
  const p = await bc.newPage();
  try {
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator('input[type="text"]').fill(user);
    await p.locator('input[type="password"]').fill(pass);
    await p.getByRole("button", { name: "Continue" }).click();
    await p.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 8000 });
    return true;
  } catch {
    return false;
  } finally {
    await bc.close();
  }
}
export { chromium };
