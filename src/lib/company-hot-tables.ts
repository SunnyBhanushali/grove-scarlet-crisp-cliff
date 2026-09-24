import type { BookId, BookPatchResult, Snapshot } from "./company-books";

/** Minimal SQL surface used by the importer (matches `Sql.query`). */
export type HotSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type HotTableCounts = {
  people: number;
  monthRecords: number;
  rewardRecords: number;
  targetCells: number;
  tombstones: number;
};

export type PersonRow = { id: string; payload: Record<string, unknown> };
export type PersonPeriodRow = {
  personId: string;
  period: string;
  payload: Record<string, unknown>;
};
export type CellRow = { id: string; payload: Record<string, unknown> };
export type TombRow = { field: string; key: string; payload: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  return { value };
}

export function flattenPeople(value: unknown): PersonRow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PersonRow[] = [];
  for (const row of value) {
    if (!isPlainObject(row)) continue;
    const id = String(row.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, payload: row });
  }
  return out;
}

export function flattenPersonPeriodMap(value: unknown): PersonPeriodRow[] {
  if (!isPlainObject(value)) return [];
  const out: PersonPeriodRow[] = [];
  for (const [period, inner] of Object.entries(value)) {
    if (!period || !isPlainObject(inner)) continue;
    for (const [personId, rec] of Object.entries(inner)) {
      if (!personId) continue;
      out.push({ personId, period, payload: asPayload(rec) });
    }
  }
  return out;
}

export function flattenTargetCells(value: unknown): CellRow[] {
  if (Array.isArray(value)) {
    const out: CellRow[] = [];
    for (const rec of value) {
      if (!isPlainObject(rec)) continue;
      const id = String(rec.id || rec.key || "");
      if (!id) continue;
      out.push({ id, payload: asPayload(rec) });
    }
    return out;
  }
  if (!isPlainObject(value)) return [];
  const out: CellRow[] = [];
  for (const [id, rec] of Object.entries(value)) {
    if (!id) continue;
    out.push({ id, payload: asPayload(rec) });
  }
  return out;
}

export function flattenTombstones(value: unknown): TombRow[] {
  if (!isPlainObject(value)) return [];
  const out: TombRow[] = [];
  for (const [field, keys] of Object.entries(value)) {
    if (!field || !isPlainObject(keys)) continue;
    for (const [key, ts] of Object.entries(keys)) {
      if (!key) continue;
      const at = Number(ts) || 0;
      out.push({ field, key, payload: { at } });
    }
  }
  return out;
}

/** Counts of live rows a full book snapshot should produce. */
export function countFromSnapshot(snapshot: Snapshot | null | undefined): HotTableCounts {
  if (!snapshot) {
    return { people: 0, monthRecords: 0, rewardRecords: 0, targetCells: 0, tombstones: 0 };
  }
  return {
    people: flattenPeople(snapshot.people).length,
    monthRecords: flattenPersonPeriodMap(snapshot.records).length,
    rewardRecords: flattenPersonPeriodMap(snapshot.rewardRecords).length,
    targetCells: flattenTargetCells(snapshot.targetCells).length,
    tombstones: flattenTombstones(snapshot.tombstones).length,
  };
}

export function countFromBooks(books: Partial<Record<BookId, Snapshot | null | undefined>>): HotTableCounts {
  return countFromSnapshot({
    people: books.org?.people,
    tombstones: books.org?.tombstones,
    records: books.months?.records,
    rewardRecords: books.months?.rewardRecords,
    targetCells: books.targets?.targetCells,
  });
}

async function upsertKeyed(
  sql: HotSql,
  table: "people" | "target_cells",
  idCol: string,
  rows: { id: string; payload: Record<string, unknown> }[],
  updatedBy: string,
) {
  for (const row of rows) {
    await sql.query(
      `insert into ${table} (${idCol}, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2::jsonb, 1, now(), $3, null)
       on conflict (${idCol}) do update set
         payload = excluded.payload,
         rev = case
           when ${table}.payload is not distinct from excluded.payload and ${table}.deleted_at is null
           then ${table}.rev
           else ${table}.rev + 1
         end,
         updated_at = now(),
         updated_by = excluded.updated_by,
         deleted_at = null`,
      [row.id, JSON.stringify(row.payload), updatedBy],
    );
  }
}

