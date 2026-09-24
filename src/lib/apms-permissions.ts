/**
 * BATCH-3: server-side permissions (LOCK "PERMISSIONS" in APMS-BUILD-CONTRACT.md).
 *
 * Before this, access-role grants were enforced only by the SPA: any signed-in
 * person could read the whole company (salaries included) and write most rows
 * through the API. The server now applies the same model the SPA uses
 * (`packForBase` / `overlayPack` / `canAccess` / `accessScope` /
 * `hasAccessFlag` in the login-view chunk, ported 1:1 below) to every read and
 * write path.
 *
 * Reads: every person row is readable (it is the directory the app is built
 * on: names, roles, managers, studios), but pay fields need the `pay` flag and
 * personal HR fields the `personal` flag (a person always sees their own row).
 * APMS month records need the APMS grant, reward records the Reward plans
 * grant, each limited to the role's scope (own / team / function / company).
 * Entity kinds are listed in KIND_RULES.
 *
 * Writes: the module grant for the kind (create / edit / delete) and, for
 * person-owned rows, the target person inside the scope. A person may always
 * make the edits the Me page and their own plan pages allow (profile basics,
 * own password, self comments / self scores). Fields a user cannot see are
 * never taken from their write: the stored value is kept (like passwords under
 * NO-SECRETS-WIRE). A refused write is 403 `{ error: "forbidden", kind, field }`.
 */

// ---------------------------------------------------------------- grants ----

export const ACCESS_MODULES = [
  { id: "org-overview", viewOnly: true },
  { id: "org-units" },
  { id: "org-functions" },
  { id: "org-roles" },
  { id: "org-people" },
  { id: "kpi" },
  { id: "apms" },
  { id: "targets" },
  { id: "rewards" },
  { id: "awards" },
  { id: "mis" },
  { id: "settings-access" },
  { id: "settings-assign" },
  { id: "settings-backup" },
  { id: "settings-trash" },
] as const;

export type ModuleId = (typeof ACCESS_MODULES)[number]["id"];
export type Act = "view" | "create" | "edit" | "delete";
type Crud = { view: boolean; create: boolean; edit: boolean; delete: boolean };

export const ACCESS_FLAGS = [
  "pay",
  "personal",
  "approve",
  "unlock",
  "frozen_edit",
  "impersonate",
  "restore",
  "mass_rewards",
  "mass_people",
  "people_list",
  "people_my",
  "people_company",
  "people_sbu",
  "people_function",
  "people_summary",
  "month_actuals",
  "changelog",
  "lock_rewards",
  "lock_apms",
] as const;

export type Scope = "own" | "team" | "function" | "company";
export type Pack = { scope: Scope; grants: Record<string, Crud>; flags: Record<string, boolean> };

const crud = (v: number, c: number, e: number, d: number): Crud => ({ view: !!v, create: !!c, edit: !!e, delete: !!d });
const crudNo = () => crud(0, 0, 0, 0);
const crudVO = () => crud(1, 0, 0, 0);
const crudCE = () => crud(1, 1, 1, 0);
const crudAll = () => crud(1, 1, 1, 1);

function fillGrants(rows: Partial<Record<string, Crud>>): Record<string, Crud> {
  const g: Record<string, Crud> = {};
  for (const m of ACCESS_MODULES) g[m.id] = rows[m.id] ? { ...crudNo(), ...rows[m.id] } : crudNo();
  return g;
}

function flagSet(on: readonly string[]): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const f of ACCESS_FLAGS) o[f] = on.includes(f);
  return o;
}

const MGR_FLAGS = [
  "approve",
  "mass_rewards",
  "people_list",
  "people_my",
  "people_company",
  "people_sbu",
  "people_function",
  "people_summary",
  "month_actuals",
  "lock_rewards",
  "lock_apms",
];

export function packForBase(base: string | undefined | null): Pack {
  const b = base || "employee";
  if (b === "super_admin" || b === "admin") {
    const rows: Record<string, Crud> = {};
    for (const m of ACCESS_MODULES) rows[m.id] = "viewOnly" in m && m.viewOnly ? crudVO() : crudAll();
    return {
      scope: "company",
      grants: fillGrants(rows),
      flags: flagSet(
        b === "super_admin"
          ? ACCESS_FLAGS
          : ["pay", "personal", "approve", "unlock", "impersonate", "restore", "mass_people", ...MGR_FLAGS, "changelog"],
      ),
    };
  }
  if (b === "hr") {
    return {
      scope: "company",
      grants: fillGrants({
        "org-overview": crudVO(),
        "org-units": crudAll(),
        "org-functions": crudAll(),
        "org-roles": crudAll(),
        "org-people": crudAll(),
        kpi: crudCE(),
        apms: crudCE(),
        targets: crudCE(),
        rewards: crudCE(),
        awards: crudCE(),
        mis: crudVO(),
        "settings-access": crudCE(),
        "settings-assign": crudCE(),
        "settings-backup": crudCE(),
        "settings-trash": crudCE(),
      }),
      flags: flagSet(["pay", "personal", "approve", "unlock", "restore", "mass_people", ...MGR_FLAGS, "changelog"]),
    };
  }
  if (b === "function_head") {
    return {
      scope: "function",
      grants: fillGrants({
        "org-overview": crudVO(),
        "org-units": crudCE(),
        "org-functions": crud(1, 0, 1, 0),
        "org-roles": crud(1, 0, 1, 0),
        "org-people": crud(1, 0, 1, 0),
        kpi: crudVO(),
        apms: crudCE(),
        targets: crudCE(),
        rewards: crudCE(),
        awards: crudCE(),
      }),
      flags: flagSet(MGR_FLAGS),
    };
  }
  if (b === "manager") {
    return {
      scope: "team",
      grants: fillGrants({
        "org-roles": crudVO(),
        "org-people": crudVO(),
        kpi: crudVO(),
        apms: crudCE(),
        rewards: crudCE(),
        awards: crudVO(),
      }),
      flags: flagSet(MGR_FLAGS),
    };
  }
  return { scope: "own", grants: fillGrants({ apms: crudVO(), rewards: crudVO() }), flags: flagSet([]) };
}

