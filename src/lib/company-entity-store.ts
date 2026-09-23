/**
 * ROWS-V2 — generic row store for every collection that used to live only in
 * the four books. One table (`entities`), one compare-and-set rule:
 *
 *   PATCH carries `baseRev`; the UPDATE is `... where rev = baseRev returning`.
 *   No match → 409 with the current row, the client re-fetches and re-applies
 *   its field. No banner, no whole-document replace, no resurrection.
 *
 * Every commit also appends to `entity_log` (the change feed clients follow by
 * `seq`) and mirrors the row into its book so existing book readers
 * (backups, restore, org slices) stay coherent. Books are no longer the
 * authority for these fields: book PATCH ignores them.
 */
import type { HotSql } from "./company-hot-tables.ts";
import type { Snapshot, BookId } from "./company-books.ts";
import { collections, specForKindOrSettings, type CollectionSpec, type EntityRowShape } from "./apms-collections.ts";

export type EntityId = { kind: string; id: string; k1: string | null; k2: string | null };

export type StoredEntity = EntityRowShape & { rev: number; deleted: boolean; updatedAt?: string };

export type EntityPatchInput = {
  payload: Record<string, unknown>;
  baseRev: number;
  deleted: boolean;
  clientOpId?: string;
};

export type EntityPatchResult = { status: number; body: Record<string, unknown> };

export type ChangeRow = {
  seq: number;
  kind: string;
  id: string;
  k1: string | null;
  k2: string | null;
  rev: number;
  deleted: boolean;
  at: string;
};

const META_KIND = "__meta__";
const IMPORT_FLAG = "imported-from-books";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function entityIdFromParts(kind: string, k1: string, k2?: string | null): EntityId {
  const spec = specForKindOrSettings(kind, k1);
  if (spec && spec.shape === "map2") {
    const inner = k2 == null ? "" : String(k2);
    return { kind, id: `${k1}${collections.SEP}${inner}`, k1: String(k1), k2: inner };
  }
  return { kind, id: String(k1), k1: String(k1), k2: null };
}

export function parseEntityPatchInput(input: unknown): EntityPatchInput | null {
  if (!isPlainObject(input)) return null;
  const inner = isPlainObject(input.data) ? (input.data as Record<string, unknown>) : input;
  const baseRev = Number(inner.baseRev);
  if (!Number.isFinite(baseRev) || baseRev < 0) return null;
  const deleted = inner.deleted === true;
  const payload = isPlainObject(inner.payload) ? inner.payload : deleted ? {} : null;
  if (!payload) return null;
  const clientOpId =
    typeof inner.clientOpId === "string" && inner.clientOpId.trim()
      ? inner.clientOpId.trim().slice(0, 200)
      : undefined;
  return { payload, baseRev, deleted, clientOpId };
}

function rowFromDb(r: {
  kind: string;
  id: string;
  k1: string | null;
  k2: string | null;
  payload: unknown;
  rev: number;
  deleted_at: string | null;
  updated_at?: string;
}): StoredEntity {
  return {
    kind: r.kind,
    id: r.id,
    k1: r.k1 ?? null,
    k2: r.k2 ?? null,
    payload: asPayload(r.payload),
    rev: Number(r.rev) || 0,
    deleted: !!r.deleted_at,
    updatedAt: r.updated_at,
  };
}

/** Secrets never leave the server: logins rows lose their password on the way out. */
export function redactEntityPayload(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "logins" || !("password" in payload)) return payload;
  const next = { ...payload };
  delete next.password;
  return next;
}

