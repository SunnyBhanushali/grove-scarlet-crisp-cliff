/**
 * Org catalog screens × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * A = sunny.b (super admin), B = floyd.dsil (super admin), C = ronlind.mene (admin).
 * Data: the imported seed (fresh database). Every scenario creates its own
 * `run`-suffixed records and deletes them again; seed rows that a scenario
 * moves (people in the reporting tree) are put back.
 */
import { ScreenResult, brief } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  openOrg, modal, rowOf, hasRow, treeRows, entityByName, entityById, personByName, groupsOf, trashRow, waitDb, trashShows,
  dragNest, dragUnnest, dragAbove, dragUnderRow, addSbuUnderBrand, addCompany, dblRename, openSbuEdit, saveSbuName, deleteRow, openSbuPage,
  addGroupMember, removeGroupMember, groupMembersShown, mappedShown, addFunction, addSubFunction, openFunctionEdit, deleteFunctionRow,
  rolesView, createRole, openRole, roleTab, saveDraft, addCompetency, pickAgs, renameRolePlacement, addRoleParent, deleteRoleRow,
  openPeopleTree, expandRow, addPersonUnder, deletePersonRow, childrenShown,
} from "./org-page.mjs";

/** Live change feed + the org screens' own row GETs (held for check 4). */
const ORG_READ = /\/api\/org(\/|\?|$)/;
const BRAND = { home: "br-1788157792728-9704", school: "br-1788157805529-kyim" };
const secs = (ms) => (ms / 1000).toFixed(1);

/** Clean-up writes must land before the next scenario starts counting writes. */
async function settleAll(ctx) {
  for (const p of [ctx.A, ctx.B, ctx.C]) await ctx.settled(p);
  await ctx.sleep(2000);
}

/** Writes page `tag` sent since `m` to URLs matching `re` (method url status). */
function realWritesOf(m, tag) {
  return brief(m.writes(tag).filter((n) => !/\/api\/(auth|session|provision-logins|issued-logins)/.test(n.u)));
}
function sent(ctx, m, tag, re) {
  return brief(m.writes(tag).filter((n) => re.test(n.u)));
}

// ---------------------------------------------------------------------------
// Org → Overview (read-only counts)
// ---------------------------------------------------------------------------
async function overviewCounts(p) {
  const t = (await p.locator("main").first().innerText()).replace(/\n+/g, "\n");
  const grab = (label) => {
    const m = t.match(new RegExp(`${label}\\n(\\d+)\\n([^\\n]*)`, "i"));
    return m ? { n: Number(m[1]), sub: m[2] } : null;
  };
  const people = grab("PEOPLE");
  const bs = grab("BRANDS & SBUS");
  const fn = grab("FUNCTIONS");
  const roles = grab("ROLES");
  return {
    people: people?.n ?? null,
    brands: bs?.n ?? null,
    sbus: bs ? Number((bs.sub.match(/(\d+) SBUs/) || [])[1]) : null,
    functions: fn?.n ?? null,
    roles: roles?.n ?? null,
  };
}
async function dbCounts(ctx) {
  const r = await ctx.sql(`select
    (select count(*)::int from entities where kind = 'brands' and deleted_at is null) brands,
    (select count(*)::int from entities where kind = 'sbus' and deleted_at is null) sbus,
    (select count(*)::int from entities where kind = 'functions' and deleted_at is null) functions,
    (select count(*)::int from entities where kind = 'roles' and deleted_at is null) roles,
    (select count(*)::int from people where deleted_at is null and coalesce(payload->>'status','active') = 'active') people`);
  return r[0];
}

