/**
 * Production wiring of the Claude connector to the running app:
 * sign-in = the app's own login rules, access token = an APMS session,
 * data = the same per-viewer company snapshot GET /api/company serves.
 *
 * Environment switches (all optional):
 *   APMS_MCP=off              turn the connector off entirely
 *   APMS_MCP_ALLOW=admin      who may connect: "admin" (default: super admin + admin access roles),
 *                             "all", or a comma list of access roles / bases, e.g. "admin,hr,function_head"
 *   APMS_MCP_REDIRECT_HOSTS   extra OAuth redirect hosts (comma list) besides claude.ai / claude.com
 *   APMS_PUBLIC_URL           public origin, e.g. https://apms.alienstattoo.in (default: from the request)
 */
import { handleMcpHttp, type McpHttpDeps } from "./http.ts";
import { sqlStore, type LoginResult } from "./oauth.ts";
import type { ToolEnv } from "./tools.ts";

type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
type Obj = Record<string, unknown>;

async function getSql(): Promise<Q> {
  const { getSql: g } = await import("../db.ts");
  return (await g()) as unknown as Q;
}

const log = (line: string) => console.log(line);

export function mcpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.APMS_MCP ?? "on").trim().toLowerCase();
  return !["off", "0", "false", "no", "disabled"].includes(v);
}

export function allowList(env: Record<string, string | undefined> = process.env): string[] {
  return String(env.APMS_MCP_ALLOW || "admin")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function refuse(personId: string): Promise<string | null> {
  const { loadViewer } = await import("../apms-permissions.ts");
  const v = await loadViewer(personId);
  if (!v.ctx.people.has(personId) && personId !== "p-admin") return "This APMS login no longer exists.";
  const allow = allowList();
  if (allow.includes("all")) return null;
  if (v.superAdmin || v.admin) return null; // "admin" is always allowed
  const mine = [v.access, v.base, v.ctx.people.get(personId)?.accessRoleId || ""].map((s) => String(s).toLowerCase());
  if (mine.some((m) => m && allow.includes(m))) return null;
  return "Your APMS access role cannot connect Claude yet. Ask an APMS admin.";
}

/** Same people + logins directory the app's sign-in uses (01-apms-auth.ts readLoginRows). */
async function loginDirectory() {
  const { mergeLogins, loadIssuedLogins } = await import("../issued-logins.ts");
  const sql = await getSql();
  const people = (await sql.query<{ id: string; payload: Obj }>(`select id, payload from people where deleted_at is null`)).map(
    (r) => ({ ...(r.payload || {}), id: r.id }),
  );
  let fromRows: Obj = {};
  try {
    const { collections } = await import("../apms-collections.ts");
    const spec = collections.specForField("logins");
    const rows = await sql.query<{ kind: string; id: string; k1: string | null; k2: string | null; payload: Obj; rev: number }>(
      `select kind, id, k1, k2, payload, rev from entities where kind = 'logins' and deleted_at is null order by updated_at asc, id asc`,
    );
    const v = spec ? collections.fromRows(spec, rows.map((r) => ({ ...r, deleted: false }))) : undefined;
    if (v && typeof v === "object") fromRows = v as Obj;
  } catch {
    /* entities not ready */
  }
  if (!people.length) {
    // Rows not filled yet: fall back to the assembled company, like the app does.
    const { loadCompanySnapshot } = await import("../company-notebook.ts");
    const loaded = await loadCompanySnapshot();
    const snap = loaded.snapshotJson ? JSON.parse(loaded.snapshotJson) : {};
    return { people: Array.isArray(snap.people) ? snap.people : [], logins: mergeLogins(snap.logins || {}, await loadIssuedLogins()) };
  }
  return { people, logins: mergeLogins(fromRows as never, await loadIssuedLogins()) };
}

function socketlessIp(headers: Headers): string {
  return headers.get("x-real-ip") || "";
}

async function login(username: string, password: string, headers: Headers): Promise<LoginResult> {
  const { findPerson, usernameKey, verifyLoginDetailedAsync, DEFAULT_PIN } = await import("../apms-credentials.ts");
  const guard = await import("../apms-signin-guard.ts");
  // The starter PIN never connects Claude, whatever APMS_DEFAULT_PIN says.
  if (password === DEFAULT_PIN) {
    return { error: "The starter password 0000 cannot connect Claude. Set your own APMS password first (Me → Password).", status: 400 };
  }
  const { people, logins } = await loginDirectory();
  const known = findPerson(people as never, username);
  const lockKey = usernameKey(known?.username || known?.email || username);
  const ip = guard.clientIp(headers, socketlessIp(headers));
  const locked = await guard.signinLock(lockKey, ip).catch(() => null);
  if (locked) return { error: guard.lockMessage(locked), status: 429 };
  const verdict = await verifyLoginDetailedAsync(people as never, logins as never, username, password, { defaultPin: false });
  if (!verdict.person) {
    const lock = await guard.recordSigninFailure(lockKey, ip).catch(() => null);
    if (lock) return { error: guard.lockMessage(lock), status: 429 };
    return { error: "Invalid username or password.", status: 401 };
  }
  await guard.recordSigninSuccess(lockKey).catch(() => undefined);
  const p = verdict.person as Obj;
  return { personId: String(p.id), name: String(p.name || p.username || p.id) };
}

async function passwordChangedAt(personId: string): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ at: string | Date | null }>(`select max(updated_at) as at from issued_logins where person_id = $1`, [personId]);
    const at = rows[0]?.at;
    return at ? new Date(at).getTime() : 0;
  } catch {
    return 0;
  }
}

async function envFor(personId: string): Promise<ToolEnv> {
  const { getCompanyWire } = await import("../company-notebook.ts");
  const perm = await import("../apms-permissions.ts");
  const { slimForWire } = await import("../company-wire-slim.ts");
  const wire = await getCompanyWire({ encode: false });
  const viewer = await perm.loadViewer(personId);
  const base = (wire.slim as Obj | undefined) || slimForWire(JSON.parse(wire.snapshotJson || "{}"));
  // Exactly what GET /api/company sends this person (company-wire-http snapshotForViewer).
  const snap = perm.readsEverything(viewer) ? base : perm.filterSnapshot(viewer, base as Obj);
  return {
    snap: snap as Obj,
    viewer,
    now: new Date(),
    roster: async (period: string) => {
      const { getRoster, isRosterPeriod } = await import("../company-roster.ts");
      if (!isRosterPeriod(period)) return null;
      return (await getRoster((await getSql()) as never, period)) as unknown as Obj;
    },
    backups: async () => {
      const { listBackups } = await import("../company-backups.ts");
      return (await listBackups()) as unknown as Obj[];
    },
  };
}

let deps: McpHttpDeps | null = null;

export function productionDeps(): McpHttpDeps {
  if (deps) return deps;
  deps = {
    store: sqlStore(getSql),
    login,
    refuse,
    issueAccessToken: async (personId) => (await import("../apms-sessions.ts")).issueSessionToken(personId),
    revokeAccessToken: async (token) => (await import("../apms-sessions.ts")).revokeSessionToken(token),
    passwordChangedAt,
    personForToken: async (token) => (await import("../apms-sessions.ts")).personIdForSessionToken(token),
    envFor,
    enabled: () => mcpEnabled(),
    redirectHosts: String(process.env.APMS_MCP_REDIRECT_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    log,
  };
  return deps;
}

/** Nitro / TanStack entry: a Response for connector paths, else null. */
export function handleApmsMcp(request: Request): Promise<Response | null> {
  return handleMcpHttp(request, productionDeps());
}
