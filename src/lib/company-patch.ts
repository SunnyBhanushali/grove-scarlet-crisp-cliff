import {
  BOOK_IDS,
  applyBookPatches,
  bookPayload,
  normalizeBookGens,
  type BookId,
  type Snapshot,
} from "./company-books";

export type CompanyPatchBody = {
  books?: Partial<Record<BookId, Snapshot>>;
  baseGens?: Partial<Record<BookId, number>>;
  tombstones?: unknown;
  clientOpId?: string;
};

export type CompanyPatchAck = {
  ok: boolean;
  error?: string;
  applied: BookId[];
  conflict: BookId[];
  skipped: BookId[];
  bookGens: Record<BookId, number>;
  notebookUpdatedAt: number;
  books?: Partial<Record<BookId, Record<string, unknown>>>;
};

export function isAdminRestorePost(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const inner =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : rec;
  return inner.restore === true || inner.allowEmpty === true || inner.adminRestore === true;
}

export function parseCompanyPatch(input: unknown): CompanyPatchBody | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const inner =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : rec;
  const rawBooks = inner.books;
  if (!rawBooks || typeof rawBooks !== "object" || Array.isArray(rawBooks)) return null;
  const books: Partial<Record<BookId, Snapshot>> = {};
  for (const id of BOOK_IDS) {
    const payload = (rawBooks as Record<string, unknown>)[id];
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      books[id] = payload as Snapshot;
    }
  }
  if (!BOOK_IDS.some((id) => books[id])) return null;
  const rawGens = inner.baseGens;
  const baseGens: Partial<Record<BookId, number>> = {};
  if (rawGens && typeof rawGens === "object" && !Array.isArray(rawGens)) {
    for (const id of BOOK_IDS) {
      const n = Number((rawGens as Record<string, unknown>)[id]);
      if (Number.isFinite(n)) baseGens[id] = n;
    }
  }
  const clientOpId =
    typeof inner.clientOpId === "string" && inner.clientOpId.trim()
      ? inner.clientOpId.trim().slice(0, 200)
      : undefined;
  return { books, baseGens, tombstones: inner.tombstones, clientOpId };
}

export function ackFromPatch(
  stored: Snapshot,
  result: ReturnType<typeof applyBookPatches>,
): CompanyPatchAck {
  const bookGens = normalizeBookGens(result.snapshot);
  const ack: CompanyPatchAck = {
    ok: result.conflict.length === 0,
    applied: result.applied,
    conflict: result.conflict,
    skipped: result.skipped,
    bookGens,
    notebookUpdatedAt: Number(result.snapshot.notebookUpdatedAt) || Date.now(),
  };
  if (result.conflict.length) {
    ack.error = "stale";
    ack.books = {};
    for (const id of result.conflict) ack.books[id] = bookPayload(stored, id);
  }
  return ack;
}
