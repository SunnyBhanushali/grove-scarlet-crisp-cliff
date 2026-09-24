import { getSql } from "./db";
import { notifyCompanyLive, currentLiveAt, currentLiveGens } from "./company-live";
import seed from "./company-seed.json";
import { hashSnapshotSecrets } from "./apms-password.ts";
import {
  assembleSnapshot,
  BOOK_IDS,
  bookHash,
  bookPayload,
  commitBooks,
  applyBookPatches,
  mergeKeepPeople,
  mergeKeepMonthMaps,
  normalizeBookGens,
  peopleCount,
  splitSnapshot,
  wouldShrinkLive,
  type BookId,
  type Snapshot,
} from "./company-books";
import { slimForWire } from "./company-wire-slim";
import {
  encodeCompanyWire,
  getCompanyWire,
  invalidateCompanyWire,
  noteWireAssemble,
  setWireAssembler,
  softInvalidateCompanyWire,
  type CompanyWire,
} from "./company-wire-cache";
import { stripSnapshotUiSession } from "./company-ui-session";
import { ackFromPatch, parseCompanyPatch, type CompanyPatchAck } from "./company-patch";
import { dualWriteAfterPatch, importHotTables } from "./company-hot-tables";
import { latestSeq } from "./company-entity-store";
import { assembleForGet, prepareBookPatch, stripRowOwnedFromBooks, normalizeCompanySnapshot } from "./company-assemble";
import {
  RestoreRejectedError,
  keepStoredTargets,
  normalizeTargetsGraph,
  restoreTargetsGuard,
  targetCellKeys,
  countTargetCells,
} from "./company-restore-targets";

const NOTEBOOK_ID = "aliens-apms";
const REV_PREFIX = "rev-";

export type CompanyLoad = {
  snapshotJson: string | null;
  personId: string | null;
  resets: unknown[];
  bootstrap: boolean;
  forbidden: boolean;
};

type BookRow = {
  book: string;
  snapshot_json: string;
  content_hash: string;
};

type PersistMode = "replace" | "skip-stale" | "fill-missing";

/**
 * BATCH-3: this used to put provisioned `uat.*` / `p-uat-*` test people and
 * logins back into every org save, so the test admins could never be removed.
 * Test fixtures are no longer kept alive: the incoming org is saved as sent.
 * (Live clean-up of existing uat.* rows is the deploy bot's job.)
 */
export function mergePreserveUatFixtures(
  incoming: Snapshot,
  _stored: Snapshot | null | undefined,
): Snapshot {
  return incoming;
}

function seedSnapshot(): Snapshot {
  const snap = JSON.parse(JSON.stringify(seed)) as Snapshot;
  // BATCH-3: the seed's logins carry plain text; never store it that way.
  hashSnapshotSecrets(snap);
  return snap;
}

function parseSnapshot(json: string | null): Snapshot | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Snapshot;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function extractSnapshot(input: unknown): Snapshot | null {
  let value: unknown = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return parseSnapshot(trimmed);
    }
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.state && typeof rec.state === "object" && !Array.isArray(rec.state)) {
    return normalizeCompanySnapshot(rec.state as Snapshot);
  }
  if (typeof rec.snapshotJson === "string") return extractSnapshot(rec.snapshotJson);
  if (typeof rec.json === "string") return extractSnapshot(rec.json);
  if (Array.isArray(rec.people) && rec.roles && typeof rec.roles === "object") {
    return normalizeCompanySnapshot(rec as Snapshot);
  }
  const parsed = parseSnapshot(JSON.stringify(rec));
  return parsed ? normalizeCompanySnapshot(parsed) : null;
}

function isThinSnapshot(snapshot: Snapshot | null): boolean {
  return !snapshot || peopleCount(snapshot) < 10;
}

function isThin(json: string | null): boolean {
  return isThinSnapshot(parseSnapshot(json));
}

function payload(row: CompanyLoad): CompanyLoad {
  return {
    snapshotJson: row.snapshotJson,
    personId: null,
    resets: [],
    bootstrap: false,
    forbidden: false,
  };
}

async function loadBookRows() {
  const sql = await getSql();
  return sql<BookRow>`
    select book, snapshot_json, content_hash from company_books
  `;
}

