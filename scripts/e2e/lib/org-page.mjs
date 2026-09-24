/**
 * Page helpers for the Org catalog screens (Overview, Brands & SBUs,
 * Functions, Roles, People reporting tree). Selectors follow rendered text
 * and aria-labels; there are no test ids.
 */

/** Open Org → <sub> (Overview / Brands & SBUs / Functions / Roles / People). */
export async function openOrg(ctx, p, sub) {
  await ctx.nav(p, "Org", sub);
  await p.locator("main").first().waitFor();
  // The side-nav item keeps a selected role / SBU open: step back to the list with the breadcrumb.
  for (let i = 0; i < 2; i++) {
    const onDetail = (await p.locator("main").getByText("Place this role", { exact: true }).count()) > 0;
    if (!onDetail || !sub) break;
    await p.locator("main").getByRole("button", { name: sub, exact: true }).first().click().catch(() => {});
    await p.waitForTimeout(800);
  }
}

/** A modal (`div.fixed.inset-0`) whose heading is `title`. */
export function modal(p, title) {
  return p.locator("div.fixed.inset-0").filter({ has: p.getByRole("heading", { name: title }) }).last();
}

/** Row of a tree (Brands & SBUs, Functions, Roles, People) by its name. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The name element of a row (roles may carry a "MULTI REPORTING" badge inside it). */
function nameText(p, name) {
  return p.getByText(new RegExp(`^${esc(name)}\\s*(multi reporting)?$`, "i"));
}
export function rowOf(p, name) {
  return p.locator("main [data-dnd-row]").filter({ has: nameText(p, name) }).first();
}

export async function hasRow(p, name) {
  return (await p.locator("main [data-dnd-row]").filter({ has: nameText(p, name) }).count()) > 0;
}

/** Row names on screen, in order, with their depth (indent of the Move handle). */
export async function treeRows(p) {
  return p.evaluate(() => {
    const out = [];
    for (const r of document.querySelectorAll("main [data-dnd-row]")) {
      const h = r.querySelector("button[aria-label^='Move']");
      const nameEl = r.querySelector(".font-medium") || r;
      out.push({ name: (nameEl.innerText || "").split("\n")[0].trim(), text: r.innerText.replace(/\n/g, " · "), x: h ? Math.round(h.getBoundingClientRect().x) : null });
    }
    return out;
  });
}

/** Latest entity row by payload name (live rows first). */
export async function entityByName(ctx, kind, name) {
  const r = await ctx.sql(
    "select id, rev, payload, deleted_at from entities where kind = $1 and payload->>'name' = $2 order by deleted_at nulls first, updated_at desc limit 1",
    [kind, name],
  );
  return r[0] || null;
}
export async function entityById(ctx, kind, id) {
  const r = await ctx.sql("select id, rev, payload, deleted_at from entities where kind = $1 and id = $2", [kind, id]);
  return r[0] || null;
}
export async function personByName(ctx, name) {
  const r = await ctx.sql("select id, rev, payload, deleted_at from people where payload->>'name' = $1 order by deleted_at nulls first limit 1", [name]);
  return r[0] || null;
}
/** Live sbu-members group ids of an SBU. */
export async function groupsOf(ctx, sbuId) {
  const r = await ctx.sql("select payload->>'groupId' g from entities where kind = 'sbu-members' and deleted_at is null and payload->>'memberId' = $1 order by 1", [sbuId]);
  return r.map((x) => x.g);
}
export async function trashRow(ctx, label) {
  const r = await ctx.sql("select id, payload, deleted_at from entities where kind = 'trash' and payload->>'label' = $1 order by updated_at desc limit 1", [label]);
  return r[0] || null;
}