function cascadeRow(row: Partial<Crud>, viewOnly: boolean): Crud {
  const r = { view: !!row.view, create: !!row.create, edit: !!row.edit, delete: !!row.delete };
  if (viewOnly) return { view: r.view, create: false, edit: false, delete: false };
  if (r.delete) r.edit = r.view = true;
  if (r.edit || r.create) r.view = true;
  return r;
}

export type AccessRoleRow = {
  id: string;
  base?: string;
  scope?: Scope;
  grants?: Record<string, Partial<Crud>>;
  flags?: Record<string, boolean>;
};

export function overlayPack(role: AccessRoleRow | null | undefined): Pack {
  const def = packForBase(role?.base || role?.id || "employee");
  if (!role) return def;
  const grants = { ...def.grants };
  if (role.grants) {
    for (const m of ACCESS_MODULES) {
      const g = role.grants[m.id];
      if (g) grants[m.id] = cascadeRow({ ...grants[m.id], ...g }, "viewOnly" in m && !!m.viewOnly);
    }
  }
  return { scope: (role.scope as Scope) || def.scope, grants, flags: { ...def.flags, ...(role.flags || {}) } };
}

// --------------------------------------------------------------- context ----

export type OrgRow = {
  id: string;
  username: string;
  access: string;
  accessRoleId: string;
  managerId: string;
  dottedManagers: string[];
  seatManagers: string[];
  functionIds: string[];
};

export type OrgContext = {
  at: number;
  people: Map<string, OrgRow>;
  reportsOf: Map<string, string[]>;
  accessRoles: Map<string, AccessRoleRow>;
  fnChildren: Map<string, string[]>;
};

type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

function obj(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>) : [];
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function orgRowFromPerson(p: Record<string, unknown>): OrgRow {
  const fns = new Set<string>();
  if (p.functionId) fns.add(str(p.functionId));
  if (p.subFunctionId) fns.add(str(p.subFunctionId));
  for (const s of arr(p.functionSeats)) {
    if (s.functionId) fns.add(str(s.functionId));
    if (s.subFunctionId) fns.add(str(s.subFunctionId));
  }
  for (const d of arr(p.dottedLine)) if (d.functionId) fns.add(str(d.functionId));
  return {
    id: str(p.id),
    username: str(p.username).toLowerCase(),
    access: str(p.access) || "employee",
    accessRoleId: str(p.accessRoleId) || str(p.access) || "employee",
    managerId: str(p.managerId),
    dottedManagers: arr(p.dottedLine).map((d) => str(d.managerId)).filter(Boolean),
    seatManagers: arr(p.functionSeats).map((s) => str(s.managerId)).filter(Boolean),
    functionIds: [...fns],
  };
}

export function buildOrgContext(input: {
  people: Array<Record<string, unknown>>;
  accessRoles: Array<Record<string, unknown>>;
  functions: Array<Record<string, unknown>>;
}): OrgContext {
  const people = new Map<string, OrgRow>();
  const reportsOf = new Map<string, string[]>();
  for (const p of input.people) {
    const row = orgRowFromPerson(p);
    if (!row.id) continue;
    people.set(row.id, row);
  }
  for (const row of people.values()) {
    for (const m of new Set([row.managerId, ...row.dottedManagers, ...row.seatManagers])) {
      if (!m || m === row.id) continue;
      const list = reportsOf.get(m) || [];
      list.push(row.id);
      reportsOf.set(m, list);
    }
  }
  const accessRoles = new Map<string, AccessRoleRow>();
  for (const r of input.accessRoles) if (r && r.id) accessRoles.set(str(r.id), r as AccessRoleRow);
  const fnChildren = new Map<string, string[]>();
  for (const f of input.functions) {
    const parent = str(f.parentId) || str(f.functionId);
    if (!parent || !f.id) continue;
    const list = fnChildren.get(parent) || [];
    list.push(str(f.id));
    fnChildren.set(parent, list);
  }
  return { at: Date.now(), people, reportsOf, accessRoles, fnChildren };
}

const CONTEXT_MS = 2000;
const gctx = globalThis as typeof globalThis & {
  __apmsOrgCtx__?: { ctx: OrgContext; until: number } | null;
  __apmsOrgCtxInflight__?: Promise<OrgContext> | null;
};

let ctxOverride: OrgContext | null = null;
export function setOrgContextForTests(ctx: OrgContext | null): void {
  ctxOverride = ctx;
}

/** Drop the cached org context (a people / access-role / function write). */
export function invalidateOrgContext(): void {
  gctx.__apmsOrgCtx__ = null;
}

