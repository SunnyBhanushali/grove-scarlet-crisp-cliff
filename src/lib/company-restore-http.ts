import { flattenPersonPeriodMap, flattenTargetCells } from "./company-hot-tables.ts";
import {
  extractSnapshot,
  replaceCompanySnapshot,
} from "./company-notebook.ts";
import { hasValidSession, unauthorizedJson } from "./apms-request-auth.ts";
import type { Snapshot } from "./company-books.ts";
import {
  RestoreRejectedError,
  countTargetNodes,
  normalizeTargetsGraph,
  restoreTargetsGuard,
  targetCellKeys,
  targetNodeIds,
} from "./company-restore-targets.ts";

function peopleCount(snapshot: Snapshot | null): number {
  return Array.isArray(snapshot?.people) ? snapshot!.people.length : 0;
}

function snapshotCounts(snapshot: Snapshot) {
  return {
    people: peopleCount(snapshot),
    monthRecords: flattenPersonPeriodMap(snapshot.records).length,
    rewardRecords: flattenPersonPeriodMap(snapshot.rewardRecords).length,
    targetCells: flattenTargetCells(snapshot.targetCells).length,
  };
}

export async function restoreCompanyFromUpload(input: unknown): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  message?: string;
  people?: number;
  monthRecords?: number;
  rewardRecords?: number;
  targetCells?: number;
  targetNodes?: number;
  targetCellKeys?: number;
  targetNodeIds?: number;
}> {
  const extracted = extractSnapshot(input);
  if (!extracted || peopleCount(extracted) < 1) {
    return {
      ok: false,
      status: 400,
      error: "That file is not an Aliens APMS snapshot.",
    };
  }
  const incoming = normalizeTargetsGraph(extracted);
  const guard = restoreTargetsGuard(incoming);
  if (!guard.ok) {
    return { ok: false, status: 400, error: guard.error };
  }
  try {
    const result = await replaceCompanySnapshot(JSON.stringify(incoming));
    let assembled: Snapshot | null = null;
    try {
      assembled = JSON.parse(result.snapshotJson) as Snapshot;
    } catch {
      assembled = incoming;
    }
    const counts = snapshotCounts(assembled || incoming);
    return {
      ok: true,
      status: 200,
      message: `Restored ${counts.people} people. Closed months stayed as stored.`,
      ...counts,
      targetNodes: countTargetNodes(assembled || incoming),
      targetCellKeys: targetCellKeys(assembled || incoming).length,
      targetNodeIds: targetNodeIds(assembled || incoming).length,
    };
  } catch (err) {
    if (err instanceof RestoreRejectedError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }
}

export async function handleCompanyRestoreRequest(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  // BATCH-2: restoring a backup replaces the company — admins only.
  const { requireAdmin } = await import("./apms-admin-auth.ts");
  const gate = await requireAdmin(request.headers);
  if (gate.response) return gate.response;
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: "POST a backup file." }, { status: 405 });
  }
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "That file is not valid JSON." },
      { status: 400 },
    );
  }
  try {
    const result = await restoreCompanyFromUpload(input);
    const { status, ...body } = result;
    return Response.json(body, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed.";
    console.error("[api/company-restore]", err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
