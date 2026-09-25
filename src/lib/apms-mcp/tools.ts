/**
 * Aliens APMS — read-only tools for the Claude connector (MCP).
 *
 * Every tool reads the company snapshot exactly as the signed-in person's
 * browser receives it (GET /api/company → apms-permissions `filterSnapshot`),
 * so the connector can never show more than the app shows that login. Nothing
 * here writes.
 *
 * One tool per module / page of the app:
 *   Home ............ apms_overview
 *   Me .............. apms_whoami, apms_get_person
 *   Org ............. apms_org_structure, apms_search_people, apms_get_person, apms_roles, apms_get_role
 *   Roster .......... apms_roster
 *   KPI ............. apms_kpi_library, apms_kpi_scores
 *   APMS ............ apms_plans_month, apms_scorecard, apms_role_plan, apms_execution, apms_reviews
 *   Rewards ......... apms_rewards_month, apms_scorecard (kind=rewards), apms_rewards_year,
 *                     apms_targets, apms_target_history, apms_awards
 *   MIS ............. apms_mis_reports (+ every list tool for the numbers)
 *   Settings ........ apms_settings
 *   Improve / alerts  apms_notices
 *   Anything else ... apms_raw
 */
import type { Viewer } from "../apms-permissions.ts";
import { can, flag, scopeSet, ACCESS_MODULES } from "../apms-permissions.ts";
import {
  STATUS_LABEL,
  asList,
  fyLabel,
  fyMonths,
  kpiFloor,
  kpiScore,
  kpiTarget,
  milestoneOf,
  missingActuals,
  nodePath,
  nodeResult,
  groupChildren,
  groupsOf,
  personMonthPayout,
  planBrands,
  planScores,
  planStatus,
  quarterOf,
  rewardsYear,
  round2,
  scoreCtx,
  shiftMonth,
  valuesWithCatalog,
  valueScore,
  cellKey,
  kraScore,
  brandScore,
} from "./scoring.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export type RosterReader = (period: string) => Promise<Obj | null>;
export type BackupsReader = () => Promise<Obj[]>;

export type ToolEnv = {
  snap: Obj;
  viewer: Viewer;
  now: Date;
  roster: RosterReader;
  backups: BackupsReader;
};

export type JsonSchema = Record<string, unknown>;

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: Obj, env: ToolEnv) => Promise<unknown> | unknown;
};

export class ToolInputError extends Error {}

// ---------------------------------------------------------------- helpers ----

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const lower = (v: unknown) => str(v).trim().toLowerCase();

function isMap(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const SECRET_KEYS = new Set(["password", "passwordHash", "pin", "tempPassword", "token", "resetToken"]);

/** Drop anything password-like, at any depth (belt and braces over the wire slimming). */
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 40) return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (isMap(v)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = scrub(x, depth + 1);
    }
    return out;
  }
  return v;
}

/** Current month in India (the app's calendar). */
export function currentMonth(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-08", "Aug 2026", "august", "last month", "this month" → "YYYY-MM". */
export function resolveMonth(input: unknown, now = new Date()): string {
  const cur = currentMonth(now);
  const s = lower(input);
  if (!s || s === "this month" || s === "current" || s === "now") return cur;
  if (s === "last month" || s === "previous month" || s === "prev") return shiftMonth(cur, -1);
  if (s === "next month") return shiftMonth(cur, 1);
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([a-z]+)[\s,'-]*(\d{2,4})?$/);
  if (m) {
    const idx = MONTHS.findIndex((x) => m![1].startsWith(x));
    if (idx >= 0) {
      let year: number;
      if (m[2]) year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      else {
        // Bare month name: the most recent such month up to this one.
        const [cy, cm] = cur.split("-").map(Number);
        year = idx + 1 <= cm ? cy : cy - 1;
      }
      return `${year}-${String(idx + 1).padStart(2, "0")}`;
    }
  }
  throw new ToolInputError(`Could not read the month "${str(input)}". Use YYYY-MM, e.g. ${cur}.`);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

class Names {
  people = new Map<string, Obj>();
  roles: Obj;
  sbus = new Map<string, Obj>();
  brands = new Map<string, Obj>();
  functions = new Map<string, Obj>();
  companies = new Map<string, Obj>();
  constructor(snap: Obj) {
    for (const p of asList<Obj>(snap.people)) if (p && p.id) this.people.set(str(p.id), p);
    this.roles = isMap(snap.roles) ? snap.roles : {};
    for (const b of asList<Obj>(snap.businessUnits)) if (b?.id) this.sbus.set(str(b.id), b);
    for (const b of asList<Obj>(snap.brands)) if (b?.id) this.brands.set(str(b.id), b);
    for (const f of [...asList<Obj>(snap.functions), ...asList<Obj>(snap.subFunctions)]) if (f?.id) this.functions.set(str(f.id), f);
    for (const c of asList<Obj>(snap.companies)) if (c?.id) this.companies.set(str(c.id), c);
  }
  person(id: unknown) {
    const p = this.people.get(str(id));
    return p ? str(p.name || `${str(p.firstName)} ${str(p.lastName)}`.trim() || p.id) : id ? str(id) : null;
  }
  role(id: unknown) {
    const r = this.roles[str(id)];
    return r ? str(r.name || id) : id ? str(id) : null;
  }
  sbu(id: unknown) {
    const r = this.sbus.get(str(id));
    return r ? str(r.name || id) : id ? str(id) : null;
  }
  brand(id: unknown) {
    if (str(id) === "all") return "All brands";
    const r = this.brands.get(str(id));
    return r ? str(r.name || id) : id ? str(id) : null;
  }
  fn(id: unknown) {
    const r = this.functions.get(str(id));
    return r ? str(r.name || id) : id ? str(id) : null;
  }
  company(id: unknown) {
    const r = this.companies.get(str(id));
    return r ? str(r.name || id) : id ? str(id) : null;
  }
}

const namesCache = new WeakMap<Obj, Names>();
function names(snap: Obj): Names {
  let n = namesCache.get(snap);
  if (!n) {
    n = new Names(snap);
    namesCache.set(snap, n);
  }
  return n;
}

function personSbuIds(p: Obj): string[] {
  const out = new Set<string>();
  if (p.buId) out.add(str(p.buId));
  for (const b of asList(p.buIds)) if (b) out.add(str(b));
  return [...out];
}

function personBrandIds(p: Obj): string[] {
  const out = new Set<string>();
  if (p.brandId) out.add(str(p.brandId));
  for (const b of asList(p.brandIds)) if (b) out.add(str(b));
  return [...out];
}

function personFunctionIds(p: Obj): string[] {
  const out = new Set<string>();
  if (p.functionId) out.add(str(p.functionId));
  if (p.subFunctionId) out.add(str(p.subFunctionId));
  for (const s of asList<Obj>(p.functionSeats)) {
    if (s.functionId) out.add(str(s.functionId));
    if (s.subFunctionId) out.add(str(s.subFunctionId));
  }
  return [...out];
}

/** One-line person, as list screens show them. */
function personRow(snap: Obj, p: Obj): Obj {
  const n = names(snap);
  return {
    id: p.id,
    name: n.person(p.id),
    title: p.title || null,
    role: n.role(p.roleId),
    sbus: personSbuIds(p).map((b) => n.sbu(b)),
    brands: personBrandIds(p).map((b) => n.brand(b)),
    function: n.fn(p.functionId),
    manager: p.managerId ? n.person(p.managerId) : null,
    status: p.status || "active",
    access: p.accessRoleId || p.access || "employee",
    employeeCode: p.employeeCode || null,
  };
}

/** Find a person by id, username, employee code, email or name (exact first, then contains). */
export function findPeople(snap: Obj, query: unknown): Obj[] {
  const q = lower(query);
  if (!q) return [];
  const all = asList<Obj>(snap.people);
  const exact = all.filter(
    (p) =>
      lower(p.id) === q ||
      lower(p.username) === q ||
      lower(p.employeeCode) === q ||
      lower(p.email) === q ||
      lower(p.name) === q ||
      lower(`${str(p.firstName)} ${str(p.lastName)}`) === q,
  );
  if (exact.length) return exact;
  const words = q.split(/\s+/).filter(Boolean);
  return all.filter((p) => {
    const hay = `${lower(p.name)} ${lower(p.firstName)} ${lower(p.lastName)} ${lower(p.username)} ${lower(p.employeeCode)} ${lower(p.title)}`;
    return words.every((w) => hay.includes(w));
  });
}

function onePerson(snap: Obj, query: unknown, viewer: Viewer): Obj {
  const q = str(query).trim();
  if (!q || lower(q) === "me" || lower(q) === "myself") {
    const me = asList<Obj>(snap.people).find((p) => p.id === viewer.id);
    if (me) return me;
    throw new ToolInputError("Your own person record was not found in APMS.");
  }
  const hits = findPeople(snap, q);
  if (!hits.length) throw new ToolInputError(`No one matches "${q}". Try apms_search_people.`);
  if (hits.length > 1) {
    const list = hits
      .slice(0, 10)
      .map((p) => `${names(snap).person(p.id)} (id ${p.id}${p.employeeCode ? `, ${p.employeeCode}` : ""}${p.title ? `, ${p.title}` : ""})`)
      .join("; ");
    throw new ToolInputError(`"${q}" matches ${hits.length} people: ${list}. Pass the id.`);
  }
  return hits[0];
}

function findById(list: Obj[], query: unknown, label: string): Obj {
  const q = lower(query);
  const exact = list.filter((x) => lower(x.id) === q || lower(x.name) === q);
  if (exact.length === 1) return exact[0];
  const part = list.filter((x) => lower(x.name).includes(q));
  if (part.length === 1) return part[0];
  if (!exact.length && !part.length) throw new ToolInputError(`No ${label} matches "${str(query)}".`);
  const pool = exact.length ? exact : part;
  throw new ToolInputError(`"${str(query)}" matches ${pool.length} ${label}s: ${pool.slice(0, 10).map((x) => `${x.name} (id ${x.id})`).join("; ")}. Pass the id.`);
}

function sbuTreeIds(snap: Obj, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const bus = asList<Obj>(snap.businessUnits);
  const members = asList<Obj>(snap.sbuMembers);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bus) if (b.parentId && out.has(str(b.parentId)) && !out.has(str(b.id))) (out.add(str(b.id)), (grew = true));
    for (const m of members) if (out.has(str(m.groupId)) && !out.has(str(m.memberId))) (out.add(str(m.memberId)), (grew = true));
  }
  return out;
}

function functionTreeIds(snap: Obj, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const fns = [...asList<Obj>(snap.functions), ...asList<Obj>(snap.subFunctions)];
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of fns) {
      const parent = str(f.parentId || f.functionId);
      if (parent && out.has(parent) && !out.has(str(f.id))) {
        out.add(str(f.id));
        grew = true;
      }
    }
  }
  return out;
}

