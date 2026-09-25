/**
 * Server-side port of the APMS scoring and rewards maths.
 *
 * The SPA computes every score and payout in the browser
 * (public/assets/login-view-*-p0ar.js). The Claude connector reads the same
 * stored rows, so it needs the same maths to say what a screen shows. Each
 * function names the bundle function it mirrors; keep them in step when the
 * bundle's formulas change.
 *
 * Pure: nothing here mutates its input.
 */
import { effectiveAchieved } from "../apms-org-scope.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
export type Ladder = { M1: number; M2: number; M3: number; M4: number; M5: number };

/** W: round to 2 decimals. */
export const round2 = (e: number): number => Math.round(e * 100) / 100;

export function asList<T = Obj>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v as Obj).filter((x) => x != null) as T[];
  return [];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ms */
export const emptyLadder = (): Ladder => ({ M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 });

/** Context the KPI score needs to resolve linked SBU actuals (effectiveAchieved). */
export type ScoreCtx = {
  month?: string | null;
  targetNodes?: Obj | null;
  targetCells?: Obj | null;
};

function effAch(k: Obj, ctx?: ScoreCtx): number | null {
  const state = ctx
    ? { currentMonth: ctx.month || null, targetNodes: ctx.targetNodes || {}, targetCells: ctx.targetCells || {} }
    : null;
  return effectiveAchieved(k as never, state as never, ctx?.month || null);
}

/** Ss: KPI target. */
export function kpiTarget(k: Obj): number {
  if (typeof k.target === "number" && !Number.isNaN(k.target)) return k.target;
  const t = k.ranges?.high?.max;
  return typeof t === "number" && !Number.isNaN(t) ? t : 0;
}

/** Cs: KPI floor. */
export function kpiFloor(k: Obj): number {
  return typeof k.floor === "number" && !Number.isNaN(k.floor) ? k.floor : 0;
}

/** ks: clamped linear interpolation. */
function lerp(e: number, t: number, n: number, r: number, i: number): number {
  if (t === n) return r;
  const a = (e - t) / (n - t);
  return r + Math.min(1, Math.max(0, a)) * (i - r);
}

/** As: one KPI's 0–5 score, or null when there is no actual. */
export function kpiScore(k: Obj, ctx?: ScoreCtx): number | null {
  const r = effAch(k, ctx);
  if (r == null || Number.isNaN(r)) return null;
  const t = kpiTarget(k);
  const n = kpiFloor(k);
  const lower = !!k.lowerIsBetter || n > t;
  if (lower) return r <= t ? 5 : r > n ? 0 : round2(lerp(r, t, n, 5, 1));
  return r >= t ? 5 : r < n ? 0 : round2(lerp(r, n, t, 1, 5));
}

/** Ms: weighted KPI tree. */
function kpiTree(list: unknown, weight: number, ctx?: ScoreCtx): { tw: number; ws: number } {
  let tw = 0;
  let ws = 0;
  for (const k of asList<Obj>(list)) {
    const w = weight * (Number(k.weight) || 0);
    if (asList(k.children).length) {
      const sub = kpiTree(k.children, w, ctx);
      tw += sub.tw;
      ws += sub.ws;
    } else {
      const s = kpiScore(k, ctx);
      if (s == null) continue;
      tw += w;
      ws += w * s;
    }
  }
  return { tw, ws };
}

/** Ns: one KRA's score. */
export function kraScore(kra: Obj | null | undefined, ctx?: ScoreCtx): number | null {
  const { tw, ws } = kpiTree(asList(kra && kra.kpis), 1, ctx);
  return tw > 0 ? round2(ws / tw) : null;
}

/** Ps: one brand block's score (weighted KRAs). */
export function brandScore(b: Obj | null | undefined, ctx?: ScoreCtx): number | null {
  let t = 0;
  let n = 0;
  for (const kra of asList<Obj>(b && b.kras)) {
    const s = kraScore(kra, ctx);
    if (s != null) {
      t += Number(kra.weight) || 0;
      n += (Number(kra.weight) || 0) * s;
    }
  }
  return t > 0 ? round2(n / t) : null;
}