export async function loadOrgContext(sqlIn?: Q): Promise<OrgContext> {
  if (ctxOverride) return ctxOverride;
  const hit = gctx.__apmsOrgCtx__;
  if (hit && hit.until > Date.now()) return hit.ctx;
  if (gctx.__apmsOrgCtxInflight__) return gctx.__apmsOrgCtxInflight__;
  gctx.__apmsOrgCtxInflight__ = (async () => {
    const sql = sqlIn || ((await (await import("./db.ts")).getSql()) as unknown as Q);
    let people: Array<Record<string, unknown>> = [];
    try {
      const rows = await sql.query<{ id: string; p: unknown }>(
        `select id, jsonb_build_object(
            'id', id,
            'username', payload->'username', 'access', payload->'access', 'accessRoleId', payload->'accessRoleId',
            'managerId', payload->'managerId', 'dottedLine', payload->'dottedLine', 'functionSeats', payload->'functionSeats',
            'functionId', payload->'functionId', 'subFunctionId', payload->'subFunctionId') as p
           from people where deleted_at is null`,
      );
      people = rows.map((r) => obj(r.p));
    } catch {
      /* fresh install */
    }
    if (!people.length) {
      try {
        const { readLiveSnapshot } = await import("./company-notebook.ts");
        const snap = (await readLiveSnapshot()) as { people?: unknown } | null;
        people = arr(snap?.people);
      } catch {
        /* ignore */
      }
    }
    let accessRoles: Array<Record<string, unknown>> = [];
    let functions: Array<Record<string, unknown>> = [];
    try {
      const rows = await sql.query<{ kind: string; payload: unknown }>(
        `select kind, payload from entities where kind in ('access-roles', 'functions', 'sub-functions') and deleted_at is null`,
      );
      for (const r of rows) {
        if (r.kind === "access-roles") accessRoles.push(obj(r.payload));
        else functions.push(obj(r.payload));
      }
    } catch {
      /* no entities yet */
    }
    if (!accessRoles.length) accessRoles = [];
    const ctx = buildOrgContext({ people, accessRoles, functions });
    gctx.__apmsOrgCtx__ = { ctx, until: Date.now() + CONTEXT_MS };
    return ctx;
  })().finally(() => {
    gctx.__apmsOrgCtxInflight__ = null;
  });
  return gctx.__apmsOrgCtxInflight__;
}

// ---------------------------------------------------------------- viewer ----

export type Viewer = {
  id: string;
  access: string;
  base: string;
  pack: Pack;
  superAdmin: boolean;
  /** Access role base admin / super_admin: every grant, company scope (same as apms-admin-auth). */
  admin: boolean;
  ctx: OrgContext;
  _vis: Map<string, Set<string> | "all">;
};

export const ADMIN_BASES = new Set(["admin", "super_admin"]);

export function viewerFor(personId: string, ctx: OrgContext): Viewer {
  const row = ctx.people.get(personId);
  // The legacy `sunny.b` fallback person (no row in the company) is the super admin.
  const access = row ? row.access : personId === "p-admin" ? "super_admin" : "employee";
  const roleId = row ? row.accessRoleId : access;
  const role =
    ctx.accessRoles.get(roleId) || ctx.accessRoles.get(access) || ({ id: access, base: access } as AccessRoleRow);
  const base = str(role.base) || str(role.id) || access;
  const superAdmin = access === "super_admin";
  const pack = superAdmin ? packForBase("super_admin") : overlayPack(role);
  return { id: personId, access, base, pack, superAdmin, admin: superAdmin || ADMIN_BASES.has(base), ctx, _vis: new Map() };
}

export async function loadViewer(personId: string): Promise<Viewer> {
  return viewerFor(personId, await loadOrgContext());
}

export function can(v: Viewer, mod: string, act: Act = "view"): boolean {
  if (v.superAdmin || v.admin) return true;
  const m = ACCESS_MODULES.find((x) => x.id === mod);
  const row = cascadeRow(v.pack.grants[mod] || crudNo(), !!m && "viewOnly" in m && !!m.viewOnly);
  if (act === "view") return row.view || row.create || row.edit || row.delete;
  if (act === "edit") return row.edit || row.delete;
  if (act === "create") return row.create;
  return row.delete;
}

export function flag(v: Viewer, f: string): boolean {
  if (v.superAdmin || v.admin) return true;
  return !!v.pack.flags[f];
}

/** Self plus everyone reporting to them (line, dotted, function seat), recursively. */
export function teamOf(v: Viewer): Set<string> {
  const out = new Set<string>([v.id]);
  const queue = [v.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of v.ctx.reportsOf.get(id) || []) {
      if (out.has(r)) continue;
      out.add(r);
      queue.push(r);
    }
  }
  return out;
}

function functionMembers(v: Viewer): Set<string> {
  const me = v.ctx.people.get(v.id);
  const fns = new Set<string>();
  const queue = [...(me?.functionIds || [])];
  while (queue.length) {
    const f = queue.shift()!;
    if (fns.has(f)) continue;
    fns.add(f);
    for (const c of v.ctx.fnChildren.get(f) || []) queue.push(c);
  }
  const out = teamOf(v);
  if (!fns.size) return out;
  for (const p of v.ctx.people.values()) if (p.functionIds.some((f) => fns.has(f))) out.add(p.id);
  return out;
}

/** People whose rows of this module the viewer may read / write (always includes self). */
export function scopeSet(v: Viewer, mod: string): Set<string> | "all" {
  const hit = v._vis.get(mod);
  if (hit) return hit;
  let out: Set<string> | "all";
  if (v.superAdmin || v.admin) out = "all";
  else if (!can(v, mod, "view")) out = new Set([v.id]);
  else if (v.pack.scope === "company") out = "all";
  else if (v.pack.scope === "function") out = functionMembers(v);
  else if (v.pack.scope === "team") out = teamOf(v);
  else out = new Set([v.id]);
  v._vis.set(mod, out);
  return out;
}

