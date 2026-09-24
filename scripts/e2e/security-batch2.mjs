#!/usr/bin/env node
/**
 * BATCH-2 security checks against the BUILT server (HTTP only, no browser).
 *
 *   BASE_URL=http://127.0.0.1:3010 A_USER=sunny.b A_PASS=0000 \
 *   N_USER=nikhil.pati N_PASS=… node scripts/e2e/security-batch2.mjs
 *
 * N is a signed-in NON-admin (access role employee).
 *
 * (a) POST /api/issued-logins and /api/provision-logins: anonymous → 401,
 *     signed-in non-admin → 403 (issued-logins: except the caller's own row,
 *     which is how the SPA changes your own password), admin → 200.
 * (b) Every API route, every token a client could make up (no token, random
 *     bearer, hand-written `apms-login.<personId>`, `apms-preview-sunny`,
 *     a well-formed but never-issued `apms-s.…`) → 401. A token the server
 *     issued at sign-in works; after sign-out it is 401 again.
 * (c) Admin-only writes: restore / backups / legacy snapshot save, access
 *     roles, someone else's login row, raising your own access role, setting
 *     another person's password → 403 for the non-admin.
 *     Forgot password never returns a temp password and never changes a
 *     password it did not email.
 * Writes a JSON report to OUT (default e2e-security.json). Exit 1 on any fail.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const OUT = process.env.OUT || "e2e-security.json";
const A = [process.env.A_USER || "sunny.b", process.env.A_PASS || "0000"];
const N = [process.env.N_USER || "nikhil.pati", process.env.N_PASS || ""];
const RESET_USER = process.env.RESET_USER || "";
const RESET_PASS = process.env.RESET_PASS || "";
if (!N[1]) {
  console.error("N_PASS (non-admin password) is required.");
  process.exit(2);
}

const LOAD = "5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5";
const SAVE = "b4b4aa7e0ac816b4d5b83f44cd4fa14cbee181632dfc30d951bda1da6d06ecdb";
const BACKUP = "60f853214adae026db975d19017ab9139db7a66a375e06ff5dd7163c493826df";
const MONTH = "2026-09";

const results = [];
function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${group}] ${name}${detail ? " — " + detail : ""}`);
}

async function call(method, path, { token, cookie, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = `better-auth.session_token=${encodeURIComponent(cookie)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
      redirect: "manual",
    });
    // SSE never ends: the status is all we need.
    const text = (res.headers.get("content-type") || "").includes("event-stream") ? "" : await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text: text.slice(0, 300), headers: res.headers };
  } catch (err) {
    return { status: 0, json: null, text: String(err), headers: new Headers() };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

async function signIn([username, password]) {
  const r = await call("POST", "/api/auth/sign-in/username", { body: { username, password } });
  return { status: r.status, token: r.headers.get("set-auth-token") || r.json?.token || "", user: r.json?.user };
}

/** Every /api route (and the legacy server fns), one representative URL each. */
function routes(ids) {
  const p = ids.person;
  return [
    ["GET", "/api/company"],
    ["POST", "/api/company", { restore: true, snapshot: {} }],
    ["PATCH", "/api/company", { patches: {} }],
    ["GET", "/api/changes?head=1"],
    ["GET", "/api/changes?since=0&payload=1"],
    ["GET", "/api/company-tick?since=0"],
    ["GET", "/api/company-live"],
    ["GET", "/api/company-backups"],
    ["POST", "/api/company-backups", { action: "save" }],
    ["POST", "/api/company-restore", {}],
    ["GET", "/api/people?limit=5"],
    ["GET", `/api/people/${p}`],
    ["PATCH", `/api/people/${p}`, { payload: { id: p }, baseRev: 1 }],
    ["GET", `/api/month-records/${MONTH}?limit=5`],
    ["GET", `/api/month-records/${MONTH}/${p}`],
    ["PATCH", `/api/month-records/${MONTH}/${p}`, { payload: {}, baseRev: 0 }],
    ["GET", `/api/reward-records/${MONTH}?limit=5`],
    ["GET", `/api/reward-records/${MONTH}/${p}`],
    ["PATCH", `/api/reward-records/${MONTH}/${p}`, { payload: {}, baseRev: 0 }],
    ["GET", "/api/target-cells/x"],
    ["PATCH", "/api/target-cells/x", { payload: {}, baseRev: 0 }],
    ["GET", "/api/org"],
    ["GET", "/api/org?kind=functions"],
    ["GET", "/api/org?kind=trash"],
    ["GET", "/api/org/functions/x"],
    ["PATCH", "/api/org/functions/x", { payload: {}, baseRev: 0 }],
    ["GET", "/api/e/notices"],
    ["GET", "/api/e/notices/x"],
    ["PATCH", "/api/e/notices/x", { payload: {}, baseRev: 0 }],
    ["GET", "/api/e/logins"],
    ["PATCH", "/api/e/access-roles/employee", { payload: {}, baseRev: 1 }],
    ["GET", `/api/roster/${MONTH}`],
    ["PATCH", `/api/roster/${MONTH}`, {}],
    ["POST", `/api/roster/${MONTH}/lock`, {}],
    ["POST", `/api/roster/${MONTH}/unlock`, {}],
    ["POST", `/api/roster/${MONTH}/copy-from/2026-08`, {}],
    ["GET", "/api/roster-bind/rewards/x"],
    ["POST", "/api/roster-bind/rewards/x/rebind", {}],
    ["GET", "/api/issued-logins"],
    ["POST", "/api/issued-logins", { rows: [{ username: "sunny.b", password: "hacked-1234" }] }],
    ["POST", "/api/provision-logins", { rows: [{ username: "sunny.b", password: "hacked-1234" }] }],
    ["GET", `/_serverFn/${LOAD}`],
    ["POST", `/_serverFn/${SAVE}`, { data: "{}" }],
    ["POST", `/_serverFn/${BACKUP}`, {}],
  ];
}

