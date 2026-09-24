/**
 * BATCH-3 part C — Targets / Rewards broken links, three users (A, B, C).
 *
 *   targets-link-guard     1. Delete a target rewards unlock against: the guard lists them
 *                             (person · month); Cancel deletes nothing; Delete anyway deletes.
 *   targets-link-broken    2. The rewards keep the link; the month list shows an orange
 *                             warning icon (tooltip) and the reward page an orange banner
 *                             with Re-link (target picker → saved through Unlock against).
 *   targets-link-relink    3. Re-create a target with the same name: a NEW node id → the
 *                             creator is offered "Relink / Not now"; Not now writes nothing,
 *                             Relink fixes every listed reward. Same node id (a target that
 *                             still has other months) → links are whole again, no offer.
 *   targets-second-group   4. A and B each add a group to the same month at the same time:
 *                             the first group stays intact.
 *   targets-import-blank   5. Import: a blank cell keeps the stored value, 0 is a value;
 *                             "X changed, Y unchanged, Z blank-kept" before Apply; Cancel
 *                             writes nothing; a value B types during the import survives
 *                             when the file's cell is blank.
 *
 * Every scenario also runs check 6 (no writes on opening, no banner, no 5xx).
 * Screenshots: SHOTS (default /tmp/claude-0/shots-c).
 *
 * Standalone (fresh database, built server):
 *   BASE_URL=http://127.0.0.1:3020 DATABASE_URL=postgres://…/aliens_apms_c \
 *   A_USER=sunny.b A_PASS=0000 B_USER=… B_PASS=… C_USER=… C_PASS=… \
 *   node scripts/e2e/lib/screens-targets-links.mjs [scenario …]
 * or add SCENARIOS to a three-user runner (rows-v2-three-users.mjs style).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ScreenResult, makeCtx, realWrites, brief } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  SEP, openTargetMonth, targetRow, dialog, newTarget, newGroup, rowDelete, cellRow, shownTargets, nestedCount, membersOf, rootOrder, setCell, cellValue,
} from "./screens-targets.mjs";
import { openPlansList, expandMonth, personRow, openPerson } from "./plan-page.mjs";
import { massUpdate, targetName } from "./screens-rewards.mjs";
import { openTargetsList } from "./screens-targets.mjs";
import { label, listedMonths } from "./screens-targets-months.mjs";

const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots-c";
const P1 = { name: "Rohan Jadhav" }; // open plan: Unlock against / Re-link editable
const P2 = { name: "Gaurav Mokale" };
const PERIOD = "2026-09";

async function shot(p, name) {
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await p.screenshot({ path, fullPage: false }).catch(() => {});
  return path;
}

async function personId(ctx, name) {
  return (await ctx.sql("select id from people where payload->>'name' = $1 and deleted_at is null", [name]))[0]?.id;
}
async function rewardLink(ctx, pid, period = PERIOD) {
  const r = await ctx.sql("select payload from reward_records where person_id = $1 and period = $2 and deleted_at is null", [pid, period]);
  return r[0]?.payload || null;
}
async function nodesNamed(ctx, name) {
  return ctx.sql("select id, deleted_at is not null as deleted from entities where kind = 'target-nodes' and payload->>'name' = $1 order by deleted, id", [name]);
}
async function rewardWrites(m, tag) {
  return realWrites(m.writes(tag)).filter((n) => /reward-records/.test(n.u));
}
/** The guard / confirm dialog opened by a row Delete. */
function openModal(p) {
  return p.locator("div.fixed.inset-0").last();
}
async function clickRowDelete(p, name) {
  await targetRow(p, name).getByRole("button", { name: "Delete", exact: true }).first().click();
  await p.waitForTimeout(500);
}
/** Warning icon on a Rewards month-list row. */
async function rowIcon(p, name) {
  const b = personRow(p, name, SEP);
  const icon = b.locator('[data-apms-tl="broken"]');
  if (!(await icon.count())) return null;
  return { title: await icon.first().getAttribute("title") };
}
function banner(p) {
  return p.locator('main [data-apms-tl="broken"][role="alert"]').first();
}
async function relinkDialog(p) {
  return p.locator("div.fixed.inset-0").filter({ has: p.locator("[data-apms-tl-relink]") }).last();
}

