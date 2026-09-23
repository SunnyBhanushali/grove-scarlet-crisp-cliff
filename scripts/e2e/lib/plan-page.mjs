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

export async function expandMonth(p, monthLabel, probeName) {
  const probe = probeName ? personRow(p, probeName, monthLabel) : null;
  if (probe && (await probe.count()) && (await probe.isVisible())) return;
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