/** Filter people by the usual list filters (sbu / brand / function / manager / role / status). */
function filterPeople(snap: Obj, people: Obj[], args: Obj): Obj[] {
  let list = people;
  const n = names(snap);
  if (args.sbu) {
    const sbu = findById(asList(snap.businessUnits), args.sbu, "SBU");
    const ids = sbuTreeIds(snap, str(sbu.id));
    list = list.filter((p) => personSbuIds(p).some((b) => ids.has(b)));
  }
  if (args.brand) {
    const b = findById(asList(snap.brands), args.brand, "brand");
    list = list.filter((p) => personBrandIds(p).includes(str(b.id)) || personSbuIds(p).some((s) => str(n.sbus.get(s)?.brandId) === str(b.id)));
  }
  if (args.function) {
    const f = findById([...asList<Obj>(snap.functions), ...asList<Obj>(snap.subFunctions)], args.function, "function");
    const ids = functionTreeIds(snap, str(f.id));
    list = list.filter((p) => personFunctionIds(p).some((x) => ids.has(x)));
  }
  if (args.manager) {
    const m = onePerson(snap, args.manager, { id: "" } as Viewer);
    const all = asList<Obj>(snap.people);
    if (args.include_indirect) {
      const team = new Set<string>([str(m.id)]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of all)
          if (!team.has(str(p.id)) && (team.has(str(p.managerId)) || asList<Obj>(p.dottedLine).some((d) => team.has(str(d.managerId))))) {
            team.add(str(p.id));
            grew = true;
          }
      }
      team.delete(str(m.id));
      list = list.filter((p) => team.has(str(p.id)));
    } else {
      list = list.filter((p) => str(p.managerId) === str(m.id) || asList<Obj>(p.dottedLine).some((d) => str(d.managerId) === str(m.id)));
    }
  }
  if (args.role) {
    const roles = Object.values(n.roles) as Obj[];
    const r = findById(roles, args.role, "role");
    list = list.filter((p) => str(p.roleId) === str(r.id) || str(p.secondaryRoleId) === str(r.id));
  }
  if (args.status && lower(args.status) !== "all") list = list.filter((p) => lower(p.status || "active") === lower(args.status));
  else if (!args.status) list = list.filter((p) => lower(p.status || "active") !== "left");
  return list;
}

/** People whose plans this login works with on a module's list screens (team / function / company scope). */
function inModuleScope(viewer: Viewer, mod: string, people: Obj[]): Obj[] {
  if (!viewer || !viewer.pack) return people;
  const s = scopeSet(viewer, mod);
  if (s === "all") return people;
  return people.filter((p) => s.has(str(p.id)));
}

function page<T>(list: T[], args: Obj, defLimit = 50, maxLimit = 500): { total: number; offset: number; limit: number; items: T[]; more: boolean } {
  const limit = Math.max(1, Math.min(maxLimit, Number(args.limit) || defLimit));
  const offset = Math.max(0, Number(args.offset) || 0);
  const items = list.slice(offset, offset + limit);
  return { total: list.length, offset, limit, items, more: offset + items.length < list.length };
}

const PERSON_ARG = { type: "string", description: 'Person: name, username, employee code, email or id. "me" = the signed-in user.' };
const MONTH_ARG = { type: "string", description: "Month as YYYY-MM (also accepts 'Aug 2026', 'august', 'last month'). Default: this month." };
const LIMIT_ARG = { type: "integer", minimum: 1, maximum: 500, description: "Max rows (default 50)." };
const OFFSET_ARG = { type: "integer", minimum: 0, description: "Rows to skip, for paging." };
const FILTER_ARGS = {
  sbu: { type: "string", description: "Brand & SBU unit name or id (includes its child units)." },
  brand: { type: "string", description: "Brand name or id." },
  function: { type: "string", description: "Function name or id (includes sub-functions)." },
  manager: { type: "string", description: "Manager (person) — their direct + dotted-line reports." },
  include_indirect: { type: "boolean", description: "With manager: the whole team below them, not just direct reports." },
  role: { type: "string", description: "Role name or id." },
};

function obj(props: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: "object", properties: props, required, additionalProperties: false };
}

// --------------------------------------------------------- plan detail ----

function kpiRows(list: unknown, ctx: ReturnType<typeof scoreCtx>, depth = 0): Obj[] {
  return asList<Obj>(list).map((k) => {
    const kids = asList(k.children);
    const row: Obj = {
      name: k.name,
      unit: k.unit || null,
      weight: k.weight,
      target: kpiTarget(k),
      floor: kpiFloor(k),
      lowerIsBetter: !!k.lowerIsBetter,
      achieved: k.achieved ?? null,
      score: kids.length ? null : kpiScore(k, ctx),
    };
    if (k.isQualifier) row.qualifier = true;
    if (k.feedsReward === false) row.feedsReward = false;
    if (k.scope && k.scope !== "individual") row.scope = `${k.scope}${k.scopeId ? `:${k.scopeId}` : ""}`;
    if (k.linkTargetActual) row.linkedToTargets = true;
    if (k.selfAchieved != null) row.selfAchieved = k.selfAchieved;
    if (k.comment || k.note) row.note = k.comment || k.note;
    if (kids.length && depth < 4) row.children = kpiRows(kids, ctx, depth + 1);
    return row;
  });
}

function planDetail(snap: Obj, rec: Obj, month: string): Obj {
  const n = names(snap);
  const ctx = scoreCtx(snap, month);
  const scores = planScores(rec, ctx, snap.valuesCatalog);
  const brands = planBrands(rec).map((b) => ({
    brand: b.name || n.brand(b.brandId),
    weight: b.weight,
    score: brandScore(b, ctx),
    kras: asList<Obj>(b.kras).map((kra) => ({
      kra: kra.name,
      weight: kra.weight,
      score: kraScore(kra, ctx),
      kpis: kpiRows(kra.kpis, ctx),
      responsibilities: asList<Obj>(kra.responsibilities).map((r) => r.title).filter(Boolean),
    })),
  }));
  const eos = asList<Obj>(rec.priorities).map((e) => ({
    title: e.title || e.name,
    status: e.status || null,
    score: e.score ?? null,
    selfScore: e.selfScore ?? null,
    due: e.due || e.dueDate || e.end || null,
    start: e.start || null,
    owner: e.ownerId ? n.person(e.ownerId) : undefined,
    note: e.note || e.comment || undefined,
  }));
  const values = valuesWithCatalog(rec.values, snap.valuesCatalog).map((v) => ({
    value: v.name,
    weight: v.weight,
    inPlay: v.inPlay !== false,
    score: valueScore(v),
    selfScore: valueScore(v, true),
    behaviours: asList<Obj>(v.behaviours)
      .filter((b) => b.score != null || b.selfScore != null)
      .map((b) => ({ behaviour: b.name, score: b.score ?? null, selfScore: b.selfScore ?? null })),
  }));
  const status = planStatus(rec.status);
  return {
    status: STATUS_LABEL[status],
    statusId: status,
    scoringPhase: rec.scoring?.phase || null,
    heldRole: rec.heldRoleName || (rec.heldRoleId ? n.role(rec.heldRoleId) : null),
    scores: {
      kpi: scores.kpi,
      execution: scores.exec,
      values: scores.values,
      pScore: scores.p,
      rating: scores.rating,
      valuesDrag: scores.drag,
      mix: scores.mix,
    },
    missingActuals: missingActuals(rec),
    brands,
    executionOutcomes: eos,
    values,
    notes: rec.notes || null,
    selfNotes: rec.selfNotes || null,
    dq: rec.dq || null,
    authors: rec.authors ? Object.fromEntries(Object.entries(rec.authors as Obj).map(([k, v]) => [k, isMap(v) ? { ...v, by: v.by ? n.person(v.by) : v.by } : v])) : null,
  };
}

function monthRecords(snap: Obj, field: "records" | "rewardRecords", month: string): Obj {
  const tree = snap[field];
  return isMap(tree) && isMap(tree[month]) ? tree[month] : {};
}

function monthsWith(snap: Obj, field: "records" | "rewardRecords", personId: string): string[] {
  const tree = isMap(snap[field]) ? (snap[field] as Obj) : {};
  return Object.keys(tree)
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && isMap(tree[m]) && isMap(tree[m][personId]) && (tree[m][personId].kras || tree[m][personId].brands))
    .sort();
}

function isRealRecord(rec: unknown): rec is Obj {
  return isMap(rec) && (Array.isArray(rec.kras) || Array.isArray(rec.brands) || rec.status != null);
}

// ------------------------------------------------------------------ tools ----

