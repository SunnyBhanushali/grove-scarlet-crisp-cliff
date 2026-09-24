/**
 * Targets ↔ Rewards links (BATCH-3 part C).
 *
 * A reward unlocks against a target node (`targetNodeId`). Deleting a target
 * from a month deletes its cell for that month (and the node itself once no
 * month uses it). A reward whose node is gone, or has no cell in the reward's
 * month, has a broken link. `targetLinkBroken` is COMPUTED when a record is
 * read — it is never stored: `stripComputedRewardFields` removes it from any
 * payload before a write.
 *
 * The SPA runs the same logic (stamp-p0as82-targets.mjs, TL_HELPERS_JS); the
 * test file checks both against the same cases.
 */

export type LinkNode = { id: string; name?: string; kind?: string; sbuId?: string | null; metric?: string };
export type LinkCell = { nodeId?: string; month?: string } | null | undefined;
export type LinkRec = { targetNodeId?: string | null; [k: string]: unknown } | null | undefined;

export type LinkState = {
  targetNodes?: Record<string, LinkNode | undefined>;
  targetCells?: Record<string, LinkCell>;
  rewardRecords?: Record<string, Record<string, LinkRec>>;
  rewardRoleMonths?: Record<string, Record<string, LinkRec>>;
  people?: { id: string; name?: string }[];
  roles?: Record<string, { name?: string } | undefined>;
  trash?: { kind?: string; snapshot?: { targetNodes?: Record<string, LinkNode> } }[];
};

export type RewardRef = {
  kind: "record" | "roleMonth";
  period: string;
  personId?: string;
  roleId?: string;
  nodeId: string;
};

function cellMonth(key: string, c: LinkCell) {
  if (c && c.month) return c.month;
  const i = key.lastIndexOf("::");
  return i >= 0 ? key.slice(i + 2) : "";
}

/** Does the node have a target cell in `month`? */
export function nodeHasCell(state: LinkState, nodeId: string, month: string): boolean {
  const cells = state.targetCells || {};
  if (cells[`${nodeId}::${month}`]) return true;
  for (const [k, c] of Object.entries(cells)) {
    if (c && c.nodeId === nodeId && cellMonth(k, c) === month) return true;
  }
  return false;
}

/** The link is broken: the reward names a target node that is missing, or has no cell in the reward's month. */
export function targetLinkBroken(rec: LinkRec, month: string, state: LinkState): boolean {
  const id = rec && rec.targetNodeId;
  if (!id) return false;
  if (!(state.targetNodes || {})[String(id)]) return true;
  return !nodeHasCell(state, String(id), month);
}

/** Copies of a month's reward rows with `targetLinkBroken` computed (for a read response). */
export function annotateRewardMonth<T extends Record<string, unknown>>(
  rows: Record<string, T>,
  month: string,
  state: LinkState,
): Record<string, T & { targetLinkBroken: boolean }> {
  const out: Record<string, T & { targetLinkBroken: boolean }> = {};
  for (const [id, rec] of Object.entries(rows || {})) {
    out[id] = { ...rec, targetLinkBroken: targetLinkBroken(rec as LinkRec, month, state) };
  }
  return out;
}

/** Computed fields never go into the database. */
export function stripComputedRewardFields<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object" || !("targetLinkBroken" in payload)) return payload;
  const next = { ...payload };
  delete (next as Record<string, unknown>).targetLinkBroken;
  return next;
}

/** Name of a node that may have been deleted: the live node, else the newest Trash snapshot of it. */
export function nodeNameAnyway(state: LinkState, id: string): { name: string; kind?: string } | null {
  const live = (state.targetNodes || {})[id];
  if (live && live.name) return { name: live.name, kind: live.kind };
  const trash = state.trash || [];
  for (let i = trash.length - 1; i >= 0; i--) {
    const n = trash[i] && trash[i].snapshot && trash[i].snapshot!.targetNodes && trash[i].snapshot!.targetNodes![id];
    if (n && n.name) return { name: n.name, kind: n.kind };
  }
  return null;
}

/** Every reward (person month and role month) in `months` that unlocks against one of `nodeIds` (all nodes when null). */
export function rewardsLinkedTo(state: LinkState, nodeIds: string[] | null, months: string[]): RewardRef[] {
  const want = nodeIds ? new Set(nodeIds) : null;
  const ms = new Set(months);
  const out: RewardRef[] = [];
  for (const [period, byPerson] of Object.entries(state.rewardRecords || {})) {
    if (!ms.has(period)) continue;
    for (const [personId, rec] of Object.entries(byPerson || {})) {
      const id = rec && rec.targetNodeId;
      if (id && (!want || want.has(String(id)))) out.push({ kind: "record", period, personId, nodeId: String(id) });
    }
  }
  for (const [roleId, byMonth] of Object.entries(state.rewardRoleMonths || {})) {
    for (const [period, rec] of Object.entries(byMonth || {})) {
      if (!ms.has(period)) continue;
      const id = rec && rec.targetNodeId;
      if (id && (!want || want.has(String(id)))) out.push({ kind: "roleMonth", period, roleId, nodeId: String(id) });
    }
  }
  return out.sort((a, b) => (a.period + (a.personId || a.roleId)).localeCompare(b.period + (b.personId || b.roleId)));
}

/** "Person name · month" for the guard dialog. */
export function describeReward(state: LinkState, r: RewardRef, monthLabel: (m: string) => string = (m) => m): string {
  const who =
    r.kind === "roleMonth"
      ? (state.roles || {})[r.roleId || ""]?.name || r.roleId || "Role"
      : (state.people || []).find((p) => p.id === r.personId)?.name || r.personId || "Person";
  return `${who} · ${monthLabel(r.period)}`;
}

function norm(s: unknown) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * After a target is created (or re-created) as `newId` in `months`: rewards in
 * those months whose link is broken and whose deleted target had the same
 * name (and kind). Empty when the create reused the node id — those links
 * are whole again on their own.
 */
export function relinkCandidates(state: LinkState, newId: string, months: string[]): (RewardRef & { fromName: string })[] {
  const node = (state.targetNodes || {})[newId];
  if (!node) return [];
  const name = norm(node.name);
  const out: (RewardRef & { fromName: string })[] = [];
  for (const r of rewardsLinkedTo(state, null, months)) {
    if (r.nodeId === newId) continue;
    if (!nodeHasCell(state, newId, r.period)) continue;
    const rec =
      r.kind === "record"
        ? state.rewardRecords?.[r.period]?.[r.personId || ""]
        : state.rewardRoleMonths?.[r.roleId || ""]?.[r.period];
    if (!targetLinkBroken(rec, r.period, state)) continue;
    const was = nodeNameAnyway(state, r.nodeId);
    if (!was || norm(was.name) !== name) continue;
    if (was.kind && node.kind && was.kind !== node.kind) continue;
    out.push({ ...r, fromName: was.name });
  }
  return out;
}

/** The fields a relink writes on a reward (same as Unlock against / Mass update). */
export function relinkFields(node: LinkNode): { targetNodeId: string; targetSbuId: string | undefined; targetMetric: string | undefined } {
  return { targetNodeId: node.id, targetSbuId: node.sbuId || undefined, targetMetric: node.metric };
}
