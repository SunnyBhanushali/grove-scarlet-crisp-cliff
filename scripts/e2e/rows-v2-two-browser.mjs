#!/usr/bin/env node
/**
 * ROWS-V2 two-browser smoke (REPORT-ROWS-V2.md "Not done here").
 *
 *   BASE_URL=http://127.0.0.1:3010 A_USER=sunny.b A_PASS=0000 \
 *   B_USER=… B_PASS=… node scripts/e2e/rows-v2-two-browser.mjs
 *
 * 1. Same role, two users: A changes the band (AGS factor), B changes the
 *    name, both save. Both persist, no refresh banner, B sees A's band ≤ 5 s.
 * 2. One user deletes a notice; the other still has it on screen (live feed
 *    held), marks it done and saves. It stays deleted and leaves their screen.
 *    The notice must be addressed to A_USER, so here B's browser deletes and
 *    A's browser is the stale editor.
 *
 * Needs a fresh test database (it edits the role and deletes one notice).
 * CHROMIUM_PATH overrides the browser binary.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const A = { user: process.env.A_USER || "sunny.b", pass: process.env.A_PASS || "0000" };
const B = { user: process.env.B_USER || "", pass: process.env.B_PASS || "" };
const ROLE_ID = process.env.ROLE_ID || "studio-mgr";
const ROLE_NAME = process.env.ROLE_NAME || "Studio Manager";
// Not a month_close_due notice: the SPA auto-completes those on its own.
const NOTICE_TITLE = process.env.NOTICE_TITLE || "September 2026 APMS is late";
const LIVE_LIMIT_MS = 5000;

if (!B.user || !B.pass) {
  console.error("B_USER / B_PASS required (a second admin who can open Org → Roles).");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

function trackPatches(page, tag, log) {
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() !== "PATCH" || !req.url().includes("/api/")) return;
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    let sent = null;
    try { sent = JSON.parse(req.postData() || "null"); } catch { /* ignore */ }
    log.push({
      who: tag,
      at: Date.now(),
      url: req.url().replace(BASE, ""),
      status: res.status(),
      baseRev: sent && sent.baseRev,
      deleted: sent && sent.deleted,
      rev: body && body.rev,
      note: req.url().includes(`/roles/${ROLE_ID}`) && sent && sent.payload
        ? `sent{name:${sent.payload.name}, band:${sent.payload.band}, 1A:${sent.payload.ags?.["1A"]}, 1B:${sent.payload.ags?.["1B"]}}` +
          (body && body.payload ? ` server{name:${body.payload.name}, band:${body.payload.band}, 1A:${body.payload.ags?.["1A"]}, 1B:${body.payload.ags?.["1B"]}}` : "")
        : "",
    });
  });
}

async function signIn(page, who) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.locator('input[type="text"]').fill(who.user);
  await page.locator('input[type="password"]').fill(who.pass);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function openRole(page) {
  await page.getByText("Org", { exact: true }).first().click();
  await page.getByText("Roles", { exact: true }).first().click();
  const nameBtn = page.locator("main button", { hasText: new RegExp("^" + ROLE_NAME) }).first();
  await nameBtn.waitFor({ timeout: 15000 });
  await nameBtn.locator("xpath=following::button[2]").click(); // pencil
  await page.getByRole("button", { name: "AGS", exact: true }).click();
  await page.waitForTimeout(500);
}

async function bandText(page) {
  const text = await page.locator("main").innerText();
  // Big heading ("\nBand 4\n") or the sticky one-line header once scrolled ("Band 4 ₹95K…").
  const m = text.match(/(?:^|\n)(Band (?:\d+|not sized))(?!\d)/);
  return m ? m[1] : null;
}

async function titleText(page) {
  const text = await page.locator("main").innerText();
  const m = text.match(/\nRoles\n([^\n]+)\n/);
  return m ? m[1] : null;
}

/** Anything that asks the user to refresh, plus the sync layer's own flags. */
async function bannerState(page) {
  return page.evaluate(() => {
    const body = document.body.innerText || "";
    const s = window.__apmsSync;
    return {
      refreshText: /refresh to|lost to sync|\bRefresh\b/i.test(body),
      globalBar: s && typeof s.showGlobalConflictBar === "function" ? s.showGlobalConflictBar() : null,
      rowConflicts: s && typeof s.rowConflicts === "function" ? (s.rowConflicts() || []).length : null,
    };
  });
}

async function apiGet(page, path) {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: "include", cache: "no-store" });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, path);
}

/**
 * Move the role up a band: 1A "Master" (40) + 1B "Multi-Func" (30). From the
 * seed Studio Manager (148 pts, Band 3) that is 183 pts → Band 4 (176–225).
 */