const whoami: ToolDef = {
  name: "apms_whoami",
  title: "Who am I in APMS",
  description:
    "The signed-in APMS person, their access role and scope, and which APMS modules they can see. Call this first when unsure what data is available.",
  inputSchema: obj({}),
  run(_a, { snap, viewer, now }) {
    const me = asList<Obj>(snap.people).find((p) => p.id === viewer.id);
    const modules = ACCESS_MODULES.map((m) => m.id).filter((m) => can(viewer, m, "view"));
    const scope = viewer.admin ? "company" : viewer.pack.scope;
    const seen = scopeSet(viewer, "apms");
    return {
      person: me ? personRow(snap, me) : { id: viewer.id },
      accessRole: viewer.access,
      accessBase: viewer.base,
      admin: viewer.admin,
      scope,
      peopleInScopeForApms: seen === "all" ? "everyone" : seen.size,
      modulesVisible: modules,
      extraRights: ["pay", "personal", "approve", "unlock", "changelog"].filter((f) => flag(viewer, f)),
      currentMonth: currentMonth(now),
      note: "All tools are read-only and return only what this login can see in the APMS app.",
    };
  },
};

const overview: ToolDef = {
  name: "apms_overview",
  title: "Company overview (Home)",
  description:
    "Home-page view: headcount by status / SBU / function, the APMS and Rewards progress for a month (plans open / locked / closed, scored, average P-score, rewards earned), target month status, and open alerts (people without a role, manager, login, APMS or Rewards plan).",
  inputSchema: obj({ month: MONTH_ARG }),
  run(a, { snap, now }) {
    const month = resolveMonth(a.month, now);
    const n = names(snap);
    const people = asList<Obj>(snap.people);
    const active = people.filter((p) => lower(p.status || "active") !== "left");
    const count = (list: Obj[], key: (p: Obj) => string[]) => {
      const m = new Map<string, number>();
      for (const p of list) for (const k of key(p).length ? key(p) : ["(none)"]) m.set(k, (m.get(k) || 0) + 1);
      return Object.fromEntries([...m.entries()].sort((x, y) => y[1] - x[1]));
    };
    const progress = (field: "records" | "rewardRecords") => {
      const recs = monthRecords(snap, field, month);
      const st: Obj = { plan_open: 0, plan_locked: 0, closed: 0 };
      let pSum = 0;
      let pN = 0;
      let earned = 0;
      let withPlan = 0;
      for (const [pid, rec] of Object.entries(recs)) {
        if (!isRealRecord(rec)) continue;
        withPlan += 1;
        st[planStatus(rec.status)] += 1;
        if (field === "records") {
          const s = planScores(rec, scoreCtx(snap, month), snap.valuesCatalog);
          if (s.p != null) (pSum += s.p), (pN += 1);
        } else {
          const person = n.people.get(pid);
          if (person) earned += personMonthPayout(snap, person, month, now).payout.earned;
        }
      }
      const base: Obj = { peopleWithPlan: withPlan, planOpen: st.plan_open, planLocked: st.plan_locked, closed: st.closed };
      if (field === "records") base.avgPScore = pN ? round2(pSum / pN) : null;
      else base.totalEarned = earned;
      return base;
    };
    const apmsIds = new Set(Object.keys(monthRecords(snap, "records", month)));
    const rewardIds = new Set(Object.keys(monthRecords(snap, "rewardRecords", month)));
    const logins = isMap(snap.logins) ? Object.values(snap.logins as Obj).map((l: any) => str(l?.personId)) : [];
    const loginSet = new Set(logins);
    const openNotices = asList<Obj>(snap.notices).filter((x) => x.status !== "closed" && x.status !== "done" && x.status !== "dismissed");
    return {
      month,
      monthLabel: monthLabel(month),
      headcount: {
        total: people.length,
        byStatus: count(people, (p) => [str(p.status || "active")]),
        activeBySbu: count(active, (p) => personSbuIds(p).map((b) => str(n.sbu(b)))),
        activeByFunction: count(active, (p) => (p.functionId ? [str(n.fn(p.functionId))] : [])),
      },
      apms: progress("records"),
      rewards: progress("rewardRecords"),
      targetsMonthStatus: (snap.targetMonthStatus || {})[month] || null,
      alerts: {
        withoutRole: active.filter((p) => !p.roleId).length,
        withoutManager: active.filter((p) => !p.managerId && p.access !== "super_admin").length,
        withoutLogin: loginSet.size ? active.filter((p) => !p.username && !loginSet.has(str(p.id))).length : null,
        withoutApmsPlanThisMonth: active.filter((p) => !apmsIds.has(str(p.id))).length,
        withoutRewardsPlanThisMonth: active.filter((p) => !rewardIds.has(str(p.id))).length,
        openNotices: openNotices.length,
      },
      monthsInUse: asList(snap.months),
    };
  },
};

const searchPeople: ToolDef = {
  name: "apms_search_people",
  title: "Search people (Org → People)",
  description:
    "List / search people with Org → People filters: text (name, username, code, title), SBU, brand, function, manager (optionally the whole team below), role, status (active / left / paused / joining / all; default hides 'left'). Returns one line per person.",
  inputSchema: obj({
    query: { type: "string", description: "Text to match against name, username, employee code, title." },
    ...FILTER_ARGS,
    status: { type: "string", description: "active | left | paused | joining | all. Default: everyone except left." },
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap }) {
    let list = asList<Obj>(snap.people);
    if (a.query) list = findPeople(snap, a.query);
    list = filterPeople(snap, list, a);
    list = [...list].sort((x, y) => str(names(snap).person(x.id)).localeCompare(str(names(snap).person(y.id))));
    const p = page(list.map((x) => personRow(snap, x)), a, 50);
    return { ...p, people: p.items, items: undefined };
  },
};

const getPerson: ToolDef = {
  name: "apms_get_person",
  title: "Person profile (Org → Person / Me)",
  description:
    "Full profile of one person: placement (company, brands, SBUs, function, role, manager chain, dotted lines, direct reports), role history, reward slabs and pay (only if your login may see pay), personal details (only if allowed), and a month-by-month summary of their APMS P-score and Rewards payout.",
  inputSchema: obj({ person: PERSON_ARG }, ["person"]),
  run(a, { snap, viewer, now }) {
    const p = onePerson(snap, a.person, viewer);
    const n = names(snap);
    const chain: string[] = [];
    let cur = p;
    const seen = new Set<string>();
    while (cur?.managerId && !seen.has(str(cur.managerId)) && chain.length < 12) {
      seen.add(str(cur.managerId));
      chain.push(str(n.person(cur.managerId)));
      cur = n.people.get(str(cur.managerId)) as Obj;
    }
    const people = asList<Obj>(snap.people);
    const direct = people.filter((x) => str(x.managerId) === str(p.id) && lower(x.status || "active") !== "left");
    const dotted = people.filter((x) => asList<Obj>(x.dottedLine).some((d) => str(d.managerId) === str(p.id)) && lower(x.status || "active") !== "left");
    const apms = monthsWith(snap, "records", str(p.id)).map((m) => {
      const rec = snap.records[m][p.id];
      const s = planScores(rec, scoreCtx(snap, m), snap.valuesCatalog);
      return { month: m, status: STATUS_LABEL[planStatus(rec.status)], pScore: s.p, rating: s.rating, kpi: s.kpi, execution: s.exec, values: s.values };
    });
    const rewards = monthsWith(snap, "rewardRecords", str(p.id)).map((m) => {
      const r = personMonthPayout(snap, p, m, now);
      return {
        month: m,
        status: STATUS_LABEL[planStatus(r.record?.status)],
        milestone: r.payout.milestone ? `M${r.payout.milestone}` : "none",
        earned: r.payout.earned,
        dq: r.payout.dq,
        target: r.unlock.label,
      };
    });
    const hidden = new Set(["password", "roleHistory", "functionSeats", "dottedLine", "rewardsSlabs", "buIds", "brandIds"]);
    const raw: Obj = {};
    for (const [k, v] of Object.entries(p)) if (!hidden.has(k)) raw[k] = v;
    return {
      ...personRow(snap, p),
      company: n.company(p.companyId),
      secondaryRole: p.secondaryRoleId ? n.role(p.secondaryRoleId) : null,
      managerChain: chain,
      dottedLineManagers: asList<Obj>(p.dottedLine).map((d) => ({ manager: n.person(d.managerId), function: n.fn(d.functionId) })),
      functionSeats: asList<Obj>(p.functionSeats).map((s) => ({ function: n.fn(s.functionId), subFunction: n.fn(s.subFunctionId), manager: n.person(s.managerId), kind: s.kind })),
      directReports: direct.map((x) => ({ id: x.id, name: n.person(x.id), title: x.title || null })),
      dottedReports: dotted.map((x) => ({ id: x.id, name: n.person(x.id), title: x.title || null })),
      roleHistory: asList<Obj>(p.roleHistory).map((r) => ({ role: r.roleName || n.role(r.roleId), title: r.title, function: n.fn(r.functionId), from: r.effectiveFrom, to: r.effectiveTo, reason: r.reason })),
      rewardSlabs: p.rewardsSlabs || null,
      targetUnit: p.gateUnitId ? str((snap.gateUnits || {})[p.gateUnitId]?.name || p.gateUnitId) : null,
      apmsByMonth: apms,
      rewardsByMonth: rewards,
      fields: raw,
    };
  },
};