/** Fs: brand blocks of a plan (legacy plans have KRAs only). */
export function planBrands(rec: Obj | null | undefined): Obj[] {
  if (!rec) return [];
  const brands = asList<Obj>(rec.brands);
  if (brands.length) return brands;
  if (asList(rec.kras).length) return [{ id: "legacy", brandId: "", name: "Plan", weight: 1, kras: asList(rec.kras) }];
  return [];
}

/** Is: the plan's KPI score (0–5). */
export function planKpiScore(rec: Obj | null | undefined, ctx?: ScoreCtx): number | null {
  let n = 0;
  let r = 0;
  for (const b of planBrands(rec)) {
    const s = brandScore(b, ctx);
    if (s != null) {
      n += Number(b.weight) || 0;
      r += (Number(b.weight) || 0) * s;
    }
  }
  return n > 0 ? round2(r / n) : null;
}

/** Ls: execution (EO) score. */
export function execScore(priorities: unknown): number | null {
  const t = asList<Obj>(priorities).filter((e) => e.score != null && e.status !== "dropped" && e.status !== "dump");
  return t.length ? round2(t.reduce((a, e) => a + (Number(e.score) || 0), 0) / t.length) : null;
}

/** Rs */
const validBehaviour = (e: unknown): number | null =>
  typeof e !== "number" || Number.isNaN(e) || e < 1 || e > 5 ? null : e;

/** zs: one value's score from its behaviours. */
export function valueScore(v: Obj, self = false): number | null {
  const n = asList<Obj>(v.behaviours)
    .filter((b) => b.inPlay !== false)
    .map((b) => validBehaviour(self ? b.selfScore : b.score))
    .filter((x): x is number => x != null);
  return n.length ? round2(n.reduce((a, x) => a + x, 0) / n.length) : validBehaviour(self ? v.selfScore : v.score);
}

/**
 * gt: the record's values laid over the values catalog (catalog order, names
 * and weights; the record's scores).
 */
export function valuesWithCatalog(recValues: unknown, catalog: unknown): Obj[] {
  const cat = asList<Obj>(catalog);
  const vals = asList<Obj>(recValues);
  if (!cat.length) return vals;
  return cat.map((t) => {
    const n = vals.find((e) => e.id === t.id);
    const behaviours = asList<Obj>(t.behaviours).map((b) => {
      const s = asList<Obj>(n?.behaviours).find((x) => x.id === b.id);
      return { id: b.id, name: b.name, meaning: b.meaning, score: s?.score ?? null, selfScore: s?.selfScore ?? null, inPlay: s?.inPlay };
    });
    return { id: t.id, name: t.name, weight: t.weight, behaviours, score: n?.score ?? null, selfScore: n?.selfScore ?? null, inPlay: n?.inPlay };
  });
}

/** Bs: values score. */
export function valuesScore(values: Obj[]): number | null {
  let n = 0;
  let r = 0;
  for (const v of values || []) {
    if (v.inPlay === false) continue;
    const s = valueScore(v);
    if (s == null) continue;
    const w = v.weight ?? 1;
    n += w;
    r += w * s;
  }
  return n > 0 ? round2(r / n) : null;
}

/** Vs: values drag on the P-score. */
export const valuesDrag = (v: number | null): number => (v == null || v >= 3 ? 1 : v >= 2 ? 0.9 : 0.75);

export type Mix = { kpi: number; exec: number; values: number };

/** mixOf */
export function mixOf(rec: Obj | null | undefined): Mix {
  const t = rec && rec.mix;
  const pick = (v: unknown, d: number) => (t && Number.isFinite(+(v as number)) ? Math.max(0, +(v as number)) : d);
  return { kpi: pick(t?.kpi, 50), exec: pick(t?.exec, 30), values: pick(t?.values, 20) };
}