export function inScope(v: Viewer, mod: string, personId: string): boolean {
  if (personId === v.id) return true;
  const s = scopeSet(v, mod);
  return s === "all" || s.has(personId);
}

/** True when this viewer reads everything unfiltered (the shared full wire). */
export function readsEverything(v: Viewer): boolean {
  if (v.superAdmin || v.admin) return true;
  if (v.pack.scope !== "company") return false;
  if (!flag(v, "pay") || !flag(v, "personal")) return false;
  return ["apms", "rewards", "settings-trash", "settings-assign", "mis", "org-people"].every((m) => can(v, m, "view"));
}

// ---------------------------------------------------------------- fields ----

/** Person fields that need the `pay` flag (compensation, reward slabs). */
export const PERSON_PAY_FIELDS = [
  "salary",
  "bandMidpoint",
  "rewardsSlabs",
  "ctc",
  "fixedCtc",
  "rewardsAnnual",
  "annualRewards",
  "variablePay",
  "bonus",
  "payHistory",
] as const;
/** Person fields that need the `personal` flag. */
export const PERSON_PERSONAL_FIELDS = [
  "dob",
  "phone",
  "phoneCountry",
  "personalEmail",
  "address",
  "emergencyContact",
  "bloodGroup",
  "pan",
  "aadhaar",
  "bankAccount",
  "ifsc",
  "gender",
  "maritalStatus",
] as const;
/** Job-role fields that need the `pay` flag (salary bands, reward slabs). */
export const ROLE_PAY_FIELDS = ["slabs", "salaryFrom", "salaryTo"] as const;
const SECRET_FIELDS = ["password", "passwordHash"] as const;

/** Fields of this person row the viewer may not see. */
export function hiddenPersonFields(v: Viewer, personId: string): string[] {
  if (personId === v.id) return [];
  const out: string[] = [];
  if (!flag(v, "pay")) out.push(...PERSON_PAY_FIELDS);
  if (!flag(v, "personal")) out.push(...PERSON_PERSONAL_FIELDS);
  return out;
}

export function hiddenRoleFields(v: Viewer): string[] {
  return flag(v, "pay") ? [] : [...ROLE_PAY_FIELDS];
}

function omit<T extends Record<string, unknown>>(row: T, fields: readonly string[]): T {
  let next: T | null = null;
  for (const f of fields) {
    if (f in row) {
      if (!next) next = { ...row };
      delete (next as Record<string, unknown>)[f];
    }
  }
  return next || row;
}

/** A person row as this viewer may read it (secrets always removed). */
export function readPerson(v: Viewer, row: Record<string, unknown>): Record<string, unknown> {
  if (!row || typeof row !== "object") return row;
  return omit(omit(row, SECRET_FIELDS), hiddenPersonFields(v, str(row.id)));
}

export function readRole(v: Viewer, row: Record<string, unknown>): Record<string, unknown> {
  if (!row || typeof row !== "object") return row;
  return omit(row, hiddenRoleFields(v));
}

export function canReadRecord(v: Viewer, table: "month_records" | "reward_records", personId: string): boolean {
  return inScope(v, table === "month_records" ? "apms" : "rewards", personId);
}

/** Hot-table read: the row as the viewer may see it, or null (not visible). */
export function readHotRow(
  v: Viewer,
  table: string,
  ids: { id?: string; personId?: string },
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const t = table.replace(/-/g, "_");
  if (t === "people") return readPerson(v, { ...payload, id: payload?.id ?? ids.id });
  if (t === "month_records" || t === "reward_records") {
    return canReadRecord(v, t, str(ids.personId)) ? payload : null;
  }
  if (t === "target_cells") return canReadTargets(v) ? payload : null;
  return payload;
}

export function canReadTargets(v: Viewer): boolean {
  // Rewards unlock against targets and APMS KPIs can link a target actual, so
  // every role with Targets, Reward plans or APMS reads the targets graph.
  return can(v, "targets", "view") || can(v, "rewards", "view") || can(v, "apms", "view");
}

// ------------------------------------------------------------ kind rules ----

type KindRule = {
  /** Module whose grant covers this kind; "admin" = admins only; "any" = every signed-in person. */
  module: ModuleId | "admin" | "any";
  /** Rows that only extend a parent (memberships, order, month status): create/delete count as edit. */
  sub?: boolean;
  /** Extra read check (row-level). */
  read?: (v: Viewer, row: { k1?: string | null; payload: Record<string, unknown> }) => boolean;
  /** Field filter on read. */
  strip?: (v: Viewer, payload: Record<string, unknown>) => Record<string, unknown>;
};

function involvesSelf(v: Viewer, p: Record<string, unknown>): boolean {
  const ids = [p.subjectId, p.personId, p.requesterId, p.fromId, p.createdBy, p.byId].map(str);
  if (ids.includes(v.id)) return true;
  return Array.isArray(p.toIds) && p.toIds.map(str).includes(v.id);
}

function stripTrash(v: Viewer, p: Record<string, unknown>): Record<string, unknown> {
  const snap = obj(p.snapshot);
  if (!Array.isArray(snap.people) || (flag(v, "pay") && flag(v, "personal"))) return p;
  return { ...p, snapshot: { ...snap, people: arr(snap.people).map((x) => readPerson(v, x)) } };
}