const orgStructure: ToolDef = {
  name: "apms_org_structure",
  title: "Org structure (Org → Overview / Brands & SBUs / Functions)",
  description:
    "Companies, brands, Brands & SBUs units (tree with parent / group membership and headcount), and functions / sub-functions (tree with heads and headcount).",
  inputSchema: obj({
    section: { type: "string", enum: ["all", "companies", "brands", "sbus", "functions"], description: "Default all." },
  }),
  run(a, { snap }) {
    const n = names(snap);
    const section = str(a.section || "all");
    const active = asList<Obj>(snap.people).filter((p) => lower(p.status || "active") !== "left");
    const out: Obj = {};
    if (section === "all" || section === "companies") {
      out.companies = asList<Obj>(snap.companies).map((c) => ({ id: c.id, name: c.name, factor: c.factor ?? c.companyFactor ?? null }));
      out.companyFactor = snap.companyFactor ?? null;
    }
    if (section === "all" || section === "brands") {
      out.brands = asList<Obj>(snap.brands).map((b) => ({
        id: b.id,
        name: b.name,
        company: n.company(b.companyId),
        units: asList<Obj>(snap.businessUnits).filter((u) => str(u.brandId) === str(b.id)).length,
        headcount: active.filter((p) => personBrandIds(p).includes(str(b.id))).length,
      }));
    }
    if (section === "all" || section === "sbus") {
      const groupsOfUnit = (id: string) => asList<Obj>(snap.sbuMembers).filter((m) => str(m.memberId) === id).map((m) => n.sbu(m.groupId));
      out.sbus = asList<Obj>(snap.businessUnits).map((u) => {
        const tree = sbuTreeIds(snap, str(u.id));
        return {
          id: u.id,
          name: u.name,
          kind: u.kind || null,
          isGroup: !!u.isGroup,
          brand: n.brand(u.brandId),
          parent: u.parentId ? n.sbu(u.parentId) : null,
          groups: groupsOfUnit(str(u.id)),
          headcountDirect: active.filter((p) => personSbuIds(p).includes(str(u.id))).length,
          headcountWithChildren: active.filter((p) => personSbuIds(p).some((b) => tree.has(b))).length,
        };
      });
    }
    if (section === "all" || section === "functions") {
      const fns = [...asList<Obj>(snap.functions), ...asList<Obj>(snap.subFunctions)];
      out.functions = fns.map((f) => ({
        id: f.id,
        name: f.name,
        parent: f.parentId || f.functionId ? n.fn(f.parentId || f.functionId) : null,
        head: f.headId ? n.person(f.headId) : null,
        shared: !!f.shared,
        brands: asList(f.brandIds).map((b) => n.brand(b)),
        headcount: active.filter((p) => personFunctionIds(p).some((x) => functionTreeIds(snap, str(f.id)).has(x))).length,
        description: f.description || undefined,
      }));
    }
    return out;
  },
};

const rolesList: ToolDef = {
  name: "apms_roles",
  title: "Roles (Org → Roles)",
  description: "All roles with band, function, reports-to role, number of people holding each, and KRA count. Filter by text or function.",
  inputSchema: obj({ query: { type: "string" }, function: FILTER_ARGS.function, limit: LIMIT_ARG, offset: OFFSET_ARG }),
  run(a, { snap }) {
    const n = names(snap);
    let roles = Object.entries(n.roles).map(([id, r]) => ({ id, ...(r as Obj) })) as Obj[];
    if (a.query) roles = roles.filter((r) => lower(r.name).includes(lower(a.query)) || lower(r.id) === lower(a.query));
    if (a.function) {
      const f = findById([...asList<Obj>(snap.functions), ...asList<Obj>(snap.subFunctions)], a.function, "function");
      const ids = functionTreeIds(snap, str(f.id));
      roles = roles.filter((r) => ids.has(str(r.functionId)) || ids.has(str(r.subFunctionId)));
    }
    const people = asList<Obj>(snap.people).filter((p) => lower(p.status || "active") !== "left");
    const rows = roles
      .map((r) => ({
        id: r.id,
        name: r.name,
        band: r.band ?? null,
        bandLabel: r.bandLabel || null,
        function: n.fn(r.functionId),
        reportsTo: asList(r.reportsToRoleIds).length ? asList(r.reportsToRoleIds).map((x) => n.role(x)) : r.reportsToRoleId ? [n.role(r.reportsToRoleId)] : [],
        people: people.filter((p) => str(p.roleId) === str(r.id)).length,
        kras: asList(r.kras).length,
      }))
      .sort((x, y) => (Number(y.band) || 0) - (Number(x.band) || 0) || str(x.name).localeCompare(str(y.name)));
    const p = page(rows, a, 100);
    return { ...p, roles: p.items, items: undefined };
  },
};

const getRole: ToolDef = {
  name: "apms_get_role",
  title: "Role detail (Org → Roles → role)",
  description:
    "One role's full definition: KRAs with KPIs (target, floor, weight, unit), responsibilities, competencies, AGS weights, reward slabs and salary range (only if your login may see pay), and the people holding it.",
  inputSchema: obj({ role: { type: "string", description: "Role name or id." } }, ["role"]),
  run(a, { snap }) {
    const n = names(snap);
    const r = findById(Object.entries(n.roles).map(([id, x]) => ({ id, ...(x as Obj) })), a.role, "role");
    const holders = asList<Obj>(snap.people).filter((p) => str(p.roleId) === str(r.id) && lower(p.status || "active") !== "left");
    return {
      id: r.id,
      name: r.name,
      band: r.band ?? null,
      bandLabel: r.bandLabel || null,
      function: n.fn(r.functionId),
      subFunction: n.fn(r.subFunctionId),
      reportsTo: asList(r.reportsToRoleIds).length ? asList(r.reportsToRoleIds).map((x) => n.role(x)) : r.reportsToRoleId ? [n.role(r.reportsToRoleId)] : [],
      kras: asList<Obj>(r.kras).map((k) => ({
        kra: k.name,
        weight: k.weight,
        kpis: kpiRows(k.kpis, {}),
        responsibilities: asList<Obj>(k.responsibilities).map((x) => x.title).filter(Boolean),
        performanceOutcomes: asList(k.performanceOutcomes),
        executionOutcomes: asList(k.executionOutcomes),
      })),
      competencies: asList(r.competencies),
      ags: r.ags || null,
      slabs: r.slabs || null,
      salaryFrom: r.salaryFrom ?? null,
      salaryTo: r.salaryTo ?? null,
      apmsFunctions: asList(r.apmsFunctions).map((x) => n.fn(x)),
      holders: holders.map((p) => ({ id: p.id, name: n.person(p.id), sbus: personSbuIds(p).map((b) => n.sbu(b)) })),
    };
  },
};

const kpiLibrary: ToolDef = {
  name: "apms_kpi_library",
  title: "KPI library (KPI)",
  description: "The KPI master list (name, unit, group, aliases, description) and the company values catalog with behaviours. Filter by text or group.",
  inputSchema: obj({ query: { type: "string" }, group: { type: "string" }, include_values: { type: "boolean", description: "Include the values catalog (default true)." }, limit: LIMIT_ARG, offset: OFFSET_ARG }),
  run(a, { snap }) {
    let list = asList<Obj>(snap.kpiMaster);
    if (a.query) list = list.filter((k) => lower(k.name).includes(lower(a.query)) || asList(k.aliases).some((x) => lower(x).includes(lower(a.query))) || lower(k.blurb).includes(lower(a.query)));
    if (a.group) list = list.filter((k) => lower(k.group) === lower(a.group));
    const p = page(
      list.map((k) => ({ id: k.id, name: k.name, unit: k.unit || null, group: k.group || null, aliases: asList(k.aliases), description: k.blurb || null })),
      a,
      100,
    );
    const out: Obj = { ...p, kpis: p.items, items: undefined };
    if (a.include_values !== false) {
      out.valuesCatalog = asList<Obj>(snap.valuesCatalog).map((v) => ({
        value: v.name,
        weight: v.weight,
        meaning: v.meaning || null,
        behaviours: asList<Obj>(v.behaviours).map((b) => ({ behaviour: b.name, meaning: b.meaning })),
      }));
    }
    return out;
  },
};

const plansMonth: ToolDef = {
  name: "apms_plans_month",
  title: "APMS plans for a month (APMS → Plans)",
  description:
    "Everyone's APMS plan for a month as the Plans page lists it: status (Plan open / Plan locked / Closed), KPI / Execution / Values scores, P-score and rating, and how many KPIs still need an actual. Filters: SBU, brand, function, manager, role, status. Also lists the APMS plan templates.",
  inputSchema: obj({
    month: MONTH_ARG,
    ...FILTER_ARGS,
    plan_status: { type: "string", enum: ["plan_open", "plan_locked", "closed", "missing"], description: "Only this status ('missing' = no plan this month)." },
    sort: { type: "string", enum: ["name", "pscore_desc", "pscore_asc"], description: "Default name." },
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap, viewer, now }) {
    const month = resolveMonth(a.month, now);
    const n = names(snap);
    const recs = monthRecords(snap, "records", month);
    const people = inModuleScope(viewer, "apms", filterPeople(snap, asList<Obj>(snap.people), a));
    let rows = people.map((p) => {
      const rec = recs[p.id];
      if (!isRealRecord(rec)) return { ...personRow(snap, p), plan: "missing" };
      const s = planScores(rec, scoreCtx(snap, month), snap.valuesCatalog);
      const st = planStatus(rec.status);
      return {
        id: p.id,
        name: n.person(p.id),
        role: rec.heldRoleName || n.role(p.roleId),
        sbus: personSbuIds(p).map((b) => n.sbu(b)),
        manager: p.managerId ? n.person(p.managerId) : null,
        plan: st,
        status: STATUS_LABEL[st],
        kpi: s.kpi,
        execution: s.exec,
        values: s.values,
        pScore: s.p,
        rating: s.rating,
        kpisMissingActual: missingActuals(rec).length,
      } as Obj;
    });
    if (a.plan_status) rows = rows.filter((r) => r.plan === a.plan_status);
    const pOf = (r: Obj) => (typeof r.pScore === "number" ? r.pScore : null);
    const last = (r: Obj) => (r.plan === "missing" ? 1 : 0);
    if (a.sort === "pscore_desc") rows.sort((x, y) => last(x) - last(y) || (pOf(y) ?? -1) - (pOf(x) ?? -1));
    else if (a.sort === "pscore_asc") rows.sort((x, y) => last(x) - last(y) || (pOf(x) ?? 99) - (pOf(y) ?? 99));
    else rows.sort((x, y) => str(x.name).localeCompare(str(y.name)));
    const scored = rows.map(pOf).filter((x): x is number => x != null);
    const summary = {
      people: rows.length,
      planOpen: rows.filter((r) => r.plan === "plan_open").length,
      planLocked: rows.filter((r) => r.plan === "plan_locked").length,
      closed: rows.filter((r) => r.plan === "closed").length,
      missing: rows.filter((r) => r.plan === "missing").length,
      avgPScore: scored.length ? round2(scored.reduce((x, y) => x + y, 0) / scored.length) : null,
    };
    const p = page(rows, a, 100);
    return {
      month,
      summary,
      ...p,
      rows: p.items,
      items: undefined,
      planTemplates: Object.values((snap.apmsPlans || {}) as Obj).map((t: any) => ({ id: t.id, name: t.name, role: n.role(t.roleId), function: n.fn(t.functionId), people: asList(t.peopleIds).length })),
    };
  },
};