/** Hs: P-score. */
export function pScore(kpi: number | null, exec: number | null, values: number | null, mix?: Mix): number | null {
  const m = mix || { kpi: 50, exec: 30, values: 20 };
  const parts: Array<{ w: number; s: number }> = [];
  if (m.kpi > 0 && kpi != null) parts.push({ w: m.kpi / 100, s: kpi });
  if (m.exec > 0 && exec != null) parts.push({ w: m.exec / 100, s: exec });
  if (m.values > 0 && values != null) parts.push({ w: m.values / 100, s: values });
  if (!parts.length) return null;
  const tw = parts.reduce((a, p) => a + p.w, 0);
  return round2((parts.reduce((a, p) => a + p.w * p.s, 0) / tw) * (m.values > 0 ? valuesDrag(values) : 1));
}

/** Us: rating band 0–5. */
export const ratingOf = (e: number | null): number | null =>
  e == null ? null : e >= 4.5 ? 5 : e >= 3.5 ? 4 : e >= 2.5 ? 3 : e >= 1.5 ? 2 : e >= 0.5 ? 1 : 0;

export type PlanScores = {
  kpi: number | null;
  exec: number | null;
  values: number | null;
  p: number | null;
  rating: number | null;
  drag: number;
  mix: Mix;
};

/** nc: the scorecard header (KPI · Execution · Values → P-score, rating). */
export function planScores(rec: Obj | null | undefined, ctx?: ScoreCtx, valuesCatalog?: unknown): PlanScores {
  if (!rec) return { kpi: null, exec: null, values: null, p: null, rating: null, drag: 1, mix: mixOf(null) };
  const mix = mixOf(rec);
  const kpi = mix.kpi > 0 ? planKpiScore(rec, ctx) : null;
  const exec = mix.exec > 0 ? execScore(rec.priorities) : null;
  const values = mix.values > 0 ? valuesScore(valuesWithCatalog(rec.values, valuesCatalog)) : null;
  const p = pScore(kpi, exec, values, mix);
  return { kpi, exec, values, p, rating: ratingOf(p), drag: mix.values > 0 ? valuesDrag(values) : 1, mix };
}

/** rc: KPIs still missing an actual. */
export function missingActuals(rec: Obj | null | undefined): string[] {
  const out: string[] = [];
  if (!rec) return ["No plan yet"];
  const walk = (list: unknown, prefix: string) => {
    for (const k of asList<Obj>(list)) {
      const name = String(k.name || "").trim() || "unnamed KPI";
      const label = prefix ? `${prefix} / ${name}` : name;
      if (asList(k.children).length) walk(k.children, label);
      else if (k.achieved == null || Number.isNaN(Number(k.achieved))) out.push(`${label}: enter the actual`);
    }
  };
  for (const b of planBrands(rec)) for (const kra of asList<Obj>(b.kras)) walk(kra.kpis, `${b.name} · ${kra.name}`);
  return out;
}

// ------------------------------------------------------------- statuses ----

const STATUS_ALIASES: Record<string, string> = {
  draft: "plan_open",
  open: "plan_open",
  targets_set: "plan_locked",
  plan_closed: "plan_locked",
  scored: "plan_locked",
  scoring: "plan_locked",
  locked: "closed",
};

/** K: normalized plan status. */
export function planStatus(s: unknown): "plan_open" | "plan_locked" | "closed" {
  const v = String(s || "");
  if (v === "plan_open" || v === "plan_locked" || v === "closed") return v;
  return (STATUS_ALIASES[v] as "plan_open" | "plan_locked" | "closed") || "plan_open";
}

export const STATUS_LABEL: Record<string, string> = {
  plan_open: "Plan open",
  plan_locked: "Plan locked",
  closed: "Closed",
};

/** U: month + delta. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Cl: days from today to the first of `month`. */
function daysUntil(month: string, now = new Date()): number {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return 99;
  const i = Date.UTC(y, m - 1, 1);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((i - a) / 864e5);
}

/** wl: the month has ended. */
export const monthEnded = (month: string, now = new Date()): boolean => daysUntil(shiftMonth(month, 1), now) <= 0;

// -------------------------------------------------------------- rewards ----

