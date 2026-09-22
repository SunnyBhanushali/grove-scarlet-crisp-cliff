/**
 * MOD-ORG (p0as74): Org / person / trash screens fetch a slice, not the company file.
 * GET /api/org?kind=  GET/PATCH /api/org/:kind/:id
 */
import { unauthorizedJson, hasSessionToken } from "./apms-request-auth.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";
import { notifyCompanyLive } from "./company-live.ts";
import { softInvalidateCompanyWire } from "./company-wire-cache.ts";

export const ORG_KINDS = [
  "overview",
  "chart",
  "builder",
  "companies",
  "units",
  "brands",
  "sbus",
  "cluster",
  "functions",
  "roles",
  "trash",
] as const;

export type OrgKind = (typeof ORG_KINDS)[number] | "subFunctions";

const KIND_FIELDS: Record<string, readonly string[]> = {
  overview: ["companies", "brands", "businessUnits", "functions"],
  chart: ["companies", "brands", "businessUnits", "functions", "subFunctions"],
  builder: ["companies", "brands", "businessUnits", "functions", "subFunctions", "sbuMembers"],
  companies: ["companies"],
  units: ["companies"],
  brands: ["brands"],
  sbus: ["businessUnits", "sbuMembers"],
  cluster: ["companies", "brands", "businessUnits"],
  functions: ["functions", "subFunctions"],
  roles: ["roles"],
  subFunctions: ["subFunctions"],
  trash: ["trash"],
};

const NODE_FIELD: Record<string, string> = {
  companies: "companies",
  units: "companies",
  brands: "brands",
  sbus: "businessUnits",
  functions: "functions",
  roles: "roles",
  subFunctions: "subFunctions",
};

/** Org node kinds → generic entity kinds (apms-collections.js). */
const ORG_KIND_TO_ENTITY: Record<string, string> = {
  companies: "companies",
  units: "companies",
  brands: "brands",
  sbus: "sbus",
  functions: "functions",
  roles: "roles",
  subFunctions: "sub-functions",
};

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

export function parseOrgPath(pathname: string): { kind?: string; id?: string; list: boolean } | null {
  const path = pathname.replace(/\/+$/, "") || pathname;
  if (path === "/api/org") return { list: true };
  const one = path.match(/^\/api\/org\/([^/]+)$/);
  if (one) return { list: true, kind: decodeURIComponent(one[1]) };
  const two = path.match(/^\/api\/org\/([^/]+)\/([^/]+)$/);
  if (two) return { list: false, kind: decodeURIComponent(two[1]), id: decodeURIComponent(two[2]) };
  return null;
}

export function normalizeOrgKind(raw: string | undefined | null): string {
  const k = String(raw || "").trim();
  if (k === "org-units" || k === "unit") return "units";
  if (k === "org-brands" || k === "brand") return "brands";
  if (k === "org-sbus" || k === "sbu" || k === "businessUnits") return "sbus";
  if (k === "org-functions" || k === "function") return "functions";
  if (k === "org-roles" || k === "role") return "roles";
  if (k === "org-chart") return "chart";
  if (k === "org-builder") return "builder";
  if (k === "org-overview" || k === "org") return "overview";
  if (k === "org-cluster") return "cluster";
  if (k === "companies") return "companies";
  return k;
}

function itemsOf(book: Snapshot, field: string): unknown {
  return book[field];
}

function asNodeList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isPlain);
  }
  if (isPlain(value)) {
    return Object.values(value).filter(isPlain);
  }
  return [];
}

function findNode(value: unknown, id: string): Record<string, unknown> | null {
  const want = String(id);
  if (Array.isArray(value)) {
    for (const row of value) {
      if (isPlain(row) && String(row.id) === want) return row;
    }
    return null;
  }
  if (isPlain(value)) {
    const direct = value[want];
    if (isPlain(direct)) return { ...direct, id: want };
    for (const row of Object.values(value)) {
      if (isPlain(row) && String(row.id) === want) return row;
    }
  }
  return null;
}

export function orgSliceFromBook(book: Snapshot, kind: string): Record<string, unknown> {
  const k = normalizeOrgKind(kind);
  const fields = KIND_FIELDS[k] || KIND_FIELDS.overview;
  const out: Record<string, unknown> = { ok: true, kind: k };
  for (const field of fields) {
    out[field] = itemsOf(book, field) ?? (field === "roles" ? {} : []);
  }
  return out;
}

export function getOrgNodeFromBook(
  book: Snapshot,
  kind: string,
  id: string,
): { status: number; body: Record<string, unknown> } {
  const k = normalizeOrgKind(kind);
  const field = NODE_FIELD[k];
  if (!field) return { status: 404, body: { ok: false, error: "unknown-kind", kind: k } };
  const node = findNode(book[field], id);
  if (!node) return { status: 404, body: { ok: false, error: "not-found", kind: k, id } };
  return {
    status: 200,
    body: {
      ok: true,
      kind: k,
      id,
      field,
      payload: node,
      rev: Number(node.rev) || 0,
    },
  };
}

