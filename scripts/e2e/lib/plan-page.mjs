/**
 * Page helpers for the APMS / Rewards person-month pages and month lists.
 * Selectors follow what the SPA renders (no test ids in the recovered bundle).
 */

export async function openPlansList(ctx, p, kind) {
  await ctx.nav(p, kind === "rewards" ? "Rewards" : "APMS", "Plans");
}

/** Month group header button ("September 2026 …"). */
export function monthButton(p, monthLabel) {
  return p.locator("main button", { hasText: new RegExp("^" + monthLabel) }).first();
}

/** Person row in an expanded month group. */
export function personRow(p, name, monthLabel) {
  return p.locator("main button", { hasText: new RegExp(`${name}.*${monthLabel}`) }).first();
}

export async function expandMonth(p, monthLabel) {
  // Person rows read "Name\nSeptember 2026 · Role …"; the group header "September 2026 | n people".
  const rows = p.locator("main button", { hasText: new RegExp(monthLabel + " ·") });
  if (await rows.count()) return;
  await monthButton(p, monthLabel).click();
  await p.waitForTimeout(700);
}

export async function openPerson(ctx, p, kind, name, monthLabel) {
  await openPlansList(ctx, p, kind);
  await expandMonth(p, monthLabel, name);
  await personRow(p, name, monthLabel).click();
  await p.locator("main").getByText(name, { exact: true }).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
}

/** The textarea under a section label (e.g. "Manager notes"). */
export function textareaAfter(p, label) {
  return p.locator(`xpath=//main//*[normalize-space(text())="${label}"]/following::textarea[1]`).first();
}

/** Smallest block that holds `name` and a matching control. */
export function rowWith(p, name, controlSel) {
  return p
    .locator("main div")
    .filter({ has: p.getByText(name, { exact: true }) })
    .filter({ has: p.locator(controlSel) })
    .last();
}

export async function setInput(p, locator, value) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.fill(String(value));
  await locator.press("Tab");
  await p.waitForTimeout(150);
}

export async function kpiWeight(p, kpiName) {
  return rowWith(p, kpiName, 'input[aria-label="Weightage %"]').locator('input[aria-label="Weightage %"]').last();
}

export async function behaviourBox(p, behaviourName) {
  return rowWith(p, behaviourName, 'input[type="checkbox"]').locator('input[type="checkbox"]').first();
}

export async function addPriority(p, title, description) {
  await p.getByRole("button", { name: "Add priority" }).click();
  await p.waitForTimeout(400);
  await p.locator("main input[placeholder=Required]").last().fill(title);
  await p.locator('main textarea[placeholder^="Required"]').last().fill(description);
  await p.waitForTimeout(200);
  const ok = p.locator("main button:has(svg.lucide-check)").last();
  if (await ok.count()) await ok.click();
  await p.waitForTimeout(300);
}

/** Header delete (trash) of a person-month page, then confirm. */
export async function deletePersonMonth(p) {
  await p.locator("main button:has(svg.lucide-trash-2), main button:has(svg.lucide-trash)").first().click();
  await p.waitForTimeout(400);
  const confirm = p.locator("div.fixed.inset-0 button", { hasText: /^(Delete|Yes, delete|Remove)/ }).last();
  await confirm.click();
  await p.waitForTimeout(800);
}

export async function pageHas(p, text) {
  return (await p.locator("main").innerText()).includes(text);
}

export async function inputValues(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll("main input, main textarea")].map((e) => (e.type === "checkbox" ? (e.checked ? "☑" : "☐") : e.value)),
  );
}

/** Month-end actual inputs (locked plan), in page order. */
export function actualInputs(p) {
  return p.locator('main table input[type="number"]');
}

/** Execution score selects (locked plan), in page order. */
export function execSelects(p) {
  return p.locator("main select");
}

/** Values score buttons ("Score n") of the i-th behaviour row. */
export function scoreButton(p, behaviourIndex, n) {
  return p.locator(`main button[aria-label="Score ${n}"]`).nth(behaviourIndex);
}

export async function scoreSelected(btn) {
  return btn.evaluate((e) => !e.className.includes("bg-transparent"));
}

export async function headerButton(p, label) {
  return p.locator("main").getByRole("button", { name: label, exact: true }).first();
}

export async function statusBadge(p) {
  const t = await p.locator("main").innerText();
  const m = t.match(/\n(Plan open|Plan locked|Closure pending|Closed|Waiting approval|Approved)\n/);
  return m ? m[1] : null;
}

/** Fill every month-end actual, execution score and values score so the plan can be closed. */
export async function fillAllScores(p, base = 80) {
  const n = await actualInputs(p).count();
  for (let i = 0; i < n; i++) if (!(await actualInputs(p).nth(i).isDisabled())) await setInput(p, actualInputs(p).nth(i), base + i);
  const s = await execSelects(p).count();
  for (let i = 0; i < s; i++) if (!(await execSelects(p).nth(i).isDisabled())) await execSelects(p).nth(i).selectOption("3");
  const b = await p.locator('main button[aria-label="Score 3"]').count();
  for (let i = 0; i < b; i++) {
    const btn = p.locator('main button[aria-label="Score 3"]').nth(i);
    if (await btn.isDisabled()) continue;
    if (!(await scoreSelected(btn))) await btn.click();
  }
  return { actuals: n, exec: s, values: b };
}