export const KIND_RULES: Record<string, KindRule> = {
  companies: { module: "org-units" },
  brands: { module: "org-units" },
  sbus: { module: "org-units" },
  "sbu-members": { module: "org-units", sub: true },
  functions: { module: "org-functions" },
  "sub-functions": { module: "org-functions" },
  roles: { module: "org-roles", strip: (v, p) => readRole(v, p) },
  "role-krocs": { module: "org-roles", sub: true },
  "access-roles": { module: "admin" },
  "custom-reports": { module: "mis", read: (v) => can(v, "mis", "view") },
  "report-folders": { module: "mis", read: (v) => can(v, "mis", "view") },
  notices: { module: "any" },
  "app-requests": { module: "any", read: (v, r) => can(v, "org-people", "view") || involvesSelf(v, r.payload) },
  "role-cases": { module: "any", read: (v, r) => can(v, "org-people", "view") || involvesSelf(v, r.payload) },
  trash: { module: "settings-trash", read: (v) => can(v, "settings-trash", "view"), strip: stripTrash },
  logins: {
    module: "settings-assign",
    read: (v, r) => can(v, "settings-assign", "view") || str(r.k1).toLowerCase() === (v.ctx.people.get(v.id)?.username || "\u0000"),
  },
  "values-catalog": { module: "kpi" },
  "kpi-master": { module: "kpi" },
  "apms-plans": { module: "apms" },
  "apms-months": { module: "apms", sub: true },
  "role-months": { module: "apms", sub: true },
  "period-reviews": {
    module: "apms",
    read: (v, r) => !r.payload.personId || inScope(v, "apms", str(r.payload.personId)),
  },
  "award-instances": { module: "awards" },
  "award-measures": { module: "awards" },
  "award-prizes": { module: "awards" },
  "gate-units": { module: "rewards" },
  "gate-months": { module: "rewards", sub: true },
  "reward-role-months": { module: "rewards", sub: true },
  "ags-months": { module: "org-roles", sub: true, read: (v) => flag(v, "pay") || can(v, "org-roles", "edit") },
  "ags-reviews": { module: "org-roles", sub: true, read: (v) => flag(v, "pay") || can(v, "org-roles", "edit") },
  "sbu-targets": { module: "targets", sub: true, read: (v) => canReadTargets(v) },
  "target-history": { module: "targets", sub: true, read: (v) => canReadTargets(v) },
  "target-nodes": { module: "targets", read: (v) => canReadTargets(v) },
  "target-members": { module: "targets", sub: true, read: (v) => canReadTargets(v) },
  "target-month-status": { module: "targets", sub: true, read: (v) => canReadTargets(v) },
  "target-root-order": { module: "targets", sub: true, read: (v) => canReadTargets(v) },
};

/** Settings scalars (kind `settings`, k1 = field). */
export const SETTINGS_RULES: Record<string, { write: (v: Viewer) => boolean; read?: (v: Viewer) => boolean }> = {
  dismissedAlertIds: { write: (v) => can(v, "org-people", "view") || can(v, "settings-assign", "view") },
  setupDone: { write: (v) => can(v, "settings-access", "edit") || can(v, "settings-assign", "edit") },
  companyFactor: { write: (v) => v.admin, read: () => true },
  pendingRoleDeletes: { write: (v) => can(v, "org-roles", "edit") },
  months: { write: (v) => can(v, "apms", "create") || can(v, "rewards", "create") || can(v, "targets", "create") },
  seedGeneration: { write: (v) => v.admin },
  awardBandShares: { write: (v) => can(v, "awards", "edit") },
  rewardYearSeed: { write: (v) => can(v, "rewards", "edit") },
};

export function canReadEntity(
  v: Viewer,
  kind: string,
  row: { k1?: string | null; payload: Record<string, unknown> },
): boolean {
  if (v.superAdmin || v.admin) return true;
  if (kind === "settings") return SETTINGS_RULES[str(row.k1)]?.read?.(v) ?? true;
  const rule = KIND_RULES[kind];
  if (!rule) return true;
  return rule.read ? rule.read(v, { k1: row.k1, payload: obj(row.payload) }) : true;
}

/** An entity payload as the viewer may read it, or null. */
export function readEntityPayload(
  v: Viewer,
  kind: string,
  row: { k1?: string | null; payload: Record<string, unknown> },
): Record<string, unknown> | null {
  if (!canReadEntity(v, kind, row)) return null;
  if (v.superAdmin || v.admin) return row.payload;
  const rule = KIND_RULES[kind];
  const payload = obj(row.payload);
  const clean = kind === "logins" ? omit(payload, SECRET_FIELDS) : payload;
  return rule?.strip ? rule.strip(v, clean) : clean;
}

// ---------------------------------------------------------------- writes ----

export type Refusal = { error: "forbidden"; kind: string; field?: string; message: string };

export function refusal(kind: string, field: string | undefined, message: string): Refusal {
  return { error: "forbidden", kind, ...(field ? { field } : {}), message };
}

