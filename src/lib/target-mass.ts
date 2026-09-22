/** Mass update one field on many person-month rows. One PATCH per row, no 409 overwrite-retry. */

export type MassKind = "rewards" | "apms";
export type MassField = "targetNodeId" | "targetSbuId" | "heldRoleId";

export const MASS_FIELDS_REWARDS: MassField[] = ["targetNodeId"];
export const MASS_FIELDS_APMS: MassField[] = [];

export function massActionEnabled(selectedIds: readonly string[]): boolean {
  return selectedIds.length > 0;
}

export function allowedMassFields(kind: MassKind): MassField[] {
  return kind === "rewards" ? MASS_FIELDS_REWARDS.slice() : MASS_FIELDS_APMS.slice();
}

export type MassNode = { id: string; sbuId?: string | null; metric?: string };
export type MassRole = { id: string; name?: string };

export function applyMassField(
  rec: Record<string, unknown>,
  field: MassField,
  value: string | null,
  opts: { node?: MassNode | null; role?: MassRole | null } = {},
): Record<string, unknown> {
  const next = { ...rec };
  if (field === "targetNodeId") {
    const node = opts.node;
    next.targetNodeId = value || null;
    if (value && node) {
      next.targetSbuId = node.sbuId || undefined;
      next.targetMetric = node.metric;
    } else if (!value) {
      next.targetSbuId = undefined;
      next.targetMetric = undefined;
    }
  } else if (field === "targetSbuId") {
    next.targetSbuId = value || undefined;
  } else if (field === "heldRoleId") {
    next.heldRoleId = value || null;
    if (opts.role) next.heldRoleName = opts.role.name;
  }
  next.updatedAt = Date.now();
  return next;
}

export type MassHttpResult = { status: number; personId: string };

export type MassSummary = {
  updated: number;
  stale: number;
  failed: number;
  staleIds: string[];
  message: string;
};

export function summarizeMassResults(results: MassHttpResult[]): MassSummary {
  let updated = 0;
  let stale = 0;
  let failed = 0;
  const staleIds: string[] = [];
  for (const r of results) {
    if (r.status === 200) updated += 1;
    else if (r.status === 409) {
      stale += 1;
      staleIds.push(r.personId);
    } else failed += 1;
  }
  return {
    updated,
    stale,
    failed,
    staleIds,
    message: `${updated} updated, ${stale} stale (409), ${failed} failed.`,
  };
}

export function massEntityUrl(kind: MassKind, period: string, personId: string) {
  const table = kind === "rewards" ? "reward-records" : "month-records";
  return `/api/${table}/${encodeURIComponent(period)}/${encodeURIComponent(personId)}`;
}

export type UnlockNode = {
  id: string;
  name?: string;
  kind?: string;
  sbuId?: string | null;
};

export type UnlockMonthState = {
  targetNodes?: Record<string, UnlockNode>;
  targetCells?: Record<string, { month?: string; nodeId?: string } | null | undefined>;
  targetMembers?: { month?: string; groupId?: string; memberId?: string }[];
  targetRootOrder?: Record<string, string[]>;
};

function cellMonth(key: string, cell: { month?: string } | null | undefined): string {
  if (cell && cell.month) return String(cell.month);
  const i = String(key).lastIndexOf("::");
  return i >= 0 ? String(key).slice(i + 2) : "";
}

/** Nodes laid in this month — same set as Targets / person-month Unlock against. */
export function monthUnlockNodes(state: UnlockMonthState, month: string): UnlockNode[] {
  const ids = new Set<string>();
  for (const [k, c] of Object.entries(state.targetCells || {})) {
    if (cellMonth(k, c) !== month) continue;
    const id = (c && c.nodeId) || String(k).split("::")[0];
    if (id) ids.add(id);
  }
  for (const mem of state.targetMembers || []) {
    if (mem.month !== month) continue;
    if (mem.groupId) ids.add(mem.groupId);
    if (mem.memberId) ids.add(mem.memberId);
  }
  for (const id of state.targetRootOrder?.[month] || []) ids.add(id);
  return Object.values(state.targetNodes || {})
    .filter((n) => ids.has(n.id))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function monthUnlockGroups(nodes: UnlockNode[]) {
  return {
    groups: nodes.filter((n) => n.kind === "group"),
    studios: nodes.filter((n) => n.kind === "leaf" && n.sbuId),
    other: nodes.filter((n) => n.kind !== "group" && !n.sbuId),
  };
}

export function massRevKey(kind: MassKind, period: string, personId: string) {
  const table = kind === "rewards" ? "reward_records" : "month_records";
  return `${table}:${period}:${personId}`;
}
