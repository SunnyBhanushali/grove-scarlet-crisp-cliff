/**
 * ROWS-V2 HTTP surface + server hooks.
 *
 *   GET   /api/e/:kind                 list live rows (optional ?k1=)
 *   GET   /api/e/:kind/:k1[/:k2]       one row
 *   PATCH /api/e/:kind/:k1[/:k2]       { baseRev, payload | deleted, clientOpId }
 *   GET   /api/changes?since=<seq>     change feed after a cursor
 *
 * Auth: same dual auth as the other entity routes (session token + resolved person).
 */
import { unauthorizedJson, hasValidSession } from "./apms-request-auth.ts";
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot } from "./company-books.ts";
import { collections, specForKindOrSettings, type CollectionSpec } from "./apms-collections.ts";
import {
  changesSince,
  ensureEntitiesFromBooks,
  entityBody,
  entityIdFromParts,
  latestSeq,
  listEntities,
  patchEntityRow,
  readEntity,
  type EntityHooks,
  type StoredEntity,
} from "./company-entity-store.ts";

export const ENTITY_ROWS_ENABLED = String(process.env.APMS_ENTITY_ROWS || "on").toLowerCase() !== "off";

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseEntityV2Path(pathname: string): { kind: string; k1?: string; k2?: string; list: boolean } | null {
  const path = pathname.replace(/\/+$/, "");
  const m = path.match(/^\/api\/e\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (!m) return null;
  const kind = decodePart(m[1]);
  if (!m[2]) return { kind, list: true };
  return { kind, k1: decodePart(m[2]), k2: m[3] !== undefined ? decodePart(m[3]) : undefined, list: false };
}

/** Live hint type for a generic kind: `e:<kind>`; the client maps it back. */
export function liveTypeForKind(kind: string): string {
  return `e:${kind}`;
}

export function kindFromLiveType(type: string): string | null {
  return type.startsWith("e:") ? type.slice(2) : null;
}

/** Book mirror + live publish, wired lazily to avoid import cycles. */
export function liveEntityHooks(): EntityHooks {
  return {
    async mirrorToBook(spec: CollectionSpec, row: StoredEntity) {
      // The row is committed and on the feed; the book copy follows in the
      // background (group-committed per book), as for hot-table rows. The
      // reply's bookGens come from publish.
      const { commitEntityRowToBook } = await import("./company-notebook");
      void commitEntityRowToBook(spec, row).catch((err) => {
        console.error("[entities] book mirror failed; row stands", row.kind, row.id, err);
      });
      return undefined;
    },
    async publish(spec: CollectionSpec, row: StoredEntity, seq: number) {
      const { notifyCompanyLive, currentLiveGens } = await import("./company-live");
      const { softInvalidateCompanyWire } = await import("./company-wire-cache");
      const prev = currentLiveGens() || { org: 0, plans: 0, months: 0, targets: 0 };
      const gens = { ...prev, [spec.book]: (Number(prev[spec.book]) || 0) + 1 };
      await notifyCompanyLive(Date.now(), gens, [
        {
          type: liveTypeForKind(row.kind),
          id: row.k1 || row.id,
          period: row.k2 || undefined,
          seq,
        } as { type: string; id: string; period?: string; seq?: number },
      ]);
      try {
        softInvalidateCompanyWire();
      } catch {
        /* ignore */
      }
      return gens;
    },
  };
}

async function resolvePerson(request: Request): Promise<string | null> {
  const { getCompanyWireForAuth } = await import("./company-wire-cache");
  const { personIdForWire } = await import("./company-wire-http");
  const wire = await getCompanyWireForAuth();
  return personIdForWire(request, wire);
}

export async function handleEntityV2Http(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const parsed = parseEntityV2Path(url.pathname);
  if (!parsed) return null;
  if (!ENTITY_ROWS_ENABLED) return Response.json({ ok: false, error: "rows-disabled" }, { status: 503 });
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const personId = await resolvePerson(request);
  if (!personId) return unauthorizedJson();

  const method = request.method.toUpperCase();
  const { getSql } = await import("./db");
  const { readLiveSnapshot } = await import("./company-notebook");
  const sql = (await getSql()) as unknown as HotSql;
  await ensureEntitiesFromBooks(sql, () => readLiveSnapshot());

  if (parsed.list) {
    if (method !== "GET") return Response.json({ ok: false, error: "method" }, { status: 405 });
    if (parsed.kind !== "settings" && !collections.specForKind(parsed.kind)) {
      return Response.json({ ok: false, error: "unknown-kind", kind: parsed.kind }, { status: 404 });
    }
    const k1 = url.searchParams.get("k1") || undefined;
    const limitRaw = Number(url.searchParams.get("limit") || 0);
    const rows = await listEntities(sql, parsed.kind, { k1, limit: limitRaw > 0 ? limitRaw : undefined });
    // BATCH-3: rows / fields filtered by the caller's access role.
    const perm = await import("./apms-permissions.ts");
    const viewer = await perm.loadViewer(personId);
    const seen = rows
      .map((r) => {
        const body = entityBody(r);
        const p = perm.readEntityPayload(viewer, r.kind, { k1: r.k1, payload: body.payload as Record<string, unknown> });
        return p ? { ...body, payload: p } : null;
      })
      .filter(Boolean);
    return Response.json({ ok: true, kind: parsed.kind, rows: seen, seq: await latestSeq(sql) });
  }

  const key = entityIdFromParts(parsed.kind, parsed.k1 || "", parsed.k2);
  const spec = specForKindOrSettings(key.kind, key.k1 || key.id);
  if (!spec) return Response.json({ ok: false, error: "unknown-kind", kind: parsed.kind }, { status: 404 });
  if (spec.shape === "map2" && parsed.k2 === undefined) {
    return Response.json({ ok: false, error: "missing-k2", kind: parsed.kind }, { status: 400 });
  }

  const perm = await import("./apms-permissions.ts");
  const viewer = await perm.loadViewer(personId);
  const seenBody = (b: Record<string, unknown>): Record<string, unknown> => {
    if (!b || typeof b !== "object" || !b.payload || typeof b.payload !== "object") return b;
    const p = perm.readEntityPayload(viewer, key.kind, { k1: key.k1, payload: b.payload as Record<string, unknown> });
    return { ...b, payload: p || {} };
  };
  if (method === "GET") {
    const row = await readEntity(sql, key);
    if (!row) return Response.json({ ok: false, error: "not-found", kind: key.kind, id: key.id }, { status: 404 });
    const body = entityBody(row);
    if (!perm.readEntityPayload(viewer, key.kind, { k1: key.k1, payload: body.payload as Record<string, unknown> })) {
      return perm.forbiddenResponse(perm.refusal(key.kind, undefined, "You cannot see this."));
    }
    return Response.json(seenBody(body as unknown as Record<string, unknown>));
  }
  if (method !== "PATCH") return Response.json({ ok: false, error: "method" }, { status: 405 });

  const body = await request.json().catch(() => null);
  // BATCH-2: access roles and other people's logins are admin-only.
  const { entityWriteRefusal } = await import("./apms-write-guard.ts");
  const why = await entityWriteRefusal(key.kind, key.k1 || key.id, personId);
  if (why) return perm.forbiddenResponse(perm.refusal(key.kind, undefined, why));
  // BATCH-3: the module grant for this kind; hidden fields keep their stored value.
  const guarded = await guardEntityPatch(viewer, sql, key, body);
  if (guarded.refused) return perm.forbiddenResponse(guarded.refused);
  const result = await patchEntityRow(sql, key, guarded.body, personId, liveEntityHooks());
  if (key.kind === "access-roles" || key.kind === "functions" || key.kind === "sub-functions") perm.invalidateOrgContext();
  return Response.json(seenBody(result.body as Record<string, unknown>), { status: result.status });
}

/** BATCH-3: permission check for one generic row write; returns the body to store. */
export async function guardEntityPatch(
  viewer: import("./apms-permissions.ts").Viewer,
  sql: HotSql,
  key: ReturnType<typeof entityIdFromParts>,
  body: unknown,
): Promise<{ body: unknown; refused: import("./apms-permissions.ts").Refusal | null }> {
  const perm = await import("./apms-permissions.ts");
  if (viewer.superAdmin || viewer.admin) return { body, refused: null };
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const inner = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : rec;
  const payload = inner.payload && typeof inner.payload === "object" ? (inner.payload as Record<string, unknown>) : {};
  const stored = await readEntity(sql, key);
  const checked = perm.checkEntityWrite(
    viewer,
    key.kind,
    String(key.k1 || key.id),
    payload,
    stored ? { payload: stored.payload, deleted: stored.deleted } : null,
    inner.deleted === true,
  );
  if (checked.refused) return { body, refused: checked.refused };
  if (checked.payload !== payload) inner.payload = checked.payload;
  return { body, refused: null };
}

export async function handleChangesHttp(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const personId = await resolvePerson(request);
  if (!personId) return unauthorizedJson();
  const url = new URL(request.url);
  if (url.searchParams.get("head") === "1") {
    const { getSql } = await import("./db");
    const sql = (await getSql()) as unknown as HotSql;
    return Response.json({ ok: true, seq: await latestSeq(sql) }, { headers: { "cache-control": "no-store" } });
  }
  const since = Number(url.searchParams.get("since") || 0);
  const limit = Number(url.searchParams.get("limit") || 200);
  const { getSql } = await import("./db");
  const sql = (await getSql()) as unknown as HotSql;
  const withPayload = url.searchParams.get("payload") === "1";
  const changes = await changesSince(sql, Number.isFinite(since) ? since : 0, Number.isFinite(limit) ? limit : 200, { withPayload });
  const seq = changes.length ? changes[changes.length - 1].seq : await latestSeq(sql);
  // BATCH-3: rows the caller may not read are dropped, hidden fields removed.
  // The cursor still moves past them (seq is the last row scanned).
  const perm = await import("./apms-permissions.ts");
  const viewer = await perm.loadViewer(personId);
  const seen = changes.map((c) => perm.filterChange(viewer, c)).filter((c) => c !== null);
  return Response.json({ ok: true, since: Number.isFinite(since) ? since : 0, seq, changes: seen });
}

/** Overlay authority rows over a snapshot (GET assemble / backups). */
export async function overlayEntityFields(sql: HotSql, snapshot: Snapshot, readBooks: () => Promise<Snapshot | null>): Promise<Snapshot> {
  if (!ENTITY_ROWS_ENABLED) return snapshot;
  const { loadEntityFields } = await import("./company-entity-store.ts");
  await ensureEntitiesFromBooks(sql, readBooks);
  const fields = await loadEntityFields(sql);
  return pruneDanglingTargets(foldRoleKrocsIntoRoles({ ...snapshot, ...fields }));
}

/**
 * Safety net for "a deleted target keeps coming back": the month root order
 * and group memberships are lists of target ids. Whatever path put a deleted
 * id back into one of them, it is never shown: entries that point at a target
 * node that no longer exists are dropped on every assemble. Cells and reward
 * links are left alone (a broken reward link is surfaced, not hidden).
 */
export function pruneDanglingTargets(snapshot: Snapshot): Snapshot {
  const nodes = snapshot.targetNodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return snapshot;
  const live = new Set(Object.keys(nodes as Record<string, unknown>));
  if (!live.size) return snapshot;
  const out: Snapshot = { ...snapshot };
  const order = snapshot.targetRootOrder;
  if (order && typeof order === "object" && !Array.isArray(order)) {
    const next: Record<string, unknown> = {};
    for (const [month, ids] of Object.entries(order as Record<string, unknown>)) {
      next[month] = Array.isArray(ids) ? ids.filter((id) => live.has(String(id))) : ids;
    }
    out.targetRootOrder = next;
  }
  const members = snapshot.targetMembers;
  if (Array.isArray(members)) {
    out.targetMembers = members.filter((row) => {
      if (!row || typeof row !== "object") return true;
      const r = row as Record<string, unknown>;
      return live.has(String(r.groupId)) && live.has(String(r.memberId));
    });
  }
  return out;
}

/**
 * The wire carries roles whole (kras / ags / competencies inside), as
 * assembleSnapshot always did; `roleKrocs` is a book-storage split, not a
 * client field. role-krocs rows only fill kroc fields a role row lacks — the
 * role row (what clients edit) wins.
 */
export function foldRoleKrocsIntoRoles(snapshot: Snapshot): Snapshot {
  const krocs = snapshot.roleKrocs;
  if (krocs === undefined) return snapshot;
  const out: Snapshot = { ...snapshot };
  delete out.roleKrocs;
  const roles = out.roles;
  if (!krocs || typeof krocs !== "object" || Array.isArray(krocs)) return out;
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return out;
  const next: Record<string, unknown> = {};
  for (const [id, role] of Object.entries(roles as Record<string, unknown>)) {
    const kroc = (krocs as Record<string, unknown>)[id];
    const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    next[id] = isObj(role) && isObj(kroc) ? { ...(kroc as object), ...(role as object) } : role;
  }
  out.roles = next;
  return out;
}