/** Poll the DB until `fn` returns truthy (value returned) or null after `ms`. */
export async function waitDb(fn, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Settings → Trash shows `label`? */
export async function trashShows(ctx, p, label) {
  await ctx.nav(p, "Settings");
  await p.locator("main").getByRole("button", { name: "Trash", exact: true }).click();
  await p.waitForTimeout(1200);
  return (await p.locator("main").getByText(label, { exact: true }).count()) > 0;
}

// ---------------------------------------------------------------------------
// Pointer drag (apms-dnd-engine: 28 px of travel per level; rows on screen are
// indented 44 px per level). Pointer drags cannot leave the viewport, so the
// viewport is made tall enough for both rows.
// ---------------------------------------------------------------------------
async function tall(p, fn) {
  const vp = p.viewportSize();
  await p.setViewportSize({ width: vp.width, height: 3200 });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  try {
    return await fn();
  } finally {
    await p.setViewportSize(vp);
  }
}

async function pointerDrag(p, from, to) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.waitForTimeout(250);
  await p.mouse.move(from.x, from.y + 8, { steps: 3 });
  await p.waitForTimeout(150);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + 8 + ((to.y - from.y - 8) * i) / steps);
    await p.waitForTimeout(35);
  }
  await p.waitForTimeout(300);
  await p.mouse.up();
  await p.waitForTimeout(700);
}

async function handleBox(p, name) {
  const h = rowOf(p, name).locator("button[aria-label^='Move']").first();
  return h.boundingBox();
}

/**
 * Drag `name` so it becomes the last-level child of `parent` (nest). Works
 * whether the row starts above or below the parent (engine slot maths:
 * the pointer ends on the parent row when the source is above it, on the
 * row right after the parent when it is below).
 */
export async function dragNest(p, name, parent) {
  return tall(p, async () => {
    const rows = await treeRows(p);
    const a = rows.findIndex((r) => r.name === name);
    const b = rows.findIndex((r) => r.name === parent);
    if (a < 0 || b < 0) throw new Error(`dragNest: row not on screen (${name}: ${a}, ${parent}: ${b})`);
    const s = await handleBox(p, name);
    const pb = await handleBox(p, parent);
    const levels = Math.round((pb.x - s.x) / 44) + 1;
    const overName = a < b ? parent : rows[b + 1].name;
    const over = await rowOf(p, overName).boundingBox();
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    await pointerDrag(p, from, { x: from.x + levels * 28 + 6, y: over.y + over.height * 0.55 });
  });
}

/** Drag `name` left one level to the slot after `lastSibling` (un-nest). */
export async function dragUnnest(p, name, lastSibling) {
  return tall(p, async () => {
    const s = await handleBox(p, name);
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const row = await rowOf(p, lastSibling || name).boundingBox();
    await pointerDrag(p, from, { x: from.x - 34, y: row.y + row.height * 0.6 });
  });
}

/**
 * Drag `name` (which sits further down) into the slot right after the row
 * whose text matches `rowRe` (e.g. a brand row): the engine then nests it
 * inside that row. On Brands & SBUs this is the only drag that takes an SBU
 * out of its group (dropping it inside the brand).
 */
export async function dragUnderRow(p, name, rowRe) {
  return tall(p, async () => {
    const rows = await treeRows(p);
    const i = rows.findIndex((r) => rowRe.test(r.text));
    const a = rows.findIndex((r) => r.name === name);
    if (i < 0 || a <= i + 1) throw new Error(`dragUnderRow: bad rows (${name} at ${a}, target at ${i})`);
    const s = await handleBox(p, name);
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const over = await p.locator("main [data-dnd-row]").nth(i + 1).boundingBox();
    await pointerDrag(p, from, { x: from.x, y: over.y + over.height * 0.5 });
  });
}

/** Drag `name` (below `before`, same depth) onto `before`'s slot: reorder above it. */
export async function dragAbove(p, name, before) {
  return tall(p, async () => {
    const s = await handleBox(p, name);
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const row = await rowOf(p, before).boundingBox();
    await pointerDrag(p, from, { x: from.x, y: row.y + row.height * 0.35 });
  });
}

