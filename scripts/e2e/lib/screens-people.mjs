/**
 * Org → People × the six checks (see scripts/e2e/rows-v2-three-users.mjs).
 * Every scenario hires its own people (run-suffixed names), edits only those
 * and trashes them at the end, so it works on a fresh database in any order.
 * The seeded managers (Avnish Chollera, Floyd Dsilva) are only picked as
 * managers; their own rows are never edited.
 */
import { ScreenResult, realWrites, brief } from "./harness.mjs";
import { openWithoutWrites, endChecks } from "./screens-apms.mjs";
import {
  personByName, personById, waitDb, openPeople, setView, search, treeRow, rowShown, rowHasMR, countLine, hire, openFile,
  trashPerson, openTrash, trashRow, restoreFromTrash, detail, startEdit, field, setField, saveEdit, picker, pickerToggle,
  pickerValue, reportsToDialog, massSelect, massApply, esc, waitQuiet, watchWrites, statusFilter,
} from "./people-page.mjs";

const MGR1 = { name: "Avnish Chollera" };
const MGR2 = { name: "Floyd Dsilva" };

/** Unique hire data per run (employee ID, phone and email must be unique). */
let seq = 0;
export function newPerson(run, first, last) {
  const h = [...String(run)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99991, 7);
  seq++;
  const n = 5000 + ((h * 7 + seq * 13) % 4999);
  return {
    first,
    last,
    name: `${first} ${last}`,
    email: `${first}.${last}.${seq}@e2e.test`.toLowerCase(),
    code: `ALN${n}`,
    phone: `9${String(h).padStart(5, "0").slice(-5)}${String(seq).padStart(4, "0")}`,
    dob: "1995-05-05",
  };
}
/** Letters-only tag from the run id (names stay searchable). */
export function tagOf(run) {
  return String(run).replace(/[^a-z0-9]/gi, "").slice(-6);
}

async function hireOn(ctx, p, v) {
  watchWrites(ctx);
  await openPeople(ctx, p, "List");
  await hire(ctx, p, v);
  const row = await waitDb(ctx, async () => {
    const r = await personByName(ctx, v.name);
    return r && !r.deleted_at ? r : null;
  }, 20000);
  if (!row) throw new Error(`hire of ${v.name} (${v.code}) not in the DB 20 s after Create person`);
  return row;
}
/** Trash our own people at the end of a scenario (A), quietly. */
async function cleanup(ctx, names) {
  for (const n of names) {
    const r = await personByName(ctx, n);
    if (r && !r.deleted_at) await trashPerson(ctx, ctx.A, n).catch(() => {});
  }
  await ctx.settled(ctx.A);
}
const payloadOf = async (ctx, id) => (await personById(ctx, id))?.payload || {};
const peopleRe = (id) => new RegExp(`/api/people/${esc(id)}([?]|$)`);

/** Every page's list shows exactly the live DB people whose name matches `q`. */
async function listAgrees(ctx, q, pages = ["A", "B", "C"]) {
  const db = (await ctx.sql("select payload->>'name' as n from people where deleted_at is null and payload->>'name' ilike $1", [`%${q}%`])).map((r) => r.n).sort();
  const got = {};
  for (const t of pages) {
    const p = ctx[t];
    await openPeople(ctx, p, "List");
    await search(p, q);
    const names = await p.locator("main div[data-dnd-row] button span.font-medium").evaluateAll((els) => els.map((e) => (e.childNodes[0]?.textContent || e.innerText).trim()));
    got[t] = names.filter((n) => n.toLowerCase().includes(q.toLowerCase())).sort();
  }
  const ok = Object.values(got).every((g) => JSON.stringify(g) === JSON.stringify(db));
  return { ok, db, got };
}