/** qs */
export function gateLadder(gateUnit: Obj | null | undefined, gateMonth: Obj | null | undefined): Ladder {
  return (gateMonth?.ladder || gateUnit?.ladder || emptyLadder()) as Ladder;
}

/** Js: highest milestone the actual reaches. */
export function milestoneOf(ladder: Obj | null | undefined, actual: number | null | undefined): number {
  if (actual == null || !ladder) return 0;
  let n = 0;
  for (let r = 1; r <= 5; r++) {
    const i = Number(ladder[`M${r}`]) || 0;
    if (i > 0 && actual >= i) n = r;
  }
  return n;
}

/** Ys: reward slabs (person first, then role). */
export function slabsOf(person: Obj | null | undefined, role: Obj | null | undefined): Ladder {
  return (person?.rewardsSlabs || role?.slabs || emptyLadder()) as Ladder;
}

/** Ks: KPI multiplier (KPI score ÷ 5). */
export function kpiMultiplier(rec: Obj | null | undefined, ctx?: ScoreCtx): number {
  const t = planKpiScore(rec, ctx);
  return t == null ? 0 : t / 5;
}

/** kpiBelowFloorQual: a qualifier KPI is under its floor. */
export function qualifierKpiBelowFloor(rec: Obj | null | undefined, ctx?: ScoreCtx): string[] {
  const fails: string[] = [];
  const walk = (list: unknown) => {
    for (const k of asList<Obj>(list)) {
      if (asList(k.children).length) walk(k.children);
      if (!k.isQualifier) continue;
      const a0 = effAch(k, ctx);
      if (a0 == null || Number.isNaN(Number(a0))) continue;
      if (typeof k.floor !== "number" || Number.isNaN(k.floor)) continue;
      const a = Number(a0);
      const tgt = typeof k.target === "number" ? k.target : null;
      const lower = !!k.lowerIsBetter || (tgt != null && k.floor > tgt);
      if (lower ? a > k.floor : a < k.floor) fails.push(String(k.name || k.id || "KPI"));
    }
  };
  for (const b of planBrands(rec)) for (const kra of asList<Obj>(b.kras)) walk(kra.kpis);
  return fails;
}

export type Payout = {
  dq: boolean;
  dqReason?: string;
  milestone: number;
  pot: number;
  multiplier: number;
  earned: number;
  qualifiersOk: boolean;
  qualifierFails: string[];
};

/** Qs: one month's reward payout. */
export function monthPayout(
  rec: Obj | null | undefined,
  role: Obj | null | undefined,
  gateUnit: Obj | null | undefined,
  gateMonth: Obj | null | undefined,
  person: Obj | null | undefined,
  unlock: { ladder: Obj; actual: number | null } | null | undefined,
  ctx?: ScoreCtx,
): Payout {
  const zero: Payout = { dq: false, milestone: 0, pot: 0, multiplier: 0, earned: 0, qualifiersOk: true, qualifierFails: [] };
  if (!rec || !role) return zero;
  const flags = asList<Obj>(rec.rewardFlags);
  const dqFlag = flags.find((f) => f.kind === "disqualifier" && f.on);
  if (rec.dq || dqFlag) return { ...zero, dq: true, dqReason: dqFlag ? String(dqFlag.name || "disqualifier") : "marked DQ" };
  const ladder = unlock?.ladder || gateLadder(gateUnit, gateMonth);
  const actual = unlock ? unlock.actual : gateMonth?.actual ?? null;
  if (!gateUnit && !unlock) return zero;
  const milestone = milestoneOf(ladder, actual);
  const slabs = slabsOf(person, role) as Obj;
  const pot = (milestone > 0 && Number(slabs[`M${milestone}`])) || 0;
  const multiplier = kpiMultiplier(rec, ctx);
  const quals = flags.filter((f) => f.kind === "qualifier");
  const qualOffs = quals.filter((f) => !f.on).map((f) => String(f.name || "qualifier"));
  const kpiFails = qualifierKpiBelowFloor(rec, ctx);
  const ok = qualOffs.length === 0 && kpiFails.length === 0;
  return {
    dq: false,
    milestone,
    pot,
    multiplier: round2(multiplier),
    earned: ok ? Math.round(pot * multiplier) : 0,
    qualifiersOk: ok,
    qualifierFails: [...qualOffs.map((q) => `qualifier off: ${q}`), ...kpiFails.map((k) => `KPI below floor: ${k}`)],
  };
}