async function raiseBand(page) {
  await page.locator("main button", { hasText: "Master of craft" }).first().click();
  await page.waitForTimeout(300);
  await page.locator("main button", { hasText: "Manages multiple functions" }).first().click();
  return "1A Master + 1B Multi-Func";
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const pa = await ctxA.newPage();
const pb = await ctxB.newPage();
const patches = [];
trackPatches(pa, "A", patches);
trackPatches(pb, "B", patches);
const pageErrors = [];
for (const [tag, p] of [["A", pa], ["B", pb]]) {
  p.on("pageerror", (e) => pageErrors.push(`${tag}: ${String((e && e.message) || e).slice(0, 160)}`));
}

try {
  // ---------------------------------------------------------------- scenario 1
  console.log("\n# Scenario 1 — same role: A changes band, B changes name");
  await Promise.all([signIn(pa, A), signIn(pb, B)]);
  const loginPatches = patches.length;
  check("no entity writes on sign-in (no login write storm)", loginPatches === 0, `${loginPatches} PATCHes`);

  await Promise.all([openRole(pa), openRole(pb)]);
  const before = (await apiGet(pa, `/api/e/roles/${ROLE_ID}`)).json;
  const bandA0 = await bandText(pa);
  const bandB0 = await bandText(pb);
  console.log(`  start: rev ${before.rev}, name "${before.payload.name}", band ${before.payload.band}, ags.1A ${before.payload.ags?.["1A"]}; A sees ${bandA0}, B sees ${bandB0}`);

  const newName = `${ROLE_NAME} (B ${Date.now() % 10000})`;
  // Every committed save of this role, per browser.
  const commits = { A: [], B: [] };
  for (const [tag, p] of [["A", pa], ["B", pb]]) {
    p.on("response", async (r) => {
      if (r.request().method() !== "PATCH" || !r.url().includes(`/api/e/roles/${ROLE_ID}`) || r.status() !== 200) return;
      const t = Date.now();
      try { commits[tag].push({ t, row: await r.json() }); } catch { /* ignore */ }
    });
  }

  // A: band (AGS factors). B: title. Neither waits for the other.
  const picked = await raiseBand(pa);
  await pb.getByRole("button", { name: "Edit", exact: true }).click();
  // The placement form's Title input is the text input holding the role name.
  // (The input has no type attribute, so match on the value, not [type=text].)
  await pb.waitForFunction((name) => [...document.querySelectorAll("input")].some((e) => e.value === name), ROLE_NAME, { timeout: 15000 });
  const titleIdx = await pb.locator("input").evaluateAll((els, name) => els.findIndex((e) => e.value === name), ROLE_NAME);
  if (titleIdx < 0) throw new Error("Title input not found");
  const title = pb.locator("input").nth(titleIdx);
  await title.fill(newName);
  await pb.getByRole("button", { name: "Save placement" }).click();

  const waitFor = async (pred, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const hit = pred(); if (hit) return hit; await pa.waitForTimeout(50); }
    return null;
  };
  const aCommit = await waitFor(() => commits.A.find((c) => String(c.row?.payload?.band) !== String(before.payload.band)));
  const bCommit = await waitFor(() => commits.B.find((c) => c.row?.payload?.name === newName));
  if (!aCommit || !bCommit) throw new Error(`saves not committed: A ${JSON.stringify(commits.A.map((c) => c.row?.payload?.band))} B ${JSON.stringify(commits.B.map((c) => c.row?.payload?.name))}`);
  const tA = aCommit.t;
  const aRow = aCommit.row;
  const bandAfterA = await bandText(pa);
  console.log(`  A picked "${picked}" → A sees ${bandAfterA} (server band ${aRow.payload?.band}, rev ${aRow.rev})`);
  check("A's band change actually changed the band", bandAfterA && bandAfterA !== bandA0, `${bandA0} → ${bandAfterA}`);

  // B must show A's band within 5 s of A's save, without a reload.
  let bSees = null;
  let seenAt = null;
  while (Date.now() - tA < LIVE_LIMIT_MS + 3000) {
    bSees = await bandText(pb);
    if (bSees === bandAfterA) { seenAt = Date.now(); break; }
    await pb.waitForTimeout(100);
  }
  const lag = seenAt ? seenAt - tA : null;
  check(`B's screen shows A's band within ${LIVE_LIMIT_MS / 1000}s`, lag !== null && lag <= LIVE_LIMIT_MS, lag !== null ? `${lag} ms (B sees ${bSees})` : `B still shows ${bSees}`);

  // A should also see B's name (not required, reported).
  let aTitleLag = null;
  const tB = Date.now();
  while (Date.now() - tB < LIVE_LIMIT_MS + 3000) {
    if ((await titleText(pa)) === newName) { aTitleLag = Date.now() - tB; break; }
    await pa.waitForTimeout(100);
  }
  console.log(`  A sees B's new name: ${aTitleLag !== null ? "yes (" + aTitleLag + " ms after both saves)" : "no"}`);

  await pa.waitForTimeout(1500);
  const bannersA = await bannerState(pa);
  const bannersB = await bannerState(pb);
  check("no refresh banner for A", !bannersA.refreshText && !bannersA.globalBar, JSON.stringify(bannersA));
  check("no refresh banner for B", !bannersB.refreshText && !bannersB.globalBar, JSON.stringify(bannersB));

  const after = (await apiGet(pa, `/api/e/roles/${ROLE_ID}`)).json;
  console.log(`  server: rev ${after.rev}, name "${after.payload.name}", band ${after.payload.band}, ags.1A ${after.payload.ags?.["1A"]}`);
  check("server keeps B's name", after.payload.name === newName, after.payload.name);
  // The band is computed from the AGS factors; A's change is the factors.
  check("server keeps A's band change (AGS factors)", after.payload.ags?.["1A"] === aRow.payload?.ags?.["1A"] && after.payload.ags?.["1B"] === aRow.payload?.ags?.["1B"], `ags.1A ${after.payload.ags?.["1A"]}, ags.1B ${after.payload.ags?.["1B"]}`);
  check("stored role.band field agrees with the AGS band", String(after.payload.band) === String(aRow.payload?.band), `stored band ${after.payload.band}, A saved band ${aRow.payload?.band}`);

  // Fresh loads in both browsers show both edits.
  for (const [tag, p] of [["A", pa], ["B", pb]]) {
    await p.reload({ waitUntil: "load" });
    await p.getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(1500);
    await openRole(p).catch(() => {});
    const t = await titleText(p);
    const band = await bandText(p);
    check(`${tag} after reload: name + band both persisted`, t === newName && band === bandAfterA, `title "${t}", ${band}`);
  }

  // ---------------------------------------------------------------- scenario 2
  console.log("\n# Scenario 2 — B deletes a notice, stale A edits it");
  // A is the one the notice is addressed to (Home → Alerts): A is the stale editor.
  const stale = pa;
  const deleter = pb;
  await stale.getByText("Home", { exact: true }).first().click();
  const alertRow = stale.locator("main button", { hasText: new RegExp("^" + NOTICE_TITLE) }).first();
  await alertRow.waitFor({ timeout: 15000 });
  const list = (await apiGet(stale, "/api/e/notices")).json;
  const notice = (list.rows || []).find((r) => r.payload && r.payload.title === NOTICE_TITLE);
  if (!notice) throw new Error(`no notice titled "${NOTICE_TITLE}"`);
  console.log(`  notice ${notice.id} rev ${notice.rev} status ${notice.payload.status}`);

  // Hold A's live feed so A provably keeps the deleted notice on screen.
  const held = [];
  await stale.route(/\/api\/(changes|company-tick|company-live)/, (route) => { held.push(route.request().url()); route.abort(); });

  const del = await deleter.evaluate(async ({ id, rev, payload }) => {
    const r = await fetch(`/api/e/notices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, baseRev: rev, deleted: true, clientOpId: "e2e-del-" + Date.now() }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, { id: notice.id, rev: notice.rev, payload: notice.payload });
  check("B deletes the notice", del.status === 200 && del.json?.deleted === true, `HTTP ${del.status}, rev ${del.json?.rev}`);

  await stale.waitForTimeout(500);
  check("A still sees the deleted notice (stale screen)", await alertRow.isVisible());

  const bPatch = stale.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(encodeURIComponent(notice.id)), { timeout: 15000 }).catch(() => null);
  await alertRow.locator("xpath=following::button[normalize-space()='Done'][1]").click();
  const bRes = await bPatch;
  console.log(`  A's save of the notice: ${bRes ? "HTTP " + bRes.status() : "no PATCH sent"}`);

  await stale.unroute(/\/api\/(changes|company-tick|company-live)/);
  console.log(`  held ${held.length} live-feed requests on A`);
  await stale.waitForTimeout(LIVE_LIMIT_MS);

  const after2 = (await apiGet(deleter, `/api/e/notices/${encodeURIComponent(notice.id)}`)).json;
  check("notice is still deleted on the server", after2 && after2.deleted === true, `rev ${after2?.rev}, deleted ${after2?.deleted}`);
  check("A's screen dropped the deleted notice", !(await alertRow.isVisible().catch(() => false)));
  await stale.reload({ waitUntil: "load" });
  await stale.getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
  await stale.waitForTimeout(2000);
  const againRows = ((await apiGet(stale, "/api/e/notices")).json.rows || []).filter((r) => r.id === notice.id);
  check("after A reloads, the notice is not back", againRows.length === 0, `${againRows.length} live rows with that id`);
  const banners2 = await bannerState(stale);
  check("no refresh banner for A after the notice conflict", !banners2.refreshText && !banners2.globalBar, JSON.stringify(banners2));
} catch (err) {
  check("script ran to completion", false, String((err && err.stack) || err).slice(0, 600));
  if (process.env.SHOT_DIR) {
    await pa.screenshot({ path: `${process.env.SHOT_DIR}/fail-A.png` }).catch(() => {});
    await pb.screenshot({ path: `${process.env.SHOT_DIR}/fail-B.png` }).catch(() => {});
  }
} finally {
  console.log("\n# PATCH log");
  for (const p of patches) console.log(`  ${p.who} ${p.status} ${p.url} baseRev=${p.baseRev}${p.deleted ? " deleted" : ""} → rev ${p.rev}${p.note ? " " + p.note : ""}`);
  if (pageErrors.length) console.log("\n# page errors\n  " + [...new Set(pageErrors)].join("\n  "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