function rowsToBooks(rows: BookRow[]): Partial<Record<BookId, Snapshot>> {
  const books: Partial<Record<BookId, Snapshot>> = {};
  for (const row of rows) {
    if (!(BOOK_IDS as readonly string[]).includes(row.book)) continue;
    const snap = parseSnapshot(row.snapshot_json);
    if (snap) books[row.book as BookId] = snap;
  }
  return books;
}

async function writeBook(book: BookId, snap: Snapshot, hash: string) {
  const sql = await getSql();
  const json = JSON.stringify(snap);
  await sql`
    insert into company_books (book, snapshot_json, content_hash, updated_at)
    values (${book}, ${json}, ${hash}, now())
    on conflict (book) do update
      set snapshot_json = excluded.snapshot_json,
          content_hash = excluded.content_hash,
          updated_at = now()
  `;
  await sql`
    insert into company_book_hashes (book, content_hash, seen_at)
    values (${book}, ${hash}, now())
    on conflict (book, content_hash) do update
      set seen_at = now()
  `;
}

async function recentHashes(book: BookId): Promise<Set<string>> {
  const sql = await getSql();
  const rows = await sql<{ content_hash: string }>`
    select content_hash from company_book_hashes
    where book = ${book}
    order by seen_at desc
    limit 80
  `;
  return new Set(rows.map((r) => r.content_hash));
}

async function writeCombined(snapshot: Snapshot) {
  const sql = await getSql();
  const json = JSON.stringify(snapshot);
  await sql`
    insert into company_notebook (id, snapshot_json, updated_at)
    values (${NOTEBOOK_ID}, ${json}, now())
    on conflict (id) do update
      set snapshot_json = excluded.snapshot_json,
          updated_at = now()
  `;
}

async function persistBooks(snapshot: Snapshot, mode: PersistMode, only?: readonly BookId[]) {
  const incoming = splitSnapshot(snapshot);
  const existing = rowsToBooks(await loadBookRows());
  const writeIds = only?.length ? only : BOOK_IDS;
  for (const book of writeIds) {
    const next = incoming[book];
    const hash = bookHash(next);
    const stored = existing[book];
    if (!stored) {
      await writeBook(book, next, hash);
      continue;
    }
    const storedHash = bookHash(stored);
    if (storedHash === hash) continue;
    if (mode === "fill-missing") continue;
    if (mode === "skip-stale") {
      const seen = await recentHashes(book);
      if (seen.has(hash) && hash !== storedHash) continue;
    }
    await writeBook(book, next, hash);
  }
  const assembled = assembleSnapshot(rowsToBooks(await loadBookRows()));
  try {
    if (!isThinSnapshot(assembled) || mode === "replace") await writeCombined(assembled);
  } catch (err) {
    console.error("[company-notebook] writeCombined failed after book persist", err);
  }
  return assembled;
}

async function importHotTablesAfterCommit(snapshot: Snapshot, updatedBy: string) {
  if (isThinSnapshot(snapshot)) return;
  try {
    await importHotTables(await getSql(), snapshot, { updatedBy });
  } catch (err) {
    console.error("[hot-tables] import after commit failed", err);
  }
}

/** Merge one entity slice into the matching book. Union only — never 409 on book gen. */
type BookSliceOpts = { book: BookId; payload: Snapshot; extraTombs?: unknown };
type BookSliceResult = { ok: boolean; snapshot: Snapshot };

/**
 * Hot-row writes mirror into their book. Each mirror re-reads, merges and
 * re-writes the whole book, serialized on it; a burst (a month lock saves
 * every target cell) held the event loop for seconds and every other request
 * with it. Slices that arrive while a write for the same book is running are
 * group-committed: applied together in the next single book write.
 */
const bookSliceQueues = new Map<BookId, { items: Array<{ opts: BookSliceOpts; resolve: (r: BookSliceResult) => void }>; running: boolean }>();

export async function applyEntityBookSlice(opts: BookSliceOpts): Promise<BookSliceResult> {
  return new Promise<BookSliceResult>((resolve) => {
    let q = bookSliceQueues.get(opts.book);
    if (!q) {
      q = { items: [], running: false };
      bookSliceQueues.set(opts.book, q);
    }
    q.items.push({ opts, resolve });
    if (!q.running) void drainBookSlices(opts.book);
  });
}

