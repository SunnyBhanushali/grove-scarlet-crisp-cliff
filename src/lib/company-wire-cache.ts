/**
 * GET /api/company wire: the assembled company, kept in memory and patched on
 * every commit.
 *
 * PERF (server p0aw5): before, every generic-row commit soft-invalidated the
 * wire and a background rebuild re-read every book, hot row and entity row,
 * re-assembled, re-stringified and re-gzipped ~6 MB; every hot-row commit
 * re-encoded the whole company 30 ms later even when nobody read it. Under 50+
 * users that was most of one core, and a GET right after a save could get the
 * pre-save wire (the rebuild had not finished, or a patch-in-place discarded a
 * rebuild that held a generic write).
 *
 * Now:
 *   - Commits patch the in-memory copy *before the save returns*: hot rows in
 *     place (`patchCompanyWireEntity`), generic rows by re-reading that kind's
 *     rows (`applyEntityFieldsToWire`, run in commit order). The next read of
 *     the wire — by anyone — includes the save (read-after-write).
 *   - The JSON / gzip bodies are encoded lazily, once per version, only when a
 *     GET asks for them.
 *   - A full assemble only runs for a hard change (restore, book PATCH, admin
 *     wipe) — reads wait for it — and as a rare background refresh; commits
 *     that land while it runs are journaled and re-applied to its result, so a
 *     rebuild never drops one.
 *   - `feedSeq` (the change-feed position the wire is at least as new as) only
 *     moves at a quiet point: when no row write is between its commit and its
 *     wire patch, so a client replaying the feed from `feedSeq` misses nothing.
 * State lives on globalThis so both server module copies (Nitro middleware and
 * SSR routes) share one wire.
 */
import { gzipSync } from "node:zlib";
import { slimPersonForWire } from "./company-wire-slim.ts";
import { normalizeBookGens, type BookId, type Snapshot } from "./company-books.ts";
import { bumpAllHotGens } from "./company-read-cache.ts";

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
/** A background full assemble refreshes the wire at most this often (drift guard). */
export const WIRE_REFRESH_MS = 10 * 60 * 1000;

type Mutation = (slim: Snapshot) => Snapshot;

type WireState = {
  cache: CompanyWire | null;
  inflight: Promise<CompanyWire> | null;
  /** The in-flight assemble answers a hard change: reads wait for it. */
  inflightHard: boolean;
  /** A hard change arrived and no assemble has started for it yet. */
  stale: boolean;
  rebuildQueued: boolean;
  /** Mutations applied while a full assemble is in flight (re-applied to its result). */
  journal: Mutation[] | null;
  assembleCount: number;
  encodeCount: number;
  lastBuildAt: number;
  testBuild: null | (() => Promise<CompanyWire>);
  assembler: null | (() => Promise<CompanyWire>);
  /** Row writes between their commit and their wire patch. */
  writesInFlight: number;
  maxAppliedSeq: number;
  /** Serializes generic-kind re-reads so they land in commit order. */
  kindChain: Promise<unknown>;
  version: number;
};

const g = globalThis as typeof globalThis & { __apmsWireState__?: WireState };
const S: WireState = (g.__apmsWireState__ ??= {
  cache: null,
  inflight: null,
  inflightHard: false,
  stale: false,
  rebuildQueued: false,
  journal: null,
  assembleCount: 0,
  encodeCount: 0,
  lastBuildAt: 0,
  testBuild: null,
  assembler: null,
  writesInFlight: 0,
  maxAppliedSeq: 0,
  kindChain: Promise.resolve(),
  version: 0,
});

export function wireAssembleCalls(): number {
  return S.assembleCount;
}

export function wireEncodeCalls(): number {
  return S.encodeCount;
}

export function noteWireAssemble(): void {
  S.assembleCount += 1;
}

export function setWireAssembler(fn: (() => Promise<CompanyWire>) | null) {
  // Both server module copies register the same function; the first one stays.
  if (!S.assembler || !fn) S.assembler = fn;
}

export function resetWireForTests() {
  S.cache = null;
  S.inflight = null;
  S.inflightHard = false;
  S.stale = false;
  S.rebuildQueued = false;
  S.journal = null;
  S.assembleCount = 0;
  S.encodeCount = 0;
  S.lastBuildAt = 0;
  S.testBuild = null;
  S.writesInFlight = 0;
  S.maxAppliedSeq = 0;
  S.kindChain = Promise.resolve();
  S.version = 0;
}

export function setWireBuildForTests(fn: null | (() => Promise<CompanyWire>)) {
  S.testBuild = fn;
}

/** Monotonic wire version (`at`): strictly increases on every change. */
function nextAt(): number {
  S.version = Math.max(S.version + 1, Date.now());
  return S.version;
}

/** Hard change (restore / admin wipe): drop the copy; the next read assembles. */
export function invalidateCompanyWire() {
  // A hard change (restore / wipe) also moves every table the screen reads cache.
  bumpAllHotGens();
  S.cache = null;
  S.stale = false;
  S.inflight = null;
  S.inflightHard = false;
  S.rebuildQueued = false;
  S.journal = null;
}