/** Bottom "Close plan" (locked plan). Returns the validation message, if any. */
export async function closePlan(p) {
  const b = p.locator("main").getByRole("button", { name: "Close plan", exact: true }).last();
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await p.waitForTimeout(800);
  const t = await p.locator("main").innerText();
  const m = t.match(/[^\n]*(before close|enter the actual|rate every|must total)[^\n]*/i);
  return m ? m[0].slice(0, 200) : "";
}

/**
 * Make a locked plan closable (Super admin): unlock for edit, add one
 * execution outcome, score every actual / execution / value, press Done.
 */
export async function prepareClose(p, title) {
  const unlock = p.locator("main").getByRole("button", { name: "Unlock plan", exact: true }).first();
  if (await unlock.count()) {
    await unlock.click();
    await p.waitForTimeout(600);
  }
  if (!(await p.locator("main select").count())) await addPriority(p, title, "Done means shipped");
  // Values must be on the plan (and rated) before close.
  if (!(await p.locator('main button[aria-label="Score 3"]').count())) {
    let all = p.locator("main").getByRole("button", { name: "Select all", exact: true }).first();
    if (!(await all.count())) {
      const vb = p.locator("main button", { hasText: /^Values ·/ }).first();
      if (await vb.count()) {
        await vb.click();
        await p.waitForTimeout(400);
      }
      all = p.locator("main").getByRole("button", { name: "Select all", exact: true }).first();
    }
    if (await all.count()) {
      await all.scrollIntoViewIfNeeded();
      await all.click();
      await p.waitForTimeout(300);
    }
  }
  const done = p.locator("main").getByRole("button", { name: "Done", exact: true }).first();
  if (await done.count()) {
    await done.click();
    await p.waitForTimeout(600);
  }
  return fillAllScores(p);
}

/**
 * A notes section as the screen shows it ("Manager notes", "Self comments"):
 * the textarea that belongs to that label, or its read-only text. Found by
 * structure (the label's next sibling), not "the next textarea on the page".
 */
export async function notesValue(p, label = "Manager notes") {
  return p.evaluate((label) => {
    const h = [...document.querySelectorAll("main *")].find((e) => e.children.length === 0 && e.textContent.trim() === label);
    if (!h) return null;
    let el = h;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      let sib = el.nextElementSibling;
      while (sib) {
        const ta = sib.matches("textarea") ? sib : sib.querySelector("textarea");
        if (ta) return ta.value;
        const t = (sib.innerText || "").trim();
        if (t) return t === "—" ? "" : t.split("\n")[0].trim();
        sib = sib.nextElementSibling;
      }
    }
    return "";
  }, label);
}

/** The textarea that belongs to a notes label, found by structure. */
export function sectionTextarea(p, label) {
  return p.locator(`xpath=//main//*[normalize-space(text())="${label}"]/following-sibling::*[1]/descendant-or-self::textarea | //main//*[normalize-space(text())="${label}"]/../following-sibling::*[1]/descendant-or-self::textarea`).first();
}

/** Month group "Add people": tick `names` and save. */
export async function addPeople(p, monthLabel, names) {
  await expandMonth(p, monthLabel);
  const grp = monthButton(p, monthLabel);
  await grp.locator("xpath=..").getByRole("button", { name: "Add people" }).click();
  await p.waitForTimeout(600);
  const d = p.locator("div.fixed.inset-0").last();
  for (const name of names) {
    await d.locator('input[placeholder="Search people…"]').fill(name);
    await p.waitForTimeout(500);
    await d.locator("button", { hasText: new RegExp("^" + name) }).first().click();
    await p.waitForTimeout(200);
  }
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(600);
}

/** Person row "Delete" in the month list, then confirm. */
export async function deleteFromList(p, name, monthLabel) {
  await expandMonth(p, monthLabel);
  const row = personRow(p, name, monthLabel);
  await row.locator("xpath=..").getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForTimeout(400);
  await p.locator("div.fixed.inset-0 button", { hasText: /^Delete/ }).last().click();
  await p.waitForTimeout(800);
}

/** Names listed under a month group (expanded). */
export async function listedNames(p, monthLabel) {
  await expandMonth(p, monthLabel);
  const rows = p.locator("main button", { hasText: new RegExp(monthLabel + " ·") });
  const texts = await rows.allInnerTexts();
  return texts.map((t) => t.split("\n")[0].trim()).sort();
}

/** Pointer drag (the SPA's DnD: hold the title, move, drop) of `srcText` onto `dstText`'s row. */
export async function dragOnto(p, srcText, dstText) {
  const src = p.locator("main").getByText(srcText, { exact: true }).first();
  const dst = p.locator("main").getByText(dstText, { exact: true }).first();
  await src.scrollIntoViewIfNeeded();
  const s = await src.boundingBox();
  const d = await dst.boundingBox();
  await p.mouse.move(s.x + 20, s.y + s.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(400);
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(s.x + 20, s.y + s.height / 2 + ((d.y - s.y - 10) * i) / steps);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(400);
}

/** Leaf texts on screen that are one of `names`, in page order. */
export async function screenOrder(p, names) {
  return p.evaluate((names) => [...document.querySelectorAll("main *")].filter((e) => e.children.length === 0 && names.includes(e.textContent.trim())).map((e) => e.textContent.trim()), names);
}
