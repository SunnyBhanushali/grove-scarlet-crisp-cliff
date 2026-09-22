import type { Snapshot } from "./company-books.ts";
import { flattenTargetCells } from "./company-hot-tables.ts";

export const EMPTY_TARGETS_RESTORE_ERROR =
  "Restore did not load the target cells from this file. Restore cancelled.";

export class RestoreRejectedError extends Error {
  status = 400;
  constructor(message: string = EMPTY_TARGETS_RESTORE_ERROR) {
    super(message);
    this.name = "RestoreRejectedError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asIdMap(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const row of value) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const rec = row as Record<string, unknown>;
      const id = String(rec.id || rec.key || "");
      if (!id) continue;
      out[id] = rec;
    }
    return out;
  }
  if (isPlainObject(value)) return { ...value };
  return {};
}

export function countTargetNodes(snapshot: Snapshot | null | undefined): number {
  if (!snapshot) return 0;
  const nodes = snapshot.targetNodes;
  if (Array.isArray(nodes)) return nodes.filter((row) => row && typeof row === "object").length;
  if (isPlainObject(nodes)) return Object.keys(nodes).length;
  return 0;
}

export function countTargetCells(snapshot: Snapshot | null | undefined): number {
  if (!snapshot) return 0;
  return flattenTargetCells(snapshot.targetCells).length;
}

export function listedTargetMonths(snapshot: Snapshot | null | undefined): string[] {
  if (!snapshot) return [];
  const months = new Set<string>();
  const status = snapshot.targetMonthStatus;
  if (isPlainObject(status)) {
    for (const key of Object.keys(status)) if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  const order = snapshot.targetRootOrder;
  if (isPlainObject(order)) {
    for (const key of Object.keys(order)) if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  if (Array.isArray(order)) {
    /* ids only — months come from status/cells */
  }
  for (const cell of flattenTargetCells(snapshot.targetCells)) {
    const rec = cell.payload;
    const month = String(rec.month || rec.period || "");
    if (/^\d{4}-\d{2}$/.test(month)) months.add(month);
    const fromId = cell.id.match(/(\d{4}-\d{2})/);
    if (fromId) months.add(fromId[1]);
  }
  return [...months];
}

export function targetsGraphEmpty(snapshot: Snapshot | null | undefined): boolean {
  return countTargetNodes(snapshot) < 1 && countTargetCells(snapshot) < 1;
}

export function restoreTargetsGuard(
  snapshot: Snapshot | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!snapshot) return { ok: false, error: "That file is not an Aliens APMS snapshot." };
  return { ok: true };
}

const TARGET_BOOK_FIELDS = [
  "targetNodes",
  "targetMembers",
  "targetCells",
  "targetMonthStatus",
  "targetRootOrder",
  "sbuTargets",
  "targetHistory",
] as const;

/** Keep file node ids. Arrays become id maps so SPA lookups still resolve. */
export function normalizeTargetsGraph(snapshot: Snapshot): Snapshot {
  const next: Snapshot = { ...snapshot };
  if ("targetNodes" in next || next.targetNodes) next.targetNodes = asIdMap(next.targetNodes);
  if ("targetCells" in next || next.targetCells) next.targetCells = asIdMap(next.targetCells);
  if (Array.isArray(next.targetMembers) || isPlainObject(next.targetMembers)) {
    next.targetMembers = Array.isArray(next.targetMembers)
      ? next.targetMembers
      : Object.values(next.targetMembers as Record<string, unknown>);
  }
  return next;
}

/** Incoming file has no targets graph — do not blank live interiors. */
export function keepStoredTargets(incoming: Snapshot, stored: Snapshot | null | undefined): Snapshot {
  if (!stored || !targetsGraphEmpty(incoming) || targetsGraphEmpty(stored)) return incoming;
  const next: Snapshot = { ...incoming };
  for (const field of TARGET_BOOK_FIELDS) {
    if (stored[field] !== undefined) next[field] = stored[field];
  }
  return next;
}

export function targetNodeIds(snapshot: Snapshot): string[] {
  const nodes = snapshot.targetNodes;
  if (Array.isArray(nodes)) {
    return nodes
      .map((row) => (row && typeof row === "object" ? String((row as { id?: unknown }).id || "") : ""))
      .filter(Boolean);
  }
  if (isPlainObject(nodes)) return Object.keys(nodes);
  return [];
}

export function targetCellKeys(snapshot: Snapshot): string[] {
  return flattenTargetCells(snapshot.targetCells).map((row) => row.id);
}