export function patchOrgNodeInBook(
  book: Snapshot,
  kind: string,
  id: string,
  payload: Record<string, unknown>,
  baseRev: number,
  deleted = false,
): { status: number; book: Snapshot; body: Record<string, unknown> } {
  const k = normalizeOrgKind(kind);
  const field = NODE_FIELD[k];
  if (!field) return { status: 404, book, body: { ok: false, error: "unknown-kind", kind: k } };
  const current = book[field];
  const existing = findNode(current, id);
  const rev = existing ? Number(existing.rev) || 0 : 0;
  if (existing && baseRev !== rev) {
    return {
      status: 409,
      book,
      body: {
        ok: false,
        error: "stale",
        kind: k,
        id,
        payload: existing,
        rev,
      },
    };
  }
  const nextNode = deleted
    ? null
    : { ...(existing || {}), ...payload, id, rev: rev + 1 };
  let nextCol: unknown;
  if (Array.isArray(current) || current == null) {
    const list = asNodeList(current).filter((row) => String(row.id) !== id);
    if (nextNode) list.push(nextNode);
    nextCol = list;
  } else if (isPlain(current)) {
    const map = { ...current };
    if (deleted) delete map[id];
    else if (nextNode) map[id] = nextNode;
    nextCol = map;
  } else {
    nextCol = nextNode ? [nextNode] : [];
  }
  const nextBook: Snapshot = { ...book, [field]: nextCol };
  return {
    status: 200,
    book: nextBook,
    body: {
      ok: true,
      kind: k,
      id,
      field,
      payload: nextNode || {},
      rev: nextNode ? Number(nextNode.rev) || 1 : rev + 1,
      deleted,
    },
  };
}

export async function listTrashPeople(sql: HotSql): Promise<{
  people: Array<Record<string, unknown>>;
  total: number;
}> {
  const rows = await sql.query<{ id: string; payload: unknown; rev?: number }>(
    "select id, payload, rev from people where deleted_at is not null",
  );
  const people = rows.map((row) => ({ ...asPayload(row.payload), id: row.id, rev: Number(row.rev) || 1, deleted: true }));
  people.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return { people, total: people.length };
}

export async function handleOrgHttp(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const parsed = parseOrgPath(url.pathname);
  if (!parsed) return null;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "PATCH") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }
  if (!hasSessionToken(request.headers)) return unauthorizedJson();

  const { readOrgBook, commitOrgFields } = await import("./company-notebook");
  const kind = normalizeOrgKind(parsed.kind || url.searchParams.get("kind") || "overview");

  if (method === "GET" && (parsed.list || !parsed.id)) {
    if (kind === "trash") {
      const { getSql } = await import("./db");
      const sql = await getSql();
      const page = await listTrashPeople(sql);
      const book = await readOrgBook();
      return Response.json({
        ok: true,
        kind: "trash",
        people: page.people,
        trash: book.trash || [],
        total: page.total,
      });
    }
    const book = await readOrgBook();
    return Response.json(orgSliceFromBook(book, kind));
  }

  if (!parsed.id) return Response.json({ ok: false, error: "missing-id" }, { status: 400 });

  // ROWS-V2: org nodes are generic entity rows. Reads and writes go through the
  // row store so two admins editing different nodes never overwrite each other
  // (the book read-modify-write below raced outside the book lock).
  const { ENTITY_ROWS_ENABLED, liveEntityHooks } = await import("./company-entities-v2");
  const entityKind = ORG_KIND_TO_ENTITY[kind];
  if (ENTITY_ROWS_ENABLED && entityKind) {
    const { getSql } = await import("./db");
    const { readLiveSnapshot } = await import("./company-notebook");
    const { ensureEntitiesFromBooks, entityIdFromParts, patchEntityRow, readEntity } = await import("./company-entity-store");
    const sql = (await getSql()) as unknown as HotSql;
    await ensureEntitiesFromBooks(sql, () => readLiveSnapshot());
    const key = entityIdFromParts(entityKind, parsed.id);
    const field = NODE_FIELD[kind];
    if (method === "GET") {
      const row = await readEntity(sql, key);
      if (!row || row.deleted) return Response.json({ ok: false, error: "not-found", kind, id: parsed.id }, { status: 404 });
      return Response.json({ ok: true, kind, id: parsed.id, field, payload: { ...row.payload, rev: row.rev }, rev: row.rev });
    }
    const body = await request.json().catch(() => null);
    const result = await patchEntityRow(sql, key, body, "org-patch", liveEntityHooks());
    return Response.json({ ...result.body, kind, field }, { status: result.status });
  }

  if (method === "GET") {
    const book = await readOrgBook();
    const got = getOrgNodeFromBook(book, kind, parsed.id);
    return Response.json(got.body, { status: got.status });
  }

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const inner = input && isPlain(input.data) ? (input.data as Record<string, unknown>) : input;
  if (!isPlain(inner)) return Response.json({ ok: false, error: "bad-patch" }, { status: 400 });
  const baseRev = Number(inner.baseRev);
  if (!Number.isFinite(baseRev) || baseRev < 0) {
    return Response.json({ ok: false, error: "bad-rev" }, { status: 400 });
  }
  const deleted = inner.deleted === true;
  const payload = isPlain(inner.payload) ? inner.payload : {};
  const book = await readOrgBook();
  const patched = patchOrgNodeInBook(book, kind, parsed.id, payload, baseRev, deleted);
  if (patched.status !== 200) return Response.json(patched.body, { status: patched.status });
  const field = String(patched.body.field || NODE_FIELD[kind]);
  const saved = await commitOrgFields({ [field]: patched.book[field] });
  const gens = (saved && isPlain(saved.bookGens) ? saved.bookGens : {}) as {
    org: number;
    plans: number;
    months: number;
    targets: number;
  };
  await notifyCompanyLive(Date.now(), gens, [{ type: "org-" + kind, id: parsed.id }]);
  try {
    softInvalidateCompanyWire();
  } catch {
    /* ignore */
  }
  return Response.json({ ...patched.body, bookGens: gens }, { status: 200 });
}
