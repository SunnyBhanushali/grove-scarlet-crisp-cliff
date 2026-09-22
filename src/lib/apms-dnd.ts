/** Nested-list drag: Reminders/Finder slot model. Persist via existing save paths. */

export type DndMode = "before" | "inside" | "after";

export const DND_INDENT = 28;
export const DND_THRESHOLD = 4;
export const DND_DROP_MS = 260;

/** @deprecated hit-test kept for older callers; live drag uses projectSlot. */
export function dndHitMode(clientY: number, top: number, height: number): DndMode {
  const h = height <= 0 ? 1 : height;
  const r = (clientY - top) / h;
  if (r < 0.28) return "before";
  if (r > 0.72) return "after";
  return "inside";
}

export type SlotRow = { id: string; key: string; depth: number };

export type SlotRect = { top: number; bottom: number; height: number };

export type SlotTarget = { t: number; depth: number; parentId: string | null };

/** Insertion slot. `t` is an index into `rows` without the active row (same as ReportingTree). */
export function projectSlot(
  rows: SlotRow[],
  rects: SlotRect[],
  a: number,
  pageY: number,
  dx: number,
  indent = DND_INDENT,
  minFloor = 1,
): SlotTarget | null {
  const n = rows.length;
  if (!n || a < 0 || a >= n || !rects[a]) return null;
  let over = -1;
  for (let i = 0; i < n; i++) {
    if (pageY >= rects[i].top && pageY < rects[i].bottom) {
      over = i;
      break;
    }
  }
  if (over === -1) over = pageY < rects[0].top ? 0 : n - 1;
  const others = rows.filter((_, i) => i !== a);
  if (!others.length) return null;
  const t = Math.max(minFloor, Math.min(over, others.length));
  const prev = others[t - 1];
  const next = others[t];
  if (!prev) {
    if (!next) return null;
    return { t, depth: next.depth, parentId: null };
  }
  const maxDepth = prev.depth + 1;
  const minDepth = next ? Math.max(minFloor, next.depth) : minFloor;
  const wanted = rows[a].depth + Math.round(dx / indent);
  const depth = Math.max(minDepth, Math.min(maxDepth, wanted));
  let parentId: string | null = null;
  for (let i = t - 1; i >= 0; i--) {
    if (others[i].depth === depth - 1) {
      parentId = others[i].id;
      break;
    }
  }
  return { t, depth, parentId };
}

/** translateY for every visible row while the overlay is out. */
export function shiftsFor(a: number, t: number, n: number, h: number): number[] {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === a) {
      out[i] = (t - a) * h;
      continue;
    }
    const p = i < a ? i : i - 1;
    const q = p < t ? p : p + 1;
    out[i] = (q - i) * h;
  }
  return out;
}

export function slotToDrop(
  rows: SlotRow[],
  a: number,
  target: SlotTarget,
): { overKey: string; mode: DndMode } | null {
  const active = rows[a];
  if (!active || !target) return null;
  const others = rows.filter((_, i) => i !== a);
  const prev = others[target.t - 1];
  const next = others[target.t];
  if (!prev) {
    if (next) return { overKey: next.key, mode: "before" };
    return null;
  }
  if (target.depth === prev.depth + 1) {
    return { overKey: prev.key, mode: "inside" };
  }
  if (next && target.depth <= next.depth) {
    return { overKey: next.key, mode: "before" };
  }
  return { overKey: prev.key, mode: "after" };
}

export type PlanKpi = { id: string } & Record<string, unknown>;
export type PlanKra = { id: string; kpis?: PlanKpi[] } & Record<string, unknown>;

function cloneKras(kras: PlanKra[]): PlanKra[] {
  return kras.map((k) => ({ ...k, kpis: [...(k.kpis || [])] }));
}

function findPlan(
  kras: PlanKra[],
  id: string,
): { kind: "kra"; ki: number } | { kind: "kpi"; ki: number; pi: number } | null {
  for (let ki = 0; ki < kras.length; ki++) {
    if (kras[ki].id === id) return { kind: "kra", ki };
    const pi = (kras[ki].kpis || []).findIndex((p) => p.id === id);
    if (pi >= 0) return { kind: "kpi", ki, pi };
  }
  return null;
}

/** Reorder KRAs or move a KPI (including across KRAs). KRAs do not nest. */
export function applyPlanDrop(
  kras: PlanKra[],
  activeId: string,
  overKey: string,
  mode: DndMode,
): PlanKra[] {
  const overId = String(overKey || "").split(":").slice(1).join(":");
  if (!activeId || !overId || overId === activeId || overId === "root" || overId === "__head") {
    return kras;
  }
  const next = cloneKras(kras);
  const src = findPlan(next, activeId);
  const dst = findPlan(next, overId);
  if (!src || !dst) return kras;

  if (src.kind === "kra") {
    const item = next[src.ki];
    const rest = next.filter((_, i) => i !== src.ki);
    const dstKraId = next[dst.ki].id;
    const di = rest.findIndex((k) => k.id === dstKraId);
    if (di < 0) return kras;
    const insertAt = mode === "before" ? di : di + 1;
    rest.splice(insertAt, 0, item);
    return rest;
  }

  const kpi = next[src.ki].kpis![src.pi];
  next[src.ki].kpis!.splice(src.pi, 1);
  const dst2 = findPlan(next, overId);
  if (!dst2) return kras;
  if (dst2.kind === "kra") {
    const list = next[dst2.ki].kpis!;
    if (mode === "after") list.push(kpi);
    else list.unshift(kpi);
    return next;
  }
  const list = next[dst2.ki].kpis!;
  let at = dst2.pi;
  if (mode === "after" || mode === "inside") at = dst2.pi + 1;
  list.splice(at, 0, kpi);
  return next;
}

/** Empty string stays empty while typing; do not coerce to 0 until blur. */
export function parseWeightPct(raw: string): { empty: boolean; ok: boolean; weight: number } {
  const t = String(raw ?? "");
  if (t === "") return { empty: true, ok: true, weight: 0 };
  if (!/^\d*\.?\d*$/.test(t)) return { empty: false, ok: false, weight: 0 };
  return { empty: false, ok: true, weight: (Number(t) || 0) / 100 };
}

type Row = { id: string } & Record<string, unknown>;

export function nestAtTop<T extends Row>(
  list: T[],
  id: string,
  parentId: string | null,
  parentField: string,
): T[] {
  const item = list.find((row) => row.id === id);
  if (!item) return list;
  const rest = list.filter((row) => row.id !== id);
  const updated = { ...item, [parentField]: parentId || null } as T;
  if (!parentId) {
    const firstRoot = rest.findIndex((row) => !row[parentField]);
    rest.splice(firstRoot < 0 ? 0 : firstRoot, 0, updated);
    return rest;
  }
  const firstSib = rest.findIndex((row) => (row[parentField] || null) === parentId);
  if (firstSib >= 0) {
    rest.splice(firstSib, 0, updated);
    return rest;
  }
  const parentIdx = rest.findIndex((row) => row.id === parentId);
  rest.splice(parentIdx >= 0 ? parentIdx + 1 : rest.length, 0, updated);
  return rest;
}

export function nestMemberAtTop<T extends { groupId: string; memberId: string }>(
  rows: T[],
  memberId: string,
  groupId: string,
  extra: Partial<T> = {},
): T[] {
  const without = rows.filter((row) => row.memberId !== memberId);
  const sibs = without.filter((row) => row.groupId === groupId);
  const others = without.filter((row) => row.groupId !== groupId);
  const next = { ...extra, groupId, memberId } as T;
  return [...others, next, ...sibs];
}
