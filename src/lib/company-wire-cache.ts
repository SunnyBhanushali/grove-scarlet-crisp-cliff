/**
 * GET /api/company gzip cache. Stale-while-revalidate on entity writes.
 * Stamp: p0aw1. No DB import — notebook registers the assembler.
 */
import { gzipSync } from "node:zlib";
import { slimPersonForWire } from "./company-wire-slim.ts";
import { normalizeBookGens, type BookId, type Snapshot } from "./company-books.ts";

export type CompanyWire = {
  at: number;
  snapshotJson: string;
  jsonBody: Buffer;
  gzipBody: Buffer;
  people: Array<Record<string, unknown>>;
  bookGens: Record<BookId, number>;
  slim?: Snapshot;
  /** slim/people/bookGens/at are current; snapshotJson + bodies not re-encoded yet. */
  encodePending?: boolean;
};

export const WIRE_GZIP_LEVEL = 5;

let wireCache: CompanyWire | null = null;
let wireInflight: Promise<CompanyWire> | null = null;
let wireDirtyGen = 0;
let wireBuiltGen = 0;
let wireSeq = 0;
let rebuildQueued = false;
let wireAssembleCount = 0;
let testBuild: null | (() => Promise<CompanyWire>) = null;
let defaultAssembler: null | (() => Promise<CompanyWire>) = null;

export function wireAssembleCalls(): number {
  return wireAssembleCount;
}

export function noteWireAssemble(): void {
  wireAssembleCount += 1;
}

export function setWireAssembler(fn: (() => Promise<CompanyWire>) | null) {
  defaultAssembler = fn;
}

export function resetWireForTests() {
  wireCache = null;
  wireInflight = null;
  wireDirtyGen = 0;
  wireBuiltGen = 0;
  wireSeq = 0;
  rebuildQueued = false;
  wireAssembleCount = 0;
  testBuild = null;
}

export function setWireBuildForTests(fn: null | (() => Promise<CompanyWire>)) {
  testBuild = fn;
}

export function invalidateCompanyWire() {
  wireCache = null;
  wireDirtyGen += 1;
  wireBuiltGen = 0;
  wireSeq += 1;
  wireInflight = null;
  rebuildQueued = false;
}

export function softInvalidateCompanyWire() {
  wireDirtyGen += 1;
  if (wireCache) scheduleWireRebuild();
}

export function peekCompanyWire(): CompanyWire | null {
  flushEncode();
  return wireCache;
}

function parseSlim(json: string | null | undefined): Snapshot | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as Snapshot;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function setCompanyWireForTests(wire: CompanyWire | null) {
  wireCache = wire
    ? {
        ...wire,
        slim: wire.slim || parseSlim(wire.snapshotJson),
      }
    : null;
  wireInflight = null;
  rebuildQueued = false;
  wireBuiltGen = wireCache ? wireDirtyGen : 0;
}

