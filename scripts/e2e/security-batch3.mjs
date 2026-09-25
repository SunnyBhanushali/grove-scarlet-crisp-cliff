#!/usr/bin/env node
/**
 * BATCH-3 security suite against the BUILT server (HTTP, no browser).
 *
 *   PORT=3015 DB=aliens_apms_sec OUTPUT=.output sh scripts/e2e/fresh-server.sh
 *   BASE_URL=http://127.0.0.1:3015 DATABASE_URL=postgres://…/aliens_apms_sec PORT=3015 OUTPUT=.output \
 *     node scripts/e2e/security-batch3.mjs
 *
 * Runs with the real sign-in limits (5 / username, 30 / IP per 15 min). It
 * restarts the server itself (scripts/e2e/restart-server.sh) for the
 * one-time password conversion, the lock surviving a restart and the
 * APMS_DEFAULT_PIN switch; PORT / OUTPUT / DATABASE_URL must match the server.
 *
 * Sections (every check is one line in the JSON report):
 *   P  permissions per route and per access role — reads (wire, ?books=, legacy
 *      LOAD, people list / row, APMS + Rewards lists / rows, /api/e kinds,
 *      /api/changes with and without payload, tick hints, /api/org, backups)
 *      and writes (hot rows, every /api/e kind, /api/org, book PATCH tombstones,
 *      restore / backups / snapshot POST, login writes, /api/login-locks);
 *      403 shape { error: "forbidden", kind, field }.
 *   F  hidden fields kept on a restricted user's write, also through a 409.
 *   L  lock-out: 5 wrong → locked 15 min (right password refused too), message,
 *      admin unlock, survives a restart; 30 wrong / IP.
 *   H  hashing: no plain text at rest; one-time conversion with a backup
 *      table (idempotent: second boot converts 0); nothing secret on any read.
 *   S  sessions: admin reset ends all of the person's sessions; own change ends
 *      the other sessions and keeps the current one.
 *   D  APMS_DEFAULT_PIN on / off.
 *   X  every route × forged tokens → 401 (incl. the new /api/login-locks);
 *      the company dumps that used to be public are gone.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { pwEq } from "./lib/harness.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3015";
const OUT = process.env.OUT || "e2e-security-batch3.json";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PORT = process.env.PORT || new URL(BASE).port;
const OUTPUT = process.env.OUTPUT || ".output";
const MONTH = "2026-09";
const LOAD = "5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5";
const SAVE = "b4b4aa7e0ac816b4d5b83f44cd4fa14cbee181632dfc30d951bda1da6d06ecdb";
const BACKUP = "60f853214adae026db975d19017ab9139db7a66a375e06ff5dd7163c493826df";
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const q = async (text, params = []) => (await pool.query(text, params)).rows;

const USERS = {
  A: ["sunny.b", "0000"], // super admin
  E: ["nikhil.pati", "Nikhil-e2e-1"], // employee (own scope)
  M: ["sarvjeet.sand", "Sarv-e2e-1"], // manager (team scope)
  F: ["ravi.kuma", "Ravi-e2e-1"], // function head (function scope, no pay / personal)
  H: ["", "Hr-e2e-1"], // an employee made HR by the admin below (company scope, pay)
};

const results = [];
function check(group, name, ok, detail = "") {
  results.push({ group, name, ok: !!ok, detail: String(detail).slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"} [${group}] ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
}

let ipSeq = 1;
/** Every call gets its own client IP (X-Forwarded-For) unless one is given, so the per-IP limit only counts where a check wants it. */
async function call(method, path, { token, cookie, body, ip, raw } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip || `10.9.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = `better-auth.session_token=${encodeURIComponent(cookie)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal, redirect: "manual" });
    const stream = (res.headers.get("content-type") || "").includes("event-stream");
    const text = stream ? "" : await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text: raw ? text : text.slice(0, 400), headers: res.headers };
  } catch (err) {
    return { status: 0, json: null, text: String(err), headers: new Headers() };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
async function signIn([username, password], ip) {
  const r = await call("POST", "/api/auth/sign-in/username", { body: { username, password }, ip });
  return { status: r.status, token: r.headers.get("set-auth-token") || r.json?.token || "", user: r.json?.user, json: r.json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function restart(extraEnv = {}) {
  execFileSync("sh", ["scripts/e2e/restart-server.sh"], {
    env: { ...process.env, PORT, OUTPUT, DATABASE_URL, LOG: process.env.SERVER_LOG || "/tmp/apms-sec-server.log", ...extraEnv },
    stdio: "ignore",
  });
  // Up = the API answers (the page can answer before the API routes are ready).
  for (let i = 0; i < 120; i++) {
    const r = await call("GET", "/api/auth/get-session");
    if (r.status === 200) return;
    await sleep(250);
  }
  throw new Error("server did not come back after restart");
}
function serverLog() {
  try {
    return execFileSync("cat", [process.env.SERVER_LOG || "/tmp/apms-sec-server.log"]).toString();
  } catch {
    return "";
  }
}

const wireOf = async (t) => {
  const r = await call("GET", "/api/company", { token: t, raw: true });
  return r.json?.snapshotJson ? JSON.parse(r.json.snapshotJson) : null;
};
const countRecs = (tree) => Object.values(tree || {}).reduce((n, m) => n + Object.keys(m || {}).length, 0);
const recPeople = (tree) => new Set(Object.values(tree || {}).flatMap((m) => Object.keys(m || {})));
const hasKey = (obj, key) => JSON.stringify(obj).includes(`"${key}":`);

async function main() {
  // ------------------------------------------------------------------ setup
  const A = await signIn(USERS.A);
  check("setup", "admin signs in", A.status === 200, A.status);
  // Hot tables are imported by the first read.
  await call("GET", "/api/company", { token: A.token });
  const people = await q("select id, payload from people where deleted_at is null");
  const byUser = new Map(people.map((r) => [String(r.payload.username || ""), r]));
  const idOf = (u) => byUser.get(u)?.id;
  // HR: an active employee with a login is made HR by the admin.
  const hrRow = people.find((r) => r.payload.access === "employee" && r.payload.status === "active" && r.payload.username && !["nikhil.pati"].includes(r.payload.username) && !r.payload.managerId?.startsWith("p-1788346069555"));
  USERS.H[0] = hrRow.payload.username;
  const setHr = await call("PATCH", `/api/people/${hrRow.id}`, {
    token: A.token,
    body: { payload: { ...hrRow.payload, access: "hr", accessRoleId: "hr" }, baseRev: (await q("select rev from people where id=$1", [hrRow.id]))[0].rev },
  });
  check("setup", `admin makes ${USERS.H[0]} HR`, setHr.status === 200, setHr.status);
  const issue = await call("POST", "/api/issued-logins", {
    token: A.token,
    body: { rows: [["E"], ["M"], ["F"], ["H"]].map(([k]) => ({ username: USERS[k][0], password: USERS[k][1], personId: idOf(USERS[k][0]) })) },
  });
  check("setup", "admin issues logins for E / M / F / H", issue.status === 200, issue.status);
  const T = {};
  for (const k of ["E", "M", "F", "H"]) {
    const s = await signIn(USERS[k]);
    T[k] = s.token;
    check("setup", `${k} (${USERS[k][0]}) signs in`, s.status === 200, s.status);
  }
  T.A = A.token;
  const ID = { A: "p-admin", E: idOf(USERS.E[0]), M: idOf(USERS.M[0]), F: idOf(USERS.F[0]), H: hrRow.id };

  // Team of the manager and reports of the function head, from the DB.
  const reportsOf = new Map();
  for (const r of people) {
    const mgrs = new Set([r.payload.managerId, ...(r.payload.dottedLine || []).map((d) => d.managerId), ...(r.payload.functionSeats || []).map((s) => s.managerId)].filter(Boolean));
    for (const m of mgrs) reportsOf.set(m, [...(reportsOf.get(m) || []), r.id]);
  }
  const teamOf = (id) => {
    const out = new Set([id]);
    const qd = [id];
    while (qd.length) for (const c of reportsOf.get(qd.shift()) || []) if (!out.has(c)) (out.add(c), qd.push(c));
    return out;
  };
  const teamM = teamOf(ID.M);
  const teamF = teamOf(ID.F);

  // ------------------------------------------------------------- P: reads
  const adminWire = await wireOf(T.A);
  const allRecs = countRecs(adminWire.records);
  const allRr = countRecs(adminWire.rewardRecords);
  check("P", "admin wire: every person, every salary, every record", adminWire.people.length > 150 && adminWire.people.every((p) => "salary" in p) && allRecs > 0 && allRr > 0, `people ${adminWire.people.length}, records ${allRecs}, reward records ${allRr}`);
  check("P", "admin wire carries no password or hash", !hasKey(adminWire, "password") && !JSON.stringify(adminWire).includes("scrypt$"), "");

  for (const k of ["E", "M", "F", "H"]) {
    const w = await wireOf(T[k]);
    const sal = w.people.filter((p) => "salary" in p || "rewardsSlabs" in p || "bandMidpoint" in p).map((p) => p.id);
    const dob = w.people.filter((p) => "dob" in p || "phone" in p).map((p) => p.id);
    const recs = recPeople(w.records);
    const rrs = recPeople(w.rewardRecords);
    const noSecret = !hasKey(w, "password") && !JSON.stringify(w).includes("scrypt$");
    if (k === "H") {
      check("P", "HR (company scope + pay + personal) reads the full wire", w.people.length === adminWire.people.length && sal.length === adminWire.people.length && countRecs(w.records) === allRecs && noSecret, `salaries ${sal.length}, records ${countRecs(w.records)}/${allRecs}`);
      continue;
    }
    check("P", `${k} wire: every person listed (directory)`, w.people.length === adminWire.people.length, `${w.people.length}/${adminWire.people.length}`);
    check("P", `${k} wire: pay fields only on their own row`, sal.length === 1 && sal[0] === ID[k], `rows with pay fields: ${sal.length} (${sal.slice(0, 3).join(", ")})`);
    check("P", `${k} wire: personal fields (dob / phone) only on their own row`, dob.every((id) => id === ID[k]), `rows with dob/phone: ${dob.length}`);
    check("P", `${k} wire: no password / hash`, noSecret, "");
    const allowed = k === "E" ? new Set([ID.E]) : k === "M" ? teamM : null;
    if (allowed) {
      const out = [...recs, ...rrs].filter((id) => !allowed.has(id));
      check("P", `${k} wire: APMS / Rewards records only in scope (${k === "E" ? "own" : "team"})`, out.length === 0, `records of ${recs.size} + ${rrs.size} people; outside scope: ${out.length}`);
    } else {
      const direct = [...teamF].filter((id) => id !== ID.F);
      const seeOwnTeam = direct.filter((id) => Object.values(adminWire.records).some((m) => m[id])).every((id) => recs.has(id));
      const outsider = [...recPeople(adminWire.records)].find((id) => {
        const p = adminWire.people.find((x) => x.id === id);
        return p && !teamF.has(id) && p.functionId && p.functionId !== adminWire.people.find((x) => x.id === ID.F)?.functionId;
      });
      check("P", "F wire: team records visible, another function's records hidden", seeOwnTeam && outsider && !recs.has(outsider), `records of ${recs.size} people; outsider ${outsider} hidden ${outsider ? !recs.has(outsider) : "n/a"}`);
    }
    check("P", `${k} wire: Trash hidden`, (w.trash || []).length === 0, `trash rows ${(w.trash || []).length}`);
    check("P", `${k} wire: other people's login rows hidden`, Object.keys(w.logins || {}).every((u) => u === USERS[k][0]), Object.keys(w.logins || {}).join(","));
    check("P", `${k} wire: job-role salary bands / slabs hidden`, !Object.values(w.roles || {}).some((r) => "slabs" in r || "salaryFrom" in r || "salaryTo" in r), "");
    const books = await call("GET", "/api/company?books=org,months", { token: T[k], raw: true });
    const bo = books.json?.books || {};
    check("P", `${k} ?books=org,months filtered like the wire`, (bo.org?.people || []).filter((p) => "salary" in p).length <= 1 && [...recPeople(bo.months?.records)].every((id) => k === "F" || (allowed && allowed.has(id))), `org people w/ salary ${(bo.org?.people || []).filter((p) => "salary" in p).length}`);
    const load = await call("POST", `/_serverFn/${LOAD}`, { token: T[k], body: {}, raw: true });
    const ls = load.json?.snapshotJson ? JSON.parse(load.json.snapshotJson) : null;
    check("P", `${k} legacy LOAD server fn filtered like the wire`, ls && ls.people.filter((p) => "salary" in p).length === 1, `status ${load.status}`);
    const pl = await call("GET", "/api/people?limit=200", { token: T[k], raw: true });
    check("P", `${k} /api/people list: pay + personal only on own row`, pl.status === 200 && (pl.json.people || []).filter((p) => "salary" in p || "dob" in p).every((p) => p.id === ID[k]), `status ${pl.status}`);
    const other = await call("GET", `/api/people/${ID.A}`, { token: T[k] });
    check("P", `${k} /api/people/:id of someone else: no salary / dob / password`, other.status === 200 && !("salary" in (other.json?.payload || {})) && !("password" in (other.json?.payload || {})), `status ${other.status}`);
    const own = await call("GET", `/api/people/${ID[k]}`, { token: T[k] });
    check("P", `${k} /api/people/:id own row: own salary visible`, own.status === 200 && "salary" in (own.json?.payload || {}), `status ${own.status}`);
    // A record outside scope, by row and by month list.
    const outsidePid = [...recPeople(adminWire.records)].find((id) => !(k === "E" ? new Set([ID.E]) : k === "M" ? teamM : teamF).has(id));
    const outsidePeriod = Object.entries(adminWire.records).find(([, m]) => m[outsidePid])?.[0];
    const r1 = await call("GET", `/api/month-records/${outsidePeriod}/${outsidePid}`, { token: T[k] });
    check("P", `${k} GET /api/month-records/:period/:person outside scope → 403`, r1.status === 403 && r1.json?.error === "forbidden", `status ${r1.status} ${r1.text.slice(0, 80)}`);
    const l1 = await call("GET", `/api/month-records/${outsidePeriod}?limit=200`, { token: T[k] });
    check("P", `${k} GET /api/month-records/:period list: no row outside scope`, l1.status === 200 && !(l1.json.records || []).some((r) => r.personId === outsidePid), `rows ${(l1.json.records || []).length}`);
    const rrOut = [...recPeople(adminWire.rewardRecords)].find((id) => !(k === "E" ? new Set([ID.E]) : k === "M" ? teamM : teamF).has(id));
    const rrPeriod = Object.entries(adminWire.rewardRecords).find(([, m]) => m[rrOut])?.[0];
    const r2 = await call("GET", `/api/reward-records/${rrPeriod}/${rrOut}`, { token: T[k] });
    check("P", `${k} GET /api/reward-records/:period/:person outside scope → 403`, r2.status === 403, `status ${r2.status}`);
    const l2 = await call("GET", `/api/reward-records/${rrPeriod}?limit=200`, { token: T[k] });
    check("P", `${k} GET /api/reward-records/:period list: no row outside scope`, l2.status === 200 && !(l2.json.records || []).some((r) => r.personId === rrOut), `rows ${(l2.json.records || []).length}`);
    for (const kind of ["trash", "custom-reports", "logins"]) {
      const r = await call("GET", `/api/e/${kind}`, { token: T[k] });
      const rows = r.json?.rows || [];
      const ok = kind === "logins" ? rows.every((x) => String(x.k1) === USERS[k][0]) : rows.length === 0;
      check("P", `${k} GET /api/e/${kind}: ${kind === "logins" ? "own row only" : "no rows"}`, r.status === 200 && ok && !hasKey(rows, "password"), `rows ${rows.length}`);
    }
    const trashRow = (adminWire.trash || [])[0];
    if (trashRow) {
      const r = await call("GET", `/api/e/trash/${encodeURIComponent(trashRow.id)}`, { token: T[k] });
      check("P", `${k} GET /api/e/trash/:id → 403`, r.status === 403, `status ${r.status}`);
    }
    const roles = await call("GET", "/api/org?kind=roles", { token: T[k] });
    check("P", `${k} GET /api/org?kind=roles: no salary bands`, roles.status === 200 && !/"(slabs|salaryFrom|salaryTo)":/.test(roles.text + JSON.stringify(roles.json)), `status ${roles.status}`);
    const roleId = Object.keys(adminWire.roles || {})[0];
    const one = await call("GET", `/api/org/roles/${roleId}`, { token: T[k] });
    check("P", `${k} GET /api/org/roles/:id: no salary bands`, one.status === 200 && !("slabs" in (one.json?.payload || {})), `status ${one.status}`);
    const tr = await call("GET", "/api/org?kind=trash", { token: T[k] });
    check("P", `${k} GET /api/org?kind=trash → 403`, tr.status === 403, `status ${tr.status}`);
    for (const [m, u, b] of [["GET", "/api/company-backups"], ["POST", "/api/company-backups", { action: "save" }], ["POST", "/api/company-restore", {}], ["POST", "/api/company", { restore: true, snapshot: {} }], ["POST", `/_serverFn/${SAVE}`, { data: "{}" }], ["POST", `/_serverFn/${BACKUP}`, {}], ["GET", "/api/login-locks"], ["POST", "/api/login-locks", { username: "x" }]]) {
      const r = await call(m, u, { token: T[k], body: b });
      check("P", `${k} ${m} ${u.replace(/(_serverFn\/\w{8})\w+/, "$1…")} → 403`, r.status === 403 && r.json?.error === "forbidden", `status ${r.status}`);
    }
  }
  // HR keeps admin-only surfaces admin-only (backups / restore).
  const hrB = await call("GET", "/api/company-backups", { token: T.H });
  check("P", "HR GET /api/company-backups → 403 (admin only, unchanged)", hrB.status === 403, hrB.status);

  // Change feed + hints: the admin edits a record outside E's scope and a salary.
  const feedHead = Number((await call("GET", "/api/changes?head=1", { token: T.E })).json?.seq || 0);
  const tickAt = Date.now() - 1;
  const outRec = (await q("select person_id, period, payload, rev from reward_records where deleted_at is null and person_id <> $1 limit 1", [ID.E]))[0];
  const pr = await call("PATCH", `/api/reward-records/${outRec.period}/${outRec.person_id}`, { token: T.A, body: { payload: { ...outRec.payload, notes: `feed-${Date.now()}` }, baseRev: outRec.rev } });
  const vic = (await q("select id, payload, rev from people where id = $1", [ID.M]))[0];
  const ps = await call("PATCH", `/api/people/${vic.id}`, { token: T.A, body: { payload: { ...vic.payload, salary: 654321 }, baseRev: vic.rev } });
  check("P", "admin edits a reward record and a salary (setup)", pr.status === 200 && ps.status === 200, `${pr.status} / ${ps.status}`);
  await sleep(700);
  for (const [k, withPayload] of [["E", true], ["E", false], ["A", true]]) {
    const ch = await call("GET", `/api/changes?since=${feedHead}${withPayload ? "&payload=1" : ""}&limit=500`, { token: T[k], raw: true });
    const rows = ch.json?.changes || [];
    const rr = rows.find((c) => c.kind === "reward-records" && c.k1 === outRec.person_id);
    const pm = rows.find((c) => c.kind === "people" && c.k1 === vic.id);
    if (k === "A") check("P", "admin feed has the reward row and the salary", rr && (!withPayload || pm?.payload?.salary === 654321), `${rows.length} rows`);
    else check("P", `E /api/changes${withPayload ? "?payload=1" : ""}: reward row outside scope dropped, salary not carried`, !rr && (!withPayload || (pm && !("salary" in (pm.payload || {})))) && ch.json?.seq >= feedHead, `${rows.length} rows; cursor ${ch.json?.seq}`);
  }
  const tickE = await call("GET", `/api/company-tick?since=${tickAt}`, { token: T.E });
  const tickA = await call("GET", `/api/company-tick?since=${tickAt}`, { token: T.A });
  const hintOf = (t) => (t.json?.entities || []).some((h) => /reward/.test(h.type) && h.id === outRec.person_id);
  check("P", "tick hints: admin gets the reward-record hint, E does not", hintOf(tickA) && !hintOf(tickE), `admin ${(tickA.json?.entities || []).length}, E ${(tickE.json?.entities || []).length}`);

  // ------------------------------------------------------------ P: writes
  const pRow = async (id) => (await q("select payload, rev from people where id = $1", [id]))[0];
  const patchPerson = (k, id, row, extra) => call("PATCH", `/api/people/${id}`, { token: T[k], body: { payload: { ...row.payload, ...extra }, baseRev: row.rev } });
  const forb = (r, field) => r.status === 403 && r.json?.error === "forbidden" && (!field || r.json?.field === field);
  let me = await pRow(ID.E);
  let r = await patchPerson("E", ID.E, me, { location: "should-fail" });
  check("P", "E PATCH own row, field outside the Me page (location) → 403 field location", forb(r, "location"), `${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
  me = await pRow(ID.E);
  r = await patchPerson("E", ID.E, me, { phone: "9000000123", firstName: "Nikhil" });
  check("P", "E PATCH own row, Me fields (mobile, name) → 200", r.status === 200, r.status);
  me = await pRow(ID.E);
  r = await patchPerson("E", ID.E, me, { salary: 999999 });
  check("P", "E PATCH own salary → 403 field salary", forb(r, "salary"), `${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
  r = await patchPerson("E", ID.E, me, { access: "super_admin", accessRoleId: "super_admin" });
  check("P", "E PATCH own access role → 403", r.status === 403, r.status);
  const other = await pRow(ID.F);
  r = await patchPerson("E", ID.F, other, { title: "hacked" });
  check("P", "E PATCH someone else's row → 403 (kind people)", forb(r) && r.json?.kind === "people", `${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
  r = await call("PATCH", `/api/people/p-sec-${Date.now()}`, { token: T.E, body: { payload: { name: "Ghost" }, baseRev: 0 } });
  check("P", "E create a person → 403", forb(r), r.status);
  r = await call("PATCH", `/api/people/${ID.F}`, { token: T.E, body: { payload: {}, baseRev: other.rev, deleted: true } });
  check("P", "E delete a person → 403", forb(r), r.status);
  r = await call("PATCH", `/api/people/${ID.F}`, { token: T.M, body: { payload: { ...other.payload, title: "m" }, baseRev: other.rev } });
  check("P", "M (People view only) edits a person → 403", forb(r), r.status);

  // APMS / Rewards rows.
  const eRec = (await q("select person_id, period, payload, rev from month_records where deleted_at is null and person_id = $1 limit 1", [ID.E]))[0];
  r = await call("PATCH", `/api/month-records/${MONTH}/${ID.E}`, { token: T.E, body: { payload: { status: "plan_open", kras: [] }, baseRev: 0 } });
  check("P", "E create own APMS plan → 403", forb(r), `${r.status}`);
  const outM = (await q("select person_id, period, payload, rev from month_records where deleted_at is null and person_id <> $1 limit 1", [ID.E]))[0];
  r = await call("PATCH", `/api/month-records/${outM.period}/${outM.person_id}`, { token: T.E, body: { payload: { ...outM.payload, notes: "x" }, baseRev: outM.rev } });
  check("P", "E edit someone else's APMS plan → 403", forb(r), r.status);
  if (eRec) {
    r = await call("PATCH", `/api/month-records/${eRec.period}/${ID.E}`, { token: T.E, body: { payload: { ...eRec.payload, selfNotes: "my note" }, baseRev: eRec.rev } });
    check("P", "E own plan: Self comments → 200", r.status === 200, r.status);
  }
  const mTeam = [...teamM].find((id) => id !== ID.M);
  const mRr = (await q("select period, payload, rev from reward_records where deleted_at is null and person_id = $1 limit 1", [mTeam]))[0];
  if (mRr) {
    r = await call("PATCH", `/api/reward-records/${mRr.period}/${mTeam}`, { token: T.M, body: { payload: { ...mRr.payload, notes: "manager note" }, baseRev: mRr.rev } });
    check("P", "M edits a team member's reward plan → 200", r.status === 200, r.status);
    const cur = (await q("select rev, payload from reward_records where person_id=$1 and period=$2", [mTeam, mRr.period]))[0];
    r = await call("PATCH", `/api/reward-records/${mRr.period}/${mTeam}`, { token: T.M, body: { payload: {}, baseRev: cur.rev, deleted: true } });
    check("P", "M deletes a team member's reward plan (no delete grant) → 403", forb(r), r.status);
  }
  const rrOutM = (await q("select person_id, period, payload, rev from reward_records where deleted_at is null and not (person_id = any($1::text[])) limit 1", [[...teamM]]))[0];
  r = await call("PATCH", `/api/reward-records/${rrOutM.period}/${rrOutM.person_id}`, { token: T.M, body: { payload: { ...rrOutM.payload, notes: "x" }, baseRev: rrOutM.rev } });
  check("P", "M edits a reward plan outside the team → 403", forb(r), r.status);
  const cell = (await q("select id, payload, rev from target_cells where deleted_at is null limit 1"))[0];
  r = await call("PATCH", `/api/target-cells/${encodeURIComponent(cell.id)}`, { token: T.E, body: { payload: { ...cell.payload, actual: 1 }, baseRev: cell.rev } });
  check("P", "E edits a target cell → 403", forb(r), r.status);
  r = await call("PATCH", `/api/target-cells/${encodeURIComponent(cell.id)}`, { token: T.M, body: { payload: { ...cell.payload, actual: 1 }, baseRev: cell.rev } });
  check("P", "M (no Targets grant) edits a target cell → 403", forb(r), r.status);

  // Every /api/e kind: E refused where the grant is missing; admin allowed.
  const kinds = {
    companies: 1, brands: 1, sbus: 1, "sbu-members": 1, functions: 1, "sub-functions": 1, roles: 1, "role-krocs": 1, "access-roles": 1,
    "custom-reports": 1, "report-folders": 1, "values-catalog": 1, "kpi-master": 1, "apms-plans": 1, "apms-months": 1, "role-months": 1,
    "period-reviews": 1, "award-instances": 1, "award-measures": 1, "award-prizes": 1, "gate-units": 1, "gate-months": 1, "reward-role-months": 1,
    "ags-months": 1, "ags-reviews": 1, "sbu-targets": 1, "target-history": 1, "target-nodes": 1, "target-members": 1, "target-month-status": 1,
    "target-root-order": 1, trash: 0, notices: 0, "app-requests": 0, "role-cases": 0,
  };
  const map2 = new Set(["role-months", "reward-role-months", "ags-months", "gate-months"]);
  const eRefused = [];
  const eAllowed = [];
  const aBad = [];
  for (const [kind, refused] of Object.entries(kinds)) {
    const id = `sec-${kind}-${Date.now().toString(36)}`;
    const path = map2.has(kind) ? `/api/e/${kind}/${id}/2026-09` : `/api/e/${kind}/${id}`;
    const payload = kind === "sbu-members" ? { groupId: id, memberId: "m" } : kind === "target-members" ? { groupId: id, memberId: "m", month: "2026-09" } : kind === "apms-months" ? { planId: id, month: "2026-09" } : { id, name: "sec" };
    const e = await call("PATCH", path, { token: T.E, body: { payload, baseRev: 0 } });
    if (refused) (forb(e) && e.json?.kind === kind ? eRefused : aBad).push(`${kind}:${e.status}`);
    else if (kind === "trash") (e.status === 200 ? eAllowed : aBad).push(`${kind}:${e.status}`);
    else (e.status === 200 ? eAllowed : aBad).push(`${kind}:${e.status}`);
    // Admin: create, then delete again.
    const a = await call("PATCH", path, { token: T.A, body: { payload, baseRev: refused || kind === "trash" ? 0 : (e.json?.rev ?? 0) } });
    const rev = a.json?.rev ?? e.json?.rev;
    const d = await call("PATCH", path, { token: T.A, body: { payload: {}, baseRev: rev, deleted: true } });
    if (a.status !== 200 && a.status !== 409) aBad.push(`admin ${kind}:${a.status}`);
    if (d.status !== 200 && d.status !== 409) aBad.push(`admin delete ${kind}:${d.status}`);
  }
  check("P", `E PATCH /api/e/<kind> refused (403 kind) on every granted kind (${eRefused.length})`, eRefused.length === Object.values(kinds).filter(Boolean).length, eRefused.join(" "));
  check("P", "E may file notices / app requests / role cases / a trash row (open kinds)", eAllowed.length === 4, eAllowed.join(" "));
  check("P", "no unexpected status on /api/e writes (E and admin)", aBad.length === 0, aBad.join(" "));
  const sett = await call("PATCH", "/api/e/settings/companyFactor", { token: T.E, body: { payload: { value: 9 }, baseRev: 1 } });
  check("P", "E PATCH settings/companyFactor → 403 (field companyFactor)", forb(sett, "companyFactor"), sett.status);
  const org = await call("PATCH", `/api/org/functions/sec-fn-${Date.now()}`, { token: T.E, body: { payload: { name: "x" }, baseRev: 0 } });
  check("P", "E PATCH /api/org/functions/:id → 403", forb(org), org.status);
  const orgF = await call("PATCH", `/api/org/functions/sec-fn-${Date.now()}`, { token: T.F, body: { payload: { name: "x" }, baseRev: 0 } });
  check("P", "F (Functions: edit, no create) creates a function via /api/org → 403", forb(orgF), orgF.status);

  // Book PATCH tombstones: a restricted user cannot wipe a month or a person.
  const recsBefore = Number((await q("select count(*) n from month_records where deleted_at is null and period = $1", [MONTH]))[0].n);
  const tomb = await call("PATCH", "/api/company", { token: T.E, body: { books: { org: { tombstones: { people: { [ID.F]: Date.now() } } } }, baseGens: {}, tombstones: { records: { [MONTH]: Date.now() }, people: { [ID.F]: Date.now() } } } });
  const recsAfter = Number((await q("select count(*) n from month_records where deleted_at is null and period = $1", [MONTH]))[0].n);
  const fAlive = (await q("select deleted_at from people where id = $1", [ID.F]))[0].deleted_at === null;
  check("P", "E book PATCH with tombstones (a whole APMS month, a person) deletes nothing", recsAfter === recsBefore && fAlive, `PATCH ${tomb.status}; ${MONTH} records ${recsBefore} → ${recsAfter}; person alive ${fAlive}`);
  check("P", "book PATCH conflict reply carries no password / hash / hidden salary", !/"password"|scrypt\$/.test(tomb.text) && !(tomb.json?.books?.org?.people || []).some((p) => p.id !== ID.E && "salary" in p), `status ${tomb.status}`);

  // Login writes.
  const iw = await call("POST", "/api/issued-logins", { token: T.E, body: { rows: [{ username: USERS.A[0], password: "Hacked-1234", personId: ID.A }] } });
  check("P", "E POST /api/issued-logins for someone else → 403", iw.status === 403, iw.status);
  const pw = await call("POST", "/api/provision-logins", { token: T.M, body: { rows: [{ username: USERS.E[0], password: "Hacked-1234" }] } });
  check("P", "M POST /api/provision-logins → 403", pw.status === 403, pw.status);

  // ---------------------------------------------- F: hidden fields preserved
  const fTarget = [...teamF].find((id) => id !== ID.F && (people.find((p) => p.id === id)?.payload.salary || 0) > 0);
  const salaryBefore = (await pRow(fTarget)).payload.salary;
  const fView = await call("GET", `/api/people/${fTarget}`, { token: T.F });
  check("F", "F reads a function member without salary / dob", fView.status === 200 && !("salary" in fView.json.payload), fView.status);
  r = await call("PATCH", `/api/people/${fTarget}`, { token: T.F, body: { payload: { ...fView.json.payload, location: "F-edit", salary: 0, rewardsSlabs: { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 } }, baseRev: fView.json.rev } });
  let after = await pRow(fTarget);
  check("F", "F saves the member (form sends salary 0 / slabs 0): salary and slabs kept", r.status === 200 && after.payload.salary === salaryBefore && after.payload.location === "F-edit" && JSON.stringify(after.payload.rewardsSlabs) !== JSON.stringify({ M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 }), `${r.status}; salary ${salaryBefore} → ${after.payload.salary}`);
  r = await call("PATCH", `/api/people/${fTarget}`, { token: T.F, body: { payload: { ...fView.json.payload, salary: 123 }, baseRev: after.rev } });
  check("F", "F sets a real salary value → 403 field salary", forb(r, "salary"), `${r.status} ${JSON.stringify(r.json)?.slice(0, 100)}`);
  // 409 path: A changes the salary while F's copy is stale; F's merge keeps A's value.
  const stale = await call("GET", `/api/people/${fTarget}`, { token: T.F });
  after = await pRow(fTarget);
  const aSet = await call("PATCH", `/api/people/${fTarget}`, { token: T.A, body: { payload: { ...after.payload, salary: 777777 }, baseRev: after.rev } });
  const f409 = await call("PATCH", `/api/people/${fTarget}`, { token: T.F, body: { payload: { ...stale.json.payload, location: "F-stale" }, baseRev: stale.json.rev } });
  check("F", "F's stale save → 409; the 409 row carries no salary", f409.status === 409 && !("salary" in (f409.json?.payload || {})), `${aSet.status} / ${f409.status}`);
  // What the client's merge3 does: theirs (server row, filtered) + my field.
  const merged = { ...f409.json.payload, location: "F-merged" };
  const f2 = await call("PATCH", `/api/people/${fTarget}`, { token: T.F, body: { payload: merged, baseRev: f409.json.rev } });
  after = await pRow(fTarget);
  check("F", "F's merged retry → 200; A's salary 777777 stands", f2.status === 200 && after.payload.salary === 777777 && after.payload.location === "F-merged", `${f2.status}; salary ${after.payload.salary}`);

  // ------------------------------------------------------------ L: lock-out
  const LIP = "10.77.0.1";
  const target = USERS.M;
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push((await signIn([target[0], "wrong-" + i], LIP)).status);
  const locked = await signIn(target, LIP);
  check("L", "5 wrong passwords → the 5th reply is 429 LOCKED", tries.slice(0, 4).every((s) => s === 401) && tries[4] === 429, tries.join(","));
  check("L", "while locked the right password is refused (429) with a clear message", locked.status === 429 && /locked/i.test(locked.json?.message || ""), `${locked.status} ${locked.json?.message}`);
  const otherIp = await signIn(target, "10.77.0.2");
  check("L", "the lock is per username (another IP is refused too)", otherIp.status === 429, otherIp.status);
  const dbLock = await q("select key, locked_until from apms_signin_failures where key = $1", [`u:${target[0]}`]);
  check("L", "lock stored in the database", dbLock[0] && new Date(dbLock[0].locked_until) > new Date(Date.now() + 14 * 60000), JSON.stringify(dbLock[0] || {}));
  await restart();
  const afterRestart = await signIn(target, "10.77.0.3");
  check("L", "lock survives a server restart", afterRestart.status === 429, afterRestart.status);
  T.A = (await signIn(USERS.A)).token;
  const list = await call("GET", "/api/login-locks", { token: T.A });
  check("L", "admin sees the locked username", (list.json?.locks || []).some((l) => l.username === target[0]), JSON.stringify(list.json?.locks || []).slice(0, 200));
  const un = await call("POST", "/api/login-locks", { token: T.A, body: { username: target[0] } });
  const back = await signIn(target, "10.77.0.4");
  check("L", "admin unlock → the right password works at once", un.status === 200 && un.json?.unlocked && back.status === 200, `${un.status} / ${back.status}`);
  T.M = back.token;
  const IIP = "10.88.0.1";
  const ipTries = [];
  for (let i = 0; i < 30; i++) ipTries.push((await signIn([`nobody-${i}`, "x"], IIP)).status);
  const ipLocked = await signIn(USERS.E, IIP);
  check("L", "30 wrong tries from one IP → that IP is locked (even a right password)", ipTries.slice(0, 29).every((s) => s === 401) && ipTries[29] === 429 && ipLocked.status === 429 && /network/i.test(ipLocked.json?.message || ""), `${ipTries.filter((s) => s === 401).length}×401 then ${ipTries[29]}; right password ${ipLocked.status}`);
  const ipOther = await signIn(USERS.E, "10.88.0.2");
  check("L", "another IP still signs in", ipOther.status === 200, ipOther.status);

  // --------------------------------------------------------- H: hashing
  const plainRows = [
    ...(await q("select 'issued_logins' src, username ref from issued_logins where password not like 'scrypt$%'")),
    ...(await q("select 'people' src, id ref from people where coalesce(payload->>'password','') not in ('') and payload->>'password' not like 'scrypt$%'")),
    ...(await q("select 'entities' src, id ref from entities where coalesce(payload->>'password','') <> '' and payload->>'password' not like 'scrypt$%'")),
    ...(await q("select 'entity_log' src, seq::text ref from entity_log where coalesce(payload->>'password','') <> '' and payload->>'password' not like 'scrypt$%'")),
    ...(await q(`select 'company_books' src, book ref from company_books where snapshot_json ~ '"password":"[^s"]'`)),
  ];
  check("H", "no plain-text password anywhere (issued_logins, people, logins rows, feed, books)", plainRows.length === 0, JSON.stringify(plainRows.slice(0, 5)));
  const iss = (await q("select password from issued_logins where username = $1", [USERS.E[0]]))[0];
  check("H", "issued_logins holds an scrypt hash that verifies", iss && iss.password.startsWith("scrypt$") && pwEq(iss.password, USERS.E[1]), (iss?.password || "").slice(0, 20));
  // One-time conversion: put plain text back in (as an old database would have), restart.
  const plainUser = "vishal.kuma";
  const vp = byUser.get(plainUser);
  await q("insert into issued_logins (username, person_id, password) values ($1, $2, $3) on conflict (username) do update set password = excluded.password", [plainUser, vp.id, "Plain-e2e-1"]);
  await q(`update people set payload = payload || '{"password":"Plain-e2e-2"}' where id = $1`, [ID.H]);
  await q("drop table if exists apms_password_backup_seccheck");
  await restart();
  const log1 = serverLog();
  const conv = log1.match(/plain-text passwords converted: (\d+) \(backup table (apms_password_backup_\d+)\)/);
  const bt = conv ? conv[2] : "";
  const btRows = bt ? await q(`select source, ref, password from ${bt}`) : [];
  const btOwner = bt ? (await q("select tableowner from pg_tables where tablename = $1", [bt]))[0]?.tableowner : "";
  const btPublic = bt ? await q("select grantee from information_schema.role_table_grants where table_name = $1 and grantee = 'PUBLIC'", [bt]) : [];
  check("H", "restart converts the plain text once and logs the count", !!conv && Number(conv[1]) >= 2, conv ? conv[0] : log1.split("\n").filter((l) => /apms-passwords/.test(l)).join(" | "));
  check("H", "backup table written first, with the plain values, not granted to PUBLIC", btRows.some((r) => r.password === "Plain-e2e-1") && btPublic.length === 0, `${bt}: ${btRows.length} rows, owner ${btOwner}`);
  const convIss = (await q("select password from issued_logins where username = $1", [plainUser]))[0].password;
  check("H", "converted value is a hash and the same password still signs in", convIss.startsWith("scrypt$") && (await signIn([plainUser, "Plain-e2e-1"])).status === 200, convIss.slice(0, 16));
  await restart();
  const log2 = serverLog();
  check("H", "second boot converts 0 (idempotent)", /plain-text passwords converted: 0/.test(log2), log2.split("\n").filter((l) => /apms-passwords/.test(l)).join(" | "));
  T.A = (await signIn(USERS.A)).token;
  for (const k of ["E", "M", "F", "H"]) T[k] = (await signIn(USERS[k])).token;
  // Nothing secret on any read a client can make.
  const reads = ["/api/company", "/api/company?books=org", `/api/people/${ID.E}`, "/api/people?limit=200", "/api/e/logins", "/api/changes?since=0&payload=1&limit=2000", "/api/org?kind=trash"];
  const leaks = [];
  for (const u of reads) {
    for (const k of ["A", "E"]) {
      const x = await call("GET", u, { token: T[k], raw: true });
      if (/scrypt\$|"password":"[^"]/.test(x.text)) leaks.push(`${k} ${u}`);
    }
  }
  let bl = await call("GET", "/api/company-backups", { token: T.A });
  // The hourly backup only runs 09:00–03:59 IST; outside that window there may
  // be none yet, so save a manual one to have a download to inspect.
  if (!(bl.json?.items || []).length) {
    await call("POST", "/api/company-backups", { token: T.A, body: { action: "save", label: "security-batch3" } });
    bl = await call("GET", "/api/company-backups", { token: T.A });
  }
  const bid = (bl.json?.items || [])[0]?.id;
  if (bid) {
    const bd = await call("GET", `/api/company-backups?id=${encodeURIComponent(bid)}`, { token: T.A, raw: true });
    if (/scrypt\$|"password":"[^"]/.test(bd.text)) leaks.push("admin backup download");
  }
  check("H", "no password or hash on any read (wire, books, people, logins, feed, trash, backup download)", leaks.length === 0 && !!bid, leaks.join(", ") || `backup ${bid}`);

  // ---------------------------------------------------------- S: sessions
  const e1 = await signIn(USERS.E);
  const e2 = await signIn(USERS.E);
  const reset = "Reset-e2e-" + randomBytes(3).toString("hex");
  const rs = await call("POST", "/api/issued-logins", { token: T.A, body: { rows: [{ username: USERS.E[0], password: reset, personId: ID.E }] } });
  const t0 = Date.now();
  let gone = null;
  for (let i = 0; i < 20; i++) {
    const a = await call("GET", "/api/people?limit=1", { token: e1.token });
    const b = await call("GET", "/api/people?limit=1", { token: e2.token });
    if (a.status === 401 && b.status === 401) {
      gone = Date.now() - t0;
      break;
    }
    await sleep(250);
  }
  check("S", "admin password reset ends every session of that person (API 401 within 3 s)", rs.status === 200 && gone !== null && gone <= 3000, gone === null ? "still signed in after 5 s" : `${gone} ms`);
  const gs = await call("GET", "/api/auth/get-session", { token: e1.token });
  check("S", "get-session after the reset → null", gs.json === null, gs.text.slice(0, 60));
  const n1 = await signIn([USERS.E[0], reset]);
  const n2 = await signIn([USERS.E[0], reset]);
  const own = "Own-e2e-" + randomBytes(3).toString("hex");
  const oc = await call("POST", "/api/issued-logins", { token: n1.token, body: { rows: [{ username: USERS.E[0], password: own, personId: ID.E }] } });
  await sleep(2500);
  const keep = await call("GET", "/api/people?limit=1", { token: n1.token });
  const drop = await call("GET", "/api/people?limit=1", { token: n2.token });
  check("S", "own password change: this browser stays signed in, the other session ends", oc.status === 200 && keep.status === 200 && drop.status === 401, `own ${oc.status}; this ${keep.status}; other ${drop.status}`);
  const viaPeople = await pRow(ID.E);
  const n3 = await signIn([USERS.E[0], own]);
  const pp = await call("PATCH", `/api/people/${ID.E}`, { token: n1.token, body: { payload: { ...viaPeople.payload, password: USERS.E[1] }, baseRev: viaPeople.rev } });
  await sleep(2500);
  const k2 = await call("GET", "/api/people?limit=1", { token: n1.token });
  const d2 = await call("GET", "/api/people?limit=1", { token: n3.token });
  check("S", "own password via the person row (Me): same rule", pp.status === 200 && k2.status === 200 && d2.status === 401, `patch ${pp.status}; this ${k2.status}; other ${d2.status}`);
  await call("POST", "/api/issued-logins", { token: T.A, body: { rows: [{ username: USERS.E[0], password: USERS.E[1], personId: ID.E }] } });
  const resend = await pRow(ID.E);
  const beforeResend = await signIn(USERS.E);
  const same = await call("PATCH", `/api/people/${ID.E}`, { token: T.A, body: { payload: { ...resend.payload, password: USERS.E[1], location: "x" }, baseRev: resend.rev } });
  await sleep(2500);
  const stillIn = await call("GET", "/api/people?limit=1", { token: beforeResend.token });
  check("S", "re-sending the current password is not a change (no sign-out)", same.status === 200 && stillIn.status === 200, `${same.status} / ${stillIn.status}`);

  // ------------------------------------------------------ D: default pin
  // Someone with no password at all (no issued login, none on the row).
  const noPw = (await q(`select payload->>'username' u from people p where deleted_at is null and payload->>'status' = 'active'
      and coalesce(payload->>'password','') = '' and coalesce(payload->>'username','') <> ''
      and not exists (select 1 from issued_logins i where i.username = p.payload->>'username' or i.person_id = p.id)
      and not exists (select 1 from entities e where e.kind = 'logins' and e.k1 = p.payload->>'username' and coalesce(e.payload->>'password','') <> '')
      order by id limit 1`))[0].u;
  await restart({ APMS_DEFAULT_PIN: "on" });
  const onS = await signIn(["sunny.b", "0000"]);
  const onN = await signIn([noPw, "0000"]);
  check("D", "APMS_DEFAULT_PIN=on: sunny.b / 0000 → 200", onS.status === 200, onS.status);
  check("D", "APMS_DEFAULT_PIN=on: a person with no password + 0000 → 200", onN.status === 200, onN.status);
  await restart({ APMS_DEFAULT_PIN: "off" });
  const offS = await signIn(["sunny.b", "0000"]);
  const offN = await signIn([noPw, "0000"]);
  const offE = await signIn(USERS.E);
  check("D", "APMS_DEFAULT_PIN=off: sunny.b / 0000 → 401 DEFAULT_PIN_OFF", offS.status === 401 && offS.json?.code === "DEFAULT_PIN_OFF", `${offS.status} ${offS.json?.code}`);
  check("D", "APMS_DEFAULT_PIN=off: no-password person + 0000 → 401", offN.status === 401 && offN.json?.code === "DEFAULT_PIN_OFF", `${offN.status}`);
  check("D", "APMS_DEFAULT_PIN=off: a real password still signs in", offE.status === 200, offE.status);
  await restart({ APMS_DEFAULT_PIN: "on" });
  const backOn = await signIn(["sunny.b", "0000"]);
  check("D", "switched back on: sunny.b / 0000 → 200 (not locked out)", backOn.status === 200, backOn.status);
  T.A = backOn.token;
  await call("POST", "/api/login-locks", { token: T.A, body: { username: "sunny.b" } });
  await call("POST", "/api/login-locks", { token: T.A, body: { username: noPw } });

  // ---------------------------------------------- X: forged tokens + public
  const forged = [["no token", {}], ["random bearer", { token: "abcdefghijklmnopqrstuvwxyz" }], ["never-issued apms-s.", { token: "apms-s." + randomBytes(32).toString("base64url") }], ["hand-written apms-login.p-admin cookie", { cookie: "apms-login.p-admin" }]];
  const routes = [
    ["GET", "/api/login-locks"], ["POST", "/api/login-locks", { username: "sunny.b" }], ["GET", "/api/company"], ["GET", "/api/changes?since=0&payload=1"],
    ["GET", "/api/company-tick?since=0"], ["GET", "/api/people?limit=5"], ["GET", `/api/people/${ID.E}`], ["GET", `/api/month-records/${MONTH}?limit=5`],
    ["GET", `/api/reward-records/${MONTH}?limit=5`], ["GET", "/api/e/trash"], ["GET", "/api/org?kind=roles"], ["PATCH", "/api/company", { books: {} }],
    ["PATCH", `/api/e/notices/x`, { payload: {}, baseRev: 0 }], ["GET", "/api/company-backups"],
  ];
  for (const [label, auth] of forged) {
    const bad = [];
    for (const [m, u, b] of routes) {
      const x = await call(m, u, { ...auth, body: b });
      if (x.status !== 401) bad.push(`${m} ${u} → ${x.status}`);
    }
    check("X", `${label} → 401 on every route (incl. /api/login-locks)`, !bad.length, bad.join("; "));
  }
  for (const f of ["aliens-apms-restore-2026-09-19.json", "aliens-apms-merged-2026-09-07.json"]) {
    const x = await call("GET", `/${f}`);
    check("X", `public company dump /${f} is gone`, x.status === 404 || !/"people"/.test(x.text), `status ${x.status}`);
  }
  const uat = await q("select count(*) n from people where payload->>'username' like 'uat.%' or id like 'p-uat-%'");
  check("X", "no uat.* test accounts in the seed", Number(uat[0].n) === 0, uat[0].n);

  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"} — ${results.length - failed.length}/${results.length} — report: ${OUT}`);
  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), error: String(err.stack || err), results }, null, 1));
  process.exit(1);
});
