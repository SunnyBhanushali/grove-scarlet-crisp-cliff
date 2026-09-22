/**
 * SCREEN-READ (p0as70): People list + Rewards month pages.
 * GET /api/people?limit=80 and GET /api/reward-records/:period?limit=80
 * — not the company file.
 */
import { unauthorizedJson, hasSessionToken } from "./apms-request-auth.ts";
import type { HotSql } from "./company-hot-tables.ts";

export const SCREEN_PAGE_LIMIT = 80;

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (isPlain(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isPlain(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SCREEN_PAGE_LIMIT;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

function personMatchesQ(row: Record<string, unknown>, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const fields = [row.name, row.preferredName, row.email, row.username, row.title, row.id];
  return fields.some((v) => String(v || "").toLowerCase().includes(needle));
}

function personSbuIds(row: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of ["buId", "sbuId", "businessUnitId"]) {
    if (row[key]) ids.push(String(row[key]));
  }
  if (Array.isArray(row.sbuIds)) ids.push(...row.sbuIds.map((v) => String(v)));
  return ids;
}

export function parseScreenReadPath(pathname: string): {
  kind: "people" | "reward-records" | "month-records";
  period?: string;
} | null {
  const path = pathname.replace(/\/+$/, "") || pathname;
  if (path === "/api/people") return { kind: "people" };
  const reward = path.match(/^\/api\/reward-records\/([^/]+)$/);
  if (reward) return { kind: "reward-records", period: decodeURIComponent(reward[1]) };
  const month = path.match(/^\/api\/month-records\/([^/]+)$/);
  if (month) return { kind: "month-records", period: decodeURIComponent(month[1]) };
  return null;
}

export async function listPeoplePage(
  sql: HotSql,
  opts: { limit?: number; q?: string; sbu?: string; offset?: number } = {},
): Promise<{
  people: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = clampLimit(opts.limit);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const q = String(opts.q || "").trim();
  const sbu = String(opts.sbu || "").trim();
  const rows = await sql.query<{ id: string; payload: unknown; rev?: number }>(
    "select id, payload, rev from people where deleted_at is null",
  );
  const all: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const payload = { ...asPayload(row.payload), id: row.id, rev: Number(row.rev) || 1 };
    if (!personMatchesQ(payload, q)) continue;
    if (sbu && !personSbuIds(payload).includes(sbu)) continue;
    all.push(payload);
  }
  all.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return { people: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

export async function listRewardMonthPage(
  sql: HotSql,
  period: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  period: string;
  records: Array<{ personId: string; period: string; payload: Record<string, unknown>; rev: number }>;
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = clampLimit(opts.limit);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const month = String(period || "");
  const rows = await sql.query<{ person_id: string; payload: unknown; rev?: number }>(
    "select person_id, payload, rev from reward_records where deleted_at is null and period = $1",
    [month],
  );
  const all = rows.map((row) => ({
    personId: String(row.person_id),
    period: month,
    payload: asPayload(row.payload),
    rev: Number(row.rev) || 1,
  }));
  all.sort((a, b) => a.personId.localeCompare(b.personId));
  return {
    period: month,
    records: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset,
  };
}

export async function listMonthRecordsPage(
  sql: HotSql,
  period: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  period: string;
  records: Array<{ personId: string; period: string; payload: Record<string, unknown>; rev: number }>;
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = clampLimit(opts.limit);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const month = String(period || "");
  const rows = await sql.query<{ person_id: string; payload: unknown; rev?: number }>(
    "select person_id, payload, rev from month_records where deleted_at is null and period = $1",
    [month],
  );
  const all = rows.map((row) => ({
    personId: String(row.person_id),
    period: month,
    payload: asPayload(row.payload),
    rev: Number(row.rev) || 1,
  }));
  all.sort((a, b) => a.personId.localeCompare(b.personId));
  return {
    period: month,
    records: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset,
  };
}

export async function handleScreenReadHttp(request: Request): Promise<Response | null> {
  if (request.method.toUpperCase() !== "GET") return null;
  const url = new URL(request.url);
  const parsed = parseScreenReadPath(url.pathname);
  if (!parsed) return null;
  if (!hasSessionToken(request.headers)) return unauthorizedJson();

  const { getCompanyWire } = await import("./company-notebook");
  const { personIdForWire } = await import("./company-wire-http");
  const wire = await getCompanyWire();
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();

  const { getSql } = await import("./db");
  const sql = await getSql();
  const limit = url.searchParams.get("limit");
  const q = url.searchParams.get("q") || "";
  const sbu = url.searchParams.get("sbu") || "";
  const offset = url.searchParams.get("offset");

  if (parsed.kind === "people") {
    const page = await listPeoplePage(sql, { limit: Number(limit) || undefined, q, sbu, offset: Number(offset) || 0 });
    return Response.json({ ok: true, ...page });
  }
  if (parsed.kind === "reward-records") {
    const page = await listRewardMonthPage(sql, parsed.period || "", {
      limit: Number(limit) || undefined,
      offset: Number(offset) || 0,
    });
    return Response.json({ ok: true, ...page });
  }
  const page = await listMonthRecordsPage(sql, parsed.period || "", {
    limit: Number(limit) || undefined,
    offset: Number(offset) || 0,
  });
  return Response.json({ ok: true, ...page });
}