async function upsertPersonPeriod(
  sql: HotSql,
  table: "month_records" | "reward_records",
  rows: PersonPeriodRow[],
  updatedBy: string,
) {
  for (const row of rows) {
    await sql.query(
      `insert into ${table} (person_id, period, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2, $3::jsonb, 1, now(), $4, null)
       on conflict (person_id, period) do update set
         payload = excluded.payload,
         rev = case
           when ${table}.payload is not distinct from excluded.payload and ${table}.deleted_at is null
           then ${table}.rev
           else ${table}.rev + 1
         end,
         updated_at = now(),
         updated_by = excluded.updated_by,
         deleted_at = null`,
      [row.personId, row.period, JSON.stringify(row.payload), updatedBy],
    );
  }
}

async function softDeleteMissing(
  sql: HotSql,
  table: "people" | "target_cells",
  idCol: string,
  keepIds: string[],
) {
  await sql.query(
    `update ${table}
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now()
      where deleted_at is null
        and not (${idCol} = any($1::text[]))`,
    [keepIds],
  );
}

async function softDeleteMissingPersonPeriod(
  sql: HotSql,
  table: "month_records" | "reward_records",
  rows: PersonPeriodRow[],
) {
  const sep = "\u001f";
  const pairs = rows.map((r) => `${r.personId}${sep}${r.period}`);
  await sql.query(
    `update ${table}
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now()
      where deleted_at is null
        and not ((person_id || chr(31) || period) = any($1::text[]))`,
    [pairs],
  );
}

/**
 * Project org / months / targets books into hot row tables.
 * Idempotent. Never hard-deletes. Books remain the source of truth.
 */
export async function importHotTables(
  sql: HotSql,
  snapshot: Snapshot,
  opts: { updatedBy?: string } = {},
): Promise<HotTableCounts> {
  const updatedBy = opts.updatedBy || "book-import";
  const people = flattenPeople(snapshot.people);
  const monthRecords = flattenPersonPeriodMap(snapshot.records);
  const rewardRecords = flattenPersonPeriodMap(snapshot.rewardRecords);
  const targetCells = flattenTargetCells(snapshot.targetCells);
  const tombs = flattenTombstones(snapshot.tombstones);

  if (Array.isArray(snapshot.people)) {
    await upsertKeyed(sql, "people", "id", people, updatedBy);
    await softDeleteMissing(sql, "people", "id", people.map((p) => p.id));
  }
  if ("records" in snapshot) {
    await upsertPersonPeriod(sql, "month_records", monthRecords, updatedBy);
    await softDeleteMissingPersonPeriod(sql, "month_records", monthRecords);
  }
  if ("rewardRecords" in snapshot) {
    await upsertPersonPeriod(sql, "reward_records", rewardRecords, updatedBy);
    await softDeleteMissingPersonPeriod(sql, "reward_records", rewardRecords);
  }
  if ("targetCells" in snapshot) {
    await upsertKeyed(sql, "target_cells", "id", targetCells, updatedBy);
    await softDeleteMissing(sql, "target_cells", "id", targetCells.map((c) => c.id));
  }
  await upsertTombstoneRows(sql, tombs, updatedBy);

  return liveHotTableCounts(sql);
}

export async function liveHotTableCounts(sql: HotSql): Promise<HotTableCounts> {
  const one = async (text: string) => {
    const rows = await sql.query<{ n: number }>(text);
    return Number(rows[0]?.n || 0);
  };
  return {
    people: await one("select count(*)::int as n from people where deleted_at is null"),
    monthRecords: await one("select count(*)::int as n from month_records where deleted_at is null"),
    rewardRecords: await one("select count(*)::int as n from reward_records where deleted_at is null"),
    targetCells: await one("select count(*)::int as n from target_cells where deleted_at is null"),
    tombstones: await one("select count(*)::int as n from tombstones where deleted_at is null"),
  };
}

