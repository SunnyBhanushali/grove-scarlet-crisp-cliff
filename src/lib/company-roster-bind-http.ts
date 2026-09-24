import { hasValidSession, unauthorizedJson } from "./apms-request-auth.ts";
import { isAdminAccess } from "./company-roster.ts";
import {
  getRosterBind,
  isRosterBindKind,
  parseRosterBindPath,
  rebindRoster,
} from "./company-roster-bind.ts";

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function accessOf(
  people: Array<Record<string, unknown>>,
  personId: string,
): string {
  const found = people.find((p) => String(p.id || "") === personId);
  const access = found && typeof found.access === "string" ? found.access : "";
  if (access) return access;
  if (personId === "p-admin") return "super_admin";
  return "";
}

export async function handleRosterBindHttp(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const parsed = parseRosterBindPath(new URL(request.url).pathname);
  if (!parsed || !isRosterBindKind(parsed.kind) || !parsed.subjectId) {
    return json(404, { ok: false, error: "not-found" });
  }

  const { getCompanyWire } = await import("./company-notebook.ts");
  const { personIdForWire } = await import("./company-wire-http.ts");
  const { getSql } = await import("./db.ts");
  const wire = await getCompanyWire({ encode: false });
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();

  const access = accessOf(wire.people, personId);
  const method = request.method.toUpperCase();
  const sql = await getSql();

  let awardPeriod = "";
  if (parsed.kind === "award") {
    try {
      const snap = JSON.parse(wire.snapshotJson) as Record<string, unknown>;
      const list = Array.isArray(snap.awardInstances) ? snap.awardInstances : [];
      const row = list.find(
        (a) => a && typeof a === "object" && String((a as { id?: unknown }).id || "") === parsed.subjectId,
      ) as { period?: string; periodStart?: string } | undefined;
      awardPeriod = String(row?.period || row?.periodStart || "");
    } catch {
      awardPeriod = "";
    }
  }

  if (parsed.action === "get") {
    if (method !== "GET") return json(405, { ok: false, error: "method" });
    const result = await getRosterBind(sql, parsed.kind, parsed.subjectId, {
      updatedBy: personId,
      awardPeriod,
    });
    return json(result.status, result.body);
  }

  if (parsed.action === "rebind") {
    if (method !== "POST") return json(405, { ok: false, error: "method" });
    if (!isAdminAccess(access)) {
      return json(403, { ok: false, error: "admin-only" });
    }
    const result = await rebindRoster(sql, parsed.kind, parsed.subjectId, await request.json().catch(() => null), {
      updatedBy: personId,
      access,
    });
    return json(result.status, result.body);
  }

  return json(404, { ok: false, error: "not-found" });
}