// ---------------------------------------------------------------------------
// People views: List / My team / Company / SBU / Function / Summary, filters, search
// ---------------------------------------------------------------------------
export async function peopleViews(ctx, run) {
  const R = new ScreenResult("Org", "people-views", "People: List · My team · Company · SBU · Function · Summary, filters and search");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));

  // Views, filters and search on all three at once: sessionStorage only, no writes.
  const mv = ctx.mark();
  const views = ["My team", "Company", "SBU", "Function", "Summary", "List"];
  const seen = {};
  await Promise.all(["A", "B", "C"].map(async (t) => {
    const p = ctx[t];
    seen[t] = [];
    for (const v of views) {
      await setView(p, v);
      const txt = await p.locator("main").innerText();
      seen[t].push(`${v}:${/people/.test(txt) ? "ok" : "?"}`);
    }
    const sel = p.locator("main select").filter({ has: p.locator("option", { hasText: /^Paused$/ }) }).first();
    if (await sel.count()) { await sel.selectOption({ label: "All" }).catch(() => {}); await p.waitForTimeout(400); await sel.selectOption({ label: "Active" }).catch(() => {}); }
    await search(p, "Patil");
    await search(p, "");
  }));
  await ctx.sleep(1500);
  const vw = ["A", "B", "C"].flatMap((t) => realWrites(mv.writes(t)).map((n) => `${t}: ${brief([n])[0]}`));
  const ss = await A.evaluate(() => Object.keys(sessionStorage));
  if (vw.length) R.fail(6, `writes while switching views / filters / search: ${vw.join("; ")}`);
  R.note(`views rendered: ${seen.A.join(", ")}; sessionStorage keys: ${ss.join(", ")}`);

  // Check 3: C idle on List with a search typed; A and B hire at the same time.
  const hA = newPerson(run, "Vana", `View${tag}`);
  const hB = newPerson(run, "Vbob", `View${tag}`);
  await openPeople(ctx, C, "List");
  await search(C, `View${tag}`);
  const t0 = Date.now();
  await Promise.all([hireOn(ctx, A, hA), hireOn(ctx, B, hB)]);
  const tSaved = Date.now();
  const cSeen = await ctx.waitUntil(async () => (await rowShown(C, hA.name)) && (await rowShown(C, hB.name)), 5000);
  const tC = cSeen === null ? null : Date.now() - tSaved;
  R.expect(3, tC !== null, tC === null ? `C (List, search "View${tag}") did not show both hires within 5 s of the saves (${await countLine(C)} people shown)` : `C showed both hires ${(tC / 1000).toFixed(1)} s after the saves (${((Date.now() - t0) / 1000).toFixed(1)} s after the clicks)`);
  R.na(1, "views, filters and search are per-browser sessionStorage state (apms-ui-people-list-v1), not records; the hires used here are checked in people-hire");
  R.na(2, "same: nothing in a view is a record field; field edits are checked in people-edit");
  R.na(4, "a view has no edit control of its own; delete vs a stale edit is checked in people-hire / people-edit / people-status");

  // Check 5: reload; the list (search restored from sessionStorage) agrees with the DB.
  await ctx.reloadAll();
  const restored = await C.evaluate(() => {
    const s = document.querySelector("main input[placeholder^='Search name']");
    return s ? s.value : null;
  }).catch(() => null);
  const ag = await listAgrees(ctx, `View${tag}`);
  R.expect(5, ag.ok && ag.db.length === 2, `DB ${JSON.stringify(ag.db)}; A/B/C lists ${["A", "B", "C"].map((t) => JSON.stringify(ag.got[t])).join(" / ")}; C's search after reload "${restored}"`);

  // Switch views after reload (people list GET), still no writes.
  const mr = ctx.mark();
  for (const v of views) await setView(C, v);
  const vr = realWrites(mr.writes("C"));
  if (vr.length) R.fail(6, `writes switching views after reload: ${brief(vr).join("; ")}`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [hA.name, hB.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Hire (Add person)
// ---------------------------------------------------------------------------
export async function peopleHire(ctx, run) {
  const R = new ScreenResult("Org", "people-hire", "People → Add person (hire), then the new person's file");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));
  const hA = newPerson(run, "Hana", `Hire${tag}`);
  const hB = newPerson(run, "Hbob", `Hire${tag}`);

  // Check 1 + 3: A and B hire at the same time; C idle on List searching.
  await openPeople(ctx, C, "List");
  await search(C, `Hire${tag}`);
  const [ra, rb] = await Promise.all([hireOn(ctx, A, hA), hireOn(ctx, B, hB)]);
  const tSaved = Date.now();
  const cSeen = await ctx.waitUntil(async () => (await rowShown(C, hA.name)) && (await rowShown(C, hB.name)), 5000);
  R.expect(3, cSeen !== null, cSeen === null ? "C did not show both new people within 5 s" : `C showed both new people ${(cSeen / 1000).toFixed(1)} s after the saves`);
  const la = ra ? (await ctx.sql("select payload from entities where kind = 'logins' and payload->>'personId' = $1 and deleted_at is null", [ra.id]))[0] : null;
  const lb = rb ? (await ctx.sql("select payload from entities where kind = 'logins' and payload->>'personId' = $1 and deleted_at is null", [rb.id]))[0] : null;
  // Each hire shows on the other hirer's screen too.
  await openPeople(ctx, A, "List"); await search(A, `Hire${tag}`);
  await openPeople(ctx, B, "List"); await search(B, `Hire${tag}`);
  const abOk = (await ctx.waitUntil(async () => (await rowShown(A, hB.name)) && (await rowShown(B, hA.name)), 5000)) !== null;
  const fieldsOk = ra?.payload?.email === hA.email && ra?.payload?.employeeCode === hA.code && rb?.payload?.email === hB.email && rb?.payload?.employeeCode === hB.code;
  R.expect(1, !!ra && !!rb && fieldsOk && abOk, `DB: A's hire ${!!ra} (${ra?.id}), B's hire ${!!rb} (${rb?.id}), email/ID stored ${fieldsOk}, logins rows ${!!la}/${!!lb}; A sees B's and B sees A's ${abOk}`);

  // Check 2: A and B edit different fields of A's new person at the same time.
  const loc = `Hloc ${tag}`;
  const join = "2026-08-17";
  await Promise.all([openFile(ctx, A, hA.name), openFile(ctx, B, hA.name), openFile(ctx, C, hA.name)]);
  await Promise.all([
    (async () => { await startEdit(A); await setField(A, "Location", loc); await saveEdit(A); })(),
    (async () => { await startEdit(B); await setField(B, "Join date", join); await saveEdit(B); })(),
  ]);
  const t2 = Date.now();
  const shows = async (p) => (await detail(p, "Location")) === loc && /17\/08\/2026|2026-08-17|17 Aug/.test((await detail(p, "Join date")) || "");
  const c2 = await ctx.waitUntil(() => shows(C), 5000);
  const tC2 = c2 === null ? null : Date.now() - t2;
  await ctx.settled(A); await ctx.settled(B);
  const pa = await payloadOf(ctx, ra?.id);
  const ab2 = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, pa.location === loc && pa.joinDate === join && ab2, `DB location ${JSON.stringify(pa.location)}, joinDate ${JSON.stringify(pa.joinDate)}; A and B files show both ${ab2}; C's file ${c2 === null ? "did not show both within 5 s" : `showed both ${(tC2 / 1000).toFixed(1)} s after the saves`}`);
  if (c2 === null) R.fail(3, `C's open file of ${hA.name} did not show A's Location and B's Join date within 5 s (Location "${await detail(C, "Location")}", Join date "${await detail(C, "Join date")}")`);

  // Check 4: A trashes B's hire; B (feed held) still has it open, edits and saves.
  await openFile(ctx, B, hB.name);
  await ctx.holdFeed(B, peopleRe(rb.id));
  await trashPerson(ctx, A, hB.name);
  const del1 = await waitDb(ctx, async () => (await personById(ctx, rb.id))?.deleted_at);
  const bStill = (await B.locator("main").getByText(hB.name, { exact: true }).count()) > 0;
  let err4 = "";
  try { await startEdit(B); await setField(B, "Location", `STALE ${tag}`); await saveEdit(B); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await personById(ctx, rb.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], hB.name); listed.push(await rowShown(ctx[t], hB.name) ? 1 : 0); }
  const again = await personById(ctx, rb.id);
  R.expect(4, !!del1 && bStill && !!after?.deleted_at && !!again?.deleted_at && after?.payload?.location !== `STALE ${tag}` && listed.every((n) => n === 0),
    `A's delete in DB ${!!del1}; B still saw it ${bStill}; after B's stale ${err4 ? `edit (${err4})` : "edit + Save"} still deleted ${!!after?.deleted_at}, stale Location kept out ${after?.payload?.location !== `STALE ${tag}`}; after reload deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);

  // Check 5: everyone reloaded; A's hire's file agrees with the DB.
  const want = await payloadOf(ctx, ra.id);
  const got = [];
  for (const t of ["A", "B", "C"]) {
    await openFile(ctx, ctx[t], hA.name);
    got.push({ loc: await detail(ctx[t], "Location"), email: await detail(ctx[t], "Email"), id: await detail(ctx[t], "Employee ID") });
  }
  const ok5 = got.every((g) => g.loc === want.location && g.email === want.email && g.id === want.employeeCode);
  R.expect(5, ok5, `DB ${JSON.stringify({ loc: want.location, email: want.email, id: want.employeeCode })}; A/B/C ${got.map((g) => JSON.stringify(g)).join(" / ")}`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [hA.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Edit a person: every section of the person file's Edit form + Core role
// ---------------------------------------------------------------------------
export async function peopleEdit(ctx, run) {
  const R = new ScreenResult("Org", "people-edit", "Person file → Edit (names, role, org, contact, dates, employment, access, pay) + Core role");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const X = newPerson(run, "Eda", `Edit${tag}`);
  const Y = newPerson(run, "Ebo", `Edit${tag}`);
  const rx = await hireOn(ctx, A, X);
  const ry = await hireOn(ctx, A, Y);
  await ctx.settled(A);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "a person file", (p) => openFile(ctx, p, X.name));

  // Check 2 + 3: same person, different sections, at the same time; C idle on the file.
  const vA = { Location: `Eloc ${tag}`, Employment: "contract", "Fixed CTC (annual)": "480000", "Date of birth": "1991-03-04" };
  const vB = { "Join date": "2026-07-01", Access: "manager", "Work email": `eda.b.${tag}@e2e.test`.toLowerCase(), "Employee ID": X.code.replace(/^ALN(\d)/, (m, d) => `ALN${(Number(d) + 1) % 10}`) };
  await Promise.all([
    (async () => { await startEdit(A); for (const [k, v] of Object.entries(vA)) await setField(A, k, v); await saveEdit(A); })(),
    (async () => { await startEdit(B); for (const [k, v] of Object.entries(vB)) await setField(B, k, v); await saveEdit(B); })(),
  ]);
  const t2 = Date.now();
  const shows = async (p) => (await detail(p, "Location")) === vA.Location && (await detail(p, "Email")) === vB["Work email"] && (await detail(p, "Employee ID")) === vB["Employee ID"] && /manager/i.test((await detail(p, "Access")) || "") && /contract/i.test((await detail(p, "Employment")) || "");
  const c2 = await ctx.waitUntil(() => shows(C), 5000);
  const tC2 = c2 === null ? null : Date.now() - t2;
  await ctx.settled(A); await ctx.settled(B);
  const px = await payloadOf(ctx, rx.id);
  const dbA = px.location === vA.Location && px.employmentType === "contract" && Number(px.salary) === 480000 && px.dob === vA["Date of birth"];
  const dbB = px.joinDate === vB["Join date"] && px.access === "manager" && px.email === vB["Work email"] && px.employeeCode === vB["Employee ID"];
  const abOk = (await ctx.waitUntil(() => shows(A), 5000)) !== null && (await ctx.waitUntil(() => shows(B), 5000)) !== null;
  R.expect(2, dbA && dbB && abOk, `DB A's fields (location, employment, salary, dob) ${dbA} ${JSON.stringify({ l: px.location, e: px.employmentType, s: px.salary, d: px.dob })}; B's fields (joinDate, access, email, employeeCode) ${dbB} ${JSON.stringify({ j: px.joinDate, a: px.access, m: px.email, c: px.employeeCode })}; A and B files show both ${abOk}`);
  R.expect(3, c2 !== null, c2 === null ? `C's open file did not show both within 5 s (Location "${await detail(C, "Location")}", Email "${await detail(C, "Email")}", Access "${await detail(C, "Access")}")` : `C showed A's and B's fields ${(tC2 / 1000).toFixed(1)} s after the saves`);

  // Check 1: different people at the same time. A: X's first-card Core role +
  // rewards slabs; B: Y's names-free fields + Function picker.
  await openFile(ctx, B, Y.name);
  const role = "Trainee Artist";
  await Promise.all([
    (async () => {
      await startEdit(A);
      await setField(A, "Mobile", X.phone.replace(/^9/, "8"));
      for (const [i, v] of [[1, 1000], [2, 2000], [3, 3000], [4, 4000], [5, 5000]]) await setField(A, `M${i}`, v);
      await saveEdit(A);
      const sel = A.locator("main select").filter({ has: A.locator("option", { hasText: /^No role$/ }) }).first();
      await sel.selectOption({ label: role });
    })(),
    (async () => {
      await startEdit(B);
      await setField(B, "Location", `Eyloc ${tag}`);
      await setField(B, "Employment", "intern");
      await saveEdit(B);
    })(),
  ]);
  await ctx.settled(A); await ctx.settled(B);
  const px1 = await waitDb(ctx, async () => { const x = await payloadOf(ctx, rx.id); return x.roleId ? x : null; }, 10000) || (await payloadOf(ctx, rx.id));
  const py1 = await payloadOf(ctx, ry.id);
  const slabs = px1.rewardsSlabs || {};
  const xOk = px1.phone === X.phone.replace(/^9/, "8") && slabs.M1 === 1000 && slabs.M5 === 5000 && !!px1.roleId && px1.location === vA.Location && px1.email === vB["Work email"];
  const yOk = py1.location === `Eyloc ${tag}` && py1.employmentType === "intern";
  R.expect(1, xOk && yOk, `X: phone ${px1.phone === X.phone.replace(/^9/, "8")}, Core role (picked ~0.6 s after the form Save) in the DB within 10 s ${!!px1.roleId} (${px1.title}), earlier A+B fields kept ${px1.location === vA.Location && px1.email === vB["Work email"]}, M1–M5 ${slabs.M1 === 1000 && slabs.M5 === 5000} ${JSON.stringify(slabs)}; Y: location+employment ${yOk}`);

  // Check 4: A trashes Y; B (feed held) still has Y's form, edits and saves.
  await openFile(ctx, B, Y.name);
  await ctx.holdFeed(B, peopleRe(ry.id));
  await trashPerson(ctx, A, Y.name);
  const del1 = await waitDb(ctx, async () => (await personById(ctx, ry.id))?.deleted_at);
  const bStill = (await B.locator("main").getByText(Y.name, { exact: true }).count()) > 0;
  let err4 = "";
  try { await startEdit(B); await setField(B, "Location", `STALE ${tag}`); await setField(B, "Status", "paused"); await saveEdit(B); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await personById(ctx, ry.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], Y.name); listed.push(await rowShown(ctx[t], Y.name) ? 1 : 0); }
  const again = await personById(ctx, ry.id);
  R.expect(4, !!del1 && bStill && !!after?.deleted_at && !!again?.deleted_at && after?.payload?.location !== `STALE ${tag}` && listed.every((n) => n === 0),
    `A's delete in DB ${!!del1}; B still saw it ${bStill}; after B's stale ${err4 ? `edit (${err4})` : "edit + Save"} still deleted ${!!after?.deleted_at}, stale Location kept out ${after?.payload?.location !== `STALE ${tag}`}; after reload deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);

  // Check 5: reload; X's file on all three agrees with the DB.
  const w = await payloadOf(ctx, rx.id);
  const got = [];
  for (const t of ["A", "B", "C"]) {
    await openFile(ctx, ctx[t], X.name);
    got.push({ loc: await detail(ctx[t], "Location"), email: await detail(ctx[t], "Email"), id: await detail(ctx[t], "Employee ID"), access: await detail(ctx[t], "Access") });
  }
  const ok5 = got.every((g) => g.loc === w.location && g.email === w.email && g.id === w.employeeCode && g.access === w.access);
  R.expect(5, ok5, `DB ${JSON.stringify({ loc: w.location, email: w.email, id: w.employeeCode, access: w.access })}; A/B/C ${got.map((g) => JSON.stringify(g)).join(" / ")}`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [X.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Reporting managers: primary + dotted line (edit form picker, row dialog), MR
// ---------------------------------------------------------------------------
export async function peopleManagers(ctx, run) {
  const R = new ScreenResult("Org", "people-managers", "Reports to (primary + dotted line), row Reports-to dialog, MR marks");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const X = newPerson(run, "Mia", `Mgr${tag}`);
  const Y = newPerson(run, "Mob", `Mgr${tag}`);
  const Z = newPerson(run, "Mzo", `Mgr${tag}`);
  const rx = await hireOn(ctx, A, X);
  const ry = await hireOn(ctx, A, Y);
  const rz = await hireOn(ctx, A, Z);
  await ctx.settled(A);
  await waitQuiet(ctx);
  const ids = async (n) => (await personByName(ctx, n))?.id;
  const m1 = await ids(MGR1.name);
  const m2 = await ids(MGR2.name);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));

  // Setup: X reports to MGR1 (primary), set once through the edit form.
  await openFile(ctx, A, X.name);
  await startEdit(A);
  await pickerToggle(A, "Reports to", MGR1.name);
  await ctx.settled(A);
  await waitQuiet(ctx, 2000);

  // Check 2 + 3: same person, different fields at the same time: A adds a
  // dotted-line manager (MGR2) to X, B edits X's Location. C idle on List
  // (search) must show MR on X.
  await openPeople(ctx, C, "List");
  await search(C, `Mgr${tag}`);
  const mrBefore = await rowHasMR(C, X.name);
  await openFile(ctx, B, X.name);
  await startEdit(B);
  const t0 = Date.now();
  await Promise.all([
    pickerToggle(A, "Reports to", MGR2.name),
    (async () => { await setField(B, "Location", `Mloc ${tag}`); await saveEdit(B); })(),
  ]);
  const tSaved = Date.now();
  const cMR = await ctx.waitUntil(() => rowHasMR(C, X.name), 5000);
  const tC = cMR === null ? null : Date.now() - tSaved;
  await ctx.settled(A); await ctx.settled(B);
  const px = await payloadOf(ctx, rx.id);
  const nm = (id) => (id === m1 ? MGR1.name : id === m2 ? MGR2.name : id);
  const dotted = (px.dottedLine || []).map((d) => d.managerId);
  const rowText = await treeRow(C, X.name).innerText().catch(() => "");
  R.expect(2, px.managerId === m1 && dotted.includes(m2) && px.location === `Mloc ${tag}`, `DB managerId ${nm(px.managerId)}, dotted ${JSON.stringify(dotted.map(nm))}, location ${JSON.stringify(px.location)}; A's picker "${await pickerValue(A, "Reports to")}"`);
  R.expect(3, !mrBefore && tC !== null, tC === null ? `C's List did not show MR on ${X.name} within 5 s (row: ${rowText.replace(/\n/g, " | ")})` : `C showed MR on ${X.name} ${(tC / 1000).toFixed(1)} s after the saves (${((Date.now() - t0) / 1000).toFixed(1)} s after the clicks); row: ${rowText.replace(/\n/g, " | ")}`);

  // Check 1: different people at the same time. A: Y reports to MGR2 (edit
  // form); B: row "Reports to" dialog on MGR1, ticks Z.
  await openFile(ctx, A, Y.name);
  await startEdit(A);
  await Promise.all([
    pickerToggle(A, "Reports to", MGR2.name),
    reportsToDialog(ctx, B, MGR1.name, [Z.name]),
  ]);
  await ctx.settled(A); await ctx.settled(B);
  const py = await payloadOf(ctx, ry.id);
  const pz = await payloadOf(ctx, rz.id);
  const yOk = py.managerId === m2;
  const zOk = pz.managerId === m1 || (pz.dottedLine || []).some((d) => d.managerId === m1);
  await openPeople(ctx, C, "List"); await search(C, `Mgr${tag}`);
  const noMR = !(await rowHasMR(C, Y.name)) && !(await rowHasMR(C, Z.name));
  R.expect(1, yOk && zOk && noMR, `Y reports to ${MGR2.name} ${yOk}; Z reports to ${MGR1.name} (row dialog) ${zOk} (managerId ${pz.managerId}); single-manager rows Y/Z have no MR on C ${noMR}`);

  // Check 4: A trashes Z; B (feed held) adds a dotted-line manager to Z.
  await openFile(ctx, B, Z.name);
  await startEdit(B);
  await ctx.holdFeed(B, peopleRe(rz.id));
  await trashPerson(ctx, A, Z.name);
  const del1 = await waitDb(ctx, async () => (await personById(ctx, rz.id))?.deleted_at);
  const bStill = (await B.locator("main").getByText(Z.name, { exact: true }).count()) > 0;
  let err4 = "";
  try { await pickerToggle(B, "Reports to", MGR2.name); await saveEdit(B); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await personById(ctx, rz.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], Z.name); listed.push(await rowShown(ctx[t], Z.name) ? 1 : 0); }
  const again = await personById(ctx, rz.id);
  R.expect(4, !!del1 && bStill && !!after?.deleted_at && !!again?.deleted_at && listed.every((n) => n === 0),
    `A's delete in DB ${!!del1}; B still saw it ${bStill}; after B's stale ${err4 ? `edit (${err4})` : "dotted-line tick"} still deleted ${!!after?.deleted_at}; after reload deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);

  // Check 5: reloaded; MR on exactly the people the DB says report to > 1 manager.
  const multi = async (id) => { const q = await payloadOf(ctx, id); return [q.managerId, ...(q.dottedLine || []).map((d) => d.managerId)].filter(Boolean).length > 1; };
  const want = { X: await multi(rx.id), Y: await multi(ry.id) };
  const got = [];
  for (const t of ["A", "B", "C"]) {
    await openPeople(ctx, ctx[t], "List"); await search(ctx[t], `Mgr${tag}`);
    got.push({ X: await rowHasMR(ctx[t], X.name), Y: await rowHasMR(ctx[t], Y.name) });
  }
  R.expect(5, got.every((g) => g.X === want.X && g.Y === want.Y) && want.X && !want.Y, `DB multi-manager X ${want.X}, Y ${want.Y}; MR on A/B/C ${got.map((g) => JSON.stringify(g)).join(" / ")}`);

  // Removing the dotted line takes MR away on C live (note only).
  await openFile(ctx, A, X.name); await startEdit(A);
  await openPeople(ctx, C, "List"); await search(C, `Mgr${tag}`);
  const hadMR = await rowHasMR(C, X.name);
  await pickerToggle(A, "Reports to", MGR2.name);
  const gone = await ctx.waitUntil(async () => !(await rowHasMR(C, X.name)), 5000);
  R.note(`untick the dotted-line manager → C's MR (shown before: ${hadMR}) ${gone === null ? "still shown after 5 s" : `gone in ${(gone / 1000).toFixed(1)} s`}`);
  if (hadMR && gone === null) R.fail(3, `after A removed ${X.name}'s dotted-line manager, C still showed MR after 5 s`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [X.name, Y.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Status Active / Paused / Exited
// ---------------------------------------------------------------------------

export async function peopleStatus(ctx, run) {
  const R = new ScreenResult("Org", "people-status", "Person status Active / Paused / Exited (edit form) and the People status filter");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const X = newPerson(run, "Sal", `Stat${tag}`);
  const Y = newPerson(run, "Sbo", `Stat${tag}`);
  const Z = newPerson(run, "Sze", `Stat${tag}`);
  const rx = await hireOn(ctx, A, X);
  const ry = await hireOn(ctx, A, Y);
  const rz = await hireOn(ctx, A, Z);
  await ctx.settled(A);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));

  // C idle: List, status filter Active, search.
  await statusFilter(C, "Active");
  await search(C, `Stat${tag}`);
  const cStart = (await rowShown(C, X.name)) && (await rowShown(C, Y.name));

  // Check 1: A pauses X, B exits Y, at the same time.
  await Promise.all([openFile(ctx, A, X.name), openFile(ctx, B, Y.name)]);
  await Promise.all([
    (async () => { await startEdit(A); await setField(A, "Status", "paused"); await saveEdit(A); })(),
    (async () => { await startEdit(B); await setField(B, "Status", "left"); await saveEdit(B); })(),
  ]);
  const tSaved = Date.now();
  const cGone = await ctx.waitUntil(async () => !(await rowShown(C, X.name)) && !(await rowShown(C, Y.name)), 5000);
  await ctx.settled(A); await ctx.settled(B);
  const px = await payloadOf(ctx, rx.id);
  const py = await payloadOf(ctx, ry.id);
  R.expect(1, px.status === "paused" && py.status === "left", `DB X status ${px.status}, Y status ${py.status}`);
  R.expect(3, cStart && cGone !== null, !cStart ? "C's Active list did not show X and Y before the change" : cGone === null ? "C's Active list still showed X or Y 5 s after they were paused / exited" : `C's Active list dropped both ${(cGone / 1000).toFixed(1)} s after the saves`);

  // Check 2: same person (Z): A sets Paused while B sets Location.
  await Promise.all([openFile(ctx, A, Z.name), openFile(ctx, B, Z.name), openFile(ctx, C, Z.name)]);
  await Promise.all([
    (async () => { await startEdit(A); await setField(A, "Status", "paused"); await saveEdit(A); })(),
    (async () => { await startEdit(B); await setField(B, "Location", `Sloc ${tag}`); await saveEdit(B); })(),
  ]);
  const t2 = Date.now();
  const c2 = await ctx.waitUntil(async () => /paused/i.test((await detail(C, "Status")) || "") && (await detail(C, "Location")) === `Sloc ${tag}`, 5000);
  const tC2 = c2 === null ? null : Date.now() - t2;
  await ctx.settled(A); await ctx.settled(B);
  const pz = await payloadOf(ctx, rz.id);
  R.expect(2, pz.status === "paused" && pz.location === `Sloc ${tag}`, `DB Z status ${pz.status}, location ${JSON.stringify(pz.location)}; C's file ${c2 === null ? `did not show both within 5 s (Status "${await detail(C, "Status")}", Location "${await detail(C, "Location")}")` : `showed both ${(tC2 / 1000).toFixed(1)} s after the saves`}`);
  if (c2 === null) R.fail(3, `C's open file of ${Z.name} did not show A's status and B's location within 5 s`);

  // Check 4: A trashes Y; B (feed held, Y's file open) sets it Active again.
  await openFile(ctx, B, Y.name);
  await ctx.holdFeed(B, peopleRe(ry.id));
  await trashPerson(ctx, A, Y.name);
  const del1 = await waitDb(ctx, async () => (await personById(ctx, ry.id))?.deleted_at);
  const bStill = (await B.locator("main").getByText(Y.name, { exact: true }).count()) > 0;
  let err4 = "";
  try { await startEdit(B); await setField(B, "Status", "active"); await saveEdit(B); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await personById(ctx, ry.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await statusFilter(ctx[t], "All"); await search(ctx[t], Y.name); listed.push(await rowShown(ctx[t], Y.name) ? 1 : 0); }
  const again = await personById(ctx, ry.id);
  R.expect(4, !!del1 && bStill && !!after?.deleted_at && !!again?.deleted_at && after?.payload?.status !== "active" && listed.every((n) => n === 0),
    `A's delete in DB ${!!del1}; B still saw it ${bStill}; after B's stale ${err4 ? `edit (${err4})` : "Status → Active + Save"} still deleted ${!!after?.deleted_at}, status ${after?.payload?.status}; after reload deleted ${!!again?.deleted_at}, listed A/B/C (All states) ${listed.join("/")}`);

  // Check 5: reloaded; the Paused filter lists exactly the DB's paused people.
  const dbPaused = (await ctx.sql("select payload->>'name' n from people where deleted_at is null and payload->>'status' = 'paused' and payload->>'name' ilike $1", [`%Stat${tag}%`])).map((r) => r.n).sort();
  const got = {};
  for (const t of ["A", "B", "C"]) {
    await openPeople(ctx, ctx[t], "List"); await statusFilter(ctx[t], "Paused"); await search(ctx[t], `Stat${tag}`);
    got[t] = [];
    for (const n of [X.name, Z.name]) if (await rowShown(ctx[t], n)) got[t].push(n);
    got[t].sort();
    await statusFilter(ctx[t], "Active");
  }
  R.expect(5, ["A", "B", "C"].every((t) => JSON.stringify(got[t]) === JSON.stringify(dbPaused)) && dbPaused.length === 2, `DB paused ${JSON.stringify(dbPaused)}; Paused filter on A/B/C ${["A", "B", "C"].map((t) => JSON.stringify(got[t])).join(" / ")}`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [X.name, Z.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Move to trash, Settings → Trash → Restore / Delete forever
// ---------------------------------------------------------------------------
export async function peopleTrashRestore(ctx, run) {
  const R = new ScreenResult("Org", "people-trash-restore", "People → Delete (move to trash) · Settings → Trash → Restore / Delete forever");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const X = newPerson(run, "Tia", `Trash${tag}`);
  const Y = newPerson(run, "Tob", `Trash${tag}`);
  const rx = await hireOn(ctx, A, X);
  const ry = await hireOn(ctx, A, Y);
  await ctx.settled(A);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));

  // Check 1 + 3: A trashes X while B trashes Y; C idle on List searching.
  await search(C, `Trash${tag}`);
  const cStart = (await rowShown(C, X.name)) && (await rowShown(C, Y.name));
  await Promise.all([trashPerson(ctx, A, X.name), trashPerson(ctx, B, Y.name)]);
  const tSaved = Date.now();
  const cGone = await ctx.waitUntil(async () => !(await rowShown(C, X.name)) && !(await rowShown(C, Y.name)), 5000);
  await ctx.settled(A); await ctx.settled(B);
  const dx = await personById(ctx, rx.id);
  const dy = await personById(ctx, ry.id);
  const tr = await ctx.sql("select id, payload->>'label' l, deleted_at from entities where kind = 'trash' and payload->>'label' = any($1)", [[X.name, Y.name]]);
  R.expect(1, !!dx?.deleted_at && !!dy?.deleted_at && tr.filter((t) => !t.deleted_at).length === 2, `DB X deleted ${!!dx?.deleted_at}, Y deleted ${!!dy?.deleted_at}; trash entries ${tr.filter((t) => !t.deleted_at).map((t) => t.l).join(", ")}`);
  R.expect(3, cStart && cGone !== null, cGone === null ? "C still listed X or Y 5 s after they were trashed" : `C's list dropped both ${(cGone / 1000).toFixed(1)} s after the deletes`);

  // Restore: A restores X; C (List) must show X again within 5 s; DB live again.
  await openPeople(ctx, C, "List"); await search(C, `Trash${tag}`);
  await restoreFromTrash(ctx, A, X.name);
  const tR = Date.now();
  const cBack = await ctx.waitUntil(() => rowShown(C, X.name), 5000);
  const tBack = cBack === null ? null : Date.now() - tR;
  await ctx.settled(A);
  await ctx.sleep(3000);
  const rx2 = await personById(ctx, rx.id);
  const trX = (await ctx.sql("select deleted_at from entities where kind = 'trash' and payload->>'label' = $1", [X.name]))[0];
  const tombs = await ctx.sql("select key, deleted_at from tombstones where field = 'people' and key in ($1, $2)", [rx.id, `id:${rx.id}`]);
  const restoreOk = !rx2?.deleted_at && !!trX?.deleted_at;
  if (!restoreOk) R.fail(5, `Restore: people row ${rx.id} deleted_at ${rx2?.deleted_at ? new Date(rx2.deleted_at).toISOString() : "null"} after Restore (trash entry removed ${!!trX?.deleted_at}; live person tombstones ${tombs.filter((t) => !t.deleted_at).map((t) => t.key).join(", ") || "none"})`);
  R.note(`Restore: C ${cBack === null ? "did not show X within 5 s" : `showed X again ${(tBack / 1000).toFixed(1)} s after Restore`}; DB live ${!rx2?.deleted_at}`);
  if (cBack === null) R.fail(3, `C did not list ${X.name} again within 5 s of A's Restore`);

  R.na(2, "a trashed person has no fields to edit; the trash row's only actions are Restore / Delete forever (one action per record)");

  // Check 4: A deletes Y forever; B (feed held, Trash open, still sees Y) restores Y.
  await openTrash(ctx, B);
  await ctx.holdFeed(B, /\/api\/(org\?kind=trash|e\/trash)/);
  await openTrash(ctx, A);
  const bSees = (await trashRow(B, Y.name).count()) > 0;
  await trashRow(A, Y.name).getByRole("button", { name: "Delete forever" }).click();
  await A.waitForTimeout(600);
  const dlg = A.locator("div.fixed.inset-0").last();
  if (await dlg.count()) { const b = dlg.getByRole("button", { name: /Delete|forever/i }).last(); if (await b.count()) await b.click(); }
  await ctx.settled(A);
  await ctx.sleep(1500);
  const trY1 = (await ctx.sql("select deleted_at from entities where kind = 'trash' and payload->>'label' = $1", [Y.name]))[0];
  let err4 = "";
  try { await trashRow(B, Y.name).getByRole("button", { name: "Restore" }).click({ timeout: 4000 }); await B.waitForTimeout(800); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const yAfter = await personById(ctx, ry.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], Y.name); listed.push(await rowShown(ctx[t], Y.name) ? 1 : 0); }
  const inTrash = [];
  for (const t of ["A", "B", "C"]) { await openTrash(ctx, ctx[t]); inTrash.push((await trashRow(ctx[t], Y.name).count()) ? 1 : 0); }
  const yAgain = await personById(ctx, ry.id);
  R.expect(4, !!trY1?.deleted_at && bSees && !!yAfter?.deleted_at && !!yAgain?.deleted_at && listed.every((n) => !n) && inTrash.every((n) => !n),
    `A's Delete forever removed the trash entry ${!!trY1?.deleted_at}; B still saw it ${bSees}; after B's stale Restore${err4 ? ` (${err4})` : ""} person still deleted ${!!yAfter?.deleted_at}; after reload deleted ${!!yAgain?.deleted_at}, listed A/B/C ${listed.join("/")}, in Trash A/B/C ${inTrash.join("/")}`);

  // Check 5: after reload, X (restored) is listed exactly when the DB has it live.
  const xDb = await personById(ctx, rx.id);
  const got = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], X.name); got.push(await rowShown(ctx[t], X.name)); }
  R.note(`after reload: DB X live ${!xDb?.deleted_at}; listed on A/B/C ${got.join("/")}`);
  R.expect(5, got.every((g) => g === !xDb?.deleted_at) && !xDb?.deleted_at, `DB X live ${!xDb?.deleted_at}; listed on A/B/C ${got.join("/")} (a restored person must be live in the DB and listed everywhere)`);
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [X.name]);
  return R;
}