export function forbiddenResponse(r: Refusal): Response {
  return new Response(JSON.stringify({ ok: false, ...r }), {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Value a client sends for a field it cannot see (form placeholders): null, "", 0, [], {} or all such. */
export function isEmptyish(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === 0 || v === false) return true;
  if (Array.isArray(v)) return v.every(isEmptyish);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isEmptyish);
  return false;
}

/** Missing, null, "", [] and {} are the same "nothing" (the SPA fills empty defaults on hydrate). */
function blank(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length === 0;
  return false;
}
/** Deep copy with "nothing" values removed from objects, for comparing content. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = norm((v as Record<string, unknown>)[k]);
      if (!blank(x)) out[k] = x;
    }
    return out;
  }
  return v;
}
const same = (a: unknown, b: unknown) => {
  const na = norm(a);
  const nb = norm(b);
  if (blank(na) && blank(nb)) return true;
  return JSON.stringify(na ?? null) === JSON.stringify(nb ?? null);
};

/**
 * Keep stored values for fields the viewer cannot see. A placeholder value
 * (empty / 0) is replaced silently; a real different value is a refusal.
 */
export function preserveHidden(
  kind: string,
  hidden: readonly string[],
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null,
): { payload: Record<string, unknown>; refused: Refusal | null } {
  if (!hidden.length) return { payload: incoming, refused: null };
  const out = { ...incoming };
  const src = stored || {};
  for (const f of hidden) {
    const has = f in out;
    if (has && !isEmptyish(out[f]) && !same(out[f], src[f])) {
      return { payload: incoming, refused: refusal(kind, f, `You cannot change ${f}.`) };
    }
    if (f in src) out[f] = src[f];
    else delete out[f];
  }
  return { payload: out, refused: null };
}

/** Top-level fields that differ (ignoring bookkeeping). */
export function changedFields(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  ignore: readonly string[] = [],
): string[] {
  const src = stored || {};
  const skip = new Set(["updatedAt", "rev", "id", ...ignore]);
  const keys = new Set([...Object.keys(incoming), ...Object.keys(src)]);
  const out: string[] = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (!(k in incoming)) continue; // a missing field is kept by the row merge, not a change
    if (!same(incoming[k], src[k])) out.push(k);
  }
  return out;
}

/** Deep copy without keys that start with "self" (self comments / self scores). */
function withoutSelf(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutSelf);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/^self/i.test(k)) continue;
      out[k] = withoutSelf(x);
    }
    return out;
  }
  return v;
}

/** True when the only differences are in self* keys (anywhere in the tree) or the listed meta keys. */
export function onlySelfChanges(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  meta: readonly string[] = [],
): boolean {
  const drop = new Set(["updatedAt", "rev", "authors", ...meta]);
  const norm = (r: Record<string, unknown> | null) => {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(r || {})) if (!drop.has(k)) o[k] = x;
    return withoutSelf(o);
  };
  const a = norm(incoming) as Record<string, unknown>;
  const b = norm(stored) as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!same(a[k], b[k])) return false;
  return true;
}

/** Me page: what a person may change on their own row without People edit. */
export const SELF_PERSON_FIELDS = new Set([
  "firstName",
  "lastName",
  "name",
  "preferredName",
  "email",
  "phone",
  "phoneCountry",
  "password",
  "mustResetPassword",
  "photo",
  "avatar",
  "photoUrl",
]);
const ACCESS_FIELDS = new Set(["access", "accessRoleId"]);
const APMS_PERSON_FIELDS = new Set(["apmsPlanId", "inheritRoleApms"]);
const REWARDS_PERSON_FIELDS = new Set(["targetNodeId", "targetMetric", "targetSbuId", "gateUnitId"]);

export type WriteOp = "create" | "edit" | "delete";

export function opOf(stored: { deleted?: boolean } | null | undefined, deleted: boolean): WriteOp {
  if (deleted) return "delete";
  if (!stored || stored.deleted) return "create";
  return "edit";
}

/**
 * People row write. Returns the payload to store (hidden fields kept) or a refusal.
 * `stored` is the current row payload (null for a new person).
 */
export function checkPersonWrite(
  v: Viewer,
  personId: string,
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  op: WriteOp,
): { payload: Record<string, unknown>; refused: Refusal | null } {
  if (v.superAdmin || v.admin) return { payload: incoming, refused: null };
  const K = "people";
  if (op === "create") {
    if (!can(v, "org-people", "create")) return { payload: incoming, refused: refusal(K, undefined, "You cannot add people.") };
  } else if (op === "delete") {
    if (!can(v, "org-people", "delete") || !inScope(v, "org-people", personId) || personId === v.id) {
      return { payload: incoming, refused: refusal(K, undefined, "You cannot delete this person.") };
    }
    return { payload: incoming, refused: null };
  }
  const kept = preserveHidden(K, hiddenPersonFields(v, personId), incoming, stored);
  if (kept.refused) return kept;
  const payload = kept.payload;
  const fields = op === "create" ? Object.keys(payload).filter((k) => !isEmptyish(payload[k])) : changedFields(payload, stored);
  const peopleEdit = can(v, "org-people", op === "create" ? "create" : "edit") && inScope(v, "org-people", personId);
  for (const f of fields) {
    if (ACCESS_FIELDS.has(f)) {
      if (op === "create" && same(payload[f], "employee")) continue;
      return { payload, refused: refusal(K, f, "Only an admin can change an access role.") };
    }
    if (f === "password" || f === "passwordHash") {
      if (personId === v.id || op === "create") continue;
      return { payload, refused: refusal(K, f, "Only an admin can set another person's password.") };
    }
    if (personId === v.id && SELF_PERSON_FIELDS.has(f)) continue;
    if (APMS_PERSON_FIELDS.has(f) && can(v, "apms", "edit") && inScope(v, "apms", personId)) continue;
    if (REWARDS_PERSON_FIELDS.has(f) && can(v, "rewards", "edit") && inScope(v, "rewards", personId)) continue;
    if ((PERSON_PAY_FIELDS as readonly string[]).includes(f) && !flag(v, "pay")) {
      return { payload, refused: refusal(K, f, "You cannot change compensation.") };
    }
    if (!peopleEdit) return { payload, refused: refusal(K, f, `You cannot change ${f} for this person.`) };
  }
  return { payload, refused: null };
}

