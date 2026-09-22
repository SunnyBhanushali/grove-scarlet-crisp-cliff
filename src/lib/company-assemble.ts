import type { BookId, Snapshot } from "./company-books.ts";
import {
  flattenPeople,
  importHotTables,
  liveHotTableCounts,
  type HotSql,
  type PersonPeriodRow,
} from "./company-hot-tables.ts";

/** These four collections are owned by hot rows, not book PATCH. */
export const ROW_OWNED_FIELDS = ["people", "records", "rewardRecords", "targetCells"] as const;
export type RowOwnedField = (typeof ROW_OWNED_FIELDS)[number];

export type AssembleMeta = {
  source: "rows" | "books-fallback";
  bookPeople: number;
  rowPeople: number;
  assembledPeople: number;
  imported: boolean;
};

export let lastAssembleMeta: AssembleMeta | null = null;
let getImportAttempted = false;

export function resetAssembleImportForTests(): void {
  getImportAttempted = false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return normalizeRecordPayload(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return normalizeRecordPayload(parsed);
    } catch {
      /* ignore */
    }
  }
  return {};
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter((row) => row != null);
  }
  return [];
}

function normalizeKpi(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return { children: [] };
  return { ...value, children: asList(value.children).map(normalizeKpi) };
}

function normalizeKra(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return { kpis: [] };
  return {
    ...value,
    kpis: asList(value.kpis).map(normalizeKpi),
    responsibilities: asList(value.responsibilities),
    performanceOutcomes: asList(value.performanceOutcomes),
    executionOutcomes: asList(value.executionOutcomes),
  };
}

function normalizeBrandPlan(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return { kras: [] };
  return { ...value, kras: asList(value.kras).map(normalizeKra) };
}

const RECORD_ARRAY_KEYS = [
  "brands",
  "kras",
  "priorities",
  "values",
  "rewardFlags",
  "authors",
  "behaviours",
] as const;

/** Month-record fields the SPA calls .find/.map/.for-of on. Objects (jsonb {}) crash Rewards → Plans. */
export function normalizeRecordPayload(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  next.brands = asList(next.brands).map(normalizeBrandPlan);
  next.kras = asList(next.kras).map(normalizeKra);
  for (const key of RECORD_ARRAY_KEYS) {
    if (key === "brands" || key === "kras") continue;
    next[key] = asList(next[key]);
  }
  return next;
}

const CATALOG_ARRAY_KEYS = [
  "people",
  "companies",
  "brands",
  "businessUnits",
  "functions",
  "subFunctions",
  "sbuMembers",
  "notices",
  "appRequests",
  "kpiMaster",
  "accessRoles",
  "targetMembers",
  "gateUnits",
  "awardInstances",
  "trash",
  "customReports",
] as const;

function mapMonthTree(tree: unknown): unknown {
  if (!isPlainObject(tree)) return tree;
  const out: Record<string, unknown> = {};
  for (const [period, inner] of Object.entries(tree)) {
    if (!isPlainObject(inner)) {
      out[period] = inner;
      continue;
    }
    const month: Record<string, unknown> = {};
    for (const [pid, rec] of Object.entries(inner)) {
      month[pid] = isPlainObject(rec) ? normalizeRecordPayload(rec) : rec;
    }
    out[period] = month;
  }
  return out;
}

/** After restore/GET: catalogs and plan trees must be arrays so the SPA can .find. */
export function normalizeCompanySnapshot(snapshot: Snapshot): Snapshot {
  const next: Snapshot = { ...snapshot };
  for (const key of CATALOG_ARRAY_KEYS) {
    if (key in next) {
      next[key] = asList(next[key]).filter((row) => row && typeof row === "object");
    }
  }
  if (next.records) next.records = mapMonthTree(next.records);
  if (next.rewardRecords) next.rewardRecords = mapMonthTree(next.rewardRecords);
  return next;
}

export function stripRowOwnedFromBooks(
  books: Partial<Record<BookId, Snapshot | undefined>>,
): Partial<Record<BookId, Snapshot>> {
  const out: Partial<Record<BookId, Snapshot>> = {};
  for (const [id, payload] of Object.entries(books) as [BookId, Snapshot | undefined][]) {
    if (!payload || typeof payload !== "object") continue;
    const next: Snapshot = { ...payload };
    for (const field of ROW_OWNED_FIELDS) delete next[field];
    if (Object.keys(next).length) out[id] = next;
  }
  return out;
}

/** Strip row-owned incoming writes, but keep stored maps so book PATCH cannot tombstone them. */
export function prepareBookPatch(
  books: Partial<Record<BookId, Snapshot | undefined>>,
  stored: Snapshot,
): Partial<Record<BookId, Snapshot>> {
  const stripped = stripRowOwnedFromBooks(books);
  if (stripped.targets) {
    stripped.targets = { ...stripped.targets, targetCells: stored.targetCells };
  }
  if (stripped.months) {
    stripped.months = {
      ...stripped.months,
      records: stored.records,
      rewardRecords: stored.rewardRecords,
    };
  }
  return stripped;
}

function treeFromPeriodRows(rows: PersonPeriodRow[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (!out[row.period]) out[row.period] = {};
    out[row.period][row.personId] = row.payload;
  }
  return out;
}