const scorecard: ToolDef = {
  name: "apms_scorecard",
  title: "Scorecard for one person-month (APMS / Rewards)",
  description:
    "One person's plan for one month, as the scorecard screen shows it. kind=apms: KPI / Execution / Values scores, P-score and rating, every brand → KRA → KPI with target, floor, achieved and 0–5 score, execution outcomes (EOs), values and behaviour scores, notes. kind=rewards: the same plan plus the target that unlocks the reward (ladder M1–M5 and actual), milestone reached, pot, KPI multiplier, qualifiers / disqualifiers and amount earned.",
  inputSchema: obj(
    {
      person: PERSON_ARG,
      month: MONTH_ARG,
      kind: { type: "string", enum: ["apms", "rewards"], description: "Default apms." },
    },
    ["person"],
  ),
  run(a, { snap, viewer, now }) {
    const p = onePerson(snap, a.person, viewer);
    const month = resolveMonth(a.month, now);
    const kind = a.kind === "rewards" ? "rewards" : "apms";
    const field = kind === "rewards" ? "rewardRecords" : "records";
    const rec = monthRecords(snap, field, month)[p.id];
    const n = names(snap);
    if (!isRealRecord(rec)) {
      const has = monthsWith(snap, field, str(p.id));
      return {
        person: n.person(p.id),
        month,
        kind,
        plan: null,
        note: `No ${kind === "rewards" ? "Rewards" : "APMS"} plan for ${n.person(p.id)} in ${monthLabel(month)} (or your login cannot see it).`,
        monthsWithPlans: has,
      };
    }
    const out: Obj = { person: n.person(p.id), personId: p.id, month, kind, ...planDetail(snap, rec, month) };
    if (kind === "rewards") {
      const r = personMonthPayout(snap, p, month, now);
      out.target = {
        source: r.unlock.source,
        name: r.unlock.label,
        metric: r.unlock.metric || null,
        ladder: r.unlock.ladder,
        actual: r.unlock.actual,
        milestoneHit: r.unlock.hit ? `M${r.unlock.hit}` : "none",
      };
      out.payout = {
        milestone: r.payout.milestone ? `M${r.payout.milestone}` : "none",
        pot: r.payout.pot,
        kpiMultiplier: r.payout.multiplier,
        earned: r.payout.earned,
        disqualified: r.payout.dq,
        dqReason: r.payout.dqReason || null,
        qualifiersOk: r.payout.qualifiersOk,
        blockedBy: r.payout.qualifierFails,
        formula: "earned = pot(slab at milestone) × KPI score ÷ 5, if every qualifier is on and no qualifier KPI is below its floor; 0 if disqualified",
      };
      out.rewardFlags = asList<Obj>(rec.rewardFlags).map((f) => ({ name: f.name, kind: f.kind, on: !!f.on, note: f.note || undefined }));
      out.slabs = p.rewardsSlabs || (snap.roles || {})[p.roleId]?.slabs || null;
    }
    out.computedNote = "Scores and payouts are computed with the same formulas as the APMS screens.";
    return out;
  },
};

const rolePlan: ToolDef = {
  name: "apms_role_plan",
  title: "Role plan for a month (role scorecard)",
  description: "A role's month plan (the template people in that role inherit): KRAs / KPIs / EOs / values and status, for APMS or Rewards.",
  inputSchema: obj({ role: { type: "string", description: "Role name or id." }, month: MONTH_ARG, kind: { type: "string", enum: ["apms", "rewards"] } }, ["role"]),
  run(a, { snap, now }) {
    const n = names(snap);
    const r = findById(Object.entries(n.roles).map(([id, x]) => ({ id, ...(x as Obj) })), a.role, "role");
    const month = resolveMonth(a.month, now);
    const tree = (a.kind === "rewards" ? snap.rewardRoleMonths : snap.roleMonths) || {};
    const rec = tree[r.id]?.[month];
    const months = Object.keys(tree[r.id] || {}).sort();
    if (!isRealRecord(rec)) return { role: r.name, month, plan: null, note: `No role plan for ${r.name} in ${monthLabel(month)}.`, monthsWithPlans: months };
    return { role: r.name, month, kind: a.kind === "rewards" ? "rewards" : "apms", ...planDetail(snap, rec, month), monthsWithPlans: months };
  },
};

const execution: ToolDef = {
  name: "apms_execution",
  title: "Execution outcomes (APMS → EO)",
  description:
    "Execution outcomes (EOs / priorities) from APMS plans over a month range: owner, title, status (planned / started / complete / overdue / dropped), dates and score. Filter by person, SBU, function, manager, status.",
  inputSchema: obj({
    from: { type: "string", description: "First month (default: this month)." },
    to: { type: "string", description: "Last month (default: same as from)." },
    person: PERSON_ARG,
    ...FILTER_ARGS,
    eo_status: { type: "string", description: "Only EOs with this status." },
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap, viewer, now }) {
    const from = resolveMonth(a.from, now);
    const to = a.to ? resolveMonth(a.to, now) : from;
    if (to < from) throw new ToolInputError("'to' is before 'from'.");
    const n = names(snap);
    let people = a.person ? [onePerson(snap, a.person, viewer)] : inModuleScope(viewer, "apms", filterPeople(snap, asList<Obj>(snap.people), a));
    const ids = new Set(people.map((p) => str(p.id)));
    people = [];
    const rows: Obj[] = [];
    const tree = isMap(snap.records) ? (snap.records as Obj) : {};
    for (const m of Object.keys(tree).sort()) {
      if (m < from || m > to) continue;
      for (const [pid, rec] of Object.entries(tree[m] || {})) {
        if (!ids.has(pid) || !isRealRecord(rec)) continue;
        for (const e of asList<Obj>(rec.priorities)) {
          if (a.eo_status && lower(e.status) !== lower(a.eo_status)) continue;
          rows.push({
            month: m,
            person: n.person(pid),
            eo: e.title || e.name,
            status: e.status || null,
            start: e.start || null,
            due: e.due || e.dueDate || e.end || null,
            score: e.score ?? null,
            selfScore: e.selfScore ?? null,
          });
        }
      }
    }
    const byStatus: Obj = {};
    for (const r of rows) byStatus[str(r.status || "none")] = (byStatus[str(r.status || "none")] || 0) + 1;
    const p = page(rows, a, 100);
    return { from, to, byStatus, ...p, eos: p.items, items: undefined };
  },
};

const reviews: ToolDef = {
  name: "apms_reviews",
  title: "Quarterly reviews and AGS (APMS)",
  description: "Quarterly period reviews and AGS reviews (with AGS month scores), optionally for one person.",
  inputSchema: obj({ kind: { type: "string", enum: ["all", "quarterly", "ags"] }, person: PERSON_ARG, limit: LIMIT_ARG, offset: OFFSET_ARG }),
  run(a, { snap, viewer }) {
    const n = names(snap);
    const pid = a.person ? str(onePerson(snap, a.person, viewer).id) : null;
    const kind = str(a.kind || "all");
    const out: Obj = {};
    const who = (r: Obj) => str(r.personId || r.subjectId || r.employeeId || "");
    if (kind === "all" || kind === "quarterly") {
      let list = Object.entries((snap.periodReviews || {}) as Obj).map(([id, r]) => ({ id, ...(r as Obj) })) as Obj[];
      if (pid) list = list.filter((r) => who(r) === pid);
      const p = page(list.map((r) => ({ ...r, person: who(r) ? n.person(who(r)) : null })), a, 50);
      out.quarterly = { ...p, reviews: p.items, items: undefined };
    }
    if (kind === "all" || kind === "ags") {
      let list = asList<Obj>(snap.agsReviews);
      if (pid) list = list.filter((r) => who(r) === pid);
      const p = page(list.map((r) => ({ ...r, person: who(r) ? n.person(who(r)) : null })), a, 50);
      out.ags = { ...p, reviews: p.items, items: undefined };
      const months = (snap.agsMonths || {}) as Obj;
      out.agsMonths = pid ? Object.fromEntries(Object.entries(months).map(([m, v]) => [m, (v as Obj)?.[pid]]).filter(([, v]) => v)) : Object.keys(months);
    }
    return out;
  },
};