/** Set-up shared by 1–3: a custom target in September only, two rewards unlock against it. */
async function linkedTarget(ctx, run) {
  const { A } = ctx;
  const T = `TL Link ${run.slice(-5)}`;
  await openTargetMonth(ctx, A);
  await newTarget(A, T, 400000, 600000);
  await ctx.settled(A);
  const [node] = (await nodesNamed(ctx, T)).filter((n) => !n.deleted);
  await openPlansList(ctx, A, "rewards");
  await massUpdate(A, SEP, [P1.name, P2.name], T);
  await ctx.settled(A);
  const ids = [await personId(ctx, P1.name), await personId(ctx, P2.name)];
  const links = [];
  for (const id of ids) links.push((await rewardLink(ctx, id))?.targetNodeId);
  return { T, node: node?.id, ids, links };
}

// ---------------------------------------------------------------------------
// 1 + 2 + 3: guard · broken link · relink offer
// ---------------------------------------------------------------------------
let shared = null;

export async function targetsLinkGuard(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-link-guard", "Delete a target rewards unlock against: guard (Cancel / Delete anyway)");
  shared = await linkedTarget(ctx, run);
  const { T, node, ids, links } = shared;
  R.note(`set-up: ${T} (${node}) only in September; ${P1.name} and ${P2.name} unlock against it: ${links.join(", ")}`);
  if (!node || links.some((l) => l !== node)) {
    R.fail(1, `set-up failed: node ${node}, links ${links.join(", ")}`);
    return R;
  }
  const m0 = await openWithoutWrites(ctx, R, "the Targets month page / Rewards list", async (p) => {
    if (p === C) {
      await openPlansList(ctx, p, "rewards");
      await expandMonth(p, SEP);
    } else await openTargetMonth(ctx, p);
  });

  // Guard lists both rewards; Cancel deletes nothing.
  await clickRowDelete(A, T);
  const g = openModal(A);
  const guardShown = (await g.locator("[data-apms-tl-guard]").count()) > 0;
  const gText = guardShown ? (await g.innerText()).replace(/\s+/g, " ") : "";
  const lists = gText.includes(`${P1.name} · ${SEP}`) && gText.includes(`${P2.name} · ${SEP}`) && /2 rewards unlock against this target/.test(gText);
  const hasButtons = (await g.getByRole("button", { name: "Cancel", exact: true }).count()) > 0 && (await g.getByRole("button", { name: "Delete anyway", exact: true }).count()) > 0;
  const s1 = await shot(A, "1-guard-dialog");
  const mc = ctx.mark();
  await g.getByRole("button", { name: "Cancel", exact: true }).click();
  await A.waitForTimeout(1500);
  await ctx.settled(A);
  const afterCancel = await cellRow(ctx, node);
  const cancelWrites = realWrites(mc.writes("A"));
  R.expect(1, guardShown && lists && hasButtons && afterCancel && !afterCancel.deleted_at && !cancelWrites.length,
    `guard shown ${guardShown} ("${gText.slice(0, 200)}"); lists both (person · month) ${lists}; Cancel / Delete anyway ${hasButtons}; after Cancel the cell is live ${!!afterCancel && !afterCancel.deleted_at}, writes ${cancelWrites.length ? brief(cancelWrites).join(", ") : "none"} (${s1})`);

  // Delete anyway: the cell goes; the rewards keep their link (not rewritten).
  await clickRowDelete(A, T);
  await openModal(A).getByRole("button", { name: "Delete anyway", exact: true }).click();
  const t0 = Date.now();
  await ctx.settled(A);
  const del = await cellRow(ctx, node);
  const nodeRow = (await ctx.sql("select deleted_at from entities where kind = 'target-nodes' and id = $1", [node]))[0];
  const keep = [];
  for (const id of ids) keep.push((await rewardLink(ctx, id))?.targetNodeId);
  // B (idle on the same month page) loses the row.
  const bGone = await ctx.waitUntil(async () => !(await shownTargets(B)).includes(T), 8000);
  R.expect(4, !!del?.deleted_at && !!nodeRow?.deleted_at && keep.every((l) => l === node) && bGone !== null,
    `Delete anyway: cell deleted ${!!del?.deleted_at}, node deleted ${!!nodeRow?.deleted_at} (only month); reward links kept ${keep.join(", ")}; B's page dropped it ${bGone === null ? "no" : (bGone / 1000).toFixed(1) + " s"}`);
  // Unlinked target: plain confirm (no guard).
  const plain = `TL Plain ${run.slice(-5)}`;
  await newTarget(A, plain, 100000, 200000);
  await ctx.settled(A);
  await clickRowDelete(A, plain);
  const noGuard = (await openModal(A).locator("[data-apms-tl-guard]").count()) === 0;
  const plainText = (await openModal(A).innerText()).replace(/\s+/g, " ").slice(0, 120);
  await openModal(A).getByRole("button", { name: /^Delete/ }).last().click();
  await ctx.settled(A);
  R.expect(2, noGuard && /Moves to Trash/.test(plainText), `a target nobody unlocks against keeps the plain confirm: ${noGuard} ("${plainText}")`);
  shared.deletedAt = t0;
  R.expect(3, bGone !== null && bGone <= 5000, `B (on the month page, not acting) dropped the deleted target ${bGone === null ? "not within 8 s" : `${(bGone / 1000).toFixed(1)} s`} after Delete anyway`);
  // Check 5: after reload every screen agrees with the DB (target gone, links kept).
  await ctx.reloadAll();
  const shows = [];
  for (const p of [A, B]) {
    await openTargetMonth(ctx, p);
    shows.push((await shownTargets(p)).includes(T));
  }
  const dbCell = await cellRow(ctx, node);
  const links2 = [];
  for (const id of ids) links2.push((await rewardLink(ctx, id))?.targetNodeId);
  R.expect(5, shows.every((x) => !x) && !!dbCell?.deleted_at && links2.every((l) => l === node), `after reload A/B list ${T}: ${shows.join("/")} (DB cell deleted ${!!dbCell?.deleted_at}); reward links in DB ${links2.join(", ")}`);
  await endChecks(ctx, R, m0);
  return R;
}