// ---------------------------------------------------------------------------
// Mass update (Update / Delete for ticked people)
// ---------------------------------------------------------------------------
export async function peopleMassUpdate(ctx, run) {
  const R = new ScreenResult("Org", "people-mass-update", "People → Mass update (Update fields / Delete for ticked people)");
  watchWrites(ctx);
  await waitQuiet(ctx);
  const { A, B, C } = ctx;
  const tag = tagOf(run);
  const X = newPerson(run, "Mua", `Mass${tag}`);
  const Y = newPerson(run, "Mub", `Mass${tag}`);
  const Z = newPerson(run, "Muz", `Mass${tag}`);
  const rx = await hireOn(ctx, A, X);
  const ry = await hireOn(ctx, A, Y);
  const rz = await hireOn(ctx, A, Z);
  await ctx.settled(A);
  await waitQuiet(ctx);
  const m0 = await openWithoutWrites(ctx, R, "People (List)", (p) => openPeople(ctx, p, "List"));

  // Check 1: A updates X, B updates Y, at the same time.
  await Promise.all([massSelect(ctx, A, [X.name]), massSelect(ctx, B, [Y.name])]);
  await Promise.all([massApply(A, { Location: `MA ${tag}` }), massApply(B, { Location: `MB ${tag}` })]);
  await ctx.settled(A); await ctx.settled(B);
  const px = await payloadOf(ctx, rx.id);
  const py = await payloadOf(ctx, ry.id);
  R.expect(1, px.location === `MA ${tag}` && py.location === `MB ${tag}`, `DB X location ${JSON.stringify(px.location)}, Y location ${JSON.stringify(py.location)}`);

  // Check 2 + 3: A sets Location on X+Y, B sets Employment on X+Y; C has X's file open.
  await openFile(ctx, C, X.name);
  await Promise.all([massSelect(ctx, A, [X.name, Y.name]), massSelect(ctx, B, [X.name, Y.name])]);
  await Promise.all([massApply(A, { Location: `MAB ${tag}` }), massApply(B, { Employment: "contract" })]);
  const t2 = Date.now();
  const c2 = await ctx.waitUntil(async () => (await detail(C, "Location")) === `MAB ${tag}` && /contract/i.test((await detail(C, "Employment")) || ""), 5000);
  const tC2 = c2 === null ? null : Date.now() - t2;
  await ctx.settled(A); await ctx.settled(B);
  const px2 = await payloadOf(ctx, rx.id);
  const py2 = await payloadOf(ctx, ry.id);
  R.expect(2, [px2, py2].every((q) => q.location === `MAB ${tag}` && q.employmentType === "contract"), `DB X ${JSON.stringify({ l: px2.location, e: px2.employmentType })}, Y ${JSON.stringify({ l: py2.location, e: py2.employmentType })}`);
  R.expect(3, c2 !== null, c2 === null ? `C's open file of X did not show both within 5 s (Location "${await detail(C, "Location")}", Employment "${await detail(C, "Employment")}")` : `C's file showed A's Location and B's Employment ${(tC2 / 1000).toFixed(1)} s after the saves`);

  // Check 4: A mass-deletes Z; B (feed held, Z ticked) mass-updates Z.
  await massSelect(ctx, B, [Z.name]);
  await ctx.holdFeed(B, peopleRe(rz.id));
  await massSelect(ctx, A, [Z.name]);
  await A.locator("main").getByRole("button", { name: "Delete", exact: true }).click();
  await A.waitForTimeout(600);
  const dd = A.locator("div.fixed.inset-0").last();
  if (await dd.count()) { const b = dd.getByRole("button", { name: /^Delete/ }).last(); if (await b.count()) await b.click(); }
  const del1 = await waitDb(ctx, async () => (await personById(ctx, rz.id))?.deleted_at);
  const bStill = await rowShown(B, Z.name);
  let err4 = "";
  try { await massApply(B, { Location: `STALE ${tag}` }); } catch (e) { err4 = String(e).slice(0, 80); }
  await ctx.sleep(3000);
  await ctx.releaseFeed(B);
  await ctx.sleep(3000);
  const after = await personById(ctx, rz.id);
  await ctx.reloadAll();
  const listed = [];
  for (const t of ["A", "B", "C"]) { await openPeople(ctx, ctx[t], "List"); await search(ctx[t], Z.name); listed.push(await rowShown(ctx[t], Z.name) ? 1 : 0); }
  const again = await personById(ctx, rz.id);
  R.expect(4, !!del1 && bStill && !!after?.deleted_at && !!again?.deleted_at && after?.payload?.location !== `STALE ${tag}` && listed.every((n) => !n),
    `A's mass Delete in DB ${!!del1}; B still saw Z ${bStill}; after B's stale mass Update${err4 ? ` (${err4})` : ""} still deleted ${!!after?.deleted_at}, stale Location kept out ${after?.payload?.location !== `STALE ${tag}`}; after reload deleted ${!!again?.deleted_at}, listed A/B/C ${listed.join("/")}`);

  // Check 5: reloaded; X's file agrees with the DB everywhere.
  const w = await payloadOf(ctx, rx.id);
  const got = [];
  for (const t of ["A", "B", "C"]) { await openFile(ctx, ctx[t], X.name); got.push({ l: await detail(ctx[t], "Location"), e: await detail(ctx[t], "Employment") }); }
  R.expect(5, got.every((g) => g.l === w.location && new RegExp(w.employmentType === "contract" ? "contract" : "x^", "i").test(g.e || "")), `DB ${JSON.stringify({ l: w.location, e: w.employmentType })}; A/B/C ${got.map((g) => JSON.stringify(g)).join(" / ")}`);
  // Leave mass-update mode on A/B.
  for (const p of [A, B]) { const d = p.locator("main").getByRole("button", { name: "Done", exact: true }); if (await d.count()) await d.click().catch(() => {}); }
  await endChecks(ctx, R, m0);
  await cleanup(ctx, [X.name, Y.name]);
  return R;
}

