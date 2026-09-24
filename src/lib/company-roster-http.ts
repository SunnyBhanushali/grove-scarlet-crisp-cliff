import { hasValidSession, unauthorizedJson } from "./apms-request-auth.ts";
import {
  copyRosterFrom,
  getRoster,
  isHrAccess,
  isRosterPeriod,
  lockRoster,
  patchRoster,
  unlockRoster,
} from "./company-roster.ts";

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRosterPath(pathname: string): {
  period: string;
  action: "get" | "lock" | "unlock" | "copy-from";
  fromPeriod?: string;
} | null {
  const path = pathname.replace(/\/+$/, "") || pathname;
  const copy = path.match(/^\/api\/roster\/([^/]+)\/copy-from\/([^/]+)$/);
  if (copy) {
    return { period: decodePart(copy[1]), action: "copy-from", fromPeriod: decodePart(copy[2]) };
  }
  const lock = path.match(/^\/api\/roster\/([^/]+)\/lock$/);
  if (lock) return { period: decodePart(lock[1]), action: "lock" };
  const unlock = path.match(/^\/api\/roster\/([^/]+)\/unlock$/);
  if (unlock) return { period: decodePart(unlock[1]), action: "unlock" };
  const get = path.match(/^\/api\/roster\/([^/]+)$/);
  if (get) return { period: decodePart(get[1]), action: "get" };
  return null;
}

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

function catalogsFromSnapshot(snapshotJson: string, people: Array<Record<string, unknown>>) {
  let snap: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(snapshotJson);
    if (parsed && typeof parsed === "object") snap = parsed as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const list = (value: unknown): Array<{ id: string; name: string }> => {
    if (!Array.isArray(value)) return [];
    const out: Array<{ id: string; name: string }> = [];
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const id = String(rec.id || "");
      if (!id) continue;
      out.push({ id, name: String(rec.name || id) });
    }
    return out;
  };
  return {
    people: people.map((p) => ({
      id: String(p.id || ""),
      name: String(p.name || p.id || ""),
      access: String(p.access || ""),
      status: String(p.status || "active"),
      buId: String(p.buId || ""),
      managerId: String(p.managerId || ""),
      functionId: String(p.functionId || ""),
      brandId: String(p.brandId || ""),
      companyId: String(p.companyId || ""),
    })),
    sbus: list(snap.businessUnits),
    brands: list(snap.brands),
    functions: list(snap.functions),
    months: Array.isArray(snap.months) ? snap.months.filter((m) => typeof m === "string") : [],
  };
}

export async function handleRosterHttp(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const parsed = parseRosterPath(new URL(request.url).pathname);
  if (!parsed || !isRosterPeriod(parsed.period) || (parsed.fromPeriod && !isRosterPeriod(parsed.fromPeriod))) {
    return json(404, { ok: false, error: "not-found" });
  }

  const { getCompanyWire } = await import("./company-notebook.ts");
  const { personIdForWire } = await import("./company-wire-http.ts");
  const { getSql } = await import("./db.ts");
  const wire = await getCompanyWire();
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();

  const access = accessOf(wire.people, personId);
  const method = request.method.toUpperCase();
  const sql = await getSql();

  if (parsed.action === "get") {
    if (method !== "GET") return json(405, { ok: false, error: "method" });
    const body = await getRoster(sql, parsed.period);
    return json(200, { ...body, catalogs: catalogsFromSnapshot(wire.snapshotJson, wire.people) });
  }

  if (!isHrAccess(access)) {
    return json(403, { ok: false, error: "hr-only" });
  }

  if (parsed.action === "lock") {
    if (method !== "POST") return json(405, { ok: false, error: "method" });
    const result = await lockRoster(sql, parsed.period, { updatedBy: personId });
    return json(result.status, result.body);
  }

  if (parsed.action === "unlock") {
    if (method !== "POST") return json(405, { ok: false, error: "method" });
    if (!isHrAccess(access)) return json(403, { ok: false, error: "hr-only" });
    const result = await unlockRoster(sql, parsed.period, {
      updatedBy: personId,
      access,
    });
    return json(result.status, result.body);
  }

  if (parsed.action === "copy-from") {
    if (method !== "POST") return json(405, { ok: false, error: "method" });
    const result = await copyRosterFrom(sql, parsed.period, parsed.fromPeriod || "", {
      updatedBy: personId,
    });
    return json(result.status, result.body);
  }

  if (method !== "PATCH") return json(405, { ok: false, error: "method" });
  const result = await patchRoster(sql, parsed.period, await request.json().catch(() => null), {
    updatedBy: personId,
  });
  return json(result.status, result.body);
}