// -------------------------------------------------------------- targets ----

/** Y */
export const cellKey = (nodeId: string, month: string) => `${nodeId}::${month}`;

/** nu: a group's member node ids for the month. */
export function groupChildren(members: Obj[], groupId: string, month: string): string[] {
  return (members || []).filter((m) => m.groupId === groupId && m.month === month).map((m) => String(m.memberId));
}

/** ou: groups this node sits in for the month. */
export function groupsOf(members: Obj[], nodeId: string, month: string): string[] {
  return (members || []).filter((m) => m.memberId === nodeId && m.month === month).map((m) => String(m.groupId));
}

/** su: "Parent › Child" path. */
export function nodePath(nodes: Obj, members: Obj[], nodeId: string, month: string, seen = new Set<string>()): string {
  const a = nodes[nodeId];
  if (!a) return "";
  if (seen.has(nodeId)) return String(a.name || nodeId);
  seen.add(nodeId);
  const parents = groupsOf(members, nodeId, month);
  if (!parents.length) return String(a.name || nodeId);
  const up = nodePath(nodes, members, parents[0], month, seen);
  return up ? `${up} › ${a.name}` : String(a.name || nodeId);
}

export type NodeResult = {
  ladder: Ladder;
  actual: number | null;
  mode: string;
  status: string;
  rolledLadder: Ladder;
  rolledActual: number | null;
};

/** uu: a target node's ladder and actual for the month (groups roll up their members). */
export function nodeResult(nodes: Obj, members: Obj[], cells: Obj, nodeId: string, month: string, path: string[] = [], now = new Date()): NodeResult {
  const out: NodeResult = { ladder: emptyLadder(), actual: null, mode: "set", status: "open", rolledLadder: emptyLadder(), rolledActual: null };
  if (!nodes[nodeId] || path.includes(nodeId) || path.length > 8) return out;
  const s = cells[cellKey(nodeId, month)] as Obj | undefined;
  const nL = (e: unknown) => {
    const v = Number(e);
    return Number.isFinite(v) ? v : 0;
  };
  const sumL = (e: Ladder, t?: Obj): Ladder => {
    const x = t || emptyLadder();
    return { M1: e.M1 + nL(x.M1), M2: e.M2 + nL(x.M2), M3: e.M3 + nL(x.M3), M4: e.M4 + nL(x.M4), M5: e.M5 + nL(x.M5) };
  };
  const nz = (e: Obj | undefined) => !!(e && (nL(e.M1) || nL(e.M2) || nL(e.M3) || nL(e.M4) || nL(e.M5)));
  const kids = groupChildren(members, nodeId, month);
  const results = kids.map((k) => nodeResult(nodes, members, cells, k, month, [...path, nodeId], now));
  const rolled: Ladder = kids.length ? results.reduce((acc, r) => sumL(acc, r.ladder), emptyLadder()) : ((s?.ladder as Ladder) || emptyLadder());
  const rolledActual = kids.length
    ? results.every((r) => r.actual == null)
      ? null
      : results.reduce((acc, r) => acc + nL(r.actual), 0)
    : (num(s?.actual) ?? null);
  const mode = String(s?.mode || (kids.length ? "roll" : "set"));
  const locked = s?.status === "locked" && !!s.snapshot && monthEnded(month, now);
  const snap = s?.snapshot?.ladder as Obj | undefined;
  let ladder: Ladder =
    mode === "roll" && kids.length ? (nz(rolled) ? rolled : nz(snap) ? (snap as Ladder) : rolled) : mode === "set" && s?.ladder ? (s.ladder as Ladder) : rolled;
  if (locked && !(mode === "roll" && kids.length)) ladder = nz(snap) ? (snap as Ladder) : ladder;
  let actual = kids.length && mode === "roll" ? rolledActual : (num(s?.actual) ?? rolledActual);
  if (locked && !(kids.length && mode === "roll")) actual = num(s!.actual) ?? num(s!.snapshot?.actual) ?? actual;
  return { ladder, actual, mode, status: String(s?.status || (locked ? "locked" : "open")), rolledLadder: rolled, rolledActual };
}