/** Every page / tab / dialog / button in Org → People that saves data. */
export const SCREENS = [
  { module: "Org", screen: "People — List / My team / Company / SBU / Function / Summary views", saves: "nothing (view choice in sessionStorage)", scenario: "people-views", reached: true, why: "" },
  { module: "Org", screen: "People — filter grid (brand, SBU, function, role, status, plan state, sort) + search + Hide filters", saves: "nothing (sessionStorage apms-ui-people-list-v1)", scenario: "people-views", reached: true, why: "" },
  { module: "Org", screen: "People → Add person dialog (Create person)", saves: "people row + logins entity (+ company book PATCH)", scenario: "people-hire", reached: true, why: "" },
  { module: "Org", screen: "People row → + Add person under this", saves: "people row with managerId preset", scenario: null, reached: false, why: "same Add person dialog/handler as the header button (Gs with defaultManagerId); the hire path is covered by people-hire" },
  { module: "Org", screen: "Person file → Edit form: first/last name, work email, employee ID, date of birth, mobile, location, join date, employment, access, fixed CTC, rewards annual + Compute, M1–M5", saves: "people row (PATCH /api/people/:id)", scenario: "people-edit", reached: true, why: "" },
  { module: "Org", screen: "Person file → Edit form: Role / Brand / SBU / Function pickers", saves: "people row (immediate PATCH on pick)", scenario: "people-edit", reached: true, why: "Core role (card select) covered; Brand/SBU/Function pickers change the org placement the same way (updatePerson) — not separately driven" },
  { module: "Org", screen: "Person file → Core role select (details card)", saves: "people roleId/title", scenario: "people-edit", reached: true, why: "" },
  { module: "Org", screen: "Person file → Edit form: Reports to (primary + dotted line)", saves: "people managerId + dottedLine (immediate)", scenario: "people-managers", reached: true, why: "" },
  { module: "Org", screen: "Person file → Edit form: Direct reportees", saves: "other people's managerId / dottedLine", scenario: "people-managers", reached: true, why: "exercised through the equivalent row Reports-to dialog (same setReportee path)" },
  { module: "Org", screen: "People row → Reports to dialog (tick reportees)", saves: "reportees' managerId / dottedLine", scenario: "people-managers", reached: true, why: "" },
  { module: "Org", screen: "People list MR marks / manager chips", saves: "nothing (derived from managerId + dottedLine)", scenario: "people-managers", reached: true, why: "" },
  { module: "Org", screen: "Person file → Edit form: Status Active / Paused / Exited", saves: "people status (left = Exited)", scenario: "people-status", reached: true, why: "" },
  { module: "Org", screen: "People row → Delete (move to trash)", saves: "people deleted_at + trash entity + tombstone", scenario: "people-trash-restore", reached: true, why: "" },
  { module: "Settings", screen: "Settings → Trash → Restore (person)", saves: "people row live again, trash entity removed", scenario: "people-trash-restore", reached: true, why: "" },
  { module: "Settings", screen: "Settings → Trash → Delete forever (person)", saves: "trash entity removed", scenario: "people-trash-restore", reached: true, why: "" },
  { module: "Settings", screen: "Settings → Trash → Empty trash", saves: "all trash entities removed", scenario: null, reached: false, why: "destructive for every other scenario's trash rows in a shared run; same per-row write as Delete forever" },
  { module: "Org", screen: "People → Mass update → Update dialog (role, function, extra function, brand/SBU, reporting manager, access, gate access, inherit APMS, employment, status, location, join date, CTC + rewards)", saves: "people rows (one PATCH per ticked person)", scenario: "people-mass-update", reached: true, why: "location / employment driven; the other fields go through the same apply path" },
  { module: "Org", screen: "People → Mass update → Delete", saves: "people deleted_at + trash", scenario: "people-mass-update", reached: true, why: "" },
  { module: "Org", screen: "People → Import (bulk people sheet)", saves: "people rows in bulk", scenario: null, reached: false, why: "needs a filled xlsx template upload; not driven in this pass" },
  { module: "Org", screen: "People reporting tree drag / nest (also listed under Org)", saves: "managerId / sortKey", scenario: "org-chart-drag", reached: true, why: "" },
  { module: "Org", screen: "Person file → Change role (role-change case)", saves: "roleCases entity", scenario: null, reached: false, why: "multi-step promotion/transfer workflow (case, approvals); not driven in this pass" },
  { module: "Org", screen: "Person file → Edit KROC", saves: "role (KROC) entity", scenario: null, reached: false, why: "edits the job role, not the person — belongs to Org → Roles" },
  { module: "Org", screen: "Person file → Add review (quarterly review)", saves: "quarter review", scenario: null, reached: false, why: "covered by APMS apmsQuarterReview (screens-apms-eo.mjs)" },
  { module: "Org", screen: "Person file → APMS / Rewards Add existing / Create new", saves: "month-records / reward-records", scenario: null, reached: false, why: "covered by the APMS / Rewards month scenarios" },
];

export const SCENARIOS = [
  ["peopleViews", peopleViews],
  ["peopleHire", peopleHire],
  ["peopleEdit", peopleEdit],
  ["peopleManagers", peopleManagers],
  ["peopleStatus", peopleStatus],
  ["peopleMassUpdate", peopleMassUpdate],
  ["peopleTrashRestore", peopleTrashRestore],
];