// ---------------------------------------------------------------------------
// Brands & SBUs
// ---------------------------------------------------------------------------
/** Add an SBU under a brand with the brand row's "Add SBU" (+) button. */
export async function addSbuUnderBrand(p, brand, name) {
  await rowOf(p, brand).getByRole("button", { name: "Add SBU", exact: true }).click();
  await p.getByPlaceholder("SBU name").fill(name);
  await p.locator("main").getByRole("button", { name: "Add", exact: true }).click();
  await p.waitForTimeout(600);
}
export async function addCompany(p, name) {
  await p.locator("main").getByRole("button", { name: "Add company", exact: true }).first().click();
  await p.getByPlaceholder("Company name").fill(name);
  await p.locator("main").getByRole("button", { name: "Add", exact: true }).click();
  await p.waitForTimeout(600);
}
/** Rename a tree row by double-click on its name (inline input). Returns false when no input appeared. */
export async function dblRename(p, oldName, newName, tries = 1) {
  let ok = false;
  for (let i = 0; i < tries && !ok; i++) {
    if (i) await p.waitForTimeout(1000);
    await p.locator("main [data-dnd-row]").getByText(oldName, { exact: true }).first().dblclick();
    await p.waitForTimeout(400);
    ok = await p.evaluate((n) => document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement.value === n, oldName);
    if (!ok && !(await p.locator("main [data-dnd-row]").getByText(oldName, { exact: true }).count())) break;
  }
  if (!ok) return false;
  await p.keyboard.press("Control+A");
  await p.keyboard.type(newName);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(400);
  return true;
}
/** SBU page → Edit → first input (Name) → Save. */
export async function openSbuEdit(p, name) {
  await rowOf(p, name).getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await p.locator("main").getByRole("button", { name: "Save", exact: true }).waitFor();
}
export async function saveSbuName(p, newName) {
  await p.locator("main input").first().fill(newName);
  await p.locator("main").getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(600);
}
/** Delete a tree row with its trash button and confirm the dialog. */
export async function deleteRow(p, ariaLabel) {
  await p.getByRole("button", { name: ariaLabel, exact: true }).first().click();
  const d = p.locator("div.fixed.inset-0").last();
  await d.waitFor();
  const btn = d.locator("button").filter({ hasText: /^Delete/ }).last();
  await btn.click();
  await p.waitForTimeout(600);
}
/** Open an SBU / group page from the tree (single click on its name). */
export async function openSbuPage(p, name) {
  await p.locator("main [data-dnd-row]").getByText(name, { exact: true }).first().click();
  await p.locator("main").getByRole("button", { name: "Edit", exact: true }).first().waitFor();
  await p.waitForTimeout(400);
}
/** On a group page: add an SBU with the "Add SBU…" select. */
export async function addGroupMember(p, name) {
  await p.locator("main select").filter({ has: p.locator("option", { hasText: "Add SBU…" }) }).first().selectOption({ label: name });
  await p.waitForTimeout(600);
}
/** On a group page: Remove next to member `name`. */
export async function removeGroupMember(p, name) {
  const line = p.locator("main div").filter({ has: p.getByText(name, { exact: true }) }).filter({ has: p.getByRole("button", { name: "Remove", exact: true }) }).last();
  await line.getByRole("button", { name: "Remove", exact: true }).click();
  await p.waitForTimeout(600);
}
/** Member names listed under "SBUs in this group" on a group page (rows with a Remove button; select options excluded). */
export async function groupMembersShown(p, names) {
  const listed = await p.evaluate(() => {
    const head = [...document.querySelectorAll("main h2, main h3")].find((e) => /^SBUs in\s*this group$/.test((e.textContent || "").trim()));
    const card = head && (head.closest("section") || head.parentElement.parentElement);
    if (!card) return [];
    return [...card.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Remove").map((b) => (b.parentElement.innerText || "").replace(/Remove\s*$/, "").split("\n")[0].trim());
  });
  return names.filter((n) => listed.includes(n));
}
/** On a group page: mapped function names (rows with Unmap). */
export async function mappedShown(p) {
  return p.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => b.innerText.trim() === "Unmap").map((b) => (b.parentElement.innerText || "").split("\n")[0].replace(/Shared$/, "").trim()));
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------
/** Functions → Add function dialog. `brand` optional (ticks the brand). */
export async function addFunction(p, name, brand = null) {
  await p.locator("main").getByRole("button", { name: "Add function", exact: true }).click();
  const d = modal(p, "Add function");
  await d.locator("input:not([type=checkbox])").first().fill(name);
  if (brand) await d.getByText(brand, { exact: true }).first().click();
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await p.waitForTimeout(700);
}
/** Function row "+" → Sub-function → name → Create. */
export async function addSubFunction(p, parent, name) {
  await rowOf(p, parent).locator("button[title=Add]").click();
  await p.getByText("Sub-function", { exact: true }).last().click();
  const d = modal(p, "Add sub-function");
  await d.locator("input:not([type=checkbox])").first().fill(name);
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await p.waitForTimeout(700);
}
/** Function row pencil → edit page. */
export async function openFunctionEdit(p, name) {
  await rowOf(p, name).locator("button[title=Edit]").click();
  await p.locator("main").getByRole("button", { name: "Save", exact: true }).waitFor();
  await p.waitForTimeout(300);
}
export async function deleteFunctionRow(p, name) {
  await rowOf(p, name).locator("button[title=Delete]").click();
  const d = modal(p, "Delete this function?");
  await d.getByRole("button", { name: "Delete function", exact: true }).click();
  await p.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
export async function rolesView(p, view) {
  await p.locator("main").getByRole("button", { name: view, exact: true }).first().click();
  await p.waitForTimeout(600);
}
/** Create role dialog: name, optional function and parent role(s). Lands on the role page. */
export async function createRole(p, name, { fn = null, parents = [] } = {}) {
  await p.locator("main").getByRole("button", { name: "Create role", exact: true }).click();
  const d = modal(p, "Create role");
  await d.locator("input").first().fill(name);
  if (fn) {
    await d.getByPlaceholder("Search function…").click();
    await d.getByPlaceholder("Search function…").fill(fn);
    await d.locator("ul button", { hasText: fn }).first().click();
    // The option sits inside the field's <label>: the click re-focuses the
    // input and reopens the list. Close it by clicking the heading.
    await d.getByRole("heading", { name: "Create role" }).click();
  }
  for (const parent of parents) await pickRole(p, d.getByPlaceholder("Search roles…").first(), parent, () => d.getByRole("heading", { name: "Create role" }).click());
  await d.getByRole("button", { name: "Create role and add KRAs" }).click();
  await p.locator("main").getByText("Place this role", { exact: true }).waitFor();
  await p.waitForTimeout(500);
}
/** Tick `role` in a role picker ([data-apms-picker]) opened from `input`. */
export async function pickRole(p, input, role, close) {
  await input.click();
  await p.keyboard.press("Control+A");
  await p.keyboard.type(role);
  await p.waitForTimeout(400);
  await p.locator("[data-apms-picker] button", { hasText: role }).filter({ hasText: new RegExp(`^${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).last().click();
  await p.waitForTimeout(300);
  await close();
  await p.waitForTimeout(300);
}
/** Open a role page from the Roles list (List view). */
export async function openRole(ctx, p, name) {
  await openOrg(ctx, p, "Roles");
  await rolesView(p, "List");
  // A click on the row only expands it; the pencil opens the role page.
  await rowOf(p, name).locator("button[title=Edit]").first().click();
  await p.locator("main").getByText("Place this role", { exact: true }).waitFor();
  await p.waitForTimeout(400);
}
export async function roleTab(p, tab) {
  await p.locator("main").getByRole("button", { name: tab, exact: true }).first().click();
  await p.waitForTimeout(400);
}
export async function kraName(p, i = 0) {
  return p.getByPlaceholder("KRA name").nth(i);
}
export async function saveDraft(p) {
  await p.locator("main").getByRole("button", { name: "Save draft" }).first().click();
  await p.waitForTimeout(700);
}
export async function addCompetency(p, name, weight = null) {
  await roleTab(p, "Competencies");
  await p.locator("main").getByRole("button", { name: "Add competency" }).click();
  await p.waitForTimeout(400);
  await p.getByPlaceholder("Competency").last().fill(name);
  await p.waitForTimeout(900);
  if (weight) {
    await p.locator("main select").last().selectOption({ label: weight });
    await p.waitForTimeout(700);
  }
}
/** AGS tab: pick a factor level by its label (e.g. "Solid"). Saves on click. */
export async function pickAgs(p, level) {
  await roleTab(p, "AGS");
  await p.locator("main button", { hasText: new RegExp(`^${level}`) }).first().click();
  await p.waitForTimeout(700);
}
/** Place this role → Edit → Title → Save placement. */
export async function renameRolePlacement(p, newName) {
  await p.locator("main").getByRole("button", { name: "Edit", exact: true }).first().click();
  await p.locator("main").getByRole("button", { name: "Save placement" }).waitFor();
  const title = p.locator("main").locator("label", { hasText: "Title" }).locator("input").first();
  if (await title.count()) await title.fill(newName);
  else await p.locator("main input").first().fill(newName);
  await p.locator("main").getByRole("button", { name: "Save placement" }).click();
  await p.waitForTimeout(700);
}
/** Place this role → Edit → Reports to: tick another parent → Save placement. */
export async function addRoleParent(p, parent) {
  await p.locator("main").getByRole("button", { name: "Edit", exact: true }).first().click();
  await p.locator("main").getByRole("button", { name: "Save placement" }).waitFor();
  // Reports to (Parent role) is the first role search field in the placement editor.
  const rep = p.locator("main").getByPlaceholder("Search roles…").first();
  // The picker's click-away layer covers the page: click through it at the heading.
  await pickRole(p, rep, parent, async () => {
    const b = await p.locator("main").getByText("Place this role", { exact: true }).boundingBox();
    await p.mouse.click(b.x + 5, b.y + 5);
  });
  await p.locator("main").getByRole("button", { name: "Save placement" }).click();
  await p.waitForTimeout(700);
}
export async function deleteRoleRow(p, name) {
  await rowOf(p, name).locator("button[title='Delete role']").click();
  const d = p.locator("div.fixed.inset-0").last();
  await d.waitFor();
  await d.locator("button").filter({ hasText: /^Delete/ }).last().click();
  await p.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// People reporting tree
// ---------------------------------------------------------------------------
/** Org → People → Company view; expand `expand` rows (by name). */
export async function openPeopleTree(ctx, p, expand = []) {
  await openOrg(ctx, p, "People");
  for (let i = 0; i < 4; i++) {
    await p.locator("main").getByRole("button", { name: "Company", exact: true }).click();
    await p.waitForTimeout(800);
    if (await p.locator("main").getByText(/people · Primary line/).count()) break;
  }
  for (const n of expand) await expandRow(p, n);
}
export async function expandRow(p, name) {
  const b = rowOf(p, name).getByRole("button", { name: "Expand", exact: true });
  if (await b.count()) {
    await b.first().click();
    await p.waitForTimeout(400);
  }
}
/** "Add person under this" on `manager`'s row: create a person (lands on their file). */
export async function addPersonUnder(p, manager, first, last, n) {
  await rowOf(p, manager).locator("button[title='Add person under this']").click();
  const d = modal(p, "Add person");
  const inputs = d.locator("input:not([type]), input[type=text]");
  await inputs.nth(0).fill(first);
  await inputs.nth(1).fill(last);
  await inputs.nth(2).fill(`${first}.${last}.${n}@example.com`.toLowerCase().replace(/\s+/g, ""));
  await d.locator("input[type=date]").fill("1990-01-01");
  await d.getByPlaceholder("ALN0001").fill(`ALN${n}`);
  await d.locator("input[type=tel]").fill(`90000${String(n).padStart(5, "0")}`);
  await d.getByRole("button", { name: "Create person" }).click();
  await p.waitForTimeout(1200);
}
export async function deletePersonRow(p, name) {
  await rowOf(p, name).locator(`button[title='Delete ${name}']`).click();
  const d = p.locator("div.fixed.inset-0").last();
  await d.waitFor();
  await d.locator("button").filter({ hasText: /^(Delete|Move to trash|Remove)/ }).last().click();
  await p.waitForTimeout(700);
}
/** Direct children of `name` on screen: rows right after it with a deeper handle. */
export async function childrenShown(p, name) {
  const rows = await treeRows(p);
  const i = rows.findIndex((r) => r.name === name);
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < rows.length && rows[j].x > rows[i].x; j++) if (rows[j].x === rows[i].x + 44) out.push(rows[j].name);
  return out;
}