const rewardsMonth: ToolDef = {
  name: "apms_rewards_month",
  title: "Rewards for a month (Rewards → Plans)",
  description:
    "Everyone's Rewards plan for a month: status, target unit, actual vs ladder, milestone reached (M1–M5), pot, KPI multiplier, disqualified / qualifier blocks, and amount earned, with totals. Filters: SBU, brand, function, manager, role, status.",
  inputSchema: obj({
    month: MONTH_ARG,
    ...FILTER_ARGS,
    plan_status: { type: "string", enum: ["plan_open", "plan_locked", "closed", "missing"] },
    sort: { type: "string", enum: ["name", "earned_desc", "earned_asc"] },
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap, viewer, now }) {
    const month = resolveMonth(a.month, now);
    const n = names(snap);
    const recs = monthRecords(snap, "rewardRecords", month);
    const people = inModuleScope(viewer, "rewards", filterPeople(snap, asList<Obj>(snap.people), a));
    let rows: Obj[] = people.map((p) => {
      const rec = recs[p.id];
      if (!isRealRecord(rec)) return { ...personRow(snap, p), plan: "missing" };
      const r = personMonthPayout(snap, p, month, now);
      const st = planStatus(rec.status);
      return {
        id: p.id,
        name: n.person(p.id),
        role: rec.heldRoleName || n.role(p.roleId),
        sbus: personSbuIds(p).map((b) => n.sbu(b)),
        plan: st,
        status: STATUS_LABEL[st],
        target: r.unlock.label,
        actual: r.unlock.actual,
        ladder: r.unlock.ladder,
        milestone: r.payout.milestone ? `M${r.payout.milestone}` : "none",
        pot: r.payout.pot,
        kpiMultiplier: r.payout.multiplier,
        earned: r.payout.earned,
        dq: r.payout.dq,
        blockedBy: r.payout.qualifierFails.length ? r.payout.qualifierFails : undefined,
      };
    });
    if (a.plan_status) rows = rows.filter((r) => r.plan === a.plan_status);
    const last = (r: Obj) => (r.plan === "missing" ? 1 : 0);
    if (a.sort === "earned_desc") rows.sort((x, y) => last(x) - last(y) || (Number(y.earned) || 0) - (Number(x.earned) || 0));
    else if (a.sort === "earned_asc") rows.sort((x, y) => last(x) - last(y) || (Number(x.earned) || 0) - (Number(y.earned) || 0));
    else rows.sort((x, y) => str(x.name).localeCompare(str(y.name)));
    const summary = {
      people: rows.length,
      planOpen: rows.filter((r) => r.plan === "plan_open").length,
      planLocked: rows.filter((r) => r.plan === "plan_locked").length,
      closed: rows.filter((r) => r.plan === "closed").length,
      missing: rows.filter((r) => r.plan === "missing").length,
      disqualified: rows.filter((r) => r.dq).length,
      totalEarned: rows.reduce((x, r) => x + (Number(r.earned) || 0), 0),
      byMilestone: rows.reduce((acc: Obj, r) => {
        if (r.plan !== "missing") acc[str(r.milestone)] = (acc[str(r.milestone)] || 0) + 1;
        return acc;
      }, {}),
    };
    const p = page(rows, a, 100);
    return { month, summary, ...p, rows: p.items, items: undefined };
  },
};

const rewardsYearTool: ToolDef = {
  name: "apms_rewards_year",
  title: "Rewards year for a person (Rewards → person)",
  description:
    "A person's Rewards financial year (Apr–Mar): each month's milestone and payout, each quarter's roll-up (achievement %, quarter milestone, true-up, consistency bonus) and the year total — as the Rewards person / quarter / year view builds it.",
  inputSchema: obj({ person: PERSON_ARG, month: { type: "string", description: "Any month in the FY (default: this month)." } }, ["person"]),
  run(a, { snap, viewer, now }) {
    const p = onePerson(snap, a.person, viewer);
    const month = resolveMonth(a.month, now);
    const y = rewardsYear(snap, p, month, now);
    if (!y) return { person: names(snap).person(p.id), note: "This person has no role, so no Rewards year can be built." };
    return { person: names(snap).person(p.id), slabs: p.rewardsSlabs || (snap.roles || {})[p.roleId]?.slabs || null, ...y };
  },
};

const targets: ToolDef = {
  name: "apms_targets",
  title: "Targets for a month (Rewards → Targets)",
  description:
    "The Targets sheet for a month: every target node (studio / SBU / group) with its path, metric, ladder M1–M5, actual, % of M1, milestone reached, mode (set / roll-up) and lock status, groups rolling up their members. Also the month's target status and the gate units (older target units) with their month actuals. Filter to one node / SBU (includes what rolls into it).",
  inputSchema: obj({
    month: MONTH_ARG,
    node: { type: "string", description: "Target node name / id, or an SBU name — only that node and what rolls into it." },
    include_gate_units: { type: "boolean", description: "Include gate units (default true)." },
  }),
  run(a, { snap, now }) {
    const month = resolveMonth(a.month, now);
    const nodes = (snap.targetNodes || {}) as Obj;
    const members = asList<Obj>(snap.targetMembers);
    const cells = (snap.targetCells || {}) as Obj;
    const n = names(snap);
    const inMonth = new Set<string>();
    for (const m of members) if (m.month === month) (inMonth.add(str(m.groupId)), inMonth.add(str(m.memberId)));
    for (const c of Object.values(cells) as Obj[]) if (c && c.month === month && c.nodeId) inMonth.add(str(c.nodeId));
    let ids = [...inMonth].filter((id) => nodes[id]);
    if (a.node) {
      const list = Object.values(nodes) as Obj[];
      const q = lower(a.node);
      let root = list.find((x) => lower(x.id) === q || lower(x.name) === q) || list.find((x) => lower(x.name).includes(q));
      if (!root) {
        const sbu = asList<Obj>(snap.businessUnits).find((u) => lower(u.name) === q || lower(u.id) === q);
        if (sbu) root = list.find((x) => str(x.sbuId) === str(sbu.id));
      }
      if (!root) throw new ToolInputError(`No target node matches "${str(a.node)}".`);
      const keep = new Set<string>([str(root.id)]);
      const walk = (id: string) => {
        for (const k of groupChildren(members, id, month)) if (!keep.has(k)) (keep.add(k), walk(k));
      };
      walk(str(root.id));
      ids = [...keep];
    }
    const rows = ids.map((id) => {
      const node = nodes[id];
      const r = nodeResult(nodes, members, cells, id, month, [], now);
      const m1 = Number(r.ladder.M1) || 0;
      const kids = groupChildren(members, id, month);
      return {
        id,
        name: node.name,
        path: nodePath(nodes, members, id, month),
        metric: node.metric || null,
        sbu: node.sbuId ? n.sbu(node.sbuId) : null,
        brand: node.brandId ? n.brand(node.brandId) : null,
        isGroup: kids.length > 0,
        members: kids.length ? kids.map((k) => nodes[k]?.name || k) : undefined,
        mode: r.mode,
        lock: r.status,
        ladder: r.ladder,
        actual: r.actual,
        pctOfM1: r.actual != null && m1 > 0 ? round2((r.actual / m1) * 100) : null,
        milestone: milestoneOf(r.ladder, r.actual) ? `M${milestoneOf(r.ladder, r.actual)}` : "none",
        topLevel: groupsOf(members, id, month).length === 0,
      };
    });
    rows.sort((x, y) => str(x.path).localeCompare(str(y.path)));
    const out: Obj = { month, monthStatus: (snap.targetMonthStatus || {})[month] || null, nodes: rows };
    if (a.include_gate_units !== false) {
      const gms = ((snap.gateMonths || {}) as Obj)[month] || {};
      out.gateUnits = Object.values((snap.gateUnits || {}) as Obj).map((g: any) => {
        const gm = gms[g.id] || {};
        const ladder = gm.ladder || g.ladder || null;
        const actual = gm.actual ?? null;
        return { id: g.id, name: g.name, kind: g.kind, metric: g.metric, sbu: n.sbu(g.sbuId), ladder, actual, milestone: milestoneOf(ladder, actual) ? `M${milestoneOf(ladder, actual)}` : "none" };
      });
    }
    out.monthsWithTargets = [...new Set(Object.values(cells).map((c: any) => str(c?.month)).filter(Boolean))].sort();
    return out;
  },
};

const targetHistory: ToolDef = {
  name: "apms_target_history",
  title: "Targets change log",
  description: "The Targets change log: who changed which target (ladder, actual, status) when, newest first. Filter by month, node name or person.",
  inputSchema: obj({ month: { type: "string", description: "Only this month." }, node: { type: "string" }, by: PERSON_ARG, limit: LIMIT_ARG, offset: OFFSET_ARG }),
  run(a, { snap, viewer, now }) {
    let list = asList<Obj>(snap.targetHistory);
    if (a.month) {
      const m = resolveMonth(a.month, now);
      list = list.filter((h) => h.month === m);
    }
    if (a.node) list = list.filter((h) => lower(h.nodeName).includes(lower(a.node)) || lower(h.nodeId) === lower(a.node));
    if (a.by) {
      const p = onePerson(snap, a.by, viewer);
      list = list.filter((h) => str(h.by) === str(p.id));
    }
    list = [...list].sort((x, y) => str(y.at).localeCompare(str(x.at)));
    const p = page(list.map((h) => ({ at: h.at, by: h.byName || names(snap).person(h.by), node: h.nodeName, month: h.month, field: h.field, from: h.from, to: h.to, note: h.note || undefined })), a, 50);
    return { ...p, changes: p.items, items: undefined };
  },
};