/** pu: target node for an SBU. */
function nodeForSbu(nodes: Obj, sbuId: string | null | undefined): Obj | undefined {
  if (!sbuId) return undefined;
  return Object.values(nodes).find((n: any) => n && n.sbuId === sbuId) as Obj | undefined;
}

export type Unlock = {
  source: "sbu" | "gate" | "none";
  label: string;
  nodeId?: string;
  sbuId?: string;
  metric?: string;
  ladder: Ladder;
  actual: number | null;
  hit: number;
};

/** mu: which target unlocks a person's reward for the month (SBU target node, else gate unit). */
export function rewardUnlock(snap: Obj, person: Obj | null | undefined, rec: Obj | null | undefined, month: string, now = new Date()): Unlock {
  const nodes = (snap.targetNodes || {}) as Obj;
  const members = asList<Obj>(snap.targetMembers);
  const cells = (snap.targetCells || {}) as Obj;
  const gateUnits = (snap.gateUnits || {}) as Obj;
  const gateMonths = (snap.gateMonths || {}) as Obj;
  const none: Unlock = { source: "none", label: "No target", ladder: emptyLadder(), actual: null, hit: 0 };
  const gateId = String(rec?.gateUnitId || person?.gateUnitId || "");
  const nodeId =
    rec?.targetNodeId ||
    person?.targetNodeId ||
    nodeForSbu(nodes, rec?.targetSbuId || person?.targetSbuId || gateUnits[gateId]?.sbuId)?.id;
  if (nodeId && nodes[nodeId]) {
    const r = nodeResult(nodes, members, cells, nodeId, month, [], now);
    const ladder = r.ladder || emptyLadder();
    return {
      source: "sbu",
      label: String(nodes[nodeId].name || nodeId),
      nodeId,
      sbuId: nodes[nodeId].sbuId || undefined,
      metric: nodes[nodeId].metric,
      ladder,
      actual: r.actual,
      hit: milestoneOf(ladder, r.actual),
    };
  }
  const gu = gateUnits[gateId];
  if (!gu) return none;
  const gm = gateMonths[month]?.[gateId];
  const ladder = (gm?.ladder || gu.ladder || emptyLadder()) as Ladder;
  const actual = num(gm?.actual);
  return { source: "gate", label: String(gu.name || gateId), metric: gu.metric, ladder, actual, hit: milestoneOf(ladder, actual) };
}

/** Role used for a person's reward pot (the Rewards year view uses the person's current role). */
export function rewardRole(snap: Obj, person: Obj | null | undefined): Obj | null {
  const roles = (snap.roles || {}) as Obj;
  return (person?.roleId && roles[person.roleId]) || null;
}

/** _u: a person's payout for a month, as the Rewards scorecard shows it. */
export function personMonthPayout(snap: Obj, person: Obj, month: string, now = new Date()): { unlock: Unlock; payout: Payout; record: Obj | null } {
  const rec = ((snap.rewardRecords || {}) as Obj)[month]?.[person.id] || null;
  const unlock = rewardUnlock(snap, person, rec, month, now);
  const gateId = String(rec?.gateUnitId || person.gateUnitId || "");
  const gu = (snap.gateUnits || {})[gateId];
  const gm = (snap.gateMonths || {})[month]?.[gateId];
  const payout = monthPayout(rec, rewardRole(snap, person), gu, gm, person, { ladder: unlock.ladder, actual: unlock.actual }, scoreCtx(snap, month));
  return { unlock, payout, record: rec };
}

export function scoreCtx(snap: Obj, month: string): ScoreCtx {
  return { month, targetNodes: snap.targetNodes || {}, targetCells: snap.targetCells || {} };
}

// ------------------------------------------------------- quarter / year ----