async function drainBookSlices(book: BookId): Promise<void> {
  const q = bookSliceQueues.get(book);
  if (!q || q.running) return;
  q.running = true;
  try {
    while (q.items.length) {
      const batch = q.items.splice(0);
      const list = batch.map((b) => b.opts);
      let result: BookSliceResult;
      try {
        result = await enqueueBooks([book], () => applyBookSlices(book, list));
      } catch (err) {
        console.error("[hot-tables] book merge after entity win failed; retrying", err);
        try {
          result = await enqueueBooks([book], () => applyBookSlices(book, list));
        } catch (err2) {
          console.error("[hot-tables] book merge retry failed; row win stands", err2);
          result = { ok: false, snapshot: assembleSnapshot(rowsToBooks(await loadBookRows())) };
        }
      }
      for (const b of batch) b.resolve(result);
    }
  } finally {
    q.running = false;
  }
}

async function applyBookSlices(book: BookId, list: BookSliceOpts[]): Promise<BookSliceResult> {
  const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
  const stored = existing;
  const next: Snapshot = { ...stored };
  let tombs: unknown = undefined;
  for (const opts of list) {
    const payload = opts.payload || {};
    if (book === "org" && "people" in payload) {
      next.people = mergeKeepPeople(next.people, payload.people);
    }
    if (book === "months") {
      if ("records" in payload) {
        next.records = mergeKeepMonthMaps(next.records, payload.records);
      }
      if ("rewardRecords" in payload) {
        next.rewardRecords = mergeKeepMonthMaps(next.rewardRecords, payload.rewardRecords);
      }
    }
    if (book === "targets" && "targetCells" in payload) {
      next.targetCells = {
        ...(isPlainSnap(next.targetCells) ? next.targetCells : {}),
        ...(isPlainSnap(payload.targetCells) ? payload.targetCells : {}),
      };
    }
    tombs = unionTombMaps(tombs, opts.extraTombs);
  }
  next.tombstones = unionTombMaps(stored.tombstones, tombs);
  stripEntityTombs(next, tombs);
  const gens = normalizeBookGens(stored);
  next.bookGens = { ...gens, [book]: (Number(gens[book]) || 0) + 1 };
  next.notebookUpdatedAt = Date.now();
  const merged = stripSnapshotUiSession(mergePreserveUatFixtures(next, stored));
  const assembled = await persistBooks(merged, "replace", [book]);
  await notifyCompanyLive(
    Number(assembled.notebookUpdatedAt) || Date.now(),
    normalizeBookGens(assembled),
  );
  return { ok: true, snapshot: assembled };
}

/**
 * ROWS-V2 mirror: after a generic entity row commits, patch that one row into
 * its book so book readers (backups, org slices, restore) stay coherent.
 * Serialized on the book; never 409s; does not notify (the caller publishes).
 */
type EntityBookRow = { kind: string; id: string; k1: string | null; k2: string | null; payload: Record<string, unknown>; rev: number; deleted: boolean };
type EntityBookSpec = { field: string; book: BookId; shape: string; kind: string };

/**
 * Generic rows mirror into their book like hot rows do: rows that arrive while
 * a write for the same book is running are applied together in the next
 * single book write (a duplicated month writes one membership per target;
 * one whole-book rewrite each made that take seconds).
 */
const entityRowQueues = new Map<BookId, { items: Array<{ spec: EntityBookSpec; row: EntityBookRow; resolve: (g: Record<string, number>) => void; reject: (e: unknown) => void }>; running: boolean }>();

export async function commitEntityRowToBook(spec: EntityBookSpec, row: EntityBookRow): Promise<Record<string, number>> {
  return new Promise<Record<string, number>>((resolve, reject) => {
    let q = entityRowQueues.get(spec.book);
    if (!q) {
      q = { items: [], running: false };
      entityRowQueues.set(spec.book, q);
    }
    q.items.push({ spec, row, resolve, reject });
    if (!q.running) void drainEntityRows(spec.book);
  });
}