export function entityBody(row: StoredEntity, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    kind: row.kind,
    id: row.id,
    k1: row.k1,
    k2: row.k2,
    payload: redactEntityPayload(row.kind, row.payload),
    rev: row.rev,
    deleted: row.deleted,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readEntity(sql: HotSql, key: EntityId): Promise<StoredEntity | null> {
  const rows = await sql.query<{
    kind: string;
    id: string;
    k1: string | null;
    k2: string | null;
    payload: unknown;
    rev: number;
    deleted_at: string | null;
    updated_at: string;
  }>(
    "select kind, id, k1, k2, payload, rev, deleted_at, updated_at from entities where kind = $1 and id = $2",
    [key.kind, key.id],
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function listEntities(
  sql: HotSql,
  kind: string,
  opts: { k1?: string; includeDeleted?: boolean; limit?: number } = {},
): Promise<StoredEntity[]> {
  const where: string[] = ["kind = $1"];
  const params: unknown[] = [kind];
  if (opts.k1 !== undefined) {
    params.push(opts.k1);
    where.push(`k1 = $${params.length}`);
  }
  if (!opts.includeDeleted) where.push("deleted_at is null");
  const limit = opts.limit && opts.limit > 0 ? ` limit ${Math.floor(opts.limit)}` : "";
  const rows = await sql.query<{
    kind: string;
    id: string;
    k1: string | null;
    k2: string | null;
    payload: unknown;
    rev: number;
    deleted_at: string | null;
    updated_at: string;
  }>(
    `select kind, id, k1, k2, payload, rev, deleted_at, updated_at from entities where ${where.join(" and ")} order by updated_at asc, id asc${limit}`,
    params,
  );
  return rows.map(rowFromDb);
}

/** All live rows for every spec, grouped by field — what the assembler needs. */
export async function loadEntityFields(sql: HotSql): Promise<Record<string, unknown>> {
  const rows = await sql.query<{
    kind: string;
    id: string;
    k1: string | null;
    k2: string | null;
    payload: unknown;
    rev: number;
    deleted_at: string | null;
  }>("select kind, id, k1, k2, payload, rev, deleted_at from entities where deleted_at is null and kind <> $1 order by updated_at asc, id asc", [META_KIND]);
  const byKind = new Map<string, StoredEntity[]>();
  for (const r of rows) {
    const row = rowFromDb(r);
    const list = byKind.get(row.kind) || [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const out: Record<string, unknown> = {};
  for (const spec of collections.SPECS) {
    if (spec.kind === "settings") {
      const settings = byKind.get("settings") || [];
      const value = collections.fromRows(spec, settings);
      if (value !== undefined) out[spec.field] = value;
      continue;
    }
    // Always emit the field, empty when no live rows, so the overlay replaces
    // whatever stale value the book still carries.
    out[spec.field] = collections.fromRows(spec, byKind.get(spec.kind) || []);
  }
  return out;
}

export async function entityCounts(sql: HotSql): Promise<{ live: number; total: number }> {
  const rows = await sql.query<{ live: number; total: number }>(
    "select count(*) filter (where deleted_at is null) as live, count(*) as total from entities where kind <> $1",
    [META_KIND],
  );
  return { live: Number(rows[0]?.live) || 0, total: Number(rows[0]?.total) || 0 };
}

export async function changesSince(
  sql: HotSql,
  since: number,
  limit = 200,
  opts: { withPayload?: boolean } = {},
): Promise<Array<ChangeRow & { payload?: Record<string, unknown>; currentRev?: number }>> {
  const params = [Math.max(0, Math.floor(since) || 0), Math.max(1, Math.min(2000, Math.floor(limit) || 200))];
  if (!opts.withPayload) {
    const rows = await sql.query<ChangeRow>(
      "select seq, kind, id, k1, k2, rev, deleted, at from entity_log where seq > $1 order by seq asc limit $2",
      params,
    );
    return rows.map((r) => ({ ...r, seq: Number(r.seq), rev: Number(r.rev), deleted: !!r.deleted }));
  }
  // Collapse to the latest change per row and join the current payload so a
  // follower can apply the feed in one round trip.
  const rows = await sql.query<ChangeRow & { payload: unknown; current_rev: number | null; current_deleted: string | null }>(
    `with c as (
       select seq, kind, id, k1, k2, rev, deleted, at from entity_log where seq > $1 order by seq asc limit $2
     ), latest as (
       select distinct on (kind, id) * from c order by kind, id, seq desc
     )
     select l.seq, l.kind, l.id, l.k1, l.k2, l.rev, l.deleted, l.at,
            e.payload, e.rev as current_rev, e.deleted_at as current_deleted
       from latest l left join entities e on e.kind = l.kind and e.id = l.id
      order by l.seq asc`,
    params,
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    kind: r.kind,
    id: r.id,
    k1: r.k1,
    k2: r.k2,
    rev: r.current_rev != null ? Number(r.current_rev) : Number(r.rev),
    deleted: r.current_deleted != null ? true : !!r.deleted,
    at: r.at,
    payload: redactEntityPayload(r.kind, asPayload(r.payload)),
    currentRev: r.current_rev != null ? Number(r.current_rev) : undefined,
  }));
}

export async function latestSeq(sql: HotSql): Promise<number> {
  const rows = await sql.query<{ seq: number | null }>("select max(seq) as seq from entity_log");
  return Number(rows[0]?.seq) || 0;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function appendLog(sql: HotSql, row: StoredEntity, updatedBy: string): Promise<number> {
  const rows = await sql.query<{ seq: number }>(
    "insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by) values ($1, $2, $3, $4, $5, $6, $7) returning seq",
    [row.kind, row.id, row.k1, row.k2, row.rev, row.deleted, updatedBy],
  );
  return Number(rows[0]?.seq) || 0;
}

async function notifyPg(sql: HotSql, payload: Record<string, unknown>): Promise<void> {
  try {
    await sql.query("select pg_notify($1, $2)", ["apms_entities", JSON.stringify(payload)]);
  } catch {
    /* PGlite / preview: no LISTEN, ignore */
  }
}

/**
 * Compare-and-set write. `expectRev` is the rev the row must currently have
 * (0 = row must not exist). Returns the new row, or null when the race was lost.
 */
async function casWrite(
  sql: HotSql,
  key: EntityId,
  payload: Record<string, unknown>,
  expectRev: number,
  deleted: boolean,
  updatedBy: string,
): Promise<StoredEntity | null> {
  const deletedSql = deleted ? "now()" : "null";
  if (expectRev === 0) {
    const rows = await sql.query<{ rev: number }>(
      `insert into entities (kind, id, k1, k2, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2, $3, $4, $5::jsonb, 1, now(), $6, ${deletedSql})
       on conflict (kind, id) do nothing
       returning rev`,
      [key.kind, key.id, key.k1, key.k2, JSON.stringify(payload), updatedBy],
    );
    if (!rows.length) return null;
    return { ...key, payload, rev: 1, deleted };
  }
  const nextRev = expectRev + 1;
  const rows = await sql.query<{ rev: number }>(
    `update entities set
       payload = $3::jsonb,
       k1 = $7,
       k2 = $8,
       rev = $4,
       updated_at = now(),
       updated_by = $5,
       deleted_at = ${deletedSql}
     where kind = $1 and id = $2 and rev = $6
     returning rev`,
    [key.kind, key.id, JSON.stringify(payload), nextRev, updatedBy, expectRev, key.k1, key.k2],
  );
  if (!rows.length) return null;
  return { ...key, payload, rev: nextRev, deleted };
}

const chains = new Map<string, Promise<unknown>>();
function enqueue<T>(lock: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(lock) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    lock,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export type EntityHooks = {
  /** Mirror the committed row into its book (serialized by the notebook). */
  mirrorToBook?: (spec: CollectionSpec, row: StoredEntity) => Promise<Record<string, number> | undefined>;
  /** Bump live gens / SSE / tick and invalidate the GET wire. */
  publish?: (spec: CollectionSpec, row: StoredEntity, seq: number) => Promise<Record<string, number> | undefined>;
};

async function seenOp(sql: HotSql, clientOpId?: string): Promise<boolean> {
  if (!clientOpId) return false;
  const rows = await sql.query<{ client_op_id: string }>(
    "select client_op_id from write_ids where client_op_id = $1",
    [clientOpId],
  );
  return rows.length > 0;
}

async function rememberOp(sql: HotSql, clientOpId: string, row: StoredEntity, updatedBy: string) {
  await sql.query(
    `insert into write_ids (client_op_id, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2::jsonb, 1, now(), $3, null) on conflict (client_op_id) do nothing`,
    [clientOpId, JSON.stringify({ kind: row.kind, id: row.id, rev: row.rev }), updatedBy],
  );
}

export async function patchEntityRow(
  sql: HotSql,
  key: EntityId,
  input: unknown,
  updatedBy: string,
  hooks: EntityHooks = {},
): Promise<EntityPatchResult> {
  const spec = specForKindOrSettings(key.kind, key.k1 || key.id);
  if (!spec) return { status: 404, body: { ok: false, error: "unknown-kind", kind: key.kind } };
  const parsed = parseEntityPatchInput(input);
  if (!parsed) return { status: 400, body: { ok: false, error: "invalid-patch" } };

  return enqueue(`${key.kind}:${key.id}`, async () => {
    if (parsed.clientOpId && (await seenOp(sql, parsed.clientOpId))) {
      const current = await readEntity(sql, key);
      return {
        status: 200,
        body: entityBody(current || { ...key, payload: parsed.payload, rev: parsed.baseRev, deleted: parsed.deleted }, {
          replayed: true,
        }),
      };
    }

    const stored = await readEntity(sql, key);
    // OCC rule:
    //   no row            → client must send baseRev 0
    //   live row          → baseRev must equal rev
    //   tombstoned row    → baseRev must equal the tombstone's rev (re-create)
    let expectRev: number;
    if (!stored) {
      if (parsed.baseRev !== 0) {
        return {
          status: 409,
          body: { ...entityBody({ ...key, payload: {}, rev: 0, deleted: true }), ok: false, error: "stale", missing: true },
        };
      }
      expectRev = 0;
    } else if (stored.deleted) {
      // A tombstone can only be re-created by a client that acknowledges it
      // (baseRev = tombstone rev). baseRev 0 from a client that still holds
      // the old row is exactly the "deleted records come back" case → 409.
      if (parsed.baseRev !== stored.rev) {
        return { status: 409, body: { ...entityBody(stored), ok: false, error: "stale" } };
      }
      expectRev = stored.rev;
    } else {
      if (parsed.baseRev !== stored.rev) {
        return { status: 409, body: { ...entityBody(stored), ok: false, error: "stale" } };
      }
      expectRev = stored.rev;
    }

    let payload =
      spec.shape === "list" && !spec.keyFields && !parsed.deleted
        ? { ...parsed.payload, id: parsed.payload.id ?? key.id }
        : parsed.payload;
    if (spec.kind === "logins" && !parsed.deleted) {
      // Wire strips logins{}.password; keep the stored one unless a new non-empty value arrives.
      const sent = payload.password;
      const storedPw = stored && !stored.deleted ? stored.payload.password : undefined;
      if ((typeof sent !== "string" || !sent) && typeof storedPw === "string" && storedPw) {
        payload = { ...payload, password: storedPw };
      }
    }
    const won = await casWrite(sql, key, payload, expectRev, parsed.deleted, updatedBy);
    if (!won) {
      const current = (await readEntity(sql, key)) || { ...key, payload: {}, rev: 0, deleted: true };
      return { status: 409, body: { ...entityBody(current), ok: false, error: "stale" } };
    }
    if (parsed.clientOpId) await rememberOp(sql, parsed.clientOpId, won, updatedBy);
    const seq = await appendLog(sql, won, updatedBy);
    await notifyPg(sql, { kind: won.kind, id: won.id, k1: won.k1, k2: won.k2, rev: won.rev, deleted: won.deleted, seq });

    let bookGens: Record<string, number> | undefined;
    if (hooks.mirrorToBook) {
      try {
        bookGens = await hooks.mirrorToBook(spec, won);
      } catch (err) {
        console.error("[entities] book mirror failed; row stands", key, err);
      }
    }
    if (hooks.publish) {
      try {
        const gens = await hooks.publish(spec, won, seq);
        if (gens) bookGens = gens;
      } catch (err) {
        console.error("[entities] publish failed; row stands", key, err);
      }
    }
    return { status: 200, body: entityBody(won, { seq, ...(bookGens ? { bookGens } : {}) }) };
  });
}

// ---------------------------------------------------------------------------
// Import from books (one-time bootstrap and after restore)
// ---------------------------------------------------------------------------

export async function entitiesImported(sql: HotSql): Promise<boolean> {
  const rows = await sql.query<{ id: string }>("select id from entities where kind = $1 and id = $2", [META_KIND, IMPORT_FLAG]);
  return rows.length > 0;
}

/**
 * Upsert every row from the snapshot. Rows present in the table but absent
 * from the snapshot are soft-deleted (restore semantics). Revs bump so any
 * client holding an older rev gets a clean 409 instead of a silent overwrite.
 */
export async function importEntitiesFromSnapshot(
  sql: HotSql,
  snapshot: Snapshot,
  updatedBy: string,
  opts: { pruneMissing?: boolean } = {},
): Promise<{ upserted: number; pruned: number; skipped: Array<{ field: string; index: number }> }> {
  const skipped: Array<{ field: string; index: number }> = [];
  let upserted = 0;
  let pruned = 0;
  const seenByKind = new Map<string, Set<string>>();
  for (const spec of collections.SPECS) {
    const rows = collections.toRows(spec, snapshot[spec.field], skipped);
    const seen = seenByKind.get(spec.kind) || new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      await sql.query(
        `insert into entities (kind, id, k1, k2, payload, rev, updated_at, updated_by, deleted_at)
         values ($1, $2, $3, $4, $5::jsonb, 1, now(), $6, null)
         on conflict (kind, id) do update set
           payload = excluded.payload,
           k1 = excluded.k1,
           k2 = excluded.k2,
           rev = entities.rev + 1,
           updated_at = now(),
           updated_by = excluded.updated_by,
           deleted_at = null
         where entities.payload is distinct from excluded.payload or entities.deleted_at is not null`,
        [row.kind, row.id, row.k1, row.k2, JSON.stringify(row.payload), updatedBy],
      );
      upserted += 1;
    }
    seenByKind.set(spec.kind, seen);
  }
  if (opts.pruneMissing) {
    for (const [kind, seen] of seenByKind) {
      const live = await listEntities(sql, kind);
      for (const row of live) {
        if (seen.has(row.id)) continue;
        await sql.query(
          "update entities set deleted_at = now(), rev = rev + 1, updated_at = now(), updated_by = $3 where kind = $1 and id = $2",
          [kind, row.id, updatedBy],
        );
        pruned += 1;
      }
    }
  }
  await sql.query(
    `insert into entities (kind, id, k1, k2, payload, rev, updated_at, updated_by)
     values ($1, $2, $2, null, $3::jsonb, 1, now(), $4)
     on conflict (kind, id) do update set payload = excluded.payload, updated_at = now(), rev = entities.rev + 1`,
    [META_KIND, IMPORT_FLAG, JSON.stringify({ at: new Date().toISOString(), by: updatedBy, upserted, pruned }), updatedBy],
  );
  // A restore is one logical change for followers: log a wildcard so clients resync.
  await sql.query(
    "insert into entity_log (kind, id, k1, k2, rev, deleted, updated_by) values ($1, $2, null, null, 0, false, $3)",
    ["*", "resync", updatedBy],
  );
  return { upserted, pruned, skipped };
}

/** Bootstrap once: if the table was never filled, import from the books. */
let importedKnown = false;
let importInFlight: Promise<boolean> | null = null;
export async function ensureEntitiesFromBooks(
  sql: HotSql,
  readBooks: () => Promise<Snapshot | null>,
): Promise<boolean> {
  if (importedKnown) return false;
  if (importInFlight) return importInFlight;
  importInFlight = (async () => {
    try {
      if (await entitiesImported(sql)) {
        importedKnown = true;
        return false;
      }
      const snap = await readBooks();
      if (!snap) return false;
      const result = await importEntitiesFromSnapshot(sql, snap, "books-import");
      console.info("[entities] imported from books", { upserted: result.upserted, skipped: result.skipped.length });
      importedKnown = true;
      return true;
    } finally {
      importInFlight = null;
    }
  })();
  return importInFlight;
}

export function resetEntityImportForTests(): void {
  importedKnown = false;
  importInFlight = null;
}

/** Which book a kind belongs to (for live gens). */
export function bookForKind(kind: string, id: string): BookId {
  const spec = specForKindOrSettings(kind, id);
  return spec ? spec.book : "org";
}