/** pc: the 12 months of the FY (Apr–Mar) holding `month`. */
export function fyMonths(month: string): string[] {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((m) => `${m >= 4 ? start : start + 1}-${String(m).padStart(2, "0")}`);
}

/** Eu */
export function fyLabel(month: string): string {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `FY${String(start).slice(2)}`;
}

/** Du */
export function quarterOf(month: string): { fy: number; q: number; key: string; label: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  const fy = m >= 4 ? y : y - 1;
  return { fy, q, key: `${fy}-Q${q}`, label: `Q${q} FY${String(fy).slice(2)}` };
}

/** hs: ladder as % of M1. */
function ladderPct(e: Obj | null | undefined): Ladder {
  const l = e || emptyLadder();
  const t = Number(l.M1) || 0;
  return t > 0
    ? { M1: 100, M2: ((Number(l.M2) || 0) / t) * 100, M3: ((Number(l.M3) || 0) / t) * 100, M4: ((Number(l.M4) || 0) / t) * 100, M5: ((Number(l.M5) || 0) / t) * 100 }
    : emptyLadder();
}

/** $s: period roll-up — mean achievement % of M1 and the milestone that average holds. */
function periodMilestone(list: Array<{ ladder: Obj; actual: number | null; metric?: string }>): { pct: number | null; qm: number; mixed: boolean } {
  let t = 0;
  let n = 0;
  const sum = [0, 0, 0, 0, 0, 0];
  const cnt = [0, 0, 0, 0, 0, 0];
  const metrics = new Set<string>();
  for (const o of list) {
    const m1 = Number(o.ladder.M1) || 0;
    if (!(m1 > 0)) continue;
    if (o.metric) metrics.add(String(o.metric));
    if (o.actual == null) continue;
    t += (o.actual / m1) * 100;
    n += 1;
    const s = ladderPct(o.ladder) as Obj;
    for (let e = 1; e <= 5; e++) {
      const v = s[`M${e}`] || 0;
      if (v > 0) {
        sum[e] += v;
        cnt[e] += 1;
      }
    }
  }
  const pct = n ? t / n : null;
  let qm = 0;
  if (pct != null) {
    for (let e = 1; e <= 5; e++) {
      const avg = cnt[e] ? sum[e] / cnt[e] : 0;
      if (avg > 0 && pct + 1e-9 >= avg) qm = e;
    }
  }
  return { pct, qm, mixed: metrics.size > 1 };
}

export type PeriodRollup = {
  paid: number;
  entitlement: number;
  trueUp: number;
  consistency: number;
  total: number;
  qm: number;
  nonDQ: number;
  pct: number | null;
  kpiHeld: number;
  stillInPlay: boolean;
  rows: Array<{ month: string; hasPlan: boolean; dq: boolean; earned: number; milestone: number; kpi: number | null; pot: number; qualFail: boolean; status?: string }>;
};