/**
 * A change the row patches cannot express (book PATCH, legacy org book path):
 * reassemble; reads wait for it so they never see the pre-change copy.
 */
export function softInvalidateCompanyWire() {
  if (!S.cache) return;
  S.stale = true;
  scheduleWireRebuild();
}

export function peekCompanyWire(): CompanyWire | null {
  flushEncode();
  return S.cache;
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
  S.cache = wire
    ? {
        ...wire,
        slim: wire.slim || parseSlim(wire.snapshotJson),
      }
    : null;
  S.inflight = null;
  S.inflightHard = false;
  S.rebuildQueued = false;
  S.stale = false;
  S.journal = null;
  S.lastBuildAt = Date.now();
  if (wire) S.version = Math.max(S.version, wire.at);
}

function isPlainWire(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function encodeCompanyWire(
  slim: Snapshot,
  at: number,
  bookGens: Record<BookId, number>,
  opts: { gzipLevel?: number } = {},
): CompanyWire {
  S.encodeCount += 1;
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
  const gzipBody = gzipSync(jsonBody, { level: opts.gzipLevel ?? WIRE_GZIP_LEVEL });
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

/** Apply one mutation to the live copy (and journal it while a full assemble runs). */
function mutate(fn: Mutation, book?: BookId): boolean {
  const cur = S.cache;
  if (S.journal) S.journal.push(fn);
  if (!cur || !cur.slim) return !!S.journal;
  const next = fn(cur.slim);
  // Row commits keep the book generations (see rowWriteGens in company-live):
  // the wire, the live tick and the stored books report the same numbers.
  void book;
  const gens = { ...normalizeBookGens(next) };
  next.bookGens = gens;
  const people = Array.isArray(next.people) ? (next.people as Array<Record<string, unknown>>) : [];
  S.cache = { ...cur, slim: next, people, bookGens: gens, at: nextAt(), encodePending: true };
  return true;
}

function hotMutation(
  t: string,
  id: string,
  period: string,
  deleted: boolean,
  payload: Record<string, unknown>,
): Mutation | null {
  if (t === "people") {
    return (slim) => {
      const next: Snapshot = { ...slim };
      const people = Array.isArray(next.people) ? [...(next.people as Array<Record<string, unknown>>)] : [];
      const idx = people.findIndex((row) => row && String(row.id) === id);
      if (deleted) {
        if (idx >= 0) people.splice(idx, 1);
      } else {
        const row = slimPerson({ ...payload, id: payload.id || id });
        if (idx >= 0) people[idx] = { ...people[idx], ...row };
        else people.push(row);
      }
      next.people = people;
      return next;
    };
  }
  if (t === "reward_records" || t === "reward-records" || t === "month_records" || t === "month-records") {
    const field = t.startsWith("reward") ? "rewardRecords" : "records";
    if (!period) return null;
    return (slim) => {
      const next: Snapshot = { ...slim };
      const tree = isPlainWire(next[field]) ? { ...(next[field] as Record<string, unknown>) } : {};
      const month = isPlainWire(tree[period]) ? { ...(tree[period] as Record<string, unknown>) } : {};
      if (deleted) delete month[id];
      else month[id] = payload;
      tree[period] = month;
      next[field] = tree;
      return next;
    };
  }
  if (t === "target_cells" || t === "target-cells") {
    return (slim) => {
      const next: Snapshot = { ...slim };
      const cells = isPlainWire(next.targetCells) ? { ...(next.targetCells as Record<string, unknown>) } : {};
      if (deleted) delete cells[id];
      else cells[id] = payload;
      next.targetCells = cells;
      return next;
    };
  }
  return null;
}

/**
 * Hot-row commit (people / month_records / reward_records / target_cells):
 * patch the live copy now. False when there is no copy yet (the next read
 * assembles from the database, which already holds the row).
 */
export function patchCompanyWireEntity(
  table: string,
  hint: { id?: string; personId?: string; period?: string } | null | undefined,
  rec?: WireEntityPatch | null,
): boolean {
  const id = String(hint?.id || hint?.personId || "");
  if (!id) return false;
  const deleted = !!rec?.deleted;
  const payload = rec?.payload && isPlainWire(rec.payload) ? rec.payload : {};
  const fn = hotMutation(String(table || ""), id, String(hint?.period || ""), deleted, payload);
  if (!fn) return false;
  return mutate(fn, bookForTable(String(table || "")));
}

/**
 * Generic-row commit: `load()` re-reads the affected fields from the rows (the
 * same code the full assemble uses) and `finish` applies the assemble's
 * cross-field rules. Runs in commit order; resolves once the live copy
 * includes the commit. Nothing to patch without a copy (the next read
 * assembles from the rows).
 */
export function applyEntityFieldsToWire(
  load: () => Promise<Record<string, unknown> | null>,
  finish: (slim: Snapshot) => Snapshot,
  book?: BookId,
): Promise<boolean> {
  const run = S.kindChain.then(async () => {
    if (!(S.cache && S.cache.slim) && !S.journal) return false;
    const fields = await load();
    if (!fields) {
      softInvalidateCompanyWire();
      return false;
    }
    return mutate((slim) => finish({ ...slim, ...fields }), book);
  });
  S.kindChain = run.catch(() => undefined);
  return run.catch((err) => {
    console.error("[company-wire] row apply failed; reassembling", err);
    softInvalidateCompanyWire();
    return false;
  });
}

/** A row write is about to commit; the wire's feed position must not pass it. */
export function noteWireWriteStart(): void {
  S.writesInFlight += 1;
}

/** That write is committed (feed `seq`, 0 if none) and patched into the wire (or failed). */
export function noteWireWriteEnd(seq?: number): void {
  S.writesInFlight = Math.max(0, S.writesInFlight - 1);
  if (seq && seq > S.maxAppliedSeq) S.maxAppliedSeq = seq;
  if (S.writesInFlight !== 0) return;
  const seqNow = S.maxAppliedSeq;
  if (S.journal) S.journal.push((s) => ((Number(s.feedSeq) || 0) >= seqNow ? s : { ...s, feedSeq: seqNow }));
  if (S.cache?.slim && seqNow > (Number(S.cache.slim.feedSeq) || 0)) {
    // Not a data change: no new `at`; the next encode carries it.
    S.cache = { ...S.cache, slim: { ...S.cache.slim, feedSeq: seqNow }, encodePending: true };
  }
}

export function wireWritesInFlight(): number {
  return S.writesInFlight;
}

function flushEncode() {
  const cur = S.cache;
  if (!cur || !cur.encodePending || !cur.slim) return;
  S.cache = encodeCompanyWire(cur.slim, cur.at, cur.bookGens);
}

/**
 * For resolving the signed-in person only (reads `people`): the cached wire as
 * it is, without forcing a pending re-encode. Falls back to getCompanyWire().
 */
export async function getCompanyWireForAuth(): Promise<CompanyWire> {
  if (S.cache) return S.cache;
  return getCompanyWire();
}

function scheduleWireRebuild() {
  if (S.inflight) {
    S.rebuildQueued = true;
    return;
  }
  const builder = S.testBuild || S.assembler;
  if (!builder) return;
  const journal: Mutation[] = [];
  S.journal = journal;
  S.inflightHard = S.stale || !S.cache;
  S.stale = false;
  // Declared first: the assemble checks it is still the current one when it lands.
  // eslint-disable-next-line prefer-const
  let flight: Promise<CompanyWire> | null = null;
  flight = (async () => {
    try {
      const built = await builder();
      S.lastBuildAt = Date.now();
      if (S.inflight !== flight) return S.cache || built;
      // Commits that landed while the assemble ran: re-apply them on top.
      let slim = built.slim || parseSlim(built.snapshotJson) || {};
      for (const fn of journal) slim = fn(slim);
      const at = Math.max(nextAt(), built.at);
      S.version = at;
      const people = Array.isArray(slim.people) ? (slim.people as Array<Record<string, unknown>>) : [];
      S.cache =
        journal.length || built.at !== at
          ? { ...built, slim, people, at, bookGens: normalizeBookGens(slim), encodePending: true }
          : { ...built, slim };
      return S.cache;
    } catch (err) {
      if (S.cache) return S.cache;
      throw err;
    }
  })();
  S.inflight = flight;
  const mine = flight;
  void mine
    .catch(() => null)
    .finally(() => {
      if (S.inflight === mine) {
        S.inflight = null;
        S.inflightHard = false;
        S.journal = null;
      }
      if (S.rebuildQueued || S.stale) {
        S.rebuildQueued = false;
        if (!S.inflight) scheduleWireRebuild();
      }
    });
}

export async function awaitWireIdleForTests(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (!S.inflight && !S.stale && !S.rebuildQueued) {
      await S.kindChain;
      return;
    }
    await S.inflight?.catch(() => null);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function warmCompanyWire(): void {
  void getCompanyWire().catch((err) => console.error("[company-wire] warm failed", err));
}

/**
 * The current wire, encoded. Waits for a full assemble only when there is no
 * copy yet or a hard change asked for one; otherwise answers from memory.
 */
export async function getCompanyWire(opts: { encode?: boolean } = {}): Promise<CompanyWire> {
  const encode = opts.encode !== false;
  for (let i = 0; i < 5; i++) {
    const mustWait = !S.cache || S.stale || (S.inflight && S.inflightHard);
    if (!mustWait) break;
    if (!S.inflight) scheduleWireRebuild();
    if (!S.inflight) break;
    await S.inflight.catch(() => null);
  }
  if (S.cache) {
    if (Date.now() - S.lastBuildAt > WIRE_REFRESH_MS && !S.inflight) scheduleWireRebuild();
    if (encode) flushEncode();
    return S.cache;
  }
  const builder = S.testBuild || S.assembler;
  if (!builder) throw new Error("company wire assembler is not registered");
  const built = await builder();
  if (!S.cache) {
    S.cache = built;
    S.lastBuildAt = Date.now();
    S.version = Math.max(S.version, built.at);
  }
  flushEncode();
  return S.cache;
}