async function drainEntityRows(book: BookId): Promise<void> {
  const q = entityRowQueues.get(book);
  if (!q || q.running) return;
  q.running = true;
  try {
    while (q.items.length) {
      const batch = q.items.splice(0);
      try {
        const gens = await enqueueBooks([book], () => applyEntityRows(book, batch));
        for (const b of batch) b.resolve(gens);
      } catch (err) {
        for (const b of batch) b.reject(err);
      }
    }
  } finally {
    q.running = false;
  }
}

async function applyEntityRows(book: BookId, batch: Array<{ spec: EntityBookSpec; row: EntityBookRow }>): Promise<Record<string, number>> {
  const { collections } = await import("./apms-collections.ts");
  const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
  const next: Snapshot = { ...existing };
  for (const { spec, row } of batch) {
    const cspec = collections.specForField(spec.field);
    if (!cspec) continue;
    const value = collections.applyRow(cspec, next[spec.field], row, row.deleted);
    if (value === undefined) delete next[spec.field];
    else next[spec.field] = value;
  }
  const gens = normalizeBookGens(existing);
  next.bookGens = { ...gens, [book]: (Number(gens[book]) || 0) + 1 };
  next.notebookUpdatedAt = Date.now();
  const merged = stripSnapshotUiSession(mergePreserveUatFixtures(next, existing));
  const assembled = await persistBooks(merged, "replace", [book]);
  return normalizeBookGens(assembled) as Record<string, number>;
}

/** Org book only — no assembleForGet / no people overlay. */
export async function readOrgBook(): Promise<Snapshot> {
  const rows = await loadBookRows();
  const books = rowsToBooks(rows);
  return books.org && typeof books.org === "object" ? books.org : {};
}

/** Replace named org collections. Does not touch people/records hot overlay. */
export async function commitOrgFields(fields: Record<string, unknown>): Promise<Snapshot> {
  const run = async () => {
    const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
    const next: Snapshot = { ...existing, ...fields };
    const gens = normalizeBookGens(existing);
    next.bookGens = { ...gens, org: (Number(gens.org) || 0) + 1 };
    next.notebookUpdatedAt = Date.now();
    const merged = stripSnapshotUiSession(mergePreserveUatFixtures(next, existing));
    return persistBooks(merged, "replace", ["org"]);
  };
  return enqueueBooks(["org"], run);
}