/** APMS (month_records) / Rewards (reward_records) row write. */
export function checkRecordWrite(
  v: Viewer,
  table: "month_records" | "reward_records",
  personId: string,
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  op: WriteOp,
): Refusal | null {
  if (v.superAdmin || v.admin) return null;
  const mod = table === "month_records" ? "apms" : "rewards";
  const K = table === "month_records" ? "month-records" : "reward-records";
  const scoped = inScope(v, mod, personId);
  if (op === "delete") {
    return can(v, mod, "delete") && scoped ? null : refusal(K, undefined, "You cannot delete this plan.");
  }
  if (op === "create") {
    return can(v, mod, "create") && scoped ? null : refusal(K, undefined, "You cannot create this plan.");
  }
  if (can(v, mod, "edit") && scoped) {
    if (!same(incoming.status, (stored || {}).status) && "status" in incoming) {
      const lock = table === "month_records" ? "lock_apms" : "lock_rewards";
      if (!flag(v, lock) && !flag(v, "unlock")) return refusal(K, "status", "You cannot lock, unlock or close this plan.");
    }
    return null;
  }
  // The person on their own plan: self comments / self scores only.
  if (personId === v.id && onlySelfChanges(incoming, stored)) return null;
  const f = changedFields(incoming, stored).find((k) => !/^self/i.test(k));
  return refusal(K, f, "You cannot change this plan.");
}

export function checkTargetCellWrite(v: Viewer, op: WriteOp): Refusal | null {
  if (v.superAdmin || v.admin) return null;
  return can(v, "targets", op === "create" ? "create" : op) ? null : refusal("target-cells", undefined, "You cannot change targets.");
}

/** Generic entity row write (`/api/e`, `/api/org/:kind/:id`). */
export function checkEntityWrite(
  v: Viewer,
  kind: string,
  k1: string,
  incoming: Record<string, unknown>,
  stored: { payload: Record<string, unknown>; deleted?: boolean } | null,
  deleted: boolean,
): { payload: Record<string, unknown>; refused: Refusal | null } {
  if (v.superAdmin || v.admin) return { payload: incoming, refused: null };
  const op = opOf(stored, deleted);
  const prev = stored && !stored.deleted ? stored.payload : null;
  if (kind === "settings") {
    const rule = SETTINGS_RULES[k1];
    const ok = rule ? rule.write(v) : false;
    return { payload: incoming, refused: ok ? null : refusal("settings", k1, "You cannot change this setting.") };
  }
  if (kind === "logins") {
    const mine = k1.toLowerCase() === (v.ctx.people.get(v.id)?.username || "\u0000");
    return { payload: incoming, refused: mine ? null : refusal(kind, undefined, "Only an admin can change logins.") };
  }
  if (kind === "period-reviews") {
    const pid = str(incoming.personId || prev?.personId);
    if (can(v, "apms", op === "create" ? "create" : "edit") && (!pid || inScope(v, "apms", pid))) return { payload: incoming, refused: null };
    if (pid === v.id && (op === "create" || onlySelfChanges(incoming, prev, ["status", "openedAt", "openedBy", "submittedAt", "submittedBy"]))) {
      return { payload: incoming, refused: null };
    }
    return { payload: incoming, refused: refusal(kind, undefined, "You cannot change this review.") };
  }
  if (kind === "trash") {
    // Deleting anything (a plan, an EO) files a trash row: creating one is open.
    // Restoring / deleting forever needs Settings → Trash.
    if (op === "create") return { payload: incoming, refused: null };
    return can(v, "settings-trash", "edit")
      ? { payload: incoming, refused: null }
      : { payload: incoming, refused: refusal(kind, undefined, "You cannot restore or empty trash.") };
  }
  const rule = KIND_RULES[kind];
  if (!rule) return { payload: incoming, refused: refusal(kind, undefined, "Unknown kind.") };
  if (rule.module === "any") return { payload: incoming, refused: null };
  if (rule.module === "admin") return { payload: incoming, refused: refusal(kind, undefined, "Only an admin can do that.") };
  const act: Act = rule.sub ? "edit" : op;
  if (!can(v, rule.module, act)) {
    return { payload: incoming, refused: refusal(kind, undefined, `You cannot ${op} ${kind}.`) };
  }
  if (kind === "roles") {
    const kept = preserveHidden(kind, hiddenRoleFields(v), incoming, prev);
    return kept;
  }
  return { payload: incoming, refused: null };
}

/** Book PATCH tombstones: keep only deletions this viewer may make (others are dropped, logged). */
export function filterTombstones(
  v: Viewer,
  tombs: Record<string, Record<string, unknown>> | null | undefined,
  storedTombs: Record<string, Record<string, unknown>> | null | undefined,
): { tombs: Record<string, Record<string, unknown>> | undefined; dropped: string[] } {
  if (!tombs || typeof tombs !== "object" || v.superAdmin || v.admin) return { tombs: tombs || undefined, dropped: [] };
  const out: Record<string, Record<string, unknown>> = {};
  const dropped: string[] = [];
  for (const [field, keys] of Object.entries(tombs)) {
    if (!keys || typeof keys !== "object") continue;
    const kept: Record<string, unknown> = {};
    for (const [key, at] of Object.entries(keys)) {
      const known = storedTombs?.[field] && key in (storedTombs[field] as Record<string, unknown>);
      let ok = !!known;
      if (!ok) {
        if (field === "people") {
          const pid = key.replace(/^id:/, "");
          ok = can(v, "org-people", "delete") && inScope(v, "org-people", pid) && pid !== v.id;
        } else if (field === "records") ok = false; // a whole month of APMS records: admins only
        else if (field === "rewardRecords") ok = false;
        else if (field === "targetCells") ok = can(v, "targets", "delete");
        else ok = true; // other tombstone fields are row-owned and ignored by the book merge
      }
      if (ok) kept[key] = at;
      else dropped.push(`${field}/${key}`);
    }
    out[field] = kept;
  }
  return { tombs: out, dropped };
}