const awards: ToolDef = {
  name: "apms_awards",
  title: "Awards (Rewards → Awards)",
  description: "Award programmes: name, period / cadence, who is eligible, award type, parameters / KPIs and weights, prizes, status, nominations and winners; plus the prize catalog and team band shares.",
  inputSchema: obj({ status: { type: "string" }, period: { type: "string", description: "Only awards covering this month." }, award: { type: "string", description: "One award by name or id (full detail)." } }),
  run(a, { snap, now }) {
    const n = names(snap);
    let list = asList<Obj>(snap.awardInstances);
    if (a.award) list = [findById(list, a.award, "award")];
    if (a.status) list = list.filter((x) => lower(x.status) === lower(a.status));
    if (a.period) {
      const m = resolveMonth(a.period, now);
      list = list.filter((x) => str(x.periodStart || x.period) <= m && m <= str(x.periodEnd || x.period));
    }
    const prizes = new Map(asList<Obj>(snap.awardPrizeCatalog).map((p) => [str(p.id), p]));
    const full = !!a.award;
    return {
      awards: list.map((x) => {
        const base: Obj = {
          id: x.id,
          name: x.name,
          blurb: x.blurb || null,
          status: x.status,
          cadence: x.cadence,
          period: x.periodStart && x.periodEnd && x.periodStart !== x.periodEnd ? `${x.periodStart}..${x.periodEnd}` : x.period,
          subject: x.subject || x.audience,
          awardType: x.awardType,
          decide: x.decide || x.winnerRule || null,
          eligible: x.fieldWide
            ? "everyone"
            : {
                sbus: asList(x.sbuIds).map((i) => n.sbu(i)),
                functions: asList(x.functionIds).map((i) => n.fn(i)),
                roles: asList(x.roleIds).map((i) => n.role(i)),
                brands: asList(x.brandIds).map((i) => n.brand(i)),
                people: asList(x.personIds).map((i) => n.person(i)),
              },
          parameters: asList<Obj>(x.parameters).map((p) => ({ name: p.name, weight: p.weight, floor: p.floor ?? null, rollup: p.rollup || null, qualifier: !!p.isQualifier, lowerIsBetter: !!p.lowerIsBetter })),
          prizes: asList(x.prizeCatalogIds).map((i) => {
            const p = prizes.get(str(i));
            return p ? { name: p.name, kind: p.kind, amount: p.amount } : i;
          }),
          winners: asList(x.winnerIds || x.winners).map((w: any) => (typeof w === "string" ? n.person(w) : isMap(w) ? { ...w, name: w.personId ? n.person(w.personId) : w.name } : w)),
          nominations: asList(x.nominations).length || undefined,
        };
        if (full) {
          base.nominationsDetail = asList<Obj>(x.nominations).map((m) => ({ ...m, person: m.personId ? n.person(m.personId) : undefined, by: m.byId ? n.person(m.byId) : undefined }));
          base.scores = asList<Obj>(x.parameters).map((p) => ({ parameter: p.name, scores: Object.fromEntries(Object.entries((p.scores || {}) as Obj).map(([k, v]) => [n.person(k) || k, v])) }));
          base.raw = x;
        }
        return base;
      }),
      prizeCatalog: asList<Obj>(snap.awardPrizeCatalog).map((p) => ({ id: p.id, name: p.name, kind: p.kind, amount: p.amount, blurb: p.blurb })),
      teamBandShares: snap.awardBandShares || null,
      measures: asList(snap.awardMeasures),
    };
  },
};

const kpiScores: ToolDef = {
  name: "apms_kpi_scores",
  title: "KPI scores across people (KPI → KPI scores)",
  description:
    "Every KPI result for a month across people: person, plan (APMS / Rewards), brand, KRA, KPI, target, floor, achieved and 0–5 score. Filter by KPI name text, person / team filters and source. Use it for questions like 'who is lowest on NPS this month'.",
  inputSchema: obj({
    month: MONTH_ARG,
    kpi: { type: "string", description: "Only KPIs whose name contains this text." },
    source: { type: "string", enum: ["all", "apms", "rewards"], description: "Default all." },
    person: PERSON_ARG,
    ...FILTER_ARGS,
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap, viewer, now }) {
    const month = resolveMonth(a.month, now);
    const n = names(snap);
    const people = a.person ? [onePerson(snap, a.person, viewer)] : filterPeople(snap, asList<Obj>(snap.people), a);
    const ctx = scoreCtx(snap, month);
    const apmsOk = new Set(inModuleScope(viewer, "apms", people).map((p) => str(p.id)));
    const rewardsOk = new Set(inModuleScope(viewer, "rewards", people).map((p) => str(p.id)));
    const rows: Obj[] = [];
    const sources: Array<["apms" | "rewards", "records" | "rewardRecords"]> = [];
    if (a.source !== "rewards") sources.push(["apms", "records"]);
    if (a.source !== "apms") sources.push(["rewards", "rewardRecords"]);
    for (const [src, field] of sources) {
      const recs = monthRecords(snap, field, month);
      for (const p of people) {
        if (!(src === "apms" ? apmsOk : rewardsOk).has(str(p.id))) continue;
        const rec = recs[p.id];
        if (!isRealRecord(rec)) continue;
        for (const b of planBrands(rec)) {
          for (const kra of asList<Obj>(b.kras)) {
            const walk = (list: unknown, prefix: string) => {
              for (const k of asList<Obj>(list)) {
                const label = prefix ? `${prefix} / ${k.name}` : str(k.name);
                if (asList(k.children).length) {
                  walk(k.children, label);
                  continue;
                }
                if (a.kpi && !lower(label).includes(lower(a.kpi))) continue;
                rows.push({
                  person: n.person(p.id),
                  source: src,
                  brand: b.name || n.brand(b.brandId),
                  kra: kra.name,
                  kpi: label,
                  unit: k.unit || null,
                  target: kpiTarget(k),
                  floor: kpiFloor(k),
                  achieved: k.achieved ?? null,
                  score: kpiScore(k, ctx),
                });
              }
            };
            walk(kra.kpis, "");
          }
        }
      }
    }
    const p = page(rows, a, 100);
    return { month, ...p, scores: p.items, items: undefined };
  },
};

const roster: ToolDef = {
  name: "apms_roster",
  title: "Monthly roster (Roster)",
  description:
    "The roster for a month: each person's assignment (SBU, brand, company, function, manager, solid / dotted line, allocation %, start / end, status) and whether the month is draft / current / locked. HR and admins see everyone; others see their own rows.",
  inputSchema: obj({ month: MONTH_ARG, ...FILTER_ARGS, person: PERSON_ARG, limit: LIMIT_ARG, offset: OFFSET_ARG }),
  async run(a, { snap, viewer, now, roster: readRoster }) {
    const month = resolveMonth(a.month, now);
    const body = await readRoster(month);
    if (!body) return { month, note: "The roster could not be read." };
    const n = names(snap);
    const hr = viewer.admin || ["hr", "admin", "super_admin"].includes(lower(viewer.access)) || ["hr", "admin", "super_admin"].includes(lower(viewer.base));
    let rows = asList<Obj>(body.assignments);
    if (!hr) rows = rows.filter((r) => str(r.personId) === viewer.id);
    let allowed: Set<string> | null = null;
    if (a.person) allowed = new Set([str(onePerson(snap, a.person, viewer).id)]);
    else if (a.sbu || a.brand || a.function || a.manager || a.role) allowed = new Set(filterPeople(snap, asList<Obj>(snap.people), { ...a, status: "all" }).map((p) => str(p.id)));
    if (allowed) rows = rows.filter((r) => allowed!.has(str(r.personId)));
    const out = rows.map((r) => ({
      person: n.person(r.personId),
      personId: r.personId,
      sbu: n.sbu(r.sbuId),
      brand: n.brand(r.brandId),
      company: n.company(r.companyId),
      function: n.fn(r.functionId),
      manager: r.managerId ? n.person(r.managerId) : null,
      line: r.line,
      status: r.status,
      allocationPct: r.allocationPct ?? r.allocation_pct ?? null,
      start: r.startDate ?? r.start_date ?? null,
      end: r.endDate ?? r.end_date ?? null,
      reason: r.reason || undefined,
    }));
    out.sort((x, y) => str(x.person).localeCompare(str(y.person)));
    const p = page(out, a, 200);
    return {
      month,
      status: body.status,
      lockedAt: body.lockedAt || null,
      lockedBy: body.lockedBy ? n.person(body.lockedBy) : null,
      copiedFrom: body.copiedFrom || null,
      rewardsLocked: !!body.rewardsLocked,
      ...p,
      assignments: p.items,
      items: undefined,
      scope: hr ? "everyone" : "your own rows (roster is an HR screen)",
    };
  },
};

const notices: ToolDef = {
  name: "apms_notices",
  title: "Notices, requests and role cases",
  description:
    "Section notices: the notices / alerts feed (month closed, approvals, unlock requests …) with who it is for and status. Section requests: 'Something missing? → Improve' requests. Section role_cases: role change cases.",
  inputSchema: obj({
    section: { type: "string", enum: ["notices", "requests", "role_cases"], description: "Default notices." },
    kind: { type: "string", description: "Notices: only this kind (e.g. month_closed)." },
    status: { type: "string", description: "Only this status (e.g. open)." },
    person: { type: "string", description: "Notices to / about this person." },
    month: { type: "string" },
    limit: LIMIT_ARG,
    offset: OFFSET_ARG,
  }),
  run(a, { snap, viewer, now }) {
    const n = names(snap);
    const section = str(a.section || "notices");
    if (section === "requests") {
      let list = asList<Obj>(snap.appRequests);
      if (a.status) list = list.filter((x) => lower(x.status) === lower(a.status));
      const p = page(list.map((x) => ({ ...x, by: x.byId || x.fromId ? n.person(x.byId || x.fromId) : x.byName })), a, 50);
      return { ...p, requests: p.items, items: undefined };
    }
    if (section === "role_cases") {
      let list = asList<Obj>(snap.roleCases);
      if (a.status) list = list.filter((x) => lower(x.status) === lower(a.status));
      const p = page(list.map((x) => ({ ...x, person: x.personId ? n.person(x.personId) : undefined })), a, 50);
      return { ...p, roleCases: p.items, items: undefined };
    }
    let list = asList<Obj>(snap.notices);
    if (a.kind) list = list.filter((x) => lower(x.kind) === lower(a.kind));
    if (a.status) list = list.filter((x) => lower(x.status) === lower(a.status));
    if (a.month) {
      const m = resolveMonth(a.month, now);
      list = list.filter((x) => x.month === m);
    }
    if (a.person) {
      const p = onePerson(snap, a.person, viewer);
      list = list.filter((x) => asList(x.toIds).includes(p.id) || x.subjectId === p.id || x.fromId === p.id);
    }
    list = [...list].sort((x, y) => str(y.createdAt).localeCompare(str(x.createdAt)));
    const kinds: Obj = {};
    for (const x of list) kinds[str(x.kind)] = (kinds[str(x.kind)] || 0) + 1;
    const p = page(
      list.map((x) => ({
        at: x.createdAt,
        kind: x.kind,
        title: x.title,
        body: x.body || undefined,
        status: x.status,
        month: x.month || undefined,
        plan: x.planKind || undefined,
        from: x.fromId ? n.person(x.fromId) : undefined,
        to: asList(x.toIds).map((i) => n.person(i)),
        about: x.subjectId ? n.person(x.subjectId) : undefined,
      })),
      a,
      50,
    );
    return { byKind: kinds, ...p, notices: p.items, items: undefined };
  },
};