function isPlainSnap(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unionTombMaps(stored: unknown, extra: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainSnap(stored) ? { ...stored } : {};
  if (!isPlainSnap(extra)) return out;
  for (const [field, keys] of Object.entries(extra)) {
    const prev = isPlainSnap(out[field]) ? { ...out[field] } : {};
    if (isPlainSnap(keys)) Object.assign(prev, keys);
    out[field] = prev;
  }
  return out;
}

function stripEntityTombs(next: Snapshot, extra: unknown) {
  if (!isPlainSnap(extra)) return;
  const peopleTombs = isPlainSnap(extra.people) ? extra.people : {};
  if (Object.keys(peopleTombs).length && Array.isArray(next.people)) {
    next.people = next.people.filter((row) => {
      if (!row || typeof row !== "object") return true;
      const id = String((row as { id?: string }).id || "");
      return !peopleTombs[id] && !peopleTombs[`id:${id}`];
    });
  }
  const cells = isPlainSnap(extra.targetCells) ? extra.targetCells : {};
  if (Object.keys(cells).length && isPlainSnap(next.targetCells)) {
    const map = { ...next.targetCells };
    for (const id of Object.keys(cells)) delete map[id];
    next.targetCells = map;
  }
  for (const [field, keys] of Object.entries(extra)) {
    if (!field.includes("/") || !isPlainSnap(keys)) continue;
    const [root, period] = field.split("/");
    if ((root !== "records" && root !== "rewardRecords") || !period) continue;
    const tree = isPlainSnap(next[root]) ? { ...next[root] } : {};
    const month = isPlainSnap(tree[period]) ? { ...tree[period] } : {};
    for (const pid of Object.keys(keys)) delete month[pid];
    tree[period] = month;
    next[root] = tree;
  }
}

async function writeRev(snapshot: Snapshot) {
  const at = Number(snapshot.notebookUpdatedAt) || 0;
  if (!at) return;
  const sql = await getSql();
  const id = `${REV_PREFIX}${at}`;
  const json = JSON.stringify(snapshot);
  await sql`
    insert into company_notebook (id, snapshot_json, updated_at)
    values (${id}, ${json}, now())
    on conflict (id) do nothing
  `;
  const extra = await sql<{ id: string }>`
    select id from company_notebook
    where id like ${`${REV_PREFIX}%`}
    order by updated_at desc
    offset 80
  `;
  for (const row of extra) {
    await sql`delete from company_notebook where id = ${row.id}`;
  }
}

async function readRev(at: number): Promise<Snapshot | null> {
  if (!at) return null;
  const sql = await getSql();
  const rows = await sql<{ snapshot_json: string }>`
    select snapshot_json from company_notebook where id = ${`${REV_PREFIX}${at}`} limit 1
  `;
  return parseSnapshot(rows[0]?.snapshot_json ?? null);
}

let saveChain: Promise<unknown> = Promise.resolve();
const bookChains: Record<BookId, Promise<unknown>> = {
  org: Promise.resolve(),
  plans: Promise.resolve(),
  months: Promise.resolve(),
  targets: Promise.resolve(),
};

function allBookChains(): Promise<unknown[]> {
  return Promise.all(BOOK_IDS.map((id) => bookChains[id]));
}

function enqueueBooks<T>(ids: readonly BookId[], fn: () => Promise<T>): Promise<T> {
  const unique = [...new Set(ids.length ? ids : BOOK_IDS)];
  const run = Promise.all(unique.map((id) => bookChains[id])).then(fn);
  const tracked = run.then(
    () => undefined,
    () => undefined,
  );
  for (const id of unique) bookChains[id] = tracked;
  saveChain = tracked;
  return run;
}

export async function readLiveSnapshot(): Promise<Snapshot | null> {
  const rows = await loadBookRows();
  const books = rowsToBooks(rows);
  const haveAny = BOOK_IDS.some((id) => books[id]);
  if (haveAny) return assembleSnapshot(books);
  const sql = await getSql();
  const legacy = await sql<{ snapshot_json: string }>`
    select snapshot_json from company_notebook where id = ${NOTEBOOK_ID} limit 1
  `;
  return parseSnapshot(legacy[0]?.snapshot_json ?? null);
}

export async function loadCompanySnapshot(): Promise<CompanyLoad> {
  let rows = await loadBookRows();
  let books = rowsToBooks(rows);
  let haveAny = BOOK_IDS.some((id) => books[id]);
  let haveAll = BOOK_IDS.every((id) => books[id]);
  // BATCH-3: on a fresh database the two server module copies (Nitro
  // middleware and SSR routes) seed the books at the same moment, one book at
  // a time. A caller that sees only some of them is looking at the other
  // writer mid-way: wait for it instead of "filling" the missing books with
  // empty ones (that left months / targets empty on a fresh e2e database).
  for (let i = 0; haveAny && !haveAll && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    rows = await loadBookRows();
    books = rowsToBooks(rows);
    haveAny = BOOK_IDS.some((id) => books[id]);
    haveAll = BOOK_IDS.every((id) => books[id]);
  }
  const live = haveAny ? assembleSnapshot(books) : null;

  if (!isThinSnapshot(live)) {
    if (haveAll) {
      return payload({ snapshotJson: JSON.stringify(live) } as CompanyLoad);
    }
    try {
      const assembled = await persistBooks(live!, "fill-missing");
      return payload({ snapshotJson: JSON.stringify(assembled) } as CompanyLoad);
    } catch (err) {
      console.error("[company-notebook] fill-missing failed", err);
      return payload({ snapshotJson: JSON.stringify(live) } as CompanyLoad);
    }
  }

  const sql = await getSql();
  const legacy = await sql<{ snapshot_json: string }>`
    select snapshot_json from company_notebook where id = ${NOTEBOOK_ID} limit 1
  `;
  let snapshot = parseSnapshot(legacy[0]?.snapshot_json ?? null);
  if (isThinSnapshot(snapshot)) snapshot = seedSnapshot();

  try {
    const assembled = await persistBooks(snapshot!, haveAny ? "fill-missing" : "replace");
    return payload({ snapshotJson: JSON.stringify(assembled) } as CompanyLoad);
  } catch (err) {
    console.error("[company-notebook] book migrate failed", err);
    return payload({ snapshotJson: JSON.stringify(snapshot) } as CompanyLoad);
  }
}

export async function saveCompanySnapshot(
  json: string,
): Promise<{ ok: true; bookGens?: unknown; notebookUpdatedAt?: number }> {
  return enqueueBooks(BOOK_IDS, () => saveCompanySnapshotUnlocked(json));
}

async function saveCompanySnapshotUnlocked(
  json: string,
): Promise<{ ok: true; bookGens?: unknown; notebookUpdatedAt?: number }> {
  const parsed = parseSnapshot(json) || extractSnapshot(json);
  if (isThinSnapshot(parsed)) return { ok: true };
  const incoming = stripSnapshotUiSession(parsed!);
  const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
  const stored = isThinSnapshot(existing) ? null : existing;
  if (wouldShrinkLive(incoming!, stored)) {
    console.error(
      "[company-notebook] refused save: incoming people",
      peopleCount(incoming!),
      "< stored",
      peopleCount(existing),
    );
    return { ok: true, bookGens: stored?.bookGens, notebookUpdatedAt: Number(stored?.notebookUpdatedAt) || 0 };
  }
  const concurrent = stored ? commitBooks(stored, incoming) : incoming;
  const merged = stripSnapshotUiSession(mergePreserveUatFixtures(concurrent, stored));
  let assembled = merged;
  try {
    assembled = await persistBooks(merged, "replace");
  } catch (err) {
    console.error("[company-notebook] book save failed", err);
    if (wouldShrinkLive(incoming!, existing)) {
      return { ok: true, bookGens: stored?.bookGens, notebookUpdatedAt: Number(stored?.notebookUpdatedAt) || 0 };
    }
    const sql = await getSql();
    await sql`
      insert into company_notebook (id, snapshot_json, updated_at)
      values (${NOTEBOOK_ID}, ${JSON.stringify(merged)}, now())
      on conflict (id) do update
        set snapshot_json = excluded.snapshot_json,
            updated_at = now()
    `;
    assembled = merged;
  }
  void notifyCompanyLive(
    Number(assembled.notebookUpdatedAt) || Date.now(),
    normalizeBookGens(assembled),
  ).catch((err) =>
    console.error("[company-live] notify failed", err),
  );
  invalidateCompanyWire();
  await importHotTablesAfterCommit(assembled, "restore");
  return {
    ok: true,
    bookGens: assembled.bookGens,
    notebookUpdatedAt: Number(assembled.notebookUpdatedAt) || Date.now(),
  };
}

export async function replaceCompanySnapshot(json: string): Promise<{ ok: true; snapshotJson: string }> {
  return enqueueBooks(BOOK_IDS, () => replaceCompanySnapshotUnlocked(json));
}

async function replaceCompanySnapshotUnlocked(
  json: string,
): Promise<{ ok: true; snapshotJson: string }> {
  const extracted = extractSnapshot(json);
  if (!extracted) {
    throw new Error("That file is not an Aliens APMS snapshot.");
  }
  const { keepStoredSecretsOnRestore } = await import("./apms-restore-secrets.ts");
  const incoming = normalizeTargetsGraph(
    stripSnapshotUiSession((await keepStoredSecretsOnRestore(await getSql(), extracted)) as Snapshot),
  );
  const guard = restoreTargetsGuard(incoming);
  if (!guard.ok) throw new RestoreRejectedError(guard.error);
  const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
  const stored = isThinSnapshot(existing) ? null : existing;
  const toWrite = keepStoredTargets(incoming, stored);
  const assembled = await persistBooks(toWrite, "replace");
  const importSnap: Snapshot = { ...toWrite };
  if (countTargetCells(importSnap) < 1) delete importSnap.targetCells;
  await importHotTables(await getSql(), importSnap, { updatedBy: "restore" });
  // ROWS-V2: the restored file is now the authority for every generic row.
  try {
    const { importEntitiesFromSnapshot } = await import("./company-entity-store");
    await importEntitiesFromSnapshot(await getSql(), toWrite, "restore", { pruneMissing: true, logResync: false });
  } catch (err) {
    console.error("[entities] restore import failed; books restored, rows may lag", err);
  }
  if (countTargetCells(incoming) > 0) {
    const { snapshot } = await assembleForGet(await getSql(), assembled);
    const got = new Set(targetCellKeys(snapshot));
    const want = targetCellKeys(incoming);
    if (want.some((id) => !got.has(id))) {
      throw new RestoreRejectedError();
    }
  }
  invalidateCompanyWire();
  // BATCH-2: followers resync from here — the `*` row goes in last (after the
  // wire is invalidated) and the tick carries "now", not the file's old
  // notebookUpdatedAt, so every idle screen polls the feed and pulls in full.
  try {
    const { logResync } = await import("./company-entity-store");
    await logResync(await getSql(), "restore");
  } catch (err) {
    console.error("[entities] restore resync log failed", err);
  }
  void notifyCompanyLive(
    Math.max(Date.now(), Number(assembled.notebookUpdatedAt) || 0),
    normalizeBookGens(assembled),
  ).catch((err) =>
    console.error("[company-live] notify failed", err),
  );
  return { ok: true, snapshotJson: JSON.stringify(assembled) };
}

export function isAdminRestorePost(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const inner =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : rec;
  return inner.restore === true || inner.allowEmpty === true || inner.adminRestore === true;
}

export async function patchCompanyBooks(input: unknown): Promise<{ status: number; body: CompanyPatchAck }> {
  const parsed = parseCompanyPatch(input);
  const ids = parsed ? BOOK_IDS.filter((id) => parsed.books?.[id]) : [...BOOK_IDS];
  return enqueueBooks(ids.length ? ids : BOOK_IDS, () => patchCompanyBooksUnlocked(input));
}

/** After books commit. Failures must never fail the PATCH or write rows on 409. */
async function dualWriteAfterCommit(
  parsed: NonNullable<ReturnType<typeof parseCompanyPatch>>,
  result: ReturnType<typeof applyBookPatches>,
) {
  try {
    await dualWriteAfterPatch(await getSql(), result, stripRowOwnedFromBooks(parsed.books || {}), {
      clientOpId: parsed.clientOpId,
      updatedBy: "patch",
    });
  } catch (err) {
    console.error("[hot-tables] dual-write failed", err);
  }
}

async function patchCompanyBooksUnlocked(
  input: unknown,
): Promise<{ status: number; body: CompanyPatchAck }> {
  const parsed = parseCompanyPatch(input);
  if (!parsed) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "missing books",
        applied: [],
        conflict: [],
        skipped: [...BOOK_IDS],
        bookGens: { org: 0, plans: 0, months: 0, targets: 0 },
        notebookUpdatedAt: 0,
      },
    };
  }
  const existing = assembleSnapshot(rowsToBooks(await loadBookRows()));
  const stored = isThinSnapshot(existing) ? null : existing;
  if (!stored) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "empty",
        applied: [],
        conflict: [...BOOK_IDS],
        skipped: [],
        bookGens: { org: 0, plans: 0, months: 0, targets: 0 },
        notebookUpdatedAt: 0,
      },
    };
  }
  const incoming = prepareBookPatch(parsed.books || {}, stored);
  const result = applyBookPatches(stored, incoming, parsed.baseGens || {}, parsed.tombstones);
  if (result.applied.includes("org") && wouldShrinkLive(result.snapshot, stored)) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "would-shrink",
        applied: [],
        conflict: ["org"],
        skipped: result.skipped,
        bookGens: normalizeBookGens(stored),
        notebookUpdatedAt: Number(stored.notebookUpdatedAt) || 0,
        books: { org: bookPayload(stored, "org") },
      },
    };
  }
  let assembled = stored;
  if (result.applied.length) {
    const merged = stripSnapshotUiSession(mergePreserveUatFixtures(result.snapshot, stored));
    assembled = await persistBooks(merged, "replace", result.applied);
    await dualWriteAfterCommit(parsed, result);
    void notifyCompanyLive(
      Number(assembled.notebookUpdatedAt) || Date.now(),
      normalizeBookGens(assembled),
    ).catch((err) => console.error("[company-live] notify failed", err));
    softInvalidateCompanyWire();
  }
  const ack = ackFromPatch(result.applied.length ? assembled : stored, {
    ...result,
    snapshot: result.applied.length ? assembled : stored,
  });
  return { status: ack.ok ? 200 : 409, body: ack };
}