// ------------------------------------------------------------ snapshots ----

function isMap(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * The company snapshot as this viewer may read it. Used for the per-viewer
 * wire (GET /api/company), `?books=`, and any other whole-snapshot read.
 */
export function filterSnapshot(v: Viewer, snap: Record<string, unknown>): Record<string, unknown> {
  if (readsEverything(v)) return snap;
  const out: Record<string, unknown> = { ...snap };
  if (Array.isArray(snap.people)) out.people = arr(snap.people).map((p) => readPerson(v, p));
  for (const [field, table] of [
    ["records", "month_records"],
    ["rewardRecords", "reward_records"],
  ] as const) {
    const tree = snap[field];
    if (!isMap(tree)) continue;
    const next: Record<string, unknown> = {};
    for (const [period, month] of Object.entries(tree)) {
      if (!isMap(month)) continue;
      const m: Record<string, unknown> = {};
      for (const [pid, rec] of Object.entries(month)) if (canReadRecord(v, table, pid)) m[pid] = rec;
      next[period] = m;
    }
    out[field] = next;
  }
  if (!canReadTargets(v)) {
    for (const f of ["targetCells", "targetNodes", "targetMembers", "targetMonthStatus", "targetRootOrder", "targetHistory", "sbuTargets"]) {
      if (f in out) out[f] = Array.isArray(out[f]) ? [] : {};
    }
  }
  if (isMap(snap.roles)) {
    const hidden = hiddenRoleFields(v);
    if (hidden.length) {
      const next: Record<string, unknown> = {};
      for (const [id, r] of Object.entries(snap.roles)) next[id] = isMap(r) ? omit(r, hidden) : r;
      out.roles = next;
    }
  }
  const listRule = (field: string, kind: string) => {
    const list = snap[field];
    if (!Array.isArray(list)) return;
    out[field] = list
      .filter((row) => isMap(row))
      .map((row) => readEntityPayload(v, kind, { k1: str((row as Record<string, unknown>).id), payload: row as Record<string, unknown> }))
      .filter((row) => row !== null);
  };
  listRule("trash", "trash");
  listRule("customReports", "custom-reports");
  listRule("reportFolders", "report-folders");
  listRule("appRequests", "app-requests");
  listRule("roleCases", "role-cases");
  listRule("agsReviews", "ags-reviews");
  if (isMap(snap.agsMonths) && !canReadEntity(v, "ags-months", { payload: {} })) out.agsMonths = {};
  if (isMap(snap.periodReviews)) {
    const next: Record<string, unknown> = {};
    for (const [id, r] of Object.entries(snap.periodReviews)) {
      if (isMap(r) && canReadEntity(v, "period-reviews", { k1: id, payload: r })) next[id] = r;
    }
    out.periodReviews = next;
  }
  if (isMap(snap.logins)) {
    const next: Record<string, unknown> = {};
    for (const [k, r] of Object.entries(snap.logins)) {
      if (canReadEntity(v, "logins", { k1: k, payload: obj(r) })) next[k] = isMap(r) ? omit(r, SECRET_FIELDS) : r;
    }
    out.logins = next;
  }
  return out;
}

/** A policy key: viewers with the same key read the same filtered snapshot. */
export function viewKey(v: Viewer): string {
  if (readsEverything(v)) return "full";
  return `p:${v.id}`;
}

// ------------------------------------------------------------------ feed ----

const HOT_FEED_KINDS: Record<string, string> = {
  people: "people",
  "month-records": "month_records",
  "reward-records": "reward_records",
  "target-cells": "target_cells",
};

/** One change-feed row as this viewer may see it, or null (not visible). */
export function filterChange<T extends { kind: string; k1?: string | null; k2?: string | null; payload?: Record<string, unknown> }>(
  v: Viewer,
  change: T,
): T | null {
  if (v.superAdmin || v.admin) return change;
  const kind = String(change.kind || "");
  if (kind === "*" || !kind) return change;
  const payload = change.payload && typeof change.payload === "object" ? change.payload : undefined;
  const hot = HOT_FEED_KINDS[kind];
  if (hot) {
    const ids = hot === "people" || hot === "target_cells" ? { id: str(change.k1) } : { personId: str(change.k1) };
    const seen = readHotRow(v, hot, ids, payload || {});
    if (!seen) return null;
    return payload ? { ...change, payload: seen } : change;
  }
  const seen = readEntityPayload(v, kind, { k1: change.k1, payload: payload || {} });
  if (!seen) return null;
  return payload ? { ...change, payload: seen } : change;
}

/** Live hints (`entities[]` on tick / SSE): drop hints for rows the viewer cannot read. */
export function filterHints<T extends { type?: string; id?: string; period?: string }>(v: Viewer, hints: T[]): T[] {
  if (v.superAdmin || v.admin || !Array.isArray(hints)) return hints;
  return hints.filter((h) => {
    const t = String(h?.type || "").replace(/_/g, "-");
    if (t === "month-records" || t === "month-record") return canReadRecord(v, "month_records", str(h.id));
    if (t === "reward-records" || t === "reward-record") return canReadRecord(v, "reward_records", str(h.id));
    if (t === "target-cells") return canReadTargets(v);
    return true;
  });
}