async function upsertTombstoneRows(sql: HotSql, rows: TombRow[], updatedBy: string) {
  for (const row of rows) {
    await sql.query(
      `insert into tombstones (field, key, payload, rev, updated_at, updated_by, deleted_at)
       values ($1, $2, $3::jsonb, 1, now(), $4, null)
       on conflict (field, key) do update set
         payload = excluded.payload,
         rev = case
           when tombstones.payload is not distinct from excluded.payload
           then tombstones.rev
           else tombstones.rev + 1
         end,
         updated_at = now(),
         updated_by = excluded.updated_by,
         deleted_at = null`,
      [row.field, row.key, JSON.stringify(row.payload), updatedBy],
    );
  }
}

/** Record a book-PATCH clientOpId. Conflict is a no-op (retry-safe). Never deletes. */
export async function rememberWriteId(
  sql: HotSql,
  clientOpId: string,
  payload: Record<string, unknown> = {},
  updatedBy = "patch",
): Promise<void> {
  await claimWriteId(sql, clientOpId, payload, updatedBy);
}

/**
 * Insert client_op_id. Returns true when this id is new (caller may write rows).
 * Same id twice → false; do not bump rev.
 */
export async function claimWriteId(
  sql: HotSql,
  clientOpId: string,
  payload: Record<string, unknown> = {},
  updatedBy = "patch",
): Promise<boolean> {
  const id = String(clientOpId || "").trim();
  if (!id) return true;
  const rows = await sql.query<{ client_op_id: string }>(
    `insert into write_ids (client_op_id, payload, rev, updated_at, updated_by, deleted_at)
     values ($1, $2::jsonb, 1, now(), $3, null)
     on conflict (client_op_id) do nothing
     returning client_op_id`,
    [id.slice(0, 200), JSON.stringify(payload), updatedBy],
  );
  return rows.length > 0;
}

/**
 * BATCH-2: a book save re-sends every tombstone the client holds. A person
 * restored from Trash (a live people row written after the delete) must not
 * be deleted again by that echo: a people tombstone older than the row's last
 * write is dropped (neither stored nor applied).
 */
export async function dropSupersededPeopleTombs(sql: HotSql, tombs: TombRow[]): Promise<TombRow[]> {
  const people = tombs.filter((t) => t.field === "people");
  if (!people.length) return tombs;
  const ids = [...new Set(people.map((t) => tombPersonId(t.key)))];
  const rows = await sql.query<{ id: string; updated_at: string | Date }>(
    "select id, updated_at from people where id = any($1) and deleted_at is null",
    [ids],
  );
  const liveAt = new Map(rows.map((r) => [r.id, new Date(r.updated_at).getTime()]));
  return tombs.filter((t) => {
    if (t.field !== "people") return true;
    const at = Number(t.payload.at) || 0;
    const rowAt = liveAt.get(tombPersonId(t.key));
    return rowAt === undefined || !at || at > rowAt;
  });
}

/** An explicit restore (a live people row over its tombstone) clears the person's tombstones. */
export async function clearPeopleTombs(sql: HotSql, personId: string, updatedBy: string): Promise<void> {
  await sql.query(
    `update tombstones set deleted_at = now(), updated_at = now(), updated_by = $2, rev = rev + 1
      where field = 'people' and key in ($1, 'id:' || $1) and deleted_at is null`,
    [personId, updatedBy],
  );
}

function tombPersonId(key: string): string {
  return key.startsWith("id:") ? key.slice(3) : key;
}