function isPlainWire(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function encodeCompanyWire(
  slim: Snapshot,
  at: number,
  bookGens: Record<BookId, number>,
): CompanyWire {
  const next: Snapshot = { ...slim, bookGens, notebookUpdatedAt: at };
  const snapshotJson = JSON.stringify(next);
  const jsonBody = Buffer.from(
    JSON.stringify({
      snapshotJson,
      personId: null,
      resets: [],
      bootstrap: false,
      forbidden: false,
      bookGens,
      notebookUpdatedAt: at,
    }),
    "utf8",
  );
  const gzipBody = gzipSync(jsonBody, { level: WIRE_GZIP_LEVEL });
  const people = Array.isArray(next.people)
    ? (next.people as Array<Record<string, unknown>>)
    : [];
  return { at, snapshotJson, jsonBody, gzipBody, people, bookGens, slim: next };
}

function bookForTable(table: string): BookId {
  if (table === "people") return "org";
  if (table === "target_cells" || table === "target-cells") return "targets";
  return "months";
}

function slimPerson(row: Record<string, unknown>): Record<string, unknown> {
  return slimPersonForWire(row) as Record<string, unknown>;
}

export type WireEntityPatch = {
  payload?: Record<string, unknown> | null;
  deleted?: boolean;
};

export function patchCompanyWireEntity(
  table: string,
  hint: { id?: string; personId?: string; period?: string } | null | undefined,
  rec?: WireEntityPatch | null,
): boolean {
  const slim = wireCache?.slim;
  if (!slim) return false;
  const id = String(hint?.id || hint?.personId || "");
  if (!id) return false;
  const deleted = !!rec?.deleted;
  const payload = rec?.payload && isPlainWire(rec.payload) ? rec.payload : {};
  const next: Snapshot = { ...slim };
  const book = bookForTable(table);
  const gens = { ...normalizeBookGens(next) };
  gens[book] = (Number(gens[book]) || 0) + 1;
  const t = String(table || "");

  if (t === "people") {
    const people = Array.isArray(next.people)
      ? [...(next.people as Array<Record<string, unknown>>)]
      : [];
    const idx = people.findIndex((row) => row && String(row.id) === id);
    if (deleted) {
      if (idx >= 0) people.splice(idx, 1);
    } else {
      const row = slimPerson({ ...payload, id: payload.id || id });
      if (idx >= 0) people[idx] = { ...people[idx], ...row };
      else people.push(row);
    }
    next.people = people;
  } else if (
    t === "reward_records" ||
    t === "reward-records" ||
    t === "month_records" ||
    t === "month-records"
  ) {
    const field = t.startsWith("reward") ? "rewardRecords" : "records";
    const period = String(hint?.period || "");
    if (!period) return false;
    const tree = isPlainWire(next[field]) ? { ...(next[field] as Record<string, unknown>) } : {};
    const month = isPlainWire(tree[period]) ? { ...(tree[period] as Record<string, unknown>) } : {};
    if (deleted) delete month[id];
    else month[id] = payload;
    tree[period] = month;
    next[field] = tree;
  } else if (t === "target_cells" || t === "target-cells") {
    const cells = isPlainWire(next.targetCells)
      ? { ...(next.targetCells as Record<string, unknown>) }
      : {};
    if (deleted) delete cells[id];
    else cells[id] = payload;
    next.targetCells = cells;
  } else {
    return false;
  }

  wireSeq += 1;
  // Re-encoding (JSON + gzip of the whole company) on every row write made a
  // burst of writes (a month lock saves ~20 cells) CPU-bound for seconds.
  // Keep the object current now; encode once for the burst.
  const people = Array.isArray(next.people) ? (next.people as Array<Record<string, unknown>>) : [];
  wireCache = { ...(wireCache as CompanyWire), slim: next, people, bookGens: gens, at: Date.now(), encodePending: true };
  wireBuiltGen = wireDirtyGen;
  scheduleEncode();
  return true;
}

let encodeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEncode() {
  if (encodeTimer) return;
  encodeTimer = setTimeout(() => {
    encodeTimer = null;
    flushEncode();
  }, 30);
  if (encodeTimer && typeof encodeTimer.unref === "function") encodeTimer.unref();
}

function flushEncode() {
  if (!wireCache || !wireCache.encodePending || !wireCache.slim) return;
  wireCache = encodeCompanyWire(wireCache.slim, wireCache.at, wireCache.bookGens);
}

/**
 * For resolving the signed-in person only (reads `people`): the cached wire as
 * it is, without forcing a pending re-encode. Falls back to getCompanyWire().
 */
export async function getCompanyWireForAuth(): Promise<CompanyWire> {
  if (wireCache) return wireCache;
  return getCompanyWire();
}

function scheduleWireRebuild() {
  if (wireInflight) {
    rebuildQueued = true;
    return;
  }
  const builder = testBuild || defaultAssembler;
  if (!builder) return;
  const gen = wireDirtyGen;
  const seq = wireSeq;
  wireInflight = (async () => {
    try {
      const built = await builder();
      if (seq !== wireSeq && wireCache) return wireCache;
      wireCache = built;
      wireBuiltGen = gen;
      return built;
    } catch (err) {
      if (wireCache) return wireCache;
      throw err;
    }
  })().finally(() => {
    wireInflight = null;
    rebuildQueued = false;
    if (wireDirtyGen !== wireBuiltGen) scheduleWireRebuild();
  });
}

export async function awaitWireIdleForTests(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (!wireInflight && wireDirtyGen === wireBuiltGen) return;
    await wireInflight?.catch(() => null);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function warmCompanyWire(): void {
  void getCompanyWire().catch((err) => console.error("[company-wire] warm failed", err));
}

export async function getCompanyWire(): Promise<CompanyWire> {
  if (wireCache) {
    flushEncode();
    if (wireDirtyGen !== wireBuiltGen) scheduleWireRebuild();
    return wireCache;
  }
  if (!wireInflight) scheduleWireRebuild();
  if (wireInflight) {
    const built = await wireInflight;
    if (wireCache) return wireCache;
    return built;
  }
  const builder = testBuild || defaultAssembler;
  if (!builder) throw new Error("company wire assembler is not registered");
  return builder();
}