export async function loadRequestedBooks(ids: BookId[], personId?: string): Promise<{
  books: Partial<Record<BookId, Record<string, unknown>>>;
  bookGens: Record<BookId, number>;
  notebookUpdatedAt: number;
}> {
  const wire = await getCompanyWire();
  let slim = parseSnapshot(wire.snapshotJson) || {};
  if (personId) {
    // BATCH-3: `?books=` reads are filtered by the caller's access role like the wire.
    const { snapshotForViewer } = await import("./company-wire-http");
    const seen = await snapshotForViewer(wire, personId);
    if (seen) slim = seen as Snapshot;
  }
  const books: Partial<Record<BookId, Record<string, unknown>>> = {};
  for (const id of ids) books[id] = bookPayload(slim, id);
  return {
    books,
    bookGens: wire.bookGens || normalizeBookGens(slim),
    notebookUpdatedAt: wire.at,
  };
}

async function overlaySnapshotForGet(snapshot: Snapshot): Promise<Snapshot> {
  try {
    const { snapshot: next, meta } = await assembleForGet(await getSql(), snapshot);
    if (meta.source === "books-fallback") {
      console.error("[assemble] GET using books fallback; People would have been empty");
    }
    return next;
  } catch (err) {
    console.error("[assemble] GET overlay failed; using books", err);
    return snapshot;
  }
}