/** Soft-delete matching hot rows. Missing PATCH keys never reach here. */
async function applyTombstoneDeletes(sql: HotSql, rows: TombRow[]) {
  for (const row of rows) {
    const { field, key } = row;
    if (!field || !key) continue;
    if (field === "people") {
      await sql.query(
        `update people
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [tombPersonId(key)],
      );
    } else if (field === "targetCells") {
      await sql.query(
        `update target_cells
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [key],
      );
    } else if (field === "records") {
      await sql.query(
        `update month_records
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where period = $1 and deleted_at is null`,
        [key],
      );
    } else if (field === "rewardRecords") {
      await sql.query(
        `update reward_records
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where period = $1 and deleted_at is null`,
        [key],
      );
    } else if (field.startsWith("records/")) {
      await sql.query(
        `update month_records
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where period = $1 and person_id = $2 and deleted_at is null`,
        [field.slice("records/".length), key],
      );
    } else if (field.startsWith("rewardRecords/")) {
      await sql.query(
        `update reward_records
            set deleted_at = coalesce(deleted_at, now()),
                updated_at = now()
          where period = $1 and person_id = $2 and deleted_at is null`,
        [field.slice("rewardRecords/".length), key],
      );
    }
  }
}

export type DualWriteInput = {
  applied: BookId[];
  incoming: Partial<Record<BookId, Snapshot | undefined>>;
  committed?: Snapshot;
  clientOpId?: string;
  updatedBy?: string;
};

export type DualWriteResult = {
  wrote: boolean;
  skipped: boolean;
};

/**
 * Dual-write touched slices after a committed book PATCH.
 * - applied empty / 409 → write zero rows
 * - same clientOpId twice → skip (rev unchanged)
 * - missing PATCH keys are not deletes; deletes only via tombstones
 */
export async function dualWriteHotTables(
  sql: HotSql,
  input: DualWriteInput,
): Promise<DualWriteResult> {
  if (!input.applied.length) return { wrote: false, skipped: true };

  const updatedBy = input.updatedBy || "patch";
  const opId = String(input.clientOpId || "").trim();
  if (opId) {
    const claimed = await claimWriteId(sql, opId, { applied: input.applied }, updatedBy);
    if (!claimed) return { wrote: false, skipped: true };
  }

  for (const book of input.applied) {
    const payload = input.incoming[book];
    if (!payload || typeof payload !== "object") continue;
    if (book === "org" && "people" in payload) {
      await upsertKeyed(sql, "people", "id", flattenPeople(payload.people), updatedBy);
    }
    if (book === "months") {
      if ("records" in payload) {
        await upsertPersonPeriod(
          sql,
          "month_records",
          flattenPersonPeriodMap(payload.records),
          updatedBy,
        );
      }
      if ("rewardRecords" in payload) {
        await upsertPersonPeriod(
          sql,
          "reward_records",
          flattenPersonPeriodMap(payload.rewardRecords),
          updatedBy,
        );
      }
    }
    if (book === "targets" && "targetCells" in payload) {
      await upsertKeyed(
        sql,
        "target_cells",
        "id",
        flattenTargetCells(payload.targetCells),
        updatedBy,
      );
    }
  }

  const tombs = await dropSupersededPeopleTombs(sql, flattenTombstones(input.committed?.tombstones));
  if (tombs.length) {
    await upsertTombstoneRows(sql, tombs, updatedBy);
    await applyTombstoneDeletes(sql, tombs);
  }

  return { wrote: true, skipped: false };
}

/** Gate used by PATCH /api/company: no commit → no rows. */
export async function dualWriteAfterPatch(
  sql: HotSql,
  result: Pick<BookPatchResult, "applied" | "snapshot">,
  incoming: Partial<Record<BookId, Snapshot | undefined>>,
  opts: { clientOpId?: string; updatedBy?: string } = {},
): Promise<DualWriteResult> {
  if (!result.applied.length) return { wrote: false, skipped: true };
  return dualWriteHotTables(sql, {
    applied: result.applied,
    incoming,
    committed: result.snapshot,
    clientOpId: opts.clientOpId,
    updatedBy: opts.updatedBy,
  });
}