export async function targetsLinkBroken(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Rewards", "targets-link-broken", "Broken link: month-list icon (tooltip) · reward-page banner · Re-link");
  if (!shared) shared = await linkedTarget(ctx, run);
  const { T, node, ids } = shared;
  // (targets-link-guard deleted T; when run alone, delete it here without the dialog.)
  if (!(await cellRow(ctx, node))?.deleted_at) {
    await openTargetMonth(ctx, A);
    await rowDelete(A, T);
    await ctx.settled(A);
  }
  const m0 = await openWithoutWrites(ctx, R, "the Rewards list / a reward page with a broken link", async (p) => {
    if (p === B) await openPerson(ctx, p, "rewards", P1.name, SEP);
    else {
      await openPlansList(ctx, p, "rewards");
      await expandMonth(p, SEP);
    }
  });
  // Icon + tooltip on both rows (C and A); none on an unaffected row.
  const t0 = Date.now();
  const cIcons = await ctx.waitUntil(async () => !!(await rowIcon(C, P1.name)) && !!(await rowIcon(C, P2.name)), 8000);
  const ic = await rowIcon(C, P1.name);
  const other = await rowIcon(C, "Sachin Yadav");
  await personRow(C, P1.name, SEP).scrollIntoViewIfNeeded().catch(() => {});
  await personRow(C, P1.name, SEP).locator('[data-apms-tl="broken"]').hover().catch(() => {});
  const s1 = await shot(C, "2-month-list-icon");
  R.expect(1, cIcons !== null && /Target link broken/.test(ic?.title || "") && !other,
    `month list: icons on ${P1.name} and ${P2.name} ${cIcons !== null}; tooltip "${ic?.title}"; none on Sachin Yadav ${!other} (${s1})`);
  R.expect(3, cIcons !== null, `C's list showed the icons ${cIcons === null ? "no" : ((Date.now() - t0) / 1000).toFixed(1) + " s"} after opening`);

  // Stored rows carry no computed field; link unchanged.
  const raw = [];
  for (const id of ids) raw.push(await rewardLink(ctx, id));
  const stored = raw.every((r) => r && r.targetNodeId === node && !("targetLinkBroken" in r));

  // Reward page banner and Re-link on B.
  const bn = banner(B);
  const bShown = await ctx.waitUntil(async () => (await bn.count()) > 0, 8000);
  const bText = bShown !== null ? (await bn.innerText()).replace(/\s+/g, " ") : "";
  const s2 = await shot(B, "2-reward-banner");
  await bn.getByRole("button", { name: "Re-link", exact: true }).click();
  await B.waitForTimeout(400);
  const picker = bn.locator("[data-apms-tl-picker]");
  const options = (await picker.locator("button").allInnerTexts()).map((x) => x.trim());
  const s3 = await shot(B, "2-reward-relink-picker");
  const pick = options.includes("Goa") ? "Goa" : options[0];
  const m1 = ctx.mark();
  await picker.getByRole("button", { name: pick, exact: true }).first().click();
  await B.waitForTimeout(800);
  await ctx.settled(B);
  const goaId = (await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = $1 and deleted_at is null", [pick]))[0]?.id;
  const after = await rewardLink(ctx, ids[0]);
  const bGone = await ctx.waitUntil(async () => (await bn.count()) === 0, 5000);
  const shownName = await targetName(B);
  const saves = (await rewardWrites(m1, "B")).map((n) => `${n.m} ${n.u.replace(/[?].*/, "")} ${n.s}`);
  const cClear = await ctx.waitUntil(async () => !(await rowIcon(C, P1.name)) && !!(await rowIcon(C, P2.name)), 8000);
  R.expect(2, stored && bShown !== null && /Target link broken/.test(bText) && options.length > 0 && after?.targetNodeId === goaId && bGone !== null && shownName === pick && saves.some((s) => /^PATCH \/api\/reward-records\//.test(s)),
    `DB rows keep the link, no stored targetLinkBroken ${stored}; banner "${bText.slice(0, 140)}" (${s2}); picker lists ${options.length} of September's targets (${s3}); Re-link → ${pick}: DB ${after?.targetNodeId === goaId}, banner gone ${bGone !== null}, select shows "${shownName}"; saved by ${saves.join(", ") || "nothing"}; C's icon for ${P1.name} cleared (${P2.name} still flagged) ${cClear !== null}`);
  // Put P1 back on the deleted node for the relink scenario (as it was).
  shared.p1Moved = pick;
  await ctx.reloadAll();
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openPlansList(ctx, p, "rewards");
    await expandMonth(p, SEP);
    const i1 = !!(await rowIcon(p, P1.name));
    const i2 = !!(await rowIcon(p, P2.name));
    if (i1 || !i2) bad.push(`${t}: icons ${P1.name} ${i1}, ${P2.name} ${i2}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `after reload A/B/C: ${P2.name} flagged, ${P1.name} (re-linked) not`);
  R.na(4, "the broken-link warning is computed, not a record: nothing to delete; a stale Re-link after another user's delete / relink is the same Unlock against row PATCH (batch 1 rewards-plan-open check 4, targets-delete-recreate check 4)");
  await endChecks(ctx, R, m0);
  return R;
}

export async function targetsLinkRelink(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-link-relink", "Re-create with the same name: new id → Relink / Not now; same id → links whole");
  if (!shared) shared = await linkedTarget(ctx, run);
  const { T, node, ids } = shared;
  if (!(await cellRow(ctx, node))?.deleted_at) {
    await openTargetMonth(ctx, A);
    await rowDelete(A, T);
    await ctx.settled(A);
  }
  // After targets-link-broken only P2 still points at the deleted node (P1 was re-linked there).
  const m0 = await openWithoutWrites(ctx, R, "Targets month page / Rewards list", async (p) => {
    if (p === C) {
      await openPlansList(ctx, p, "rewards");
      await expandMonth(p, SEP);
    } else await openTargetMonth(ctx, p);
  });
  const expect = [];
  for (const [i, id] of ids.entries()) if ((await rewardLink(ctx, id))?.targetNodeId === node) expect.push([P1, P2][i].name);

  // Re-create with the same custom name: the old node was deleted → a NEW id.
  await newTarget(A, T, 400000, 600000);
  await ctx.settled(A);
  const live = (await nodesNamed(ctx, T)).filter((n) => !n.deleted);
  const newId = live[0]?.id;
  const d = await relinkDialog(A);
  const offered = await ctx.waitUntil(async () => (await d.count()) > 0, 4000);
  const dText = offered !== null ? (await d.innerText()).replace(/\s+/g, " ") : "";
  const s1 = await shot(A, "3-relink-offer");
  const listsAll = expect.every((n) => dText.includes(`${n} · ${SEP}`)) && new RegExp(`${expect.length} rewards? (was|were) linked to a deleted target named “${T}”`).test(dText);
  // B and C (did not create it) get no offer.
  const bOffer = (await (await relinkDialog(B)).count()) + (await (await relinkDialog(C)).count());
  // Not now: nothing written.
  const mn = ctx.mark();
  await d.getByRole("button", { name: "Not now", exact: true }).click();
  await A.waitForTimeout(1500);
  const nnWrites = await rewardWrites(mn, "A");
  const still = [];
  for (const id of ids) still.push((await rewardLink(ctx, id))?.targetNodeId);
  R.expect(1, newId && newId !== node && offered !== null && listsAll && !bOffer && !nnWrites.length && still.filter((x) => x === node).length === expect.length,
    `re-created "${T}": new node ${newId} (old ${node}); offer shown to A ${offered !== null}: "${dText.slice(0, 220)}" (${s1}); lists ${expect.join(" + ")} ${listsAll}; B/C offered ${bOffer}; Not now wrote ${nnWrites.length ? brief(nnWrites).join(", ") : "nothing"}, links still ${still.join(", ")}`);

  // Delete the re-created one (nobody links to it yet: plain confirm) and re-create again → Relink.
  await rowDelete(A, T);
  await ctx.settled(A);
  await newTarget(A, T, 400000, 600000);
  await ctx.settled(A);
  const newId2 = (await nodesNamed(ctx, T)).filter((n) => !n.deleted)[0]?.id;
  const d2 = await relinkDialog(A);
  const offered2 = await ctx.waitUntil(async () => (await d2.count()) > 0, 4000);
  const m2 = ctx.mark();
  const t0 = Date.now();
  if (offered2 !== null) await d2.getByRole("button", { name: "Relink", exact: true }).click();
  await ctx.waitUntil(async () => (await d2.count()) === 0, 8000);
  await ctx.settled(A);
  const now = [];
  for (const id of ids) now.push((await rewardLink(ctx, id))?.targetNodeId);
  const relinked = now.filter((x) => x === newId2).length;
  const writes = (await rewardWrites(m2, "A")).map((n) => `${n.m} ${n.u.replace(/[?].*/, "")} ${n.s}`);
  const s2 = await shot(A, "3-relink-done");
  // C's list: the flagged rows clear.
  const cClear = await ctx.waitUntil(async () => !(await rowIcon(C, P1.name)) && !(await rowIcon(C, P2.name)), 8000);
  const tC = cClear === null ? null : Date.now() - t0;
  await openPlansList(ctx, C, "rewards");
  await expandMonth(C, SEP);
  const s3 = await shot(C, "3-list-after-relink");
  R.expect(2, offered2 !== null && relinked === expect.length && writes.length === expect.length && writes.every((w) => /^PATCH \/api\/reward-records\/.* 200$/.test(w)),
    `second re-create → offer ${offered2 !== null}; Relink → ${relinked}/${expect.length} rewards on ${newId2}; saves ${writes.join(", ") || "none"} (${s2})`);
  R.expect(3, tC !== null && tC <= 5000, tC === null ? "C's icons did not clear within 8 s" : `C's list cleared the icons ${(tC / 1000).toFixed(1)} s after Relink (${s3})`);

  // Same id: a target that still has other months keeps its node — Goa's September cell.
  const goa = (await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = 'Goa' and deleted_at is null"))[0]?.id;
  const goaMonths = (await ctx.sql("select count(*)::int n from target_cells where payload->>'nodeId' = $1 and deleted_at is null", [goa]))[0]?.n;
  await openTargetMonth(ctx, A);
  await rowDelete(A, "Goa");
  await ctx.settled(A);
  await newTarget(A, "Goa", 1000000, 1500000);
  await ctx.settled(A);
  const goaAfter = (await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = 'Goa' and deleted_at is null")).map((r) => r.id);
  const offer3 = (await (await relinkDialog(A)).count()) > 0;
  const goaCell = await cellRow(ctx, goa);
  R.note(`same-name re-create of a target with other months (Goa, ${goaMonths} months): node ids after ${goaAfter.join(", ")} (was ${goa}); cell back ${!!goaCell && !goaCell.deleted_at}; relink offered ${offer3}`);
  R.expect(4, goaAfter.length === 1 && goaAfter[0] === goa && !!goaCell && !goaCell.deleted_at && !offer3,
    `Goa re-created with the same name reuses node ${goa}: ${goaAfter[0] === goa}; links whole, no offer ${!offer3}`);

  await ctx.reloadAll();
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openPerson(ctx, p, "rewards", P2.name, SEP);
    const n = await targetName(p);
    const b = await banner(p).count();
    if (n !== T || b) bad.push(`${t}: ${P2.name} shows "${n}", banner ${b}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `after reload A/B/C: ${P2.name}'s page unlocks against "${T}", no banner`);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// 4: second group in a month keeps the first
// ---------------------------------------------------------------------------
export async function targetsSecondGroup(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-second-group", "Two groups added to one month at once: the first stays intact");
  const tag = run.slice(-4);
  const L = [`SG A1 ${tag}`, `SG A2 ${tag}`, `SG B1 ${tag}`, `SG B2 ${tag}`];
  const G1 = `SG G1 ${tag}`;
  const G2 = `SG G2 ${tag}`;
  const m0 = await openWithoutWrites(ctx, R, "the Targets month page (groups)", (p) => openTargetMonth(ctx, p));
  await (async () => { for (const n of L) await newTarget(A, n, 100000, 200000); })();
  await ctx.settled(A);
  await ctx.waitUntil(async () => { const s = await shownTargets(B); return L.every((n) => s.includes(n)); }, 8000);
  // Group 1 first, then group 2 while group 1 is still arriving on B.
  await newGroup(A, G1, [L[0], L[1]]);
  await newGroup(B, G2, [L[2], L[3]]);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const id = async (n) => (await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = $1 and deleted_at is null", [n]))[0]?.id;
  const g1 = await id(G1);
  const g2 = await id(G2);
  const m1 = await membersOf(ctx, g1);
  const m2 = await membersOf(ctx, g2);
  const root = await rootOrder(ctx);
  const leafIds = [];
  for (const n of L) leafIds.push(await id(n));
  const ok1 = JSON.stringify(m1) === JSON.stringify([L[0], L[1]].sort()) && JSON.stringify(m2) === JSON.stringify([L[2], L[3]].sort()) && root.includes(g1) && root.includes(g2) && !leafIds.some((x) => root.includes(x));
  const g1cell = await cellRow(ctx, g1);
  R.expect(1, ok1 && !!g1cell && !g1cell.deleted_at, `DB: G1 = ${m1.join(", ")}; G2 = ${m2.join(", ")}; both top level, members nested ${ok1}; G1 cell live ${!!g1cell && !g1cell.deleted_at}`);
  const cSeen = await ctx.waitUntil(async () => (await nestedCount(C, G1)) === 2 && (await nestedCount(C, G2)) === 2, 8000);
  R.expect(3, cSeen !== null && cSeen <= 5000, cSeen === null ? `C shows G1 ${await nestedCount(C, G1)} / G2 ${await nestedCount(C, G2)} nested` : `C showed 2 + 2 nested ${(cSeen / 1000).toFixed(1)} s after`);
  const s1 = await shot(C, "4-two-groups");
  // Same time: A adds a third group while B changes G1's floors mode is not needed; A adds G3 from G2's members is a move — skip.
  await ctx.reloadAll();
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openTargetMonth(ctx, p);
    const a = await nestedCount(p, G1);
    const b = await nestedCount(p, G2);
    if (a !== 2 || b !== 2) bad.push(`${t}: G1 ${a}, G2 ${b}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `after reload A/B/C: G1 2 nested, G2 2 nested = DB (${s1})`);
  // Clean up: delete both groups (members stay in the month).
  await rowDelete(A, G2);
  await rowDelete(A, G1);
  await ctx.settled(A);
  R.na(2, "two groups are two records; editing the same group's fields at once is batch 1 targets-groups check 2");
  R.na(4, "delete of a group while another user adds members is batch 1 targets-groups check 4 (same rows)");
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// 5: import — blank keeps, summary first
// ---------------------------------------------------------------------------
const CSV_HEAD = "month,kind,name,unit,parent_group,brand_or_sbu,mode,M1,M2,M3,M4,M5,actual";

async function loadImport(p, csv) {
  await p.locator("main").getByRole("button", { name: "Import", exact: true }).first().click();
  const d = await dialog(p, "Targets spreadsheet");
  const box = d.locator('input[type="checkbox"]').first();
  if (await box.isChecked()) await box.click();
  await d.locator('input[type="file"]').setInputFiles({ name: "targets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.waitForTimeout(1500);
  return d;
}

export async function targetsImportBlank(ctx, run) {
  const { A, B, C } = ctx;
  const R = new ScreenResult("Targets", "targets-import-blank", "Import: blank cell keeps · summary (changed / unchanged / blank-kept) · Apply / Cancel");
  const tag = run.slice(-4);
  const M = "2027-05";
  const X1 = `IB One ${tag}`;
  const X2 = `IB Two ${tag}`;
  const m0 = await openWithoutWrites(ctx, R, "the Targets list (import)", (p) => openTargetsList(ctx, p));
  const csv1 = [CSV_HEAD, `${M},target,${X1},rupees,,,set,100000,110000,120000,130000,140000,90000`, `${M},target,${X2},rupees,,,set,200000,210000,220000,230000,240000,5000`].join("\n");
  let d = await loadImport(A, csv1);
  await d.getByRole("button", { name: "Import", exact: true }).last().click();
  await A.waitForTimeout(600);
  const sum1 = ((await d.locator("[data-apms-import-summary]").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const s0 = await shot(A, "5-import-new-month-summary");
  await d.getByRole("button", { name: /^Apply/ }).last().click();
  await A.waitForTimeout(800);
  await ctx.settled(A);
  const nid = async (n) => (await ctx.sql("select id from entities where kind = 'target-nodes' and payload->>'name' = $1 and deleted_at is null", [n]))[0]?.id;
  const x1 = await nid(X1);
  const x2 = await nid(X2);
  const c1 = (await cellRow(ctx, x1, M))?.payload;
  R.note(`new month import: summary "${sum1}" (${s0}); ${X1} M1 ${c1?.ladder?.M1}, actual ${c1?.actual}`);
  const cList = await ctx.waitUntil(async () => (await listedMonths(C)).includes(`${label(M)}:2`), 8000);
  R.expect(3, cList !== null && cList <= 5000, cList === null ? "C's list did not show the imported month" : `C's list showed ${label(M)} (2) ${(cList / 1000).toFixed(1)} s after`);

  // Re-import with blanks: X1 only M3 changes; X2 floors equal, actual 0.
  const csv2 = [CSV_HEAD, `${M},target,${X1},rupees,,,set,,,125000,,,`, `${M},target,${X2},rupees,,,set,200000,210000,220000,230000,240000,0`].join("\n");
  await openTargetsList(ctx, A);
  d = await loadImport(A, csv2);
  const preview = (await d.innerText()).replace(/\s+/g, " ");
  await d.getByRole("button", { name: "Import", exact: true }).last().click();
  await A.waitForTimeout(600);
  const sum = ((await d.locator("[data-apms-import-summary]").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const btns = (await d.getByRole("button").allInnerTexts()).map((x) => x.trim());
  const s1 = await shot(A, "5-import-summary");
  // Cancel writes nothing.
  const mc = ctx.mark();
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await A.waitForTimeout(1500);
  const cw = realWrites(mc.writes("A"));
  const c1b = (await cellRow(ctx, x1, M))?.payload;
  R.expect(1, /2 changed, 5 unchanged, 5 blank-kept/.test(sum) && btns.includes("Apply") && btns.includes("Cancel") && !cw.length && Number(c1b?.ladder?.M3) === 120000,
    `summary "${sum}" with ${btns.filter((b) => /Apply|Cancel/.test(b)).join(" / ")} (${s1}); Cancel wrote ${cw.length ? brief(cw).join(", ") : "nothing"} (M3 still ${c1b?.ladder?.M3}); preview "${preview.slice(0, 120)}…"`);

  // Apply, while B (on the month page) types X1's actual: the file's cell is blank → B's value stays.
  await openTargetMonth(ctx, B, label(M));
  await openTargetsList(ctx, A);
  d = await loadImport(A, csv2);
  await d.getByRole("button", { name: "Import", exact: true }).last().click();
  await A.waitForTimeout(500);
  await Promise.all([
    (async () => { await d.getByRole("button", { name: /^Apply/ }).last().click(); })(),
    setCell(B, X1, 0, 95000),
  ]);
  await A.waitForTimeout(800);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const f1 = (await cellRow(ctx, x1, M))?.payload;
  const f2 = (await cellRow(ctx, x2, M))?.payload;
  const want1 = { M1: 100000, M2: 110000, M3: 125000, M4: 130000, M5: 140000 };
  const lad = (l) => JSON.stringify(Object.fromEntries(["M1", "M2", "M3", "M4", "M5"].map((k) => [k, Number(l?.[k])])));
  const okVals = lad(f1?.ladder) === JSON.stringify(want1) && Number(f2?.actual) === 0 && Number(f2?.ladder?.M1) === 200000;
  const bSees = await ctx.waitUntil(async () => (await cellValue(B, X1, 3)) === 125000 && (await cellValue(B, X1, 0)) === Number(f1?.actual), 5000);
  R.expect(2, okVals && Number(f1?.actual) === 95000 && bSees !== null,
    `DB after Apply: ${X1} ladder ${lad(f1?.ladder)} (blank floors kept, M3 125000), actual ${f1?.actual} (B typed 95000 while the file's cell was blank → kept); ${X2} actual ${f2?.actual} (explicit 0), M1 ${f2?.ladder?.M1}; B's page = DB ${bSees !== null}`);
  await shot(B, "5-month-after-import");
  await ctx.reloadAll();
  const bad = [];
  for (const [t, p] of Object.entries({ A, B, C })) {
    await openTargetMonth(ctx, p, label(M));
    const v = [await cellValue(p, X1, 3), await cellValue(p, X1, 0), await cellValue(p, X2, 0)];
    if (v[0] !== 125000 || v[1] !== Number(f1?.actual) || v[2] !== 0) bad.push(`${t}: ${v.join("/")}`);
  }
  R.expect(5, !bad.length, bad.length ? bad.join("; ") : `after reload A/B/C = DB (${X1} M3 125000, actual ${f1?.actual}; ${X2} actual 0)`);
  R.na(4, "import has no delete; month delete is covered by targets-import");
  await endChecks(ctx, R, m0);
  return R;
}

/** Run order (each leaves data the next one uses: guard → broken → relink). */
export const SCENARIOS = [
  ["targetsLinkGuard", targetsLinkGuard],
  ["targetsLinkBroken", targetsLinkBroken],
  ["targetsLinkRelink", targetsLinkRelink],
  ["targetsSecondGroup", targetsSecondGroup],
  ["targetsImportBlank", targetsImportBlank],
];
export const SCREENS = SCENARIOS.map(([name]) => name);

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------
async function main() {
  const { chromium } = await import("playwright");
  const BASE = process.env.BASE_URL || "http://127.0.0.1:3020";
  const USERS = {
    A: [process.env.A_USER || "sunny.b", process.env.A_PASS || "0000"],
    B: [process.env.B_USER || "sunny.b", process.env.B_PASS || "0000"],
    C: [process.env.C_USER || "sunny.b", process.env.C_PASS || "0000"],
  };
  const only = process.argv.slice(2);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pages = {};
  for (const t of ["A", "B", "C"]) pages[t] = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const ctx = await makeCtx({ ...pages, base: BASE, databaseUrl: process.env.DATABASE_URL });
  for (const [t, p] of Object.entries(pages)) {
    await p.goto(BASE + "/", { waitUntil: "load" });
    await p.locator('input[type="text"]').fill(USERS[t][0]);
    await p.locator('input[type="password"]').fill(USERS[t][1]);
    await p.getByRole("button", { name: "Continue" }).click();
    await p.getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
  }
  const results = [];
  const run = Date.now().toString(36);
  for (const [name, fn] of SCENARIOS) {
    if (only.length && !only.includes(name)) continue;
    console.log(`\n== ${name}`);
    try {
      results.push(await fn(ctx, run));
    } catch (err) {
      const r = new ScreenResult("?", name, name);
      r.fail(0, `scenario stopped: ${String((err && err.message) || err).split("\n")[0].slice(0, 300)}`);
      await shot(pages.A, `stopped-${name}-A`);
      results.push(r);
    }
  }
  await ctx.close();
  await browser.close();
  console.log("\nmodule  screen                         1     2     3     4     5     6");
  for (const r of results) {
    console.log(`${r.module.padEnd(7)} ${r.id.padEnd(30)} ${[1, 2, 3, 4, 5, 6].map((n) => String(r.checks[n]?.status || "-").padEnd(5)).join(" ")}${r.checks[0] ? "  STOPPED: " + r.checks[0].detail : ""}`);
  }
  const out = process.env.OUT || `${SHOTS}/report.json`;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
  const failed = results.some((r) => Object.values(r.checks).some((c) => c.status === "fail"));
  console.log(failed ? "\nFAIL" : "\nPASS", "— report:", out);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