const misReports: ToolDef = {
  name: "apms_mis_reports",
  title: "MIS reports",
  description:
    "Saved MIS custom reports and report folders (their definitions: data source, rows, columns, filters, aggregation). To get the numbers, use the list tools (apms_rewards_month, apms_plans_month, apms_kpi_scores, apms_targets …) and aggregate.",
  inputSchema: obj({ report: { type: "string", description: "One report by name or id (full definition)." } }),
  run(a, { snap }) {
    const n = names(snap);
    const reports = asList<Obj>(snap.customReports);
    const folders = asList<Obj>(snap.reportFolders);
    if (a.report) return { report: findById(reports, a.report, "report") };
    return {
      folders: folders.map((f) => ({ id: f.id, name: f.name })),
      reports: reports.map((r) => ({ id: r.id, name: r.name, folder: folders.find((f) => f.id === r.folderId)?.name || null, source: r.source || r.dataSource || null, by: r.ownerId || r.createdBy ? n.person(r.ownerId || r.createdBy) : null, updatedAt: r.updatedAt || null })),
      cannedReports: ["Rewards this month", "Rewards by month range", "Milestone & pool", "Function-wise", "SBU-wise", "Award payout"],
    };
  },
};

const settings: ToolDef = {
  name: "apms_settings",
  title: "Settings",
  description:
    "Settings sections: access_roles (each access role's scope, module grants view/create/edit/delete, extra rights), setup (months in use, company factor, setup steps, reward year), trash (deleted items: what, who, when), backups (backup list — admins).",
  inputSchema: obj({ section: { type: "string", enum: ["access_roles", "setup", "trash", "backups"] }, limit: LIMIT_ARG, offset: OFFSET_ARG }, ["section"]),
  async run(a, { snap, viewer, backups }) {
    const n = names(snap);
    if (a.section === "access_roles") {
      const people = asList<Obj>(snap.people);
      return {
        accessRoles: asList<Obj>(snap.accessRoles).map((r) => ({
          id: r.id,
          name: r.name,
          base: r.base,
          scope: r.scope,
          note: r.note || null,
          builtin: !!r.builtin,
          people: people.filter((p) => str(p.accessRoleId || p.access) === str(r.id)).length,
          grants: Object.fromEntries(
            Object.entries((r.grants || {}) as Obj).map(([m, g]) => [m, ["view", "create", "edit", "delete"].filter((k) => (g as Obj)?.[k]).join(",") || "none"]),
          ),
          rights: Object.entries((r.flags || {}) as Obj).filter(([, v]) => v).map(([k]) => k),
        })),
      };
    }
    if (a.section === "setup") {
      return {
        monthsInUse: asList(snap.months),
        companyFactor: snap.companyFactor ?? null,
        setupDone: asList(snap.setupDone),
        rewardYearSeed: snap.rewardYearSeed ?? null,
        awardBandShares: snap.awardBandShares || null,
        pendingRoleDeletes: asList(snap.pendingRoleDeletes).length,
      };
    }
    if (a.section === "trash") {
      const list = [...asList<Obj>(snap.trash)].sort((x, y) => str(y.deletedAt).localeCompare(str(x.deletedAt)));
      const p = page(list.map((t) => ({ id: t.id, kind: t.kind, label: t.label, deletedAt: t.deletedAt, deletedBy: t.deletedByName || n.person(t.deletedBy), items: asList(t.ids).length })), a, 50);
      return { ...p, trash: p.items, items: undefined };
    }
    if (a.section === "backups") {
      if (!can(viewer, "settings-backup", "view")) return { note: "Your login cannot see Settings → Backup." };
      const list = await backups();
      const p = page(list, a, 50);
      return { ...p, backups: p.items, items: undefined };
    }
    throw new ToolInputError("section must be access_roles, setup, trash or backups.");
  },
};

export const RAW_FIELDS = [
  "companies",
  "brands",
  "businessUnits",
  "sbuMembers",
  "functions",
  "subFunctions",
  "people",
  "roles",
  "accessRoles",
  "notices",
  "appRequests",
  "roleCases",
  "customReports",
  "reportFolders",
  "trash",
  "months",
  "companyFactor",
  "setupDone",
  "valuesCatalog",
  "kpiMaster",
  "apmsPlans",
  "apmsMonths",
  "awardInstances",
  "awardMeasures",
  "awardPrizeCatalog",
  "awardBandShares",
  "gateUnits",
  "gateMonths",
  "roleMonths",
  "rewardRoleMonths",
  "records",
  "rewardRecords",
  "agsMonths",
  "agsReviews",
  "periodReviews",
  "sbuTargets",
  "targetNodes",
  "targetMembers",
  "targetCells",
  "targetMonthStatus",
  "targetRootOrder",
  "targetHistory",
] as const;

const PERIOD_KEYED = new Set(["records", "rewardRecords", "gateMonths", "agsMonths"]);

const raw: ToolDef = {
  name: "apms_raw",
  title: "Raw APMS data (any section)",
  description:
    "Escape hatch: the stored data of any APMS section, unprocessed, for anything the other tools do not cover. Big period-keyed sections (records = APMS plans, rewardRecords = Rewards plans, gateMonths, agsMonths) need a month; targetCells can take a month. Use id to fetch one row. Prefer the specific tools — they resolve names and compute scores.",
  inputSchema: obj(
    {
      field: { type: "string", enum: [...RAW_FIELDS] },
      id: { type: "string", description: "One row / key (list: row id; map: key; records: person id)." },
      month: { type: "string", description: "Month for period-keyed sections." },
      limit: LIMIT_ARG,
      offset: OFFSET_ARG,
    },
    ["field"],
  ),
  run(a, { snap, now }) {
    const field = str(a.field);
    if (!(RAW_FIELDS as readonly string[]).includes(field)) throw new ToolInputError(`Unknown field. Use one of: ${RAW_FIELDS.join(", ")}.`);
    let value: unknown = snap[field];
    if (PERIOD_KEYED.has(field)) {
      const tree = isMap(value) ? value : {};
      if (!a.month) return { field, months: Object.keys(tree).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort(), note: "Pass month to read one month." };
      value = tree[resolveMonth(a.month, now)] || {};
    } else if (field === "targetCells" && a.month) {
      const m = resolveMonth(a.month, now);
      value = Object.fromEntries(Object.entries(isMap(value) ? value : {}).filter(([k]) => k.endsWith(`::${m}`)));
    } else if ((field === "roleMonths" || field === "rewardRoleMonths") && a.month) {
      const m = resolveMonth(a.month, now);
      value = Object.fromEntries(Object.entries(isMap(value) ? value : {}).map(([r, v]) => [r, (v as Obj)?.[m]]).filter(([, v]) => v));
    }
    if (a.id) {
      if (Array.isArray(value)) return { field, row: value.find((x) => isMap(x) && (str(x.id) === str(a.id) || str(x.planId) === str(a.id))) ?? null };
      if (isMap(value)) return { field, key: a.id, row: value[str(a.id)] ?? null };
      return { field, value };
    }
    if (Array.isArray(value)) {
      const p = page(value, a, 50);
      return { field, ...p, rows: p.items, items: undefined };
    }
    if (isMap(value)) {
      const keys = Object.keys(value);
      const p = page(keys, a, 50);
      return { field, total: p.total, offset: p.offset, limit: p.limit, more: p.more, rows: Object.fromEntries(p.items.map((k) => [k, value![k]])) };
    }
    return { field, value: value ?? null };
  },
};

export const TOOLS: ToolDef[] = [
  whoami,
  overview,
  searchPeople,
  getPerson,
  orgStructure,
  rolesList,
  getRole,
  kpiLibrary,
  kpiScores,
  plansMonth,
  scorecard,
  rolePlan,
  execution,
  reviews,
  rewardsMonth,
  rewardsYearTool,
  targets,
  targetHistory,
  awards,
  roster,
  notices,
  misReports,
  settings,
  raw,
];

/** Largest tool reply sent back (characters of JSON). */
export const MAX_REPLY_CHARS = 150_000;

export function serializeReply(value: unknown): string {
  const clean = scrub(value);
  const text = JSON.stringify(clean, (_k, v) => (v === undefined ? undefined : v));
  if (text.length <= MAX_REPLY_CHARS) return text;
  return (
    text.slice(0, MAX_REPLY_CHARS) +
    `\n…[reply cut at ${MAX_REPLY_CHARS} characters of ${text.length}. Ask again with a smaller limit, an offset, or a narrower filter.]`
  );
}

export async function runTool(name: string, args: unknown, env: ToolEnv): Promise<{ text: string; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, isError: true };
  const input = isMap(args) ? args : {};
  try {
    const out = await tool.run(input, env);
    return { text: serializeReply(out), isError: false };
  } catch (err) {
    if (err instanceof ToolInputError) return { text: err.message, isError: true };
    console.error(`[apms-mcp] ${name} failed`, err);
    return { text: `The ${name} tool failed on the server: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

export { fyMonths, fyLabel, quarterOf, cellKey };