export async function orgOverview(ctx, run) {
  const R = new ScreenResult("Org", "org-overview", "Org → Overview (read-only counts)");
  const { A, B, C } = ctx;
  const m0 = await openWithoutWrites(ctx, R, "Org → Overview", (p) => openOrg(ctx, p, "Overview"));
  R.na(1, "read-only screen: counts only, nothing to edit on Overview (edits are made on Brands & SBUs / Functions, covered there)");
  R.na(2, "read-only screen: no fields to edit");
  R.na(4, "read-only screen: no delete control on Overview");
  const before = await overviewCounts(C);
  const dbBefore = await dbCounts(ctx);

  // Check 3: C idle on Overview; A adds an SBU, B adds a function elsewhere.
  const sbu = `Ov SBU ${run}`;
  const fn = `Ov Fn ${run}`;
  await Promise.all([openOrg(ctx, A, "Brands & SBUs"), openOrg(ctx, B, "Functions")]);
  await Promise.all([addSbuUnderBrand(A, "Aliens Home", sbu), addFunction(B, fn)]);
  const t0 = Date.now();
  const seen = await ctx.waitUntil(async () => {
    const c = await overviewCounts(C);
    return c.sbus === before.sbus + 1 && c.functions === before.functions + 1;
  }, 5000);
  const after = await overviewCounts(C);
  const rowS = await waitDb(() => entityByName(ctx, "sbus", sbu));
  const rowF = await waitDb(() => entityByName(ctx, "functions", fn));
  R.expect(3, seen !== null && !!rowS && !!rowF,
    seen === null
      ? `C's Overview did not update within 5 s: SBUs ${before.sbus} → ${after.sbus}, functions ${before.functions} → ${after.functions} (want +1 each; DB has SBU ${!!rowS}, function ${!!rowF})`
      : `C showed SBUs ${before.sbus}→${after.sbus} and functions ${before.functions}→${after.functions} ${secs(seen)} s after the saves`);

  // Check 5: everyone reloads; Overview counts = database counts.
  await ctx.reloadAll();
  const db = await dbCounts(ctx);
  const got = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Overview");
    got.push(await overviewCounts(p));
  }
  const want = { brands: db.brands, sbus: db.sbus, functions: db.functions, roles: db.roles, people: db.people };
  const same = (g) => ["brands", "sbus", "functions", "roles", "people"].every((k) => g[k] === want[k]);
  R.expect(5, got.every(same), `DB ${JSON.stringify(want)} (before the test ${JSON.stringify(dbBefore)}); screens A/B/C ${got.map((g) => (same(g) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Clean up (A): delete the SBU and the function again.
  await openOrg(ctx, A, "Brands & SBUs");
  await deleteRow(A, `Delete sbu ${sbu}`);
  await openOrg(ctx, A, "Functions");
  await deleteFunctionRow(A, fn);
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Brands & SBUs: add company / SBU, rename, make group, delete
// ---------------------------------------------------------------------------
export async function orgUnits(ctx, run) {
  const R = new ScreenResult("Org", "org-units", "Brands & SBUs: add company/SBU, rename (double-click / Edit), make group, delete");
  const { A, B, C } = ctx;
  const U1 = `U1 ${run}`;
  const U1b = `U1 renamed ${run}`;
  const U2 = `U2 ${run}`;
  const CO = `UCo ${run}`;
  const CO2 = `UCo renamed ${run}`;
  const m0 = await openWithoutWrites(ctx, R, "Org → Brands & SBUs", (p) => openOrg(ctx, p, "Brands & SBUs"));

  // Setup for check 4: A adds U2.
  await addSbuUnderBrand(A, "Aliens Home", U2);
  const u2 = await waitDb(() => entityByName(ctx, "sbus", U2));
  if (!u2) throw new Error(`setup: ${U2} was not saved`);

  // Check 1: A adds SBU U1 under Aliens Home while B adds a company and renames it by double-click.
  let dblOk = null;
  const t1 = Date.now();
  await Promise.all([
    addSbuUnderBrand(A, "Aliens Home", U1),
    (async () => {
      await addCompany(B, CO);
      await B.waitForTimeout(500);
      dblOk = await dblRename(B, CO, CO2);
    })(),
  ]);
  const t1done = Date.now();
  const u1 = await waitDb(() => entityByName(ctx, "sbus", U1));
  const co = await waitDb(async () => { const r = await entityByName(ctx, "companies", CO2); return r && !r.deleted_at ? r : null; });
  const coOld = await entityByName(ctx, "companies", CO);
  const shows1 = async (p) => (await hasRow(p, U1)) && (await hasRow(p, CO2)) && !(await hasRow(p, CO));
  const aOk = (await ctx.waitUntil(() => shows1(A), 5000)) !== null;
  const bOk = (await ctx.waitUntil(() => shows1(B), 5000)) !== null;
  const c1 = await ctx.waitUntil(() => shows1(C), 5000);
  R.expect(1, !!u1 && !u1.deleted_at && u1.payload.brandId === BRAND.home && !!co && (!coOld || coOld.id === co.id) && aOk && bOk,
    `DB: ${U1} under Aliens Home ${!!u1 && u1.payload.brandId === BRAND.home}, company renamed by double-click ${!!co}${dblOk === false ? " (no inline input on double-click)" : ""}; A shows both ${aOk}, B shows both ${bOk}; C ${c1 === null ? "did not show both within 5 s" : `showed both ${secs(c1)} s after the saves`} (edits took ${secs(t1done - t1)} s)`);

  // Check 2 (+3): same SBU, different fields: A renames U1 on its Edit page, B makes it a group from the tree.
  await openSbuEdit(A, U1);
  await A.locator("main input").first().fill(U1b);
  await Promise.all([
    (async () => {
      await A.locator("main").getByRole("button", { name: "Save", exact: true }).click();
      await A.waitForTimeout(600);
    })(),
    (async () => {
      await B.getByRole("button", { name: `Make ${U1} a group SBU`, exact: true }).click();
      await B.waitForTimeout(600);
    })(),
  ]);
  const t2 = Date.now();
  const shows2 = async (p) => {
    if (!(await hasRow(p, U1b))) return false;
    return /GROUP SBU/.test(await rowOf(p, U1b).innerText());
  };
  const c2 = await ctx.waitUntil(() => shows2(C), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  const u1x = await waitDb(async () => { const r = await entityById(ctx, "sbus", u1.id); return r && r.payload.name === U1b && r.payload.isGroup === true ? r : null; }, 4000) || await entityById(ctx, "sbus", u1.id);
  await openOrg(ctx, A, "Brands & SBUs");
  const a2 = (await ctx.waitUntil(() => shows2(A), 5000)) !== null;
  const b2 = (await ctx.waitUntil(() => shows2(B), 5000)) !== null;
  R.expect(2, u1x?.payload?.name === U1b && u1x?.payload?.isGroup === true && a2 && b2,
    `DB name ${JSON.stringify(u1x?.payload?.name)} (A's rename kept ${u1x?.payload?.name === U1b}), isGroup ${u1x?.payload?.isGroup} (B's group kept ${u1x?.payload?.isGroup === true}); A shows renamed group ${a2}, B ${b2}; A sent ${brief(ctx.net.A.filter((n) => n.t >= t2 - 8000 && n.u.includes(u1.id))).join(", ")} · B sent ${brief(ctx.net.B.filter((n) => n.t >= t2 - 8000 && n.u.includes(u1.id))).join(", ")}`);
  R.expect(3, c1 !== null && c2 !== null && c1 <= 5000 && c2 <= 5000,
    `C (idle on Brands & SBUs) showed A's SBU + B's renamed company ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`} after the saves; A's rename + B's group ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`} after the saves`);

  // Double-click rename on an SBU row (the screen says "Double-click a name to rename").
  await openOrg(ctx, A, "Brands & SBUs");
  const dblSbu = await dblRename(A, U1b, `${U1b} x`);
  if (!dblSbu) {
    R.note(`double-click on the SBU name "${U1b}" did not open the inline rename: the first click of the double-click opens the SBU page (row onClick = onOpen), so brand/SBU rename by double-click is unreachable; company rows rename fine`);
    await openOrg(ctx, A, "Brands & SBUs");
  } else {
    const dbx = await waitDb(async () => (await entityById(ctx, "sbus", u1.id))?.payload?.name === `${U1b} x`, 4000);
    R.note(`double-click on the SBU name opened the inline rename; saved in DB ${!!dbx}`);
    await openOrg(ctx, A, "Brands & SBUs");
    await dblRename(A, `${U1b} x`, U1b);
    await waitDb(async () => (await entityById(ctx, "sbus", u1.id))?.payload?.name === U1b, 4000);
  }

  // Check 4: A deletes U2 while B (feed held) has U2's Edit page open, renames and saves.
  await openOrg(ctx, B, "Brands & SBUs");
  await openSbuEdit(B, U2);
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await deleteRow(A, `Delete sbu ${U2}`);
  const del = await waitDb(async () => { const r = await entityById(ctx, "sbus", u2.id); return r?.deleted_at ? r : null; });
  const bStill = (await B.locator("main input").first().inputValue().catch(() => "")) === U2;
  await saveSbuName(B, `${U2} stale`);
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "sbus", u2.id);
  const staleLive = await ctx.sql("select id from entities where kind = 'sbus' and deleted_at is null and payload->>'name' in ($1, $2)", [U2, `${U2} stale`]);
  const bSent = sent(ctx, m4, "B", new RegExp(u2.id));
  const inTrash = !!(await trashRow(ctx, U2));
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Brands & SBUs");
    shown.push((await hasRow(p, U2) ? 1 : 0) + (await hasRow(p, `${U2} stale`) ? 1 : 0));
  }
  const trashUi = await trashShows(ctx, A, U2);
  R.expect(4, !!del && bStill && !!after?.deleted_at && after?.payload?.name !== `${U2} stale` && !staleLive.length && shown.every((n) => n === 0) && inTrash && trashUi,
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale save ${bSent.join(", ") || "sent nothing"}; after it still deleted ${!!after?.deleted_at}, stale name kept out ${after?.payload?.name !== `${U2} stale`}, live copies ${staleLive.length}; shown after reload A/B/C ${shown.join("/")}; in Settings → Trash (DB ${inTrash}, screen ${trashUi})`);

  // Check 5: after reload, screens and DB agree on U1b (group) and the renamed company.
  const u1db = await entityById(ctx, "sbus", u1.id);
  const codb = await entityById(ctx, "companies", co.id);
  const got = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Brands & SBUs");
    got.push({ u1: await hasRow(p, u1db.payload.name), group: (await hasRow(p, u1db.payload.name)) && /GROUP SBU/.test(await rowOf(p, u1db.payload.name).innerText()), co: await hasRow(p, codb.payload.name) });
  }
  const want = { u1: !u1db.deleted_at, group: !u1db.deleted_at && u1db.payload.isGroup === true, co: !codb.deleted_at };
  R.expect(5, got.every((g) => JSON.stringify(g) === JSON.stringify(want)) && u1db.payload.name === U1b,
    `DB ${u1db.payload.name} group ${u1db.payload.isGroup}, company ${codb.payload.name}; screens A/B/C ${got.map((g) => (JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Clean up (A).
  await deleteRow(A, `Delete group ${u1db.payload.name}`).catch(() => deleteRow(A, `Delete sbu ${u1db.payload.name}`));
  await deleteRow(A, `Delete company ${codb.payload.name}`);
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Brands & SBUs: nest / un-nest / reorder by pointer drag
// ---------------------------------------------------------------------------
export async function orgUnitsDrag(ctx, run) {
  const R = new ScreenResult("Org", "org-units-drag", "Brands & SBUs: nest, un-nest and reorder SBUs by pointer drag");
  const { A, B, C } = ctx;
  const D1 = `D1 ${run}`, D2 = `D2 ${run}`, D2b = `D2 renamed ${run}`, D3 = `D3 ${run}`, D4 = `D4 ${run}`;
  const m0 = await openWithoutWrites(ctx, R, "Org → Brands & SBUs (drag)", (p) => openOrg(ctx, p, "Brands & SBUs"));
  // Setup (A): D1 (group) + D2 under Aliens Home, D3 (group) + D4 under Aliens Tattoo School.
  await addSbuUnderBrand(A, "Aliens Home", D1);
  await addSbuUnderBrand(A, "Aliens Home", D2);
  await addSbuUnderBrand(A, "Aliens Tattoo School", D3);
  await addSbuUnderBrand(A, "Aliens Tattoo School", D4);
  await A.getByRole("button", { name: `Make ${D1} a group SBU`, exact: true }).click();
  await A.getByRole("button", { name: `Make ${D3} a group SBU`, exact: true }).click();
  const ids = {};
  for (const n of [D1, D2, D3, D4]) {
    const r = await waitDb(() => entityByName(ctx, "sbus", n));
    if (!r) throw new Error(`setup: ${n} not saved`);
    ids[n] = r.id;
  }
  await waitDb(async () => (await entityById(ctx, "sbus", ids[D3]))?.payload?.isGroup === true);
  for (const p of [A, B, C]) await ctx.waitUntil(async () => (await hasRow(p, D4)) && /GROUP SBU/.test(await rowOf(p, D3).innerText()), 8000);

  // Check 1: A nests D2 into D1 while B nests D4 into D3.
  await Promise.all([dragNest(A, D2, D1), dragNest(B, D4, D3)]);
  const t1 = Date.now();
  const nested = async (p, kid, parent) => ((await childrenShown(p, parent)) || []).includes(kid);
  const c1 = await ctx.waitUntil(async () => (await nested(C, D2, D1)) && (await nested(C, D4, D3)), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  const d2 = await waitDb(async () => { const r = await entityById(ctx, "sbus", ids[D2]); return r?.payload?.parentId === ids[D1] ? r : null; }, 4000) || await entityById(ctx, "sbus", ids[D2]);
  const d4 = await waitDb(async () => { const r = await entityById(ctx, "sbus", ids[D4]); return r?.payload?.parentId === ids[D3] ? r : null; }, 4000) || await entityById(ctx, "sbus", ids[D4]);
  const g2 = await groupsOf(ctx, ids[D2]);
  const g4 = await groupsOf(ctx, ids[D4]);
  const ab1 = (await ctx.waitUntil(async () => (await nested(A, D2, D1)) && (await nested(A, D4, D3)) && (await nested(B, D2, D1)) && (await nested(B, D4, D3)), 5000)) !== null;
  R.expect(1, d2?.payload?.parentId === ids[D1] && d4?.payload?.parentId === ids[D3] && g2.includes(ids[D1]) && g4.includes(ids[D3]) && ab1,
    `DB: D2.parentId=D1 ${d2?.payload?.parentId === ids[D1]} (members ${g2.length}), D4.parentId=D3 ${d4?.payload?.parentId === ids[D3]} (members ${g4.length}); A and B show both nests ${ab1}; C ${c1 === null ? "did not show both within 5 s" : `showed both ${secs(c1)} s after the drops`}`);

  // Check 2: same SBU D2, different fields, at the same time: A takes it out of
  // D1 by drag while B renames it on its Edit page. First with the contract
  // gesture (drag LEFT one level), then with the only drag that un-nests on
  // this screen (drop it right under the brand row).
  const unnested = async (p) => (await hasRow(p, D2b)) && !((await childrenShown(p, D1)) || []).includes(D2b) && !((await childrenShown(p, D1)) || []).includes(D2);
  const mL = ctx.mark();
  await dragUnnest(A, D2, D2);
  await ctx.sleep(1500);
  const leftWrites = sent(ctx, mL, "A", new RegExp(ids[D2]));
  const afterLeft = await entityById(ctx, "sbus", ids[D2]);
  const leftOk = !afterLeft.payload.parentId;
  if (leftOk) await dragNest(A, D2, D1);
  await ctx.settled(A);
  await openSbuEdit(B, D2);
  await B.locator("main input").first().fill(D2b);
  const m2 = ctx.mark();
  await Promise.all([
    dragUnderRow(A, D2, /^Aliens Home · BRAND/),
    (async () => {
      await B.waitForTimeout(150);
      await B.locator("main").getByRole("button", { name: "Save", exact: true }).click();
      await B.waitForTimeout(600);
    })(),
  ]);
  const c2 = await ctx.waitUntil(() => unnested(C), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const d2x = await entityById(ctx, "sbus", ids[D2]);
  const g2x = await groupsOf(ctx, ids[D2]);
  await openOrg(ctx, B, "Brands & SBUs");
  const ab2 = (await ctx.waitUntil(async () => (await unnested(A)) && (await unnested(B)), 5000)) !== null;
  R.expect(2, leftOk && d2x?.payload?.name === D2b && !d2x?.payload?.parentId && !g2x.length && ab2,
    `drag LEFT out of D1: ${leftOk ? "un-nested" : `did nothing (D2 stays in D1; A sent ${leftWrites.join(", ") || "no write"})`}; then A drop-under-brand ‖ B rename: DB name ${JSON.stringify(d2x?.payload?.name)} (B's rename kept ${d2x?.payload?.name === D2b}), parentId ${JSON.stringify(d2x?.payload?.parentId)} + group rows ${JSON.stringify(g2x)} (A's un-nest kept ${!d2x?.payload?.parentId && !g2x.length}); A and B show it renamed and out of D1 ${ab2}; writes A ${brief(m2.writes("A").filter((n) => /sbu/.test(n.u))).join(", ")} · B ${brief(m2.writes("B").filter((n) => /sbu/.test(n.u))).join(", ")}`);

  // Sibling reorder: A drags D3 above LILA (same brand, same depth).
  await openOrg(ctx, A, "Brands & SBUs");
  const orderOf = async (p) => (await treeRows(p)).map((r) => r.name).filter((n) => n === "LILA" || n === D3);
  const mR = ctx.mark();
  await dragAbove(A, D3, "LILA");
  const tR = Date.now();
  const aOrder = await orderOf(A);
  const cR = await ctx.waitUntil(async () => (await orderOf(C)).join() === [D3, "LILA"].join(), 5000);
  await ctx.settled(A);
  await ctx.sleep(1000);
  const reorderWrites = realWritesOf(mR, "A");
  R.expect(3, c1 !== null && c2 !== null && cR !== null,
    `C (idle) showed the nests ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}, the rename + un-nest ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`}, A's reorder (D3 above LILA; A's own screen ${aOrder.join(" > ")}; A sent ${reorderWrites.join(", ") || "no write"}) ${cR === null ? `NOT within 5 s (C still ${(await orderOf(C)).join(" > ")})` : `${secs(cR)} s`} after the drops`);

  // Check 4: A deletes D4 (in D3) while B, feed held, drags D4 out of D3.
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await deleteRow(A, `Delete sbu ${D4}`);
  const del = await waitDb(async () => { const r = await entityById(ctx, "sbus", ids[D4]); return r?.deleted_at ? r : null; });
  const bStill = await hasRow(B, D4);
  let dragErr = "";
  try { await dragUnnest(B, D4, D4); } catch (e) { dragErr = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "sbus", ids[D4]);
  const liveMembers = await groupsOf(ctx, ids[D4]);
  const bSent = sent(ctx, m4, "B", new RegExp(ids[D4]));
  const inTrash = !!(await trashRow(ctx, D4));
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Brands & SBUs");
    shown.push(await hasRow(p, D4) ? 1 : 0);
  }
  R.expect(4, !!del && bStill && !!after?.deleted_at && !liveMembers.length && shown.every((n) => n === 0) && inTrash,
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale drag${dragErr ? ` (${dragErr})` : ""} sent ${bSent.join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at}, live group rows ${liveMembers.length}; shown after reload A/B/C ${shown.join("/")}; trash entry ${inTrash}`);

  // Check 5: after reload the tree (nest + order) matches the DB and A's last screen.
  const dbRows = {};
  for (const n of [D1, D2, D3]) dbRows[n] = await entityById(ctx, "sbus", ids[n]);
  const got = [];
  for (const p of [A, B, C]) {
    got.push({ d2Out: (await hasRow(p, D2b)) && !((await childrenShown(p, D1)) || []).includes(D2b), order: (await orderOf(p)).join(" > ") });
  }
  const want = { d2Out: !dbRows[D2].payload.parentId, order: aOrder.join(" > ") };
  R.expect(5, got.every((g) => g.d2Out === want.d2Out && g.order === want.order) && reorderWrites.length > 0,
    `DB: D2 parent ${JSON.stringify(dbRows[D2].payload.parentId)}; want order as A left it (${want.order}); screens A/B/C ${got.map((g) => (g.d2Out === want.d2Out && g.order === want.order ? "same" : JSON.stringify(g))).join(" / ")}${!reorderWrites.length ? " — A's reorder wrote nothing, so any order after reload is storage order" : ""}`);

  // Clean up (A).
  await openOrg(ctx, A, "Brands & SBUs");
  for (const n of [D2b, D1, D3]) {
    const r = await entityByName(ctx, "sbus", n);
    if (r && !r.deleted_at) await deleteRow(A, `${r.payload.isGroup ? "Delete group" : "Delete sbu"} ${n}`).catch(() => {});
  }
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Brands & SBUs → group SBU page: members ("SBUs in this group") + mapped functions
// ---------------------------------------------------------------------------
export async function orgSbuMembers(ctx, run) {
  const R = new ScreenResult("Org", "org-sbu-members", "Group SBU page: SBUs in this group (add / remove), mapped functions");
  const { A, B, C } = ctx;
  const G1 = `G1 ${run}`, G2 = `G2 ${run}`, M1 = `M1 ${run}`, M1b = `M1 renamed ${run}`, M2 = `M2 ${run}`;
  const FN = "Training";
  const m0 = await openWithoutWrites(ctx, R, "Org → Brands & SBUs (group page)", (p) => openOrg(ctx, p, "Brands & SBUs"));
  for (const n of [G1, G2, M1, M2]) await addSbuUnderBrand(A, "Aliens Home", n);
  const ids = {};
  for (const n of [G1, G2, M1, M2]) {
    const r = await waitDb(() => entityByName(ctx, "sbus", n));
    if (!r) throw new Error(`setup: ${n} not saved`);
    ids[n] = r.id;
  }
  await A.getByRole("button", { name: `Make ${G1} a group SBU`, exact: true }).click();
  await A.getByRole("button", { name: `Make ${G2} a group SBU`, exact: true }).click();
  await waitDb(async () => (await entityById(ctx, "sbus", ids[G2]))?.payload?.isGroup === true);
  for (const p of [A, B, C]) await ctx.waitUntil(async () => (await hasRow(p, M2)) && /GROUP SBU/.test(await rowOf(p, G2).innerText()), 8000);
  const fnRow = await entityByName(ctx, "functions", FN);
  await Promise.all([openSbuPage(A, G1), openSbuPage(B, G2), openSbuPage(C, G1)]);

  // Check 1: A adds M1 to G1 and maps Training to G1, B adds M2 to G2, at the same time.
  await Promise.all([
    (async () => {
      await addGroupMember(A, M1);
      await A.locator("main select").filter({ has: A.locator("option", { hasText: "Map function…" }) }).first().selectOption({ label: FN });
      await A.waitForTimeout(500);
    })(),
    addGroupMember(B, M2),
  ]);
  const cSeesM1 = async () => (await groupMembersShown(C, [M1])).length === 1 && (await mappedShown(C)).includes(FN);
  const c1 = await ctx.waitUntil(cSeesM1, 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  const g1m = await waitDb(async () => { const g = await groupsOf(ctx, ids[M1]); return g.length ? g : null; }, 4000) || [];
  const g2m = await waitDb(async () => { const g = await groupsOf(ctx, ids[M2]); return g.length ? g : null; }, 4000) || [];
  const fnx = await waitDb(async () => { const r = await entityById(ctx, "functions", fnRow.id); return (r.payload.buIds || []).includes(ids[G1]) ? r : null; }, 4000) || await entityById(ctx, "functions", fnRow.id);
  const aOk = (await ctx.waitUntil(async () => (await groupMembersShown(A, [M1])).length === 1, 5000)) !== null;
  const bOk = (await ctx.waitUntil(async () => (await groupMembersShown(B, [M2])).length === 1, 5000)) !== null;
  R.expect(1, g1m.join() === ids[G1] && g2m.join() === ids[G2] && (fnx.payload.buIds || []).includes(ids[G1]) && aOk && bOk,
    `DB: M1 in ${JSON.stringify(g1m)} (want G1), M2 in ${JSON.stringify(g2m)} (want G2), Training mapped to G1 ${(fnx.payload.buIds || []).includes(ids[G1])}; A shows M1 ${aOk}, B shows M2 ${bOk}; C (on G1) ${c1 === null ? "did not show M1 + Training within 5 s" : `showed M1 + Training ${secs(c1)} s after the saves`}`);

  // Check 2: same SBU M1: B renames it on its Edit page while A removes it from G1.
  await openOrg(ctx, B, "Brands & SBUs");
  await openSbuEdit(B, M1);
  await B.locator("main input").first().fill(M1b);
  await Promise.all([
    removeGroupMember(A, M1),
    (async () => {
      await B.waitForTimeout(150);
      await B.locator("main").getByRole("button", { name: "Save", exact: true }).click();
      await B.waitForTimeout(600);
    })(),
  ]);
  const t2 = Date.now();
  const c2 = await ctx.waitUntil(async () => (await groupMembersShown(C, [M1, M1b])).length === 0, 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const m1x = await entityById(ctx, "sbus", ids[M1]);
  const g1x = await groupsOf(ctx, ids[M1]);
  const aShows = (await groupMembersShown(A, [M1, M1b])).length === 0;
  R.expect(2, m1x.payload.name === M1b && !m1x.payload.parentId && !g1x.length && aShows,
    `DB: name ${JSON.stringify(m1x.payload.name)} (B's rename kept ${m1x.payload.name === M1b}), parentId ${JSON.stringify(m1x.payload.parentId)}, group rows ${JSON.stringify(g1x)} (A's Remove kept ${!m1x.payload.parentId && !g1x.length}); A's G1 page lists it ${!aShows}; writes A ${brief(ctx.net.A.filter((n) => n.t >= t2 - 8000 && n.m !== "GET" && /sbu/.test(n.u))).join(", ")} · B ${brief(ctx.net.B.filter((n) => n.t >= t2 - 8000 && n.m !== "GET" && /sbu/.test(n.u))).join(", ")}`);
  R.expect(3, c1 !== null && c2 !== null,
    `C idle on G1's page: A's member + mapping ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}; M1 leaving G1 ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`} after the saves`);

  // Check 4: A deletes M2 (member of G2) while B, feed held on G2's page, clicks Remove on it.
  await openSbuPage(B, G2).catch(async () => { await openOrg(ctx, B, "Brands & SBUs"); await openSbuPage(B, G2); });
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await openOrg(ctx, A, "Brands & SBUs");
  await deleteRow(A, `Delete sbu ${M2}`);
  const del = await waitDb(async () => { const r = await entityById(ctx, "sbus", ids[M2]); return r?.deleted_at ? r : null; });
  const bStill = (await groupMembersShown(B, [M2])).length === 1;
  let err = "";
  try { await removeGroupMember(B, M2); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "sbus", ids[M2]);
  const live = await groupsOf(ctx, ids[M2]);
  const inTrash = !!(await trashRow(ctx, M2));
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Brands & SBUs");
    const inTree = await hasRow(p, M2);
    await openSbuPage(p, G2);
    shown.push((inTree ? 1 : 0) + (await groupMembersShown(p, [M2])).length);
  }
  R.expect(4, !!del && bStill && !!after?.deleted_at && !live.length && shown.every((n) => n === 0) && inTrash,
    `deleted in DB ${!!del}; B still saw it in G2 ${bStill}; B's stale Remove${err ? ` (${err})` : ""} sent ${sent(ctx, m4, "B", /sbu/).join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at}, live group rows ${live.length}; shown after reload (tree + G2 page) A/B/C ${shown.join("/")}; trash entry ${inTrash}`);

  // Check 5: reload (done); G1 page on A/B/C matches the DB (members + mapped function).
  const dbG1Members = (await ctx.sql("select m.payload->>'memberId' id from entities m where m.kind = 'sbu-members' and m.deleted_at is null and m.payload->>'groupId' = $1", [ids[G1]])).map((r) => r.id);
  const fn5 = await entityById(ctx, "functions", fnRow.id);
  const want = { members: dbG1Members.length, training: (fn5.payload.buIds || []).includes(ids[G1]) };
  const got = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Brands & SBUs");
    await openSbuPage(p, G1);
    got.push({ members: (await groupMembersShown(p, [M1, M1b, M2])).length, training: (await mappedShown(p)).includes(FN) });
  }
  R.expect(5, got.every((g) => JSON.stringify(g) === JSON.stringify(want)),
    `DB G1: ${want.members} member(s), Training mapped ${want.training}; screens A/B/C ${got.map((g) => (JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Clean up (A): unmap Training, delete the SBUs.
  const unmap = A.locator("main div").filter({ has: A.getByText(FN, { exact: true }) }).filter({ has: A.getByRole("button", { name: "Unmap", exact: true }) }).last();
  if (await unmap.count()) { await unmap.getByRole("button", { name: "Unmap", exact: true }).click(); await A.waitForTimeout(600); }
  await openOrg(ctx, A, "Brands & SBUs");
  for (const n of [M1b, G1, G2]) {
    const r = await entityByName(ctx, "sbus", n);
    if (r && !r.deleted_at) await deleteRow(A, `${r.payload.isGroup ? "Delete group" : "Delete sbu"} ${n}`).catch(() => {});
  }
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Functions and sub-functions
// ---------------------------------------------------------------------------
export async function orgFunctions(ctx, run) {
  const R = new ScreenResult("Org", "org-functions", "Functions: add function / sub-function, edit, rename (double-click), move by drag, delete");
  const { A, B, C } = ctx;
  const F1 = `F1 ${run}`, F1b = `F1 renamed ${run}`, S1 = `S1 ${run}`, F2 = `F2 ${run}`;
  const m0 = await openWithoutWrites(ctx, R, "Org → Functions", (p) => openOrg(ctx, p, "Functions"));
  await addFunction(A, F1, "Aliens Home");
  const f1 = await waitDb(() => entityByName(ctx, "functions", F1));
  if (!f1) throw new Error(`setup: ${F1} not saved`);
  for (const p of [B, C]) await ctx.waitUntil(() => hasRow(p, F1), 8000);

  // Check 1: A adds sub-function S1 under F1 while B adds function F2.
  await Promise.all([addSubFunction(A, F1, S1), addFunction(B, F2)]);
  const shows1 = async (p) => (await hasRow(p, F2)) && ((await hasRow(p, S1)) || (await rowOf(p, F1).innerText()).includes(S1) || ((await childrenShown(p, F1)) || []).includes(S1));
  const c1 = await ctx.waitUntil(() => shows1(C), 5000);
  const s1 = await waitDb(() => entityByName(ctx, "functions", S1));
  const f2 = await waitDb(() => entityByName(ctx, "functions", F2));
  const ab1 = (await ctx.waitUntil(async () => (await shows1(A)) && (await shows1(B)), 5000)) !== null;
  R.expect(1, !!s1 && s1.payload.parentId === f1.id && !!f2 && !f2.deleted_at && ab1,
    `DB: S1 under F1 ${s1?.payload?.parentId === f1.id}, F2 saved ${!!f2}; A and B show both ${ab1}; C ${c1 === null ? "did not show both within 5 s" : `showed both ${secs(c1)} s after the saves`}`);

  // Check 2: same function F1: A edits its description on the Edit page while B renames it by double-click.
  await openFunctionEdit(A, F1);
  await A.locator("main textarea").first().fill(`desc A ${run}`);
  let dbl = null;
  let dblRetry = null;
  await Promise.all([
    (async () => {
      await A.waitForTimeout(300);
      await A.locator("main").getByRole("button", { name: "Save", exact: true }).click();
      await A.waitForTimeout(600);
    })(),
    (async () => { dbl = await dblRename(B, F1, F1b, 1); if (!dbl) { dblRetry = await dblRename(B, F1, F1b, 3); } })(),
  ]);
  const t2 = Date.now();
  const c2 = await ctx.waitUntil(() => hasRow(C, F1b), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const f1x = await entityById(ctx, "functions", f1.id);
  await openOrg(ctx, A, "Functions");
  const ab2 = (await ctx.waitUntil(async () => (await hasRow(A, F1b)) && (await hasRow(B, F1b)), 5000)) !== null;
  R.expect(2, f1x.payload.name === F1b && f1x.payload.description === `desc A ${run}` && ab2,
    `DB name ${JSON.stringify(f1x.payload.name)} (B's double-click rename kept ${f1x.payload.name === F1b}${dbl === false ? `; B's double-click during A's save opened no inline input${dblRetry ? ", a retry 1 s later did" : ", nor did retries"}` : ""}), description ${JSON.stringify(f1x.payload.description)} (A's edit kept ${f1x.payload.description === `desc A ${run}`}); A and B list it renamed ${ab2}; writes A ${brief(ctx.net.A.filter((n) => n.t >= t2 - 8000 && n.u.includes(f1.id))).join(", ")} · B ${brief(ctx.net.B.filter((n) => n.t >= t2 - 8000 && n.u.includes(f1.id))).join(", ")}`);

  // Move by drag: A drags S1 out of F1 (left) → top-level function.
  const f1Name = f1x.payload.name;
  if (!((await childrenShown(A, f1Name)) || []).includes(S1)) {
    const exp = rowOf(A, f1Name).getByRole("button", { name: "Expand", exact: true });
    if (await exp.count()) await exp.click();
  }
  await dragUnnest(A, S1, S1);
  const t3 = Date.now();
  const outOfF1 = async (p) => (await hasRow(p, S1)) && !((await childrenShown(p, f1Name)) || []).includes(S1) && !(await rowOf(p, f1Name).innerText()).includes(S1);
  const c3 = await ctx.waitUntil(() => outOfF1(C), 5000);
  await ctx.settled(A);
  const s1x = await waitDb(async () => { const r = await entityById(ctx, "functions", s1.id); return r && !r.payload.parentId ? r : null; }, 4000) || await entityById(ctx, "functions", s1.id);
  R.expect(3, c1 !== null && c2 !== null && c3 !== null,
    `C idle on Functions: A's sub-function + B's function ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}; B's rename ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`}; A's drag of S1 out of F1 (DB parentId ${JSON.stringify(s1x.payload.parentId)}) ${c3 === null ? "NOT within 5 s" : `${secs(c3)} s`} after the save`);

  // Check 4: A deletes F2 while B (feed held) has F2's Edit page open, edits the description and saves.
  await openOrg(ctx, B, "Functions");
  await openFunctionEdit(B, F2);
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await deleteFunctionRow(A, F2);
  const del = await waitDb(async () => { const r = await entityById(ctx, "functions", f2.id); return r?.deleted_at ? r : null; });
  const bStill = (await B.locator("main input").first().inputValue().catch(() => "")) === F2;
  await B.locator("main textarea").first().fill(`STALE ${run}`);
  await B.locator("main").getByRole("button", { name: "Save", exact: true }).click();
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "functions", f2.id);
  const inTrash = !!(await trashRow(ctx, F2));
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Functions");
    shown.push(await hasRow(p, F2) ? 1 : 0);
  }
  const trashUi = await trashShows(ctx, A, F2);
  R.expect(4, !!del && bStill && !!after?.deleted_at && after?.payload?.description !== `STALE ${run}` && shown.every((n) => n === 0) && inTrash && trashUi,
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale save sent ${sent(ctx, m4, "B", new RegExp(f2.id)).join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at}, stale description kept out ${after?.payload?.description !== `STALE ${run}`}; shown after reload A/B/C ${shown.join("/")}; Settings → Trash (DB ${inTrash}, screen ${trashUi})`);

  // Check 5: after reload the three screens and the DB agree (F1 renamed, S1 top level).
  const f1db = await entityById(ctx, "functions", f1.id);
  const s1db = await entityById(ctx, "functions", s1.id);
  const got = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Functions");
    got.push({ f1: await hasRow(p, f1db.payload.name), s1Top: await outOfF1(p) });
  }
  const want = { f1: true, s1Top: !s1db.payload.parentId };
  R.expect(5, got.every((g) => JSON.stringify(g) === JSON.stringify(want)),
    `DB ${f1db.payload.name} / S1 parent ${JSON.stringify(s1db.payload.parentId)}; screens A/B/C ${got.map((g) => (JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Clean up (A).
  await openOrg(ctx, A, "Functions");
  await deleteFunctionRow(A, S1).catch(() => {});
  await deleteFunctionRow(A, f1db.payload.name).catch(() => {});
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Roles: create, placement (rename), AGS, views, delete
// ---------------------------------------------------------------------------
async function roleListed(p, name) {
  return hasRow(p, name);
}

export async function orgRoles(ctx, run) {
  const R = new ScreenResult("Org", "org-roles", "Roles: create, place / rename, AGS band, List / Nested / People views, delete");
  const { A, B, C } = ctx;
  const R1 = `R1 ${run}`, R1b = `R1 renamed ${run}`, R2 = `R2 ${run}`;
  const m0 = await openWithoutWrites(ctx, R, "Org → Roles", async (p) => { await openOrg(ctx, p, "Roles"); await rolesView(p, "List"); });

  // Check 1: A creates R1 (Artistry) while B creates R2 (reports to Director of Artistry).
  await Promise.all([createRole(A, R1, { fn: "Artistry" }), createRole(B, R2, { parents: ["Director of Artistry"] })]);
  const c1 = await ctx.waitUntil(async () => (await roleListed(C, R1)) && (await roleListed(C, R2)), 5000);
  const r1 = await waitDb(() => entityByName(ctx, "roles", R1));
  const r2 = await waitDb(() => entityByName(ctx, "roles", R2));
  const artistry = await entityByName(ctx, "functions", "Artistry");
  const dirArt = (await ctx.sql("select id from entities where kind = 'roles' and deleted_at is null and payload->>'name' = 'Director of Artistry'"))[0]?.id;
  R.expect(1, !!r1 && r1.payload.functionId === artistry.id && !!r2 && (r2.payload.reportsToRoleIds || []).includes(dirArt),
    `DB: R1 in Artistry ${r1?.payload?.functionId === artistry.id}, R2 reports to Director of Artistry ${(r2?.payload?.reportsToRoleIds || []).includes(dirArt)}; both landed on their role page; C (Roles list) ${c1 === null ? "did not show both within 5 s" : `showed both ${secs(c1)} s after the saves`}`);

  // Check 2: same role R1: A renames it in Place this role while B (on R1's page) picks an AGS factor.
  await openRole(ctx, B, R1);
  await Promise.all([renameRolePlacement(A, R1b), pickAgs(B, "Solid")]);
  const t2 = Date.now();
  const c2 = await ctx.waitUntil(() => roleListed(C, R1b), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const r1x = await entityById(ctx, "roles", r1.id);
  const aTitle = (await A.locator("main").first().innerText()).includes(R1b);
  R.expect(2, r1x.payload.name === R1b && r1x.payload.ags?.["1A"] === 20,
    `DB name ${JSON.stringify(r1x.payload.name)} (A's rename kept ${r1x.payload.name === R1b}), ags ${JSON.stringify(r1x.payload.ags)} (B's 1A=Solid kept ${r1x.payload.ags?.["1A"] === 20}); A's page shows the new title ${aTitle}; writes A ${brief(ctx.net.A.filter((n) => n.t >= t2 - 8000 && n.u.includes(r1.id))).join(", ")} · B ${brief(ctx.net.B.filter((n) => n.t >= t2 - 8000 && n.u.includes(r1.id))).join(", ")}`);
  R.expect(3, c1 !== null && c2 !== null,
    `C idle on Roles (List): the two new roles ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}, A's rename ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`} after the saves`);

  // Check 4: A deletes R2 from the list while B (feed held) has R2 open, edits its KRA and saves a draft.
  await openRole(ctx, B, R2);
  await roleTab(B, "KROC");
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await openOrg(ctx, A, "Roles");
  await rolesView(A, "List");
  await deleteRoleRow(A, R2);
  const del = await waitDb(async () => { const r = await entityById(ctx, "roles", r2.id); return r?.deleted_at ? r : null; });
  const bStill = (await B.locator("main").first().innerText()).includes(R2);
  let err = "";
  try {
    await B.getByPlaceholder("KRA name").first().fill(`STALE ${run}`);
    await B.locator("main").getByRole("button", { name: "Save draft" }).first().click();
  } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "roles", r2.id);
  const inTrash = !!(await trashRow(ctx, R2));
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Roles");
    await rolesView(p, "List");
    shown.push(await roleListed(p, R2) ? 1 : 0);
  }
  const trashUi = await trashShows(ctx, A, R2);
  R.expect(4, !!del && bStill && !!after?.deleted_at && !JSON.stringify(after?.payload || {}).includes(`STALE ${run}`) && shown.every((n) => n === 0) && inTrash && trashUi,
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale draft save${err ? ` (${err})` : ""} sent ${sent(ctx, m4, "B", new RegExp(r2.id)).join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at}, stale KRA kept out ${!JSON.stringify(after?.payload || {}).includes(`STALE ${run}`)}; listed after reload A/B/C ${shown.join("/")}; Settings → Trash (DB ${inTrash}, screen ${trashUi})`);

  // Check 5: after reload the List, Nested and People views and the role page agree with the DB.
  const r1db = await entityById(ctx, "roles", r1.id);
  const got = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Roles");
    await rolesView(p, "List");
    const list = await roleListed(p, r1db.payload.name);
    await rolesView(p, "Nested");
    const nested = (await p.locator("main").first().innerText()).includes(r1db.payload.name);
    await rolesView(p, "People");
    const peopleView = (await p.locator("main").first().innerText()).length > 0;
    await openRole(ctx, p, r1db.payload.name);
    await roleTab(p, "AGS");
    const ags = /KNOW-HOW\n20\n/.test(await p.locator("main").first().innerText());
    got.push({ list, nested, peopleView, ags });
  }
  const want = { list: true, nested: true, peopleView: true, ags: r1db.payload.ags?.["1A"] === 20 };
  R.expect(5, got.every((g) => JSON.stringify(g) === JSON.stringify(want)),
    `DB ${r1db.payload.name} ags ${JSON.stringify(r1db.payload.ags)}; screens (List / Nested / People view / AGS know-how 20) A/B/C ${got.map((g) => (JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Clean up (A).
  await openOrg(ctx, A, "Roles");
  await rolesView(A, "List");
  await deleteRoleRow(A, r1db.payload.name).catch(() => {});
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// Role page: KROC (KRAs), competencies, AGS, multi-reporting
// ---------------------------------------------------------------------------
export async function orgRolesKroc(ctx, run) {
  const R = new ScreenResult("Org", "org-roles-kroc", "Role page: KRAs (KROC), competencies, AGS, multi-reporting placement");
  const { A, B, C } = ctx;
  const K1 = `K1 ${run}`, K2 = `K2 ${run}`, KRA = `KRA A ${run}`, COMP = `Comp A ${run}`, COMPB = `Comp B ${run}`;
  const m0 = await openWithoutWrites(ctx, R, "Org → Roles (role page)", (p) => openOrg(ctx, p, "Roles"));
  await createRole(A, K2, { parents: ["Director of Artistry"] });
  await openOrg(ctx, A, "Roles");
  await createRole(A, K1, { parents: ["Director of Artistry"] });
  const k1 = await waitDb(() => entityByName(ctx, "roles", K1));
  const k2 = await waitDb(() => entityByName(ctx, "roles", K2));
  if (!k1 || !k2) throw new Error("setup: roles not saved");
  await ctx.sleep(1500);
  await Promise.all([openRole(ctx, B, K2), openRole(ctx, C, K1)]);
  await roleTab(C, "KROC");

  // Check 1: A names K1's KRA and saves a draft while B gives K2 a second parent (multi-reporting).
  await Promise.all([
    (async () => {
      await roleTab(A, "KROC");
      await A.getByPlaceholder("KRA name").first().fill(KRA);
      await saveDraft(A);
    })(),
    addRoleParent(B, "Director of Operations"),
  ]);
  const c1 = await ctx.waitUntil(async () => (await C.getByPlaceholder("KRA name").first().inputValue()) === KRA, 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  const k1x = await entityById(ctx, "roles", k1.id);
  const k2x = await waitDb(async () => { const r = await entityById(ctx, "roles", k2.id); return (r.payload.reportsToRoleIds || []).length === 2 ? r : null; }, 4000) || await entityById(ctx, "roles", k2.id);
  await openOrg(ctx, A, "Roles");
  await rolesView(A, "List");
  const multi = await ctx.waitUntil(async () => /MULTI REPORTING/.test(await rowOf(A, K2).innerText()), 5000) !== null;
  R.expect(1, k1x.payload.kras?.[0]?.name === KRA && (k2x.payload.reportsToRoleIds || []).length === 2 && multi,
    `DB: K1 KRA ${JSON.stringify(k1x.payload.kras?.[0]?.name)}, K2 parents ${JSON.stringify(k2x.payload.reportsToRoleIds)}; Roles list marks K2 MULTI REPORTING ${multi}; C (on K1's KROC) ${c1 === null ? "did not show the KRA within 5 s" : `showed the KRA ${secs(c1)} s after the save`}`);

  // Check 2: same role K1: A adds a competency while B (on K1's page) picks an AGS factor.
  await openRole(ctx, A, K1);
  await openRole(ctx, B, K1);
  await Promise.all([addCompetency(A, COMP, "High"), pickAgs(B, "Deep")]);
  const t2 = Date.now();
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const k1y = await entityById(ctx, "roles", k1.id);
  const hasComp = (k1y.payload.competencies || []).some((c) => c.name === COMP && c.weight === "high");
  R.expect(2, hasComp && k1y.payload.ags?.["1A"] === 30 && k1y.payload.kras?.[0]?.name === KRA,
    `DB: competency ${hasComp} (A), ags ${JSON.stringify(k1y.payload.ags)} (B's 1A=Deep=30 kept ${k1y.payload.ags?.["1A"] === 30}), earlier KRA kept ${k1y.payload.kras?.[0]?.name === KRA}; C (idle viewer of K1, never typed) wrote K1 ${brief(ctx.net.C.filter((n) => n.m !== "GET" && n.u.includes(k1.id))).join(", ") || "never"}; writes A ${brief(ctx.net.A.filter((n) => n.t >= t2 - 8000 && n.u.includes(k1.id))).join(", ")} · B ${brief(ctx.net.B.filter((n) => n.t >= t2 - 8000 && n.u.includes(k1.id))).join(", ")}`);
  // C, idle on K1 (KROC tab), sees a KRA rename by B within 5 s.
  await roleTab(B, "KROC");
  await B.getByPlaceholder("KRA name").first().fill(`${KRA} b`);
  await saveDraft(B);
  const c3 = await ctx.waitUntil(async () => (await C.getByPlaceholder("KRA name").first().inputValue()) === `${KRA} b`, 5000);
  R.expect(3, c1 !== null && c3 !== null,
    `C idle on K1's KROC tab: A's KRA name ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}; B's KRA rename ${c3 === null ? "NOT within 5 s" : `${secs(c3)} s`} after the save`);

  // Check 4: A deletes K2 while B (feed held) has K2 open and adds a competency.
  await openRole(ctx, B, K2);
  await ctx.holdFeed(B, ORG_READ);
  const m4 = ctx.mark();
  await openOrg(ctx, A, "Roles");
  await rolesView(A, "List");
  await deleteRoleRow(A, K2);
  const del = await waitDb(async () => { const r = await entityById(ctx, "roles", k2.id); return r?.deleted_at ? r : null; });
  const bStill = (await B.locator("main").first().innerText()).includes(K2);
  let err = "";
  try { await addCompetency(B, COMPB); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await entityById(ctx, "roles", k2.id);
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openOrg(ctx, p, "Roles");
    await rolesView(p, "List");
    shown.push(await hasRow(p, K2) ? 1 : 0);
  }
  R.expect(4, !!del && bStill && !!after?.deleted_at && !JSON.stringify(after?.payload || {}).includes(COMPB) && shown.every((n) => n === 0),
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale competency${err ? ` (${err})` : ""} sent ${sent(ctx, m4, "B", new RegExp(k2.id)).join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at}, stale competency kept out ${!JSON.stringify(after?.payload || {}).includes(COMPB)}; listed after reload A/B/C ${shown.join("/")}`);

  // Check 5: reload (done); K1's page (KRA, competency, AGS) = DB on A/B/C.
  const k1db = await entityById(ctx, "roles", k1.id);
  const want = { kra: k1db.payload.kras?.[0]?.name || "", comp: (k1db.payload.competencies || []).map((c) => c.name).join("|"), ags30: k1db.payload.ags?.["1A"] === 30 };
  const got = [];
  for (const p of [A, B, C]) {
    await openRole(ctx, p, K1);
    await roleTab(p, "KROC");
    const kra = await p.getByPlaceholder("KRA name").first().inputValue();
    await roleTab(p, "Competencies");
    const comps = [];
    for (const i of await p.getByPlaceholder("Competency").all()) comps.push(await i.inputValue());
    await roleTab(p, "AGS");
    const ags30 = /KNOW-HOW\n30\n/.test(await p.locator("main").first().innerText());
    got.push({ kra, comp: comps.join("|"), ags30 });
  }
  R.expect(5, got.every((g) => JSON.stringify(g) === JSON.stringify(want)) && want.kra === `${KRA} b`,
    `DB ${JSON.stringify(want)}; screens A/B/C ${got.map((g) => (JSON.stringify(g) === JSON.stringify(want) ? "same" : JSON.stringify(g))).join(" / ")}`);

  // Bulk upload dialog opens and closes without writing.
  const mb = ctx.mark();
  await openOrg(ctx, A, "Roles");
  await A.locator("main").getByRole("button", { name: /Bulk upload/ }).click();
  const bulkOpen = await modal(A, "Bulk upload roles").isVisible().catch(() => false);
  await modal(A, "Bulk upload roles").locator("button", { hasText: /^Close$/ }).first().click().catch(() => {});
  await ctx.sleep(1000);
  const bw = mb.writes("A").filter((n) => !/\/api\/(auth|session)/.test(n.u));
  if (!bulkOpen || bw.length) R.fail(6, `Bulk upload dialog: opened ${bulkOpen}; writes ${brief(bw).join(", ")}`);

  // Clean up (A).
  await rolesView(A, "List");
  await deleteRoleRow(A, K1).catch(() => {});
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

// ---------------------------------------------------------------------------
// People reporting tree (org chart): nest, un-nest, reorder by pointer drag
// ---------------------------------------------------------------------------
export async function orgChartDrag(ctx, run) {
  const R = new ScreenResult("Org", "org-chart-drag", "People reporting tree: nest / un-nest / reorder by pointer drag");
  const { A, B, C } = ctx;
  const T = [1, 2, 3].map((i) => `T${i}${run} Tree`);
  const [T1, T2, T3] = T;
  const m0 = await openWithoutWrites(ctx, R, "Org → People (Company view)", (p) => openPeopleTree(ctx, p, ["Sunny"]));
  // Setup (A): three people under Sunny.
  let n = 0;
  for (const t of T) {
    await openPeopleTree(ctx, A, ["Sunny"]);
    await addPersonUnder(A, "Sunny", t.split(" ")[0], "Tree", (Date.now() % 90000) + 10000 + ++n);
  }
  const ids = {};
  for (const t of T) {
    const r = await waitDb(() => personByName(ctx, t));
    if (!r) throw new Error(`setup: ${t} not saved`);
    ids[t] = r.id;
  }
  const sunny = (await personByName(ctx, "Sunny")).id;
  await openPeopleTree(ctx, A, ["Sunny"]);
  for (const p of [B, C]) {
    await openPeopleTree(ctx, p, ["Sunny"]);
    await ctx.waitUntil(async () => (await hasRow(p, T3)), 8000);
  }

  // Check 1: A nests T1 under T3 while B nests T2 under T3.
  await Promise.all([dragNest(A, T1, T3), dragNest(B, T2, T3)]);
  const underT3 = async (p) => {
    const kids = (await childrenShown(p, "Sunny")) || [];
    return !kids.includes(T1) && !kids.includes(T2) && /\b2 people\b/.test(await rowOf(p, T3).innerText());
  };
  const c1 = await ctx.waitUntil(() => underT3(C), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  const p1 = await waitDb(async () => { const r = await personByName(ctx, T1); return r.payload.managerId === ids[T3] ? r : null; }, 4000) || await personByName(ctx, T1);
  const p2 = await waitDb(async () => { const r = await personByName(ctx, T2); return r.payload.managerId === ids[T3] ? r : null; }, 4000) || await personByName(ctx, T2);
  const ab1 = (await ctx.waitUntil(async () => (await underT3(A)) && (await underT3(B)), 5000)) !== null;
  R.expect(1, p1.payload.managerId === ids[T3] && p2.payload.managerId === ids[T3] && ab1,
    `DB: T1 → T3 ${p1.payload.managerId === ids[T3]}, T2 → T3 ${p2.payload.managerId === ids[T3]}; A and B show both under T3 ${ab1}; C ${c1 === null ? "did not show both within 5 s" : `showed both ${secs(c1)} s after the drops`}`);

  // Check 2: same person T1, different fields, at the same time: A takes T1
  // out of T3 by drag while B edits T1's Location on the person file (Edit →
  // Save). First the contract gesture (drag LEFT at the end of T3's reports),
  // then the drag that does un-nest here (drop T1 on the line above T3).
  await expandRow(A, T3);
  const mL = ctx.mark();
  await dragUnnest(A, T1, T2);
  await ctx.sleep(1500);
  await ctx.settled(A);
  const leftWrites = sent(ctx, mL, "A", new RegExp(ids[T1]));
  const afterLeft = await personByName(ctx, T1);
  const leftOk = afterLeft.payload.managerId === sunny;
  if (leftOk) { await expandRow(A, T3); await dragNest(A, T1, T3); await ctx.settled(A); }
  await openPeopleTree(ctx, B, ["Sunny", T3]);
  await rowOf(B, T1).locator("button").filter({ hasText: T1 }).first().click();
  await B.locator("main").getByText("Core role").first().waitFor();
  await B.locator("main").getByRole("button", { name: "Edit", exact: true }).first().click();
  const loc = B.locator("main label", { hasText: "Location" }).locator("input").first();
  await loc.waitFor();
  const LOC = `Loc ${run}`;
  await loc.fill(LOC);
  await expandRow(A, T3);
  const m2 = ctx.mark();
  await Promise.all([
    dragAbove(A, T1, T3),
    (async () => {
      await B.waitForTimeout(150);
      await B.locator("main").getByRole("button", { name: "Save", exact: true }).first().click();
      await B.waitForTimeout(600);
    })(),
  ]);
  const t1Out = async (p) => ((await childrenShown(p, "Sunny")) || []).includes(T1);
  const c2 = await ctx.waitUntil(() => t1Out(C), 5000);
  await ctx.settled(A);
  await ctx.settled(B);
  await ctx.sleep(1500);
  const p1x = await personByName(ctx, T1);
  R.expect(2, leftOk && p1x.payload.managerId === sunny && p1x.payload.location === LOC,
    `drag LEFT at the end of T3's reports: ${leftOk ? "un-nested" : `did not un-nest (A sent ${leftWrites.join(", ") || "no write"}; managerId stays ${afterLeft.payload.managerId === ids[T3] ? "T3" : JSON.stringify(afterLeft.payload.managerId)})`}; then A drop-above-T3 ‖ B Edit→Location→Save: DB managerId ${p1x.payload.managerId === sunny ? "Sunny" : p1x.payload.managerId === ids[T3] ? "T3" : JSON.stringify(p1x.payload.managerId)} (A's un-nest kept ${p1x.payload.managerId === sunny}), location ${JSON.stringify(p1x.payload.location)} (B's edit kept ${p1x.payload.location === LOC}); writes A ${brief(m2.writes("A").filter((n) => n.u.includes(ids[T1]))).join(", ") || "none"} · B ${brief(m2.writes("B").filter((n) => n.u.includes(ids[T1]))).join(", ") || "none"}`);
  await openPeopleTree(ctx, B, ["Sunny"]);

  // Sibling reorder: A drags T3 above T1 (both report to Sunny now).
  const order = async (p) => ((await childrenShown(p, "Sunny")) || []).filter((x) => x === T1 || x === T3);
  const before = await order(A);
  const cBefore = await order(C);
  const [first, second] = before;
  const mR = ctx.mark();
  if (first && second) await dragAbove(A, second, first);
  const aOrder = await order(A);
  const tR = Date.now();
  // C must move from its own earlier order to A's new one (both must have agreed before).
  const cR = cBefore.join() === before.join() ? await ctx.waitUntil(async () => (await order(C)).join() === aOrder.join(), 5000) : null;
  // The save is debounced: count A's writes once A has nothing left to save.
  await ctx.settled(A);
  await ctx.sleep(1000);
  const reorderWrites = realWritesOf(mR, "A");
  if (cBefore.join() !== before.join()) R.note(`before the reorder A showed ${before.join(" > ")} but C showed ${cBefore.join(" > ")}: sibling order differs per browser`);
  if (!reorderWrites.length) R.note("A's sibling reorder sent no write");
  R.expect(3, c1 !== null && c2 !== null && cR !== null && aOrder.join() !== before.join(),
    `C (idle, Company view): the two nests ${c1 === null ? "NOT within 5 s" : `${secs(c1)} s`}; T1 back under Sunny ${c2 === null ? "NOT within 5 s" : `${secs(c2)} s`}; A's sibling reorder (${before.join(" > ")} → A shows ${aOrder.join(" > ")}; C before ${cBefore.join(" > ")}; A sent ${reorderWrites.join(", ") || "no write"}) ${cR === null ? `NOT within 5 s (C shows ${(await order(C)).join(" > ")}; A sent ${brief(ctx.net.A.filter((n) => n.t >= tR - 3000 && n.m !== "GET")).join(", ") || "no write"})` : `${secs(cR)} s`}`);

  // Check 4: A deletes T2 (under T3) while B, feed held, drags T2 out of T3.
  await openPeopleTree(ctx, B, ["Sunny", T3]);
  await ctx.holdFeed(B, /\/api\/people(\/|\?|$)/);
  const m4 = ctx.mark();
  await expandRow(A, T3);
  await deletePersonRow(A, T2);
  const del = await waitDb(async () => { const r = await ctx.sql("select deleted_at from people where id = $1", [ids[T2]]); return r[0]?.deleted_at ? r[0] : null; });
  const bStill = await hasRow(B, T2);
  let err = "";
  try { await dragUnnest(B, T2, T2); } catch (e) { err = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = (await ctx.sql("select deleted_at, payload from people where id = $1", [ids[T2]]))[0];
  const inTrash = (await ctx.sql("select 1 from entities where kind = 'trash' and deleted_at is null and payload->'ids' ? $1", [ids[T2]])).length > 0;
  await ctx.reloadAll();
  const shown = [];
  for (const p of [A, B, C]) {
    await openPeopleTree(ctx, p, ["Sunny", T3]);
    shown.push(await hasRow(p, T2) ? 1 : 0);
  }
  R.expect(4, !!del && bStill && !!after?.deleted_at && shown.every((x) => x === 0) && inTrash,
    `deleted in DB ${!!del}; B still saw it ${bStill}; B's stale drag${err ? ` (${err})` : ""} sent ${sent(ctx, m4, "B", new RegExp(ids[T2])).join(", ") || "nothing"}; after it still deleted ${!!after?.deleted_at} (managerId ${after?.payload?.managerId === ids[T3] ? "T3" : JSON.stringify(after?.payload?.managerId)}); shown after reload A/B/C ${shown.join("/")}; trash entry ${inTrash}`);

  // Check 5: after reload the tree matches the DB (T1 and T3 report to Sunny) and A's last order.
  const db5 = {};
  for (const t of [T1, T3]) db5[t] = (await personByName(ctx, t)).payload.managerId;
  const got = [];
  for (const p of [A, B, C]) got.push({ underSunny: ((await childrenShown(p, "Sunny")) || []).filter((x) => x === T1 || x === T3).length === 2, order: (await order(p)).join(" > ") });
  const want = { underSunny: db5[T1] === sunny && db5[T3] === sunny, order: aOrder.join(" > ") };
  R.expect(5, got.every((g) => g.underSunny === want.underSunny && g.order === want.order) && reorderWrites.length > 0,
    `DB: T1/T3 managers ${db5[T1] === sunny ? "Sunny" : db5[T1]}/${db5[T3] === sunny ? "Sunny" : db5[T3]}; want order as A left it (${want.order}); screens A/B/C ${got.map((g) => (g.underSunny === want.underSunny && g.order === want.order ? "same" : JSON.stringify(g))).join(" / ")}${!reorderWrites.length ? " — A's reorder wrote nothing, so the order after reload is storage order, not a saved order (reorderPerson only reorders the local array)" : ""}`);

  // Clean up (A): delete the test people.
  await openPeopleTree(ctx, A, ["Sunny"]);
  for (const t of [T1, T3]) await deletePersonRow(A, t).catch(() => {});
  await settleAll(ctx);
  await endChecks(ctx, R, m0);
  return R;
}

/** Every screen / dialog / control in the Org area that saves data. */
export const SCREENS = [
  { module: "Org", screen: "Overview (counts)", saves: "nothing (read-only)", scenario: "org-overview", reached: true, why: "" },
  { module: "Org", screen: "Brands & SBUs: Add company (inline)", saves: "companies row", scenario: "org-units", reached: true, why: "" },
  { module: "Org", screen: "Brands & SBUs: company rename by double-click", saves: "companies.name", scenario: "org-units", reached: true, why: "" },
  { module: "Org", screen: "Brands & SBUs: Add brand (top button / company +)", saves: "brands row", scenario: null, reached: true, why: "explored by hand (PATCH /api/e/brands 200); same inline add as company/SBU, not in a scenario" },
  { module: "Org", screen: "Brands & SBUs: Add SBU (top button / brand + / Add SBU under this / Add group SBU)", saves: "sbus row", scenario: "org-units", reached: true, why: "brand + used; the other + variants share the inline editor" },
  { module: "Org", screen: "Brands & SBUs: brand / SBU rename by double-click", saves: "brands.name / sbus.name", scenario: "org-units", reached: true, why: "unreachable with a real mouse: the first click opens the brand/SBU page (see note)" },
  { module: "Org", screen: "Brands & SBUs: Make group SBU / Ungroup buttons", saves: "sbus.isGroup (+ sbu-members)", scenario: "org-units", reached: true, why: "Make group covered; Ungroup not driven" },
  { module: "Org", screen: "Brands & SBUs: drag to nest / un-nest SBU", saves: "sbus.parentId + sbu-members rows", scenario: "org-units-drag", reached: true, why: "nest works; drag LEFT never un-nests (engine sees every row at depth 0); dropping right under the brand row does" },
  { module: "Org", screen: "Brands & SBUs: drag to reorder SBU siblings", saves: "nothing (every drop nests into the row above; list order has no storage)", scenario: "org-units-drag", reached: true, why: "" },
  { module: "Org", screen: "Brands & SBUs: drag brand to another company / SBU to another brand", saves: "brands.companyId / sbus.brandId", scenario: null, reached: false, why: "not driven (same engine as nest; time)" },
  { module: "Org", screen: "Brands & SBUs: Delete company / brand / SBU / group (confirm dialog)", saves: "row deleted + trash row", scenario: "org-units", reached: true, why: "SBU, group, company delete driven; brand delete not driven" },
  { module: "Org", screen: "SBU page → Edit (Name, Brand, Group SBU, Parent group) → Save", saves: "sbus row", scenario: "org-units", reached: true, why: "" },
  { module: "Org", screen: "Group SBU page: SBUs in this group (Add SBU… / Remove)", saves: "sbu-members rows + member sbus.parentId", scenario: "org-sbu-members", reached: true, why: "" },
  { module: "Org", screen: "SBU page: Mapped functions (Map function… / Unmap)", saves: "functions.buIds / brandIds / shared", scenario: "org-sbu-members", reached: true, why: "" },
  { module: "Org", screen: "SBU page: People → Assign people (inline picker)", saves: "people.buId / buIds", scenario: null, reached: false, why: "people assignment belongs to the People screens (other agent); only opened" },
  { module: "Org", screen: "Functions: Add function dialog", saves: "functions row", scenario: "org-functions", reached: true, why: "" },
  { module: "Org", screen: "Functions: row + → Sub-function dialog", saves: "functions row with parentId", scenario: "org-functions", reached: true, why: "" },
  { module: "Org", screen: "Functions: row + → Role / SBU / Add to group", saves: "roles / functions", scenario: null, reached: false, why: "not driven (Role = Create role dialog, covered in org-roles)" },
  { module: "Org", screen: "Functions: rename by double-click", saves: "functions.name", scenario: "org-functions", reached: true, why: "" },
  { module: "Org", screen: "Function Edit page (Name, Description, Head, Brand, SBU) → Save", saves: "functions row (+ its sub-functions)", scenario: "org-functions", reached: true, why: "" },
  { module: "Org", screen: "Functions: drag to move sub-function out / nest / reorder", saves: "functions.parentId", scenario: "org-functions", reached: true, why: "un-nest driven; reorder has no storage (same as SBUs/people)" },
  { module: "Org", screen: "Functions: Delete function (confirm)", saves: "row deleted + trash row", scenario: "org-functions", reached: true, why: "" },
  { module: "Org", screen: "Roles: Create role dialog (name, function, reports to, roles under)", saves: "roles row", scenario: "org-roles", reached: true, why: "" },
  { module: "Org", screen: "Roles: List / Nested / People views", saves: "nothing (view choice is session state)", scenario: "org-roles", reached: true, why: "" },
  { module: "Org", screen: "Roles: Nested view drag (reportsTo / reorder)", saves: "roles.reportsToRoleId(s)", scenario: null, reached: false, why: "not driven (same engine; time)" },
  { module: "Org", screen: "Roles: Delete role (row)", saves: "row deleted + trash row", scenario: "org-roles", reached: true, why: "" },
  { module: "Org", screen: "Role page: Place this role → Edit → Save placement (title, reports to, SBU, function, brand, people)", saves: "roles row (+ people roleId)", scenario: "org-roles", reached: true, why: "title + a second parent (multi-reporting) driven; SBU/brand/people not" },
  { module: "Org", screen: "Role page: KROC tab (KRAs, responsibilities, outcomes, weights) → Save draft / Publish KROC", saves: "roles.kras, krocStatus", scenario: "org-roles-kroc", reached: true, why: "KRA name + Save draft; Publish not driven" },
  { module: "Org", screen: "Role page: AGS tab (factor buttons, autosave)", saves: "roles.ags / band", scenario: "org-roles", reached: true, why: "" },
  { module: "Org", screen: "Role page: Competencies tab (add, weight, delete)", saves: "roles.competencies", scenario: "org-roles-kroc", reached: true, why: "" },
  { module: "Org", screen: "Role page: Upload KROC / Download KROC / Template", saves: "roles.kras (upload)", scenario: null, reached: false, why: "file upload not driven" },
  { module: "Org", screen: "Roles: Bulk upload dialog (Import CSV)", saves: "roles / functions / sbus", scenario: "org-roles-kroc", reached: true, why: "dialog opened/closed without writes; CSV import not driven" },
  { module: "Org", screen: "People reporting tree: drag nest / un-nest", saves: "people.managerId", scenario: "org-chart-drag", reached: true, why: "" },
  { module: "Org", screen: "People reporting tree: drag reorder siblings", saves: "nothing is saved (order is local only)", scenario: "org-chart-drag", reached: true, why: "" },
  { module: "Org", screen: "People reporting tree: Reports to dialog / Add person under this / Delete", saves: "people.managerId / people row", scenario: "org-chart-drag", reached: true, why: "Add person under this + Delete used; Reports to dialog opened only" },
];

export const SCENARIOS = [
  ["org-overview", orgOverview],
  ["org-units", orgUnits],
  ["org-units-drag", orgUnitsDrag],
  ["org-sbu-members", orgSbuMembers],
  ["org-functions", orgFunctions],
  ["org-roles", orgRoles],
  ["org-roles-kroc", orgRolesKroc],
  ["org-chart-drag", orgChartDrag],
];