export type HotSlices = {
  people: Array<Record<string, unknown>>;
  records: Record<string, Record<string, unknown>>;
  rewardRecords: Record<string, Record<string, unknown>>;
  targetCells: Record<string, unknown>;
  peopleCount: number;
  monthCount: number;
  rewardCount: number;
  cellCount: number;
};

export async function loadHotSlices(sql: HotSql): Promise<HotSlices> {
  const [peopleRows, monthRows, rewardRows, cellRows, tombs] = await Promise.all([
    sql.query<{ id: string; payload: unknown }>(
      "select id, payload from people where deleted_at is null",
    ),
    sql.query<{ person_id: string; period: string; payload: unknown }>(
      "select person_id, period, payload from month_records where deleted_at is null",
    ),
    sql.query<{ person_id: string; period: string; payload: unknown }>(
      "select person_id, period, payload from reward_records where deleted_at is null",
    ),
    sql.query<{ id: string; payload: unknown }>(
      "select id, payload from target_cells where deleted_at is null",
    ),
    sql.query<{ field: string; key: string }>(
      "select field, key from tombstones where deleted_at is null",
    ),
  ]);
  const gonePeople = new Set<string>();
  const goneCells = new Set<string>();
  const goneMonth = new Set<string>();
  const goneReward = new Set<string>();
  for (const t of tombs) {
    const field = String(t.field || "");
    const key = String(t.key || "");
    if (field === "people") {
      gonePeople.add(key.startsWith("id:") ? key.slice(3) : key);
    } else if (field === "targetCells") {
      goneCells.add(key);
    } else if (field.startsWith("records/")) {
      goneMonth.add(`${field.slice("records/".length)}\u001f${key}`);
    } else if (field.startsWith("rewardRecords/")) {
      goneReward.add(`${field.slice("rewardRecords/".length)}\u001f${key}`);
    }
  }

  const people: Array<Record<string, unknown>> = [];
  for (const row of peopleRows) {
    const id = String(row.id || "");
    if (!id || gonePeople.has(id)) continue;
    const payload = asPayload(row.payload);
    people.push({ ...payload, id: payload.id || id });
  }

  const records = treeFromPeriodRows(
    monthRows
      .filter((r) => !goneMonth.has(`${r.period}\u001f${r.person_id}`))
      .map((r) => ({ personId: r.person_id, period: r.period, payload: asPayload(r.payload) })),
  );
  const rewardRecords = treeFromPeriodRows(
    rewardRows
      .filter((r) => !goneReward.has(`${r.period}\u001f${r.person_id}`))
      .map((r) => ({ personId: r.person_id, period: r.period, payload: asPayload(r.payload) })),
  );
  const targetCells: Record<string, unknown> = {};
  for (const row of cellRows) {
    const id = String(row.id || "");
    if (!id || goneCells.has(id)) continue;
    targetCells[id] = asPayload(row.payload);
  }

  return {
    people,
    records,
    rewardRecords,
    targetCells,
    peopleCount: people.length,
    monthCount: monthRows.length,
    rewardCount: rewardRows.length,
    cellCount: cellRows.length,
  };
}

export function overlayHotSlices(snapshot: Snapshot, slices: HotSlices): Snapshot {
  const next: Snapshot = { ...snapshot };
  if (slices.peopleCount > 0) next.people = slices.people;
  if (slices.monthCount > 0) next.records = slices.records;
  if (slices.rewardCount > 0) next.rewardRecords = slices.rewardRecords;
  if (slices.cellCount > 0) next.targetCells = slices.targetCells;
  return next;
}

/**
 * GET assemble: rows win. Empty people table + books have people → import once.
 * If assembled people would be empty while books have people → keep books (never ship empty UI).
 */
export async function assembleForGet(sql: HotSql, snapshot: Snapshot): Promise<{
  snapshot: Snapshot;
  meta: AssembleMeta;
}> {
  const bookPeople = flattenPeople(snapshot.people).length;
  let imported = false;
  let counts = await liveHotTableCounts(sql);
  if (counts.people < 1 && bookPeople > 0 && !getImportAttempted) {
    getImportAttempted = true;
    console.info("[assemble] empty hot tables; importHotTables from books people=", bookPeople);
    await importHotTables(sql, snapshot, { updatedBy: "get-assemble" });
    imported = true;
    counts = await liveHotTableCounts(sql);
  }
  const slices = await loadHotSlices(sql);
  const rowPeople = slices.peopleCount;
  if (rowPeople < 1 && bookPeople > 0) {
    console.error(
      "[assemble] ACCEPTANCE fail: assembled people empty while books have",
      bookPeople,
      "— falling back to books",
    );
    const meta: AssembleMeta = {
      source: "books-fallback",
      bookPeople,
      rowPeople,
      assembledPeople: bookPeople,
      imported,
    };
    lastAssembleMeta = meta;
    return { snapshot: normalizeCompanySnapshot(snapshot), meta };
  }
  const overlaid = normalizeCompanySnapshot(overlayHotSlices(snapshot, slices));
  const assembledPeople = flattenPeople(overlaid.people).length;
  const meta: AssembleMeta = {
    source: "rows",
    bookPeople,
    rowPeople,
    assembledPeople,
    imported,
  };
  lastAssembleMeta = meta;
  return { snapshot: overlaid, meta };
}