export async function companyIsEmpty(): Promise<boolean> {
  const loaded = await loadCompanySnapshot();
  return isThin(loaded.snapshotJson);
}

export { isThin, wouldShrinkLive };

export type { CompanyWire } from "./company-wire-cache";
export {
  WIRE_GZIP_LEVEL,
  awaitWireIdleForTests,
  getCompanyWire,
  invalidateCompanyWire,
  patchCompanyWireEntity,
  peekCompanyWire,
  resetWireForTests,
  setCompanyWireForTests,
  setWireBuildForTests,
  softInvalidateCompanyWire,
  warmCompanyWire,
  wireAssembleCalls,
} from "./company-wire-cache";

export { slimForWire };

async function buildCompanyWireFromDb(): Promise<CompanyWire> {
  noteWireAssemble();
  await allBookChains();
  // The change-feed position this wire is at least as new as, read before the
  // wire itself. A client that loads a stale-while-revalidate wire replays the
  // feed from here instead of from the head, so commits the wire has not
  // caught up with yet (a delete, a lock) still reach its screen.
  let feedSeq: number | undefined;
  try {
    feedSeq = await latestSeq(await getSql());
  } catch {
    feedSeq = undefined;
  }
  const loaded = await loadCompanySnapshot();
  const parsed = parseSnapshot(loaded.snapshotJson);
  const base = parsed ? slimForWire(parsed) : {};
  const slim = parsed ? slimForWire(await overlaySnapshotForGet(base)) : {};
  const liveGens = currentLiveGens();
  const gens = normalizeBookGens(slim);
  if (liveGens) {
    slim.bookGens = {
      org: Math.max(gens.org, Number(liveGens.org) || 0),
      plans: Math.max(gens.plans, Number(liveGens.plans) || 0),
      months: Math.max(gens.months, Number(liveGens.months) || 0),
      targets: Math.max(gens.targets, Number(liveGens.targets) || 0),
    };
  }
  const bookGens = normalizeBookGens(slim);
  const at = Math.max(Number(slim.notebookUpdatedAt) || 0, currentLiveAt() || 0);
  if (feedSeq !== undefined) slim.feedSeq = feedSeq;
  return encodeCompanyWire(slim, at, bookGens);
}

setWireAssembler(buildCompanyWireFromDb);
