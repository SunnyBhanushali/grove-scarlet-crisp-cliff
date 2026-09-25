/**
 * Claude connector (MCP) tests.
 *   1. OAuth + MCP over HTTP end to end, as Claude does it (discovery, dynamic
 *      registration, sign-in page, PKCE code, token, tools, refresh, revoke).
 *   2. Every tool runs on the seed company and replies within size.
 *   3. Permissions: a scoped login sees only what the app shows it.
 *   4. Scoring maths on hand-made plans.
 *   5. The Postgres OAuth store (PGlite, or a real server with PGTEST=1).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOrgContext, filterSnapshot, readsEverything, viewerFor, type Viewer } from "../apms-permissions.ts";
import { handleMcpHttp, type McpHttpDeps } from "./http.ts";
import { memoryStore, redirectAllowed, sqlStore } from "./oauth.ts";
import { TOOLS, runTool, resolveMonth, type ToolEnv } from "./tools.ts";
import { kpiScore, milestoneOf, monthPayout, nodeResult, planScores, pScore } from "./scoring.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const seed = JSON.parse(readFileSync(new URL("../company-seed.json", import.meta.url), "utf8"));
const ctx = buildOrgContext({ people: seed.people, accessRoles: seed.accessRoles, functions: seed.functions });
const NOW = new Date("2026-09-25T03:00:00Z");
const ORIGIN = "https://apms.example.test";

const superAdmin = seed.people.find((p: any) => p.access === "super_admin");
// A plain employee who has an APMS or Rewards plan somewhere, so scoping is visible.
const employee = seed.people.find(
  (p: any) =>
    (p.access || "employee") === "employee" &&
    (p.accessRoleId || "employee") === "employee" &&
    Object.values(seed.rewardRecords).some((m: any) => m && m[p.id]),
);

function envFor(personId: string): ToolEnv {
  const viewer: Viewer = viewerFor(personId, ctx);
  const snap = readsEverything(viewer) ? seed : filterSnapshot(viewer, seed);
  return {
    snap,
    viewer,
    now: NOW,
    roster: async (period) => ({
      period,
      status: "current",
      assignments: seed.people.slice(0, 5).map((p: any) => ({ personId: p.id, sbuId: p.buId || null, line: "solid", status: "active", allocationPct: 100 })),
    }),
    backups: async () => [{ id: "b1", kind: "daily", createdAt: "2026-09-24T00:00:00Z" }],
  };
}

const PASSWORDS: Record<string, { personId: string; name: string }> = {
  "boss:Right-1": { personId: superAdmin.id, name: superAdmin.name },
  "emp:Right-2": { personId: employee.id, name: employee.name },
};

function makeDeps(over: Partial<McpHttpDeps> = {}): McpHttpDeps & { tokens: Map<string, string>; changed: Map<string, number> } {
  const tokens = new Map<string, string>();
  const changed = new Map<string, number>();
  let n = 0;
  const deps: any = {
    tokens,
    changed,
    store: memoryStore(),
    login: async (u: string, p: string) => PASSWORDS[`${u}:${p}`] || { error: "Invalid username or password.", status: 401 },
    refuse: async (personId: string): Promise<string | null> => (personId === employee.id && !deps.allowEmployee ? "not allowed" : null),
    issueAccessToken: async (personId: string) => {
      const t = `apms-s.test-${++n}`;
      tokens.set(t, personId);
      return t;
    },
    revokeAccessToken: async (t: string) => void tokens.delete(t),
    passwordChangedAt: async (personId: string) => changed.get(personId) || 0,
    personForToken: async (t: string) => tokens.get(t) || null,
    envFor: async (personId: string) => envFor(personId),
    ...over,
  };
  return deps as any;
}

const req = (path: string, init: RequestInit = {}) => new Request(ORIGIN + path, init);
const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});
const b64url = (b: Buffer) => b.toString("base64url");

async function connect(deps: McpHttpDeps, user = "boss", pass = "Right-1") {
  // 1. unauthenticated MCP call → 401 pointing at the resource metadata
  const r401 = await handleMcpHttp(req("/mcp", { method: "POST", body: "{}" }), deps);
  assert.equal(r401!.status, 401);
  const wa = r401!.headers.get("www-authenticate")!;
  assert.match(wa, /resource_metadata="https:\/\/apms\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  // 2. discovery
  const prm = await (await handleMcpHttp(req("/.well-known/oauth-protected-resource/mcp"), deps))!.json();
  assert.equal(prm.resource, `${ORIGIN}/mcp`);
  const asm = await (await handleMcpHttp(req("/.well-known/oauth-authorization-server"), deps))!.json();
  assert.equal(asm.issuer, ORIGIN);
  assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
  // 3. dynamic client registration
  const reg = await handleMcpHttp(
    req("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }),
    }),
    deps,
  );
  assert.equal(reg!.status, 201);
  const client = await reg!.json();
  // 4. authorize page
  const verifier = b64url(Buffer.from("v".repeat(48)));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    state: "st-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "apms.read",
    resource: `${ORIGIN}/mcp`,
  };
  const pageRes = await handleMcpHttp(req(`/oauth/authorize?${new URLSearchParams(q)}`, { headers: { accept: "text/html" } }), deps);
  assert.equal(pageRes!.status, 200);
  const html = await pageRes!.text();
  assert.match(html, /Connect Claude to APMS/);
  assert.equal(pageRes!.headers.get("x-frame-options"), "DENY");
  // 5. sign in
  const post = await handleMcpHttp(req("/oauth/authorize", form({ ...q, username: user, password: pass, action: "allow" })), deps);
  return { post, client, verifier, q };
}

async function tokenFor(deps: McpHttpDeps) {
  const { post, client, verifier } = await connect(deps);
  assert.equal(post!.status, 302);
  const loc = new URL(post!.headers.get("location")!);
  assert.equal(loc.origin + loc.pathname, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(loc.searchParams.get("state"), "st-1");
  assert.equal(loc.searchParams.get("iss"), ORIGIN);
  const code = loc.searchParams.get("code")!;
  assert.ok(code);
  const tok = await handleMcpHttp(
    req("/oauth/token", form({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier })),
    deps,
  );
  assert.equal(tok!.status, 200);
  const body = await tok!.json();
  assert.equal(body.token_type, "Bearer");
  // A code works once.
  const again = await handleMcpHttp(
    req("/oauth/token", form({ grant_type: "authorization_code", code, client_id: client.client_id, code_verifier: verifier })),
    deps,
  );
  assert.equal(again!.status, 400);
  return { ...body, client };
}

async function rpc(deps: McpHttpDeps, token: string, method: string, params: unknown = {}, id: number | null = 1) {
  const res = await handleMcpHttp(
    req("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    }),
    deps,
  );
  return res!;
}

test("OAuth + MCP: Claude's full connect flow, tools, refresh, revoke", async () => {
  const deps = makeDeps();
  const t = await tokenFor(deps);

  const init = await (await rpc(deps, t.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "aliens-apms");
  assert.equal((await rpc(deps, t.access_token, "notifications/initialized", {}, null)).status, 202);

  const list = await (await rpc(deps, t.access_token, "tools/list")).json();
  assert.equal(list.result.tools.length, TOOLS.length);
  for (const tool of list.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.inputSchema.type, "object", tool.name);
  }

  const who = await (await rpc(deps, t.access_token, "tools/call", { name: "apms_whoami", arguments: {} })).json();
  const whoBody = JSON.parse(who.result.content[0].text);
  assert.equal(whoBody.person.id, superAdmin.id);
  assert.equal(whoBody.admin, true);

  // refresh rotates; the old refresh token is dead
  const r1 = await handleMcpHttp(req("/oauth/token", form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client.client_id })), deps);
  assert.equal(r1!.status, 200);
  const t2 = await r1!.json();
  assert.notEqual(t2.access_token, t.access_token);
  const r1again = await handleMcpHttp(req("/oauth/token", form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client.client_id })), deps);
  assert.equal(r1again!.status, 400);

  // a password change kills the refresh token
  deps.changed.set(superAdmin.id, Date.now() + 1000);
  const r2 = await handleMcpHttp(req("/oauth/token", form({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: t.client.client_id })), deps);
  assert.equal(r2!.status, 400);
  assert.match((await r2!.json()).error_description, /password changed/);

  // revoke the access token → 401
  await handleMcpHttp(req("/oauth/revoke", form({ token: t2.access_token, client_id: t.client.client_id })), deps);
  assert.equal((await rpc(deps, t2.access_token, "tools/list")).status, 401);
});

test("OAuth: wrong password re-shows the page; deny and bad PKCE fail; refused roles cannot connect", async () => {
  const deps = makeDeps();
  const bad = await connect(deps, "boss", "Wrong");
  assert.equal(bad.post!.status, 401);
  assert.match(await bad.post!.text(), /Invalid username or password/);

  const d = await connect(deps);
  const deny = await handleMcpHttp(req("/oauth/authorize", form({ ...d.q, action: "deny" })), deps);
  assert.equal(deny!.status, 302);
  assert.equal(new URL(deny!.headers.get("location")!).searchParams.get("error"), "access_denied");

  const code = new URL(d.post!.headers.get("location")!).searchParams.get("code")!;
  const pk = await handleMcpHttp(req("/oauth/token", form({ grant_type: "authorization_code", code, client_id: d.client.client_id, code_verifier: "not-the-verifier" })), deps);
  assert.equal(pk!.status, 400);

  const emp = await connect(deps, "emp", "Right-2");
  assert.equal(emp.post!.status, 403);
  assert.match(await emp.post!.text(), /not allowed/);

  // no PKCE → error redirect
  const noPkce = await handleMcpHttp(req(`/oauth/authorize?${new URLSearchParams({ ...d.q, code_challenge: "" })}`), deps);
  assert.equal(noPkce!.status, 302);
  assert.equal(new URL(noPkce!.headers.get("location")!).searchParams.get("error"), "invalid_request");
});

test("OAuth: registration only for Claude / loopback redirect targets", async () => {
  assert.ok(redirectAllowed("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(redirectAllowed("https://claude.com/api/mcp/auth_callback"));
  assert.ok(redirectAllowed("http://localhost:6274/oauth/callback"));
  assert.ok(!redirectAllowed("https://evil.example/cb"));
  assert.ok(!redirectAllowed("http://claude.ai/cb"));
  assert.ok(!redirectAllowed("https://claude.ai.evil.example/cb"));
  assert.ok(redirectAllowed("https://my.host/cb", ["my.host"]));
  const deps = makeDeps();
  const r = await handleMcpHttp(
    req("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) }),
    deps,
  );
  assert.equal(r!.status, 400);
});

test("HTTP: non-connector paths fall through; GET /mcp is 405; off switch", async () => {
  const deps = makeDeps();
  assert.equal(await handleMcpHttp(req("/api/company"), deps), null);
  assert.equal(await handleMcpHttp(req("/"), deps), null);
  assert.equal((await handleMcpHttp(req("/mcp"), deps))!.status, 405);
  const off = makeDeps({ enabled: () => false });
  assert.equal(await handleMcpHttp(req("/mcp", { method: "POST", body: "{}" }), off), null);
  assert.equal(await handleMcpHttp(req("/.well-known/oauth-authorization-server"), off), null);
  // browser from another site cannot call /mcp
  const t = await tokenFor(deps);
  const cross = await handleMcpHttp(
    req("/mcp", { method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${t.access_token}` }, body: "{}" }),
    deps,
  );
  assert.equal(cross!.status, 403);
});

test("tools: every tool runs on the seed company (admin) and stays under the reply cap", async () => {
  const env = envFor(superAdmin.id);
  const someone = seed.people.find((p: any) => p.roleId && p.managerId);
  const args: Record<string, any> = {
    apms_search_people: { query: someone.firstName },
    apms_get_person: { person: someone.id },
    apms_get_role: { role: "ceo" },
    apms_scorecard: { person: someone.id, month: "2026-08" },
    apms_role_plan: { role: Object.keys(seed.roleMonths)[0], month: "2026-09" },
    apms_rewards_year: { person: someone.id, month: "2026-08" },
    apms_settings: { section: "access_roles" },
    apms_raw: { field: "records", month: "2026-07" },
  };
  for (const t of TOOLS) {
    const out = await runTool(t.name, args[t.name] || {}, env);
    assert.equal(out.isError, false, `${t.name}: ${out.text.slice(0, 300)}`);
    assert.ok(out.text.length <= 151_000, `${t.name} too big`);
    assert.doesNotMatch(out.text, /"password"\s*:/, `${t.name} leaked a password field`);
  }
});

test("tools: a Rewards scorecard reproduces the stored plan and the payout rule", async () => {
  const env = envFor(superAdmin.id);
  // Find a closed / locked Rewards plan with a target.
  let found: { pid: string; month: string } | null = null;
  for (const [month, m] of Object.entries(seed.rewardRecords as Record<string, any>)) {
    for (const [pid, rec] of Object.entries(m || {})) {
      if ((rec as any)?.brands?.length && /^\d{4}-\d{2}$/.test(month) && month < "2027" && seed.people.some((p: any) => p.id === pid)) {
        found = { pid, month };
        break;
      }
    }
    if (found) break;
  }
  assert.ok(found, "seed has a Rewards plan");
  const out = JSON.parse((await runTool("apms_scorecard", { person: found!.pid, month: found!.month, kind: "rewards" }, env)).text);
  assert.equal(out.kind, "rewards");
  assert.ok(out.payout);
  const pot = out.payout.pot;
  const earned = out.payout.earned;
  assert.ok(earned >= 0 && earned <= pot, "0 ≤ earned ≤ pot");
  if (out.payout.disqualified || !out.payout.qualifiersOk) assert.equal(earned, 0);
  else assert.ok(Math.abs(earned - pot * out.payout.kpiMultiplier) <= pot * 0.005 + 1, "earned = pot × KPI multiplier");
});

test("permissions: an employee login sees only its own plans and no one else's pay", async () => {
  const env = envFor(employee.id);
  assert.equal(readsEverything(env.viewer), false);
  const months = Object.keys(seed.rewardRecords);
  for (const m of months) {
    const others = Object.keys(env.snap.rewardRecords?.[m] || {}).filter((pid) => pid !== employee.id);
    const team = new Set([employee.id, ...seed.people.filter((p: any) => p.managerId === employee.id).map((p: any) => p.id)]);
    assert.ok(others.every((pid) => team.has(pid)), `employee sees other people's Rewards in ${m}`);
  }
  const other = seed.people.find((p: any) => p.id !== employee.id && p.salary);
  if (other) {
    const out = JSON.parse((await runTool("apms_get_person", { person: other.id }, env)).text);
    assert.equal(out.fields.salary, undefined, "salary hidden");
  }
  const me = JSON.parse((await runTool("apms_whoami", {}, env)).text);
  assert.equal(me.person.id, employee.id);
  assert.equal(me.admin, false);
  // Month lists: only the people this login works with (employee scope = self).
  const rw = JSON.parse((await runTool("apms_rewards_month", { month: "2026-08" }, env)).text);
  assert.ok(rw.rows.every((r: any) => r.id === employee.id), "rewards list limited to own scope");
  const pl = JSON.parse((await runTool("apms_plans_month", { month: "2026-08" }, env)).text);
  assert.ok(pl.rows.every((r: any) => r.id === employee.id), "plans list limited to own scope");
  // Roster: an employee sees only their own rows.
  const roster = JSON.parse((await runTool("apms_roster", {}, env)).text);
  assert.ok(roster.assignments.every((a: any) => a.personId === employee.id));
  // Backups: not for employees.
  const backups = JSON.parse((await runTool("apms_settings", { section: "backups" }, env)).text);
  assert.match(backups.note, /cannot see/);
});

test("months: parsing", () => {
  assert.equal(resolveMonth("2026-8", NOW), "2026-08");
  assert.equal(resolveMonth("Aug 2026", NOW), "2026-08");
  assert.equal(resolveMonth("august", NOW), "2026-08");
  assert.equal(resolveMonth("december", NOW), "2025-12");
  assert.equal(resolveMonth("last month", NOW), "2026-08");
  assert.equal(resolveMonth("", NOW), "2026-09");
  assert.throws(() => resolveMonth("someday", NOW));
});

test("scoring: KPI, P-score, milestone, payout, roll-up", () => {
  assert.equal(kpiScore({ target: 100, floor: 60, achieved: 100 }), 5);
  assert.equal(kpiScore({ target: 100, floor: 60, achieved: 59 }), 0);
  assert.equal(kpiScore({ target: 100, floor: 60, achieved: 80 }), 3);
  assert.equal(kpiScore({ target: 10, floor: 20, achieved: 15 }), 3, "lower is better when floor > target");
  assert.equal(kpiScore({ target: 100, floor: 60, achieved: null }), null);
  assert.equal(pScore(5, 5, 5, { kpi: 50, exec: 30, values: 20 }), 5);
  assert.equal(pScore(4, null, 1.5, { kpi: 50, exec: 30, values: 20 }), Math.round(((0.5 * 4 + 0.2 * 1.5) / 0.7) * 0.75 * 100) / 100);
  const rec = {
    status: "closed",
    brands: [{ name: "A", weight: 1, kras: [{ name: "K", weight: 1, kpis: [{ name: "x", weight: 1, target: 100, floor: 60, achieved: 80, children: [] }] }] }],
    priorities: [{ score: 4, status: "complete" }, { score: 1, status: "dropped" }],
    values: [],
    mix: { kpi: 70, exec: 30, values: 0 },
  };
  const s = planScores(rec);
  assert.equal(s.kpi, 3);
  assert.equal(s.exec, 4);
  assert.equal(s.p, Math.round((0.7 * 3 + 0.3 * 4) * 100) / 100);
  assert.equal(milestoneOf({ M1: 80, M2: 90, M3: 100, M4: 110, M5: 120 }, 95), 2);
  const pay = monthPayout(rec, { slabs: { M1: 1000, M2: 2000, M3: 3000, M4: 4000, M5: 5000 } }, { ladder: { M1: 80, M2: 90, M3: 100, M4: 110, M5: 120 } }, { actual: 101 }, {}, null);
  assert.equal(pay.milestone, 3);
  assert.equal(pay.pot, 3000);
  assert.equal(pay.earned, Math.round(3000 * (3 / 5)));
  const dq = monthPayout({ ...rec, rewardFlags: [{ kind: "disqualifier", on: true, name: "Warning" }] }, { slabs: {} }, {}, {}, {}, null);
  assert.equal(dq.dq, true);
  assert.equal(dq.earned, 0);
  const qual = monthPayout({ ...rec, rewardFlags: [{ kind: "qualifier", on: false, name: "Attendance" }] }, { slabs: { M3: 3000 } }, { ladder: { M1: 80, M2: 90, M3: 100 } }, { actual: 101 }, {}, null);
  assert.equal(qual.earned, 0);
  // group node rolls up its members
  const nodes = { g: { id: "g", name: "G" }, a: { id: "a", name: "A" }, b: { id: "b", name: "B" } };
  const members = [
    { groupId: "g", memberId: "a", month: "2026-05" },
    { groupId: "g", memberId: "b", month: "2026-05" },
  ];
  const cells = {
    "a::2026-05": { ladder: { M1: 10, M2: 20, M3: 30, M4: 40, M5: 50 }, actual: 15 },
    "b::2026-05": { ladder: { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5 }, actual: 3 },
  };
  const g = nodeResult(nodes, members, cells, "g", "2026-05", [], NOW);
  assert.deepEqual(g.ladder, { M1: 11, M2: 22, M3: 33, M4: 44, M5: 55 });
  assert.equal(g.actual, 18);
});

test("OAuth store on Postgres: clients, single-use codes, refresh rotation", async (t: any) => {
  const { openTestDb } = await import("../test-db.ts");
  const db = await openTestDb();
  if (!db) {
    t.skip("no test database (PGlite not installed and no PGTEST server)");
    return;
  }
  try {
    const sql = db.sql as any;
    for (const t of ["apms_mcp_clients", "apms_mcp_codes", "apms_mcp_refresh"]) await sql.query(`drop table if exists ${t}`);
    const store = sqlStore(async () => sql);
    await store.saveClient({ clientId: "c1", secretHash: null, redirectUris: ["https://claude.ai/cb"], name: "Claude" });
    assert.deepEqual((await store.getClient("c1"))!.redirectUris, ["https://claude.ai/cb"]);
    assert.equal(await store.getClient("nope"), null);
    const row = { clientId: "c1", redirectUri: "https://claude.ai/cb", challenge: "x", personId: "p1", scope: "apms.read", resource: "", expiresAt: Date.now() + 60000 };
    await store.saveCode("h1", row);
    assert.deepEqual(await store.takeCode("h1"), row);
    assert.equal(await store.takeCode("h1"), null, "codes are single use");
    const now = Date.now();
    await store.saveRefresh("r1", { clientId: "c1", personId: "p1", scope: "apms.read", createdAt: now, expiresAt: now + 60000 });
    const r = await store.takeRefresh("r1");
    assert.equal(r!.personId, "p1");
    assert.ok(Math.abs(r!.createdAt - now) < 1000);
    assert.equal(await store.takeRefresh("r1"), null, "refresh tokens rotate");
  } finally {
    db.close();
  }
});
