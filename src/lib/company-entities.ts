import { ensureHashed, verifyPassword } from "./apms-password.ts";
import { mergeKeepMonthMaps, mergeKeepPeople, normalizeBookGens, type BookId, type Snapshot } from "./company-books.ts";
import { slimPersonForWire } from "./company-wire-slim.ts";
import {
  flattenPeople,
  flattenPersonPeriodMap,
  flattenTargetCells,
  importHotTables,
  liveHotTableCounts,
  rememberWriteId,
  type HotSql,
  clearPeopleTombs,
} from "./company-hot-tables.ts";
import { unauthorizedJson, hasValidSession } from "./apms-request-auth.ts";
import { publishEntityWrite, hintFromEntityTable, liveTypeFromTable } from "./company-live.ts";
import { appendHotTableChange } from "./company-entity-store.ts";

export type EntityKey =
  | { table: "people"; id: string }
  | { table: "month_records"; period: string; personId: string }
  | { table: "reward_records"; period: string; personId: string }
  | { table: "target_cells"; id: string };

export type EntityRow = {
  payload: Record<string, unknown>;
  rev: number;
  deleted: boolean;
};

export type EntityResult = {
  status: number;
  body: Record<string, unknown>;
};

export type EntityBooks = {
  read(): Promise<Snapshot | null>;
  applySlice(
    book: BookId,
    payload: Snapshot,
    extraTombs?: unknown,
  ): Promise<{ ok: boolean; snapshot: Snapshot }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asMap(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
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

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseEntityPath(pathname: string): EntityKey | null {
  const path = pathname.replace(/\/+$/, "") || pathname;
  const people = path.match(/^\/api\/people\/([^/]+)$/);
  if (people) return { table: "people", id: decodePart(people[1]) };
  const month = path.match(/^\/api\/month-records\/([^/]+)\/([^/]+)$/);
  if (month) return { table: "month_records", period: decodePart(month[1]), personId: decodePart(month[2]) };
  const reward = path.match(/^\/api\/reward-records\/([^/]+)\/([^/]+)$/);
  if (reward) return { table: "reward_records", period: decodePart(reward[1]), personId: decodePart(reward[2]) };
  const cell = path.match(/^\/api\/target-cells\/([^/]+)$/);
  if (cell) return { table: "target_cells", id: decodePart(cell[1]) };
  return null;
}

export function parseEntityPatch(input: unknown): {
  payload: Record<string, unknown>;
  baseRev: number;
  clientOpId?: string;
  deleted: boolean;
} | null {
  if (!isPlainObject(input)) return null;
  const inner =
    input.data && isPlainObject(input.data) ? (input.data as Record<string, unknown>) : input;
  const baseRev = Number(inner.baseRev);
  if (!Number.isFinite(baseRev) || baseRev < 0) return null;
  const deleted = inner.deleted === true;
  const payload = isPlainObject(inner.payload) ? inner.payload : deleted ? {} : null;
  if (!payload) return null;
  const clientOpId =
    typeof inner.clientOpId === "string" && inner.clientOpId.trim()
      ? inner.clientOpId.trim().slice(0, 200)
      : undefined;
  return { payload, baseRev, clientOpId, deleted };
}

/**
 * The wire never carries `password` / `passwordHash`, so a client re-saving a
 * person sends neither. Keep what is stored unless the client explicitly set a
 * new non-empty password (admin reset / new hire form).
 */
export function preservePersonSecrets(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out = { ...incoming };
  const src = stored || {};
  for (const field of ["password", "passwordHash"] as const) {
    const sent = out[field];
    const has = typeof sent === "string" ? sent.length > 0 : sent !== undefined && sent !== null;
    const kept = src[field] !== undefined && src[field] !== null && src[field] !== "";
    if (!has && kept) out[field] = src[field];
    else if (!has) delete out[field];
    // BATCH-3: stored as a scrypt hash; re-sending the current password is not a change.
    else if (kept && (sent === src[field] || verifyPassword(String(sent), src[field]))) out[field] = src[field];
    else out[field] = ensureHashed(sent);
  }
  return out;
}

/** BATCH-3: true when this people write sets a password different from the stored one. */
export function personPasswordChanges(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): boolean {
  const sent = incoming.password;
  if (typeof sent !== "string" || !sent) return false;
  const have = (stored || {}).password;
  if (!have) return true;
  return !(sent === have || verifyPassword(sent, have));
}

function rowBody(key: EntityKey, row: EntityRow, extra: Record<string, unknown> = {}) {
  const ids =
    key.table === "people" || key.table === "target_cells"
      ? { id: key.id }
      : { period: key.period, personId: key.personId };
  return {
    ok: true,
    table: key.table,
    ...ids,
    payload: key.table === "people" ? (slimPersonForWire(row.payload) as Record<string, unknown>) : row.payload,
    rev: row.rev,
    deleted: row.deleted,
    ...extra,
  };
}

function staleBody(key: EntityKey, row: EntityRow, error: string) {
  return { ...rowBody(key, row), ok: false, error };
}

async function readRow(sql: HotSql, key: EntityKey): Promise<EntityRow | null> {
  if (key.table === "people") {
    const rows = await sql.query<{ payload: unknown; rev: number; deleted_at: string | null }>(
      "select payload, rev, deleted_at from people where id = $1",
      [key.id],
    );
    if (!rows[0]) return null;
    return { payload: asPayload(rows[0].payload), rev: Number(rows[0].rev) || 0, deleted: !!rows[0].deleted_at };
  }
  if (key.table === "target_cells") {
    const rows = await sql.query<{ payload: unknown; rev: number; deleted_at: string | null }>(
      "select payload, rev, deleted_at from target_cells where id = $1",
      [key.id],
    );
    if (!rows[0]) return null;
    return { payload: asPayload(rows[0].payload), rev: Number(rows[0].rev) || 0, deleted: !!rows[0].deleted_at };
  }
  const table = key.table;
  const rows = await sql.query<{ payload: unknown; rev: number; deleted_at: string | null }>(
    `select payload, rev, deleted_at from ${table} where person_id = $1 and period = $2`,
    [key.personId, key.period],
  );
  if (!rows[0]) return null;
  return { payload: asPayload(rows[0].payload), rev: Number(rows[0].rev) || 0, deleted: !!rows[0].deleted_at };
}

async function insertIfMissing(
  sql: HotSql,
  key: EntityKey,
  payload: Record<string, unknown>,
  updatedBy: string,
) {
  if (key.table === "people") {
    await sql.query(
      `insert into people (id, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, 1, now(), $3, null)
       on conflict (id) do nothing`,
      [key.id, JSON.stringify(payload), updatedBy],
    );
    return;
  }
  if (key.table === "target_cells") {
    await sql.query(
      `insert into target_cells (id, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, 1, now(), $3, null)
       on conflict (id) do nothing`,
      [key.id, JSON.stringify(payload), updatedBy],
    );
    return;
  }
  await sql.query(
    `insert into ${key.table} (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2, $3::jsonb, 1, now(), $4, null)
     on conflict (person_id, period) do nothing`,
    [key.personId, key.period, JSON.stringify(payload), updatedBy],
  );
}

async function writeRow(
  sql: HotSql,
  key: EntityKey,
  payload: Record<string, unknown>,
  rev: number,
  deleted: boolean,
  updatedBy: string,
  baseRev: number,
): Promise<boolean> {
  const deletedSql = deleted ? "now()" : "null";
  if (key.table === "people") {
    const rows = await sql.query<{ rev: number }>(
      `insert into people (id, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, $3, now(), $4, ${deletedSql})
       on conflict (id) do update set
         payload = excluded.payload,
         rev = excluded.rev,
         updated_at = now(),
         updated_by = excluded.updated_by,
         deleted_at = ${deletedSql}
       where people.rev = $5
       returning rev`,
      [key.id, JSON.stringify(payload), rev, updatedBy, baseRev],
    );
    return rows.length > 0;
  }
  if (key.table === "target_cells") {
    const rows = await sql.query<{ rev: number }>(
      `insert into target_cells (id, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, $3, now(), $4, ${deletedSql})
       on conflict (id) do update set
         payload = excluded.payload,
         rev = excluded.rev,
         updated_at = now(),
         updated_by = excluded.updated_by,
         deleted_at = ${deletedSql}
       where target_cells.rev = $5
       returning rev`,
      [key.id, JSON.stringify(payload), rev, updatedBy, baseRev],
    );
    return rows.length > 0;
  }
  const rows = await sql.query<{ rev: number }>(
    `insert into ${key.table} (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2, $3::jsonb, $4, now(), $5, ${deletedSql})
     on conflict (person_id, period) do update set
       payload = excluded.payload,
       rev = excluded.rev,
       updated_at = now(),
       updated_by = excluded.updated_by,
       deleted_at = ${deletedSql}
     where ${key.table}.rev = $6
     returning rev`,
    [key.personId, key.period, JSON.stringify(payload), rev, updatedBy, baseRev],
  );
  return rows.length > 0;
}

function entityLockId(key: EntityKey): string {
  if (key.table === "people" || key.table === "target_cells") return `${key.table}:${key.id}`;
  return `${key.table}:${key.personId}:${key.period}`;
}

const patchChains = new Map<string, Promise<unknown>>();

function enqueueEntityPatch<T>(key: EntityKey, fn: () => Promise<T>): Promise<T> {
  const id = entityLockId(key);
  const prev = patchChains.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  patchChains.set(
    id,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function sliceFromSnapshot(snapshot: Snapshot | null, key: EntityKey): Record<string, unknown> | null {
  if (!snapshot) return null;
  if (key.table === "people") {
    const found = flattenPeople(snapshot.people).find((p) => p.id === key.id);
    return found ? found.payload : null;
  }
  if (key.table === "month_records") {
    const found = flattenPersonPeriodMap(snapshot.records).find(
      (r) => r.personId === key.personId && r.period === key.period,
    );
    return found ? found.payload : null;
  }
  if (key.table === "reward_records") {
    const found = flattenPersonPeriodMap(snapshot.rewardRecords).find(
      (r) => r.personId === key.personId && r.period === key.period,
    );
    return found ? found.payload : null;
  }
  const found = flattenTargetCells(snapshot.targetCells).find((c) => c.id === key.id);
  return found ? found.payload : null;
}

function bookAndPayload(
  _snapshot: Snapshot,
  key: EntityKey,
  payload: Record<string, unknown>,
  deleted: boolean,
): { book: BookId; payload: Snapshot; extraTombs?: Record<string, Record<string, number>> } {
  const at = Date.now();
  if (key.table === "people") {
    const person = { ...payload, id: key.id };
    const extraTombs = deleted
      ? { people: { [key.id]: at, [`id:${key.id}`]: at } }
      : undefined;
    return { book: "org", payload: { people: [person] }, extraTombs };
  }
  if (key.table === "month_records" || key.table === "reward_records") {
    const field = key.table === "month_records" ? "records" : "rewardRecords";
    const month = deleted ? {} : { [key.personId]: payload };
    const extraTombs = deleted ? { [`${field}/${key.period}`]: { [key.personId]: at } } : undefined;
    return { book: "months", payload: { [field]: { [key.period]: month } }, extraTombs };
  }
  const extraTombs = deleted ? { targetCells: { [key.id]: at } } : undefined;
  return {
    book: "targets",
    payload: { targetCells: deleted ? {} : { [key.id]: payload } },
    extraTombs,
  };
}

async function entityVisibleInAssemble(
  sql: HotSql,
  key: EntityKey,
  deleted: boolean,
): Promise<boolean> {
  // The assembled GET reads live hot rows (deleted_at is null), so "visible in
  // assemble" is exactly "this row is live". One row lookup instead of loading
  // every hot row for every PATCH (a month lock writes ~20 cells: that full
  // load per cell held each save for seconds).
  const row = await readRow(sql, key);
  const has = !!row && !row.deleted;
  return deleted ? !has : has;
}

async function seenWriteId(sql: HotSql, clientOpId: string | undefined): Promise<boolean> {
  const id = String(clientOpId || "").trim();
  if (!id) return false;
  const rows = await sql.query<{ client_op_id: string }>(
    "select client_op_id from write_ids where client_op_id = $1",
    [id],
  );
  return rows.length > 0;
}

/** If hot tables are empty and books have people, import once. */
// Every write asks "are the hot tables filled?" (five count(*) queries).
// Once they are, the answer holds; re-check at most once a minute.
const hotTablesFilledAt = new WeakMap<object, number>();

export async function ensureHotTablesFromBooks(
  sql: HotSql,
  read: () => Promise<Snapshot | null>,
): Promise<void> {
  const seen = hotTablesFilledAt.get(sql as object);
  if (seen && Date.now() - seen < 60_000) return;
  const counts = await liveHotTableCounts(sql);
  if (counts.people > 0) {
    hotTablesFilledAt.set(sql as object, Date.now());
    return;
  }
  const snap = await read();
  const n = flattenPeople(snap?.people).length;
  if (!snap || n < 1) return;
  console.info("[hot-tables] empty tables; importHotTables from books people=", n);
  await importHotTables(sql, snap, { updatedBy: "empty-import" });
}

/**
 * The books, for the legacy-hydrate check of a row the table does not have.
 * Every new row (a duplicated month writes one per target) asks; reading and
 * parsing the whole book per row made such a burst take seconds. Rows only
 * reach a book after their table row exists (or before the boot import), so
 * a copy a few seconds old answers "is it in the book?" just as well.
 */
const HYDRATE_READ_MS = 2000;
const hydrateReads = new WeakMap<EntityBooks, { at: number; snap: Promise<Snapshot | null> }>();
function readBooksForHydrate(books: EntityBooks): Promise<Snapshot | null> {
  const hit = hydrateReads.get(books);
  if (hit && Date.now() - hit.at < HYDRATE_READ_MS) return hit.snap;
  const snap = books.read().catch((err) => {
    hydrateReads.delete(books);
    throw err;
  });
  hydrateReads.set(books, { at: Date.now(), snap });
  return snap;
}

async function hydrateFromBook(
  sql: HotSql,
  key: EntityKey,
  snapshot: Snapshot | null,
): Promise<EntityRow | null> {
  const payload = sliceFromSnapshot(snapshot, key);
  if (!payload) return null;
  await insertIfMissing(sql, key, payload, "hydrate");
  return readRow(sql, key);
}

export async function getEntity(
  sql: HotSql,
  key: EntityKey,
  books: EntityBooks,
): Promise<EntityResult> {
  await ensureHotTablesFromBooks(sql, () => books.read());
  let row = await readRow(sql, key);
  if (!row) {
    const snap = await readBooksForHydrate(books);
    row = await hydrateFromBook(sql, key, snap);
  }
  if (!row) return { status: 404, body: { ok: false, error: "not-found", table: key.table } };
  return { status: 200, body: rowBody(key, row) };
}

export async function patchEntity(
  sql: HotSql,
  key: EntityKey,
  input: unknown,
  books: EntityBooks,
  updatedBy = "entity-patch",
): Promise<EntityResult> {
  return enqueueEntityPatch(key, () => patchEntityUnlocked(sql, key, input, books, updatedBy));
}

async function patchEntityUnlocked(
  sql: HotSql,
  key: EntityKey,
  input: unknown,
  books: EntityBooks,
  updatedBy: string,
): Promise<EntityResult> {
  const parsed = parseEntityPatch(input);
  if (!parsed) return { status: 400, body: { ok: false, error: "invalid-patch" } };

  await ensureHotTablesFromBooks(sql, () => books.read());
  let row = await readRow(sql, key);
  if (!row) {
    const snap = await readBooksForHydrate(books);
    row = await hydrateFromBook(sql, key, snap);
  }
  const stored: EntityRow = row || { payload: {}, rev: 0, deleted: false };

  if (parsed.clientOpId && (await seenWriteId(sql, parsed.clientOpId))) {
    return { status: 200, body: rowBody(key, stored, { replayed: true }) };
  }

  if (parsed.baseRev !== stored.rev) {
    return { status: 409, body: staleBody(key, stored, "stale") };
  }

  const payload =
    key.table === "people" ? preservePersonSecrets({ ...parsed.payload, id: key.id }, stored.payload) : { ...parsed.payload };

  const nextRev = stored.rev === 0 ? 1 : stored.rev + 1;
  const won = await writeRow(sql, key, payload, nextRev, parsed.deleted, updatedBy, parsed.baseRev);
  if (!won) {
    const current = (await readRow(sql, key)) || stored;
    return { status: 409, body: staleBody(key, current, "stale") };
  }
  if (parsed.clientOpId) {
    await rememberWriteId(sql, parsed.clientOpId, { table: key.table, rev: nextRev }, updatedBy);
  }
  const next: EntityRow = { payload, rev: nextRev, deleted: parsed.deleted };
  if (key.table === "people" && stored.deleted && !parsed.deleted) {
    // BATCH-2: restore from Trash (re-create over the tombstone at its rev).
    await clearPeopleTombs(sql, key.id, updatedBy);
  }

  // ROWS-V2: hot-table commits ride the same change feed as every other row,
  // so followers no longer depend on the hint channel for these four kinds.
  let feedSeq = 0;
  try {
    const k1 = key.table === "people" || key.table === "target_cells" ? key.id : key.personId;
    const k2 = key.table === "people" || key.table === "target_cells" ? null : key.period;
    feedSeq = await appendHotTableChange(
      sql,
      liveTypeFromTable(key.table),
      k1,
      k2,
      nextRev,
      parsed.deleted,
      key.table === "people" ? (slimPersonForWire(payload) as Record<string, unknown>) : payload,
      updatedBy,
    );
  } catch (err) {
    console.error("[hot-tables] change-feed append failed; hints still published", err);
  }

  let liveGens: Record<string, number> | undefined;
  try {
    liveGens = await publishEntityWrite(
      key.table,
      hintFromEntityTable(key.table, key),
      { payload, deleted: parsed.deleted },
    );
  } catch (err) {
    console.error("[hot-tables] publish after entity row failed; still returning after assemble check", err);
  }

  // Mirror the row into its book in the background (group-committed and
  // serialized per book). The row is committed and on the feed already; the
  // reply no longer waits ~200 ms per row for the book rewrite, which made a
  // burst of writes (a month lock saves every target cell) take seconds.
  const bookGens: Record<string, number> | undefined = liveGens;
  const slice = bookAndPayload({}, key, payload, parsed.deleted);
  void (async () => {
    try {
      let applied = await books.applySlice(slice.book, slice.payload, slice.extraTombs);
      if (!applied.ok) applied = await books.applySlice(slice.book, slice.payload, slice.extraTombs);
    } catch (err) {
      console.error("[hot-tables] book merge after row win failed; row stands", err);
    }
  })();

  let visible = await entityVisibleInAssemble(sql, key, parsed.deleted);
  if (!visible) {
    visible = await entityVisibleInAssemble(sql, key, parsed.deleted);
  }
  if (!visible) {
    console.error("[hot-tables] assemble still missing entity after PATCH", key);
  }

  return { status: 200, body: rowBody(key, next, { ...(bookGens ? { bookGens } : {}), ...(feedSeq ? { seq: feedSeq } : {}) }) };
}

/** In-memory book adapter for tests. Serializes union-merge; never 409s on book gen. */
export function memoryEntityBooks(initial: Snapshot): EntityBooks {
  let snap: Snapshot = {
    bookGens: { org: 1, plans: 1, months: 1, targets: 1 },
    ...initial,
  };
  let chain: Promise<unknown> = Promise.resolve();
  return {
    async read() {
      return snap;
    },
    applySlice(book, payload, extraTombs) {
      const run = async () => {
        const gens = normalizeBookGens(snap);
        const next: Snapshot = { ...snap };
        if (book === "org" && payload.people) {
          next.people = mergeKeepPeople(snap.people, payload.people);
          const tombs =
            extraTombs && typeof extraTombs === "object"
              ? ((extraTombs as { people?: Record<string, number> }).people || {})
              : {};
          if (Array.isArray(next.people) && Object.keys(tombs).length) {
            next.people = next.people.filter((row) => {
              if (!row || typeof row !== "object") return true;
              const id = String((row as { id?: string }).id || "");
              return !tombs[id] && !tombs[`id:${id}`];
            });
          }
        }
        if (book === "months") {
          if (payload.records) next.records = mergeKeepMonthMaps(snap.records, payload.records);
          if (payload.rewardRecords) {
            next.rewardRecords = mergeKeepMonthMaps(snap.rewardRecords, payload.rewardRecords);
          }
        }
        if (book === "targets" && payload.targetCells) {
          next.targetCells = {
            ...(isPlainObject(snap.targetCells) ? snap.targetCells : {}),
            ...(isPlainObject(payload.targetCells) ? payload.targetCells : {}),
          };
        }
        next.bookGens = { ...gens, [book]: (Number(gens[book]) || 0) + 1 };
        snap = next;
        return { ok: true, snapshot: snap };
      };
      const pending = chain.then(run, run);
      chain = pending.then(
        () => {},
        () => {},
      );
      return pending;
    },
  };
}

export async function handleEntityHttp(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const key = parseEntityPath(new URL(request.url).pathname);
  if (!key) {
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const { getCompanyWireForAuth } = await import("./company-wire-cache");
  const { personIdForWire } = await import("./company-wire-http");
  const wire = await getCompanyWireForAuth();
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "PATCH") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }

  const { getSql } = await import("./db");
  const { liveEntityBooks } = await import("./company-entities-live");
  const sql = await getSql();
  const books = liveEntityBooks();
  // BATCH-3: server-side permissions (apms-permissions.ts).
  const perm = await import("./apms-permissions.ts");
  const viewer = await perm.loadViewer(personId);
  const ids = key.table === "people" || key.table === "target_cells" ? { id: key.id } : { personId: key.personId };
  const kindName = key.table.replace(/_/g, "-");
  const filtered = (body: Record<string, unknown>): Record<string, unknown> => {
    if (!body || typeof body !== "object" || !body.payload || typeof body.payload !== "object") return body;
    const seen = perm.readHotRow(viewer, key.table, ids, body.payload as Record<string, unknown>);
    return seen ? { ...body, payload: seen } : { ...body, payload: {} };
  };
  if (method === "GET") {
    const result = await getEntity(sql, key, books);
    if (result.status === 200 && result.body.payload && typeof result.body.payload === "object") {
      if (!perm.readHotRow(viewer, key.table, ids, result.body.payload as Record<string, unknown>)) {
        return perm.forbiddenResponse(perm.refusal(kindName, undefined, "You cannot see this."));
      }
    }
    return Response.json(filtered(result.body as Record<string, unknown>), { status: result.status });
  }
  const input = await request.json().catch(() => null);
  const { patchPayload } = await import("./apms-write-guard.ts");
  const sent = patchPayload(input);
  const inner = input && typeof input === "object" ? ((input as Record<string, unknown>).data && typeof (input as Record<string, unknown>).data === "object" ? ((input as Record<string, unknown>).data as Record<string, unknown>) : (input as Record<string, unknown>)) : {};
  const deleted = inner.deleted === true;
  const storedRow = await readRow(sql as unknown as HotSql, key);
  const op = perm.opOf(storedRow, deleted);
  const prev = storedRow && !storedRow.deleted ? storedRow.payload : null;
  if (key.table === "people") {
    // BATCH-2: access-role changes and other people's passwords are admin-only.
    const { peopleWriteRefusal, requesterIsAdmin } = await import("./apms-write-guard.ts");
    const why = peopleWriteRefusal(personId, key.id, sent, prev);
    if (why && !(await requesterIsAdmin(personId))) {
      return perm.forbiddenResponse(perm.refusal("people", /password/.test(why) ? "password" : "access", why));
    }
    const checked = perm.checkPersonWrite(viewer, key.id, sent, prev, op);
    if (checked.refused) return perm.forbiddenResponse(checked.refused);
    if (checked.payload !== sent && inner.payload && typeof inner.payload === "object") inner.payload = checked.payload;
  } else if (key.table === "month_records" || key.table === "reward_records") {
    const refused = perm.checkRecordWrite(viewer, key.table, key.personId, sent, prev, op);
    if (refused) return perm.forbiddenResponse(refused);
  } else if (key.table === "target_cells") {
    const refused = perm.checkTargetCellWrite(viewer, op);
    if (refused) return perm.forbiddenResponse(refused);
  }
  let pwChange = false;
  if (key.table === "people") pwChange = personPasswordChanges(patchPayload(input), prev);
  const result = await patchEntity(sql, key, input, books, personId);
  if (key.table === "people") perm.invalidateOrgContext();
  if (pwChange && result.status === 200) {
    // BATCH-3: a new password ends that person's other sessions.
    const { sessionFromHeaders } = await import("./apms-request-auth.ts");
    const { endSessionsAfterPasswordChange } = await import("./issued-logins.ts");
    if (key.table === "people") await endSessionsAfterPasswordChange([key.id], await sessionFromHeaders(request.headers));
  }
  return Response.json(filtered(result.body as Record<string, unknown>), { status: result.status });
}