/** ec: quarter / year roll-up with true-up and consistency bonus. */
function periodRollup(
  months: string[],
  recs: Obj,
  role: Obj,
  gateUnit: Obj | undefined,
  gateMonths: Obj,
  person: Obj,
  unlocks: Obj,
  snap: Obj,
): PeriodRollup {
  let paid = 0;
  let withLadder = 0;
  let allHit = true;
  let noDq = true;
  let nonDQ = 0;
  const list: Array<{ ladder: Obj; actual: number | null; metric?: string }> = [];
  const rows: PeriodRollup["rows"] = [];
  let kSum = 0;
  let kN = 0;
  for (const p of months) {
    const rec = recs[p];
    const gm = gateMonths?.[p];
    const un = unlocks?.[p];
    const ctx = scoreCtx(snap, p);
    const g = monthPayout(rec, role, gateUnit, gm, person, un, ctx);
    paid += g.earned;
    const ladder = un?.ladder || gateLadder(gateUnit, gm);
    const actual = un ? un.actual : gm?.actual ?? null;
    const kpi = rec ? planKpiScore(rec, ctx) : null;
    const ms = g.dq ? 0 : g.milestone || 0;
    rows.push({ month: p, hasPlan: !!rec, dq: !!g.dq, earned: g.earned, milestone: ms, kpi, pot: g.pot, qualFail: !g.dq && g.pot > 0 && g.earned === 0, status: rec?.status });
    if (Object.values(ladder || {}).some((x) => Number(x) > 0)) {
      withLadder += 1;
      list.push({ ladder, actual, metric: un?.metric });
      if (rec?.dq || g.dq) noDq = false;
      else {
        nonDQ += 1;
        if (ms < 1) allHit = false;
      }
      if (kpi != null && !g.dq) {
        kSum += kpi;
        kN += 1;
      }
    }
  }
  const pm = periodMilestone(list);
  const m = pm.qm;
  const slabs = slabsOf(person, role) as Obj;
  const kpiHeld = kN ? round2(kSum / kN) : 0;
  const slab = (x: number) => (x > 0 && Number(slabs[`M${x}`])) || 0;
  const elig = rows.filter((r) => r.hasPlan && !r.dq && !r.qualFail);
  const avgM = elig.length ? elig.reduce((a, r) => a + (r.milestone || 0), 0) / elig.length : 0;
  const qmR = Math.floor(avgM);
  const poolM = (qmR > 0 && Number(slabs[`M${qmR}`])) || 0;
  const entitled = Math.round(poolM * ((kpiHeld || 0) / 5) * elig.length);
  const trueUp = Math.max(0, entitled - paid);
  let consistency = 0;
  if (withLadder >= 3 && allHit && noDq && m >= 1 && m <= 4) consistency = Math.round(0.1 * (Number(slabs[`M${m + 1}`]) || 0));
  const stillInPlay = months.some((mo) => recs[mo] && recs[mo].status !== "closed");
  return {
    paid,
    entitlement: Math.round(slab(m) * nonDQ),
    trueUp,
    consistency,
    total: paid + trueUp + consistency,
    qm: qmR,
    nonDQ,
    pct: pm.pct == null ? null : round2(pm.pct),
    kpiHeld,
    stillInPlay,
    rows,
  };
}

/** yu: a person's rewards FY — four quarters and the year, as the Rewards year view builds it. */
export function rewardsYear(snap: Obj, person: Obj, month: string, now = new Date()) {
  const role = rewardRole(snap, person);
  if (!role) return null;
  const fy = fyMonths(month);
  const recs: Obj = {};
  const unlocks: Obj = {};
  for (const mo of fy) {
    const rec = ((snap.rewardRecords || {}) as Obj)[mo]?.[person.id];
    recs[mo] = rec;
    const u = rewardUnlock(snap, person, rec, mo, now);
    unlocks[mo] = { ladder: u.ladder, actual: u.actual, metric: u.metric };
  }
  const gateId = String(person.gateUnitId || "");
  const gate = (snap.gateUnits || {})[gateId];
  const gms: Obj = Object.fromEntries(fy.map((mo) => [mo, (snap.gateMonths || {})[mo]?.[gateId]]));
  const counted = (list: string[]) => list.filter((mo) => monthEnded(mo, now) || recs[mo] || unlocks[mo]?.actual != null);
  const quarters = [fy.slice(0, 3), fy.slice(3, 6), fy.slice(6, 9), fy.slice(9, 12)].map((q, i) => {
    const r = periodRollup(counted(q), recs, role, gate, gms, person, unlocks, snap);
    return { label: `Q${i + 1}`, months: q, ...r };
  });
  const f = periodRollup(counted(fy), recs, role, gate, gms, person, unlocks, snap);
  // Quarter true-ups are paid at the quarter; the year only tops up what is left.
  const quarterCatch = quarters.reduce((a, q) => a + (q.trueUp || 0), 0);
  const yearTrueUp = Math.max(0, (f.trueUp || 0) - quarterCatch);
  const year = { ...f, quarterCatch, trueUp: yearTrueUp, total: f.paid + quarterCatch + yearTrueUp + (f.consistency || 0) };
  return { fy: fyLabel(month), quarters, year };
}