async function main() {
  const admin = await signIn(A);
  check("setup", `admin ${A[0]} signs in`, admin.status === 200 && admin.token, `status ${admin.status}`);
  const non = await signIn(N);
  check("setup", `non-admin ${N[0]} signs in`, non.status === 200 && non.token, `status ${non.status}`);
  const nonId = non.user?.id || "";
  const adminId = admin.user?.id || "p-admin";
  const people = await call("GET", "/api/people?limit=200", { token: admin.token });
  const list = people.json?.people || people.json?.rows || [];
  const nonPerson = list.find((x) => (x.payload || x).username === N[0]);
  const nonPid = (nonPerson && (nonPerson.payload || nonPerson).id) || nonId;
  check("setup", "issued token reads /api/people", people.status === 200, `status ${people.status}, ${list.length} people`);

  // (b) tokens the server never issued.
  const forged = [
    ["no token", {}],
    ["random bearer", { token: "abcdefghijklmnopqrstuvwxyz" }],
    ["hand-written apms-login.<admin> bearer", { token: `apms-login.${adminId}` }],
    ["hand-written apms-login.p-admin cookie", { cookie: "apms-login.p-admin" }],
    ["apms-preview-sunny cookie", { cookie: "apms-preview-sunny" }],
    ["well-formed never-issued apms-s.", { token: "apms-s." + randomBytes(32).toString("base64url") }],
    ["admin token with one char changed", { token: admin.token.slice(0, -1) + (admin.token.endsWith("A") ? "B" : "A") }],
  ];
  for (const [label, auth] of forged) {
    const bad = [];
    for (const [m, u, body] of routes({ person: nonPid || "p-admin" })) {
      const r = await call(m, u, { ...auth, body });
      if (r.status !== 401) bad.push(`${m} ${u} → ${r.status}`);
    }
    check("b", `${label} → 401 on every API route`, !bad.length, bad.length ? bad.join("; ") : `${routes({ person: "x" }).length} routes`);
  }
  // The issued token is accepted everywhere (not 401).
  {
    const bad = [];
    for (const [m, u, body] of routes({ person: nonPid || "p-admin" })) {
      if (m !== "GET") continue;
      const r = await call(m, u, { token: admin.token, body });
      if (r.status === 401) bad.push(`${m} ${u} → 401`);
    }
    check("b", "issued admin token is accepted on every GET route", !bad.length, bad.join("; "));
  }

  // (a) login writes.
  const other = { username: A[0], password: "Hacked-9999", personId: adminId };
  for (const path of ["/api/issued-logins", "/api/provision-logins"]) {
    const anon = await call("POST", path, { body: { rows: [other] } });
    check("a", `${path} anonymous → 401`, anon.status === 401, `status ${anon.status}`);
    const n = await call("POST", path, { token: non.token, body: { rows: [other] } });
    check("a", `${path} non-admin (someone else's row) → 403`, n.status === 403, `status ${n.status}`);
    const n2 = await call("POST", path, { cookie: non.token, body: { rows: [other] } });
    check("a", `${path} non-admin via cookie → 403`, n2.status === 403, `status ${n2.status}`);
  }
  // The victim's password did not change.
  const still = await signIn(A);
  check("a", "admin password unchanged after the refused writes", still.status === 200, `status ${still.status}`);

  // Admin issues a login for a third person → works.
  const target = list.map((x) => x.payload || x).find((x) => x.username && x.username !== N[0] && x.username !== A[0] && x.status !== "left" && (x.accessRoleId || x.access) === "employee");
  if (target) {
    const newPass = "Issued-" + randomBytes(4).toString("hex");
    const r = await call("POST", "/api/issued-logins", { token: admin.token, body: { rows: [{ username: target.username, password: newPass, personId: target.id }] } });
    check("a", "/api/issued-logins admin → 200", r.status === 200 && r.json?.ok, `status ${r.status}`);
    const s = await signIn([target.username, newPass]);
    check("a", "the issued password signs in", s.status === 200, `status ${s.status}`);
    const newPass2 = "Prov-" + randomBytes(4).toString("hex");
    const r2 = await call("POST", "/api/provision-logins", { token: admin.token, body: { rows: [{ username: target.username, password: newPass2, personId: target.id, email: target.email, name: target.name }] } });
    check("a", "/api/provision-logins admin → 200", r2.status === 200 && r2.json?.ok !== false, `status ${r2.status}`);
    const s2 = await signIn([target.username, newPass2]);
    check("a", "the provisioned password signs in", s2.status === 200, `status ${s2.status}`);
    const s3 = await signIn([target.username, newPass]);
    check("a", "the previous password stops working", s3.status === 401, `status ${s3.status}`);
  } else {
    check("a", "admin issue for a third person", false, "no employee with a username found");
  }
  // Own row (Me → change password) still works for a non-admin.
  const own = "Own-" + randomBytes(4).toString("hex");
  const o = await call("POST", "/api/issued-logins", { token: non.token, body: { rows: [{ username: N[0], password: own, personId: nonPid }] } });
  check("a", "/api/issued-logins non-admin own row → 200", o.status === 200, `status ${o.status}`);
  const os = await signIn([N[0], own]);
  check("a", "own new password signs in", os.status === 200, `status ${os.status}`);
  const oo = await signIn(N);
  check("a", "own old password stops working", oo.status === 401, `status ${oo.status}`);
  // Put N's test password back for later runs.
  await call("POST", "/api/issued-logins", { token: admin.token, body: { rows: [{ username: N[0], password: N[1], personId: nonPid }] } });

  // (c) admin-only writes refused for the non-admin (403, not 401 / 200).
  const me = await call("GET", `/api/people/${nonPid}`, { token: non.token });
  const myRow = me.json?.payload || {};
  const myRev = me.json?.rev || 0;
  const adminOnly = [
    ["POST", "/api/company-restore", {}],
    ["GET", "/api/company-backups"],
    ["POST", "/api/company-backups", { action: "save" }],
    ["POST", "/api/company", { restore: true, snapshot: {} }],
    ["POST", `/_serverFn/${SAVE}`, { data: "{}" }],
    ["POST", `/_serverFn/${BACKUP}`, {}],
    ["PATCH", "/api/e/access-roles/employee", { payload: { id: "employee", name: "Employee", base: "super_admin" }, baseRev: 1 }],
    ["PATCH", `/api/e/logins/${A[0]}`, { payload: { personId: nonPid }, baseRev: 1 }],
    ["PATCH", `/api/people/${nonPid}`, { payload: { ...myRow, access: "super_admin", accessRoleId: "super_admin" }, baseRev: myRev }],
    ["PATCH", `/api/people/${adminId}`, { payload: { id: adminId, password: "Hacked-7777" }, baseRev: 1 }],
  ];
  for (const [m, u, body] of adminOnly) {
    const r = await call(m, u, { token: non.token, body });
    check("c", `non-admin ${m} ${u.replace(/_serverFn\/(\w{8})\w+/, "_serverFn/$1…")} → 403`, r.status === 403, `status ${r.status} ${r.text.slice(0, 80)}`);
  }
  const after = await call("GET", `/api/people/${nonPid}`, { token: admin.token });
  const acc = after.json?.payload?.accessRoleId || after.json?.payload?.access;
  check("c", "non-admin is still an employee", acc === "employee" || !acc, `accessRoleId ${acc}`);
  // A normal self edit still works for the non-admin.
  const edit = await call("PATCH", `/api/people/${nonPid}`, { token: non.token, body: { payload: { ...after.json.payload, phone: "9000000001" }, baseRev: after.json.rev } });
  check("c", "non-admin can still edit their own profile", edit.status === 200, `status ${edit.status} ${edit.text.slice(0, 80)}`);
  const adm = await call("GET", "/api/company-backups", { token: admin.token });
  check("c", "admin still lists backups", adm.status === 200, `status ${adm.status}`);

  // Forgot password: nothing comes back, nothing changes unless emailed.
  if (RESET_USER && RESET_PASS) {
    const r = await call("POST", "/api/password-reset", { body: { login: RESET_USER, origin: BASE } });
    const leaked = r.json && (r.json.previewPassword || r.json.previewLink);
    check("c", "forgot password returns no temp password / link", r.status === 200 && !leaked, JSON.stringify(r.json));
    const s = await signIn([RESET_USER, RESET_PASS]);
    check("c", "forgot password (not emailed) leaves the password working", s.status === 200, `status ${s.status}`);
  }

  // Sign-out revokes the token.
  const t = await signIn(N);
  const before = await call("GET", "/api/people?limit=1", { token: t.token });
  await call("POST", "/api/auth/sign-out", { token: t.token, body: {} });
  const afterOut = await call("GET", "/api/people?limit=1", { token: t.token });
  check("b", "signed-out token → 401", before.status === 200 && afterOut.status === 401, `before ${before.status}, after ${afterOut.status}`);
  const sess = await call("GET", "/api/auth/get-session", { token: t.token });
  check("b", "get-session with a signed-out token → null", sess.status === 200 && sess.json === null, sess.text.slice(0, 80));

  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"} — ${results.length - failed.length}/${results.length} — report: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
