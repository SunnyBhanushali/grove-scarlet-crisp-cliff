/**
 * PERF (server p0aw5): cached screen reads.
 *
 * The People list, Rewards month and APMS month screens re-read their rows
 * while open (every 2 s before stamp p0as83): 0.1–1.1 MB of JSON per read,
 * built from every jsonb row of that table / month. Most reads found nothing
 * changed. A read is now answered from memory while its table (and month) has
 * not changed since the body was built:
 *
 *   - generations per table and per table+month, bumped by every row write in
 *     this process (the write path), by imports / restore, and by LISTEN
 *     notifications of commits made elsewhere; a short TTL covers anything
 *     else;
 *   - the body is serialized and gzipped once per generation and viewer scope;
 *   - `ETag` + `If-None-Match` → 304 with no body.
 *
 * State lives on globalThis (both server module copies share it).
 */
import { gzipSync } from "node:zlib";

type Entry = { key: string; gen: string; at: number; etag: string; json: Buffer; gz: Buffer | null };
type ReadCacheState = {
  all: number;
  gens: Map<string, number>;
  entries: Map<string, Entry>;
  flights: Map<string, Promise<Entry>>;
  hits: number;
  misses: number;
  notModified: number;
};

const g = globalThis as typeof globalThis & { __apmsReadCache__?: ReadCacheState };
const S: ReadCacheState = (g.__apmsReadCache__ ??= {
  all: 0,
  gens: new Map(),
  entries: new Map(),
  flights: new Map(),
  hits: 0,
  misses: 0,
  notModified: 0,
});

/** Anything older than this is rebuilt even if no generation moved. */
export const READ_CACHE_TTL_MS = 10_000;
const MAX_ENTRIES = 600;
const GZIP_MIN_BYTES = 2048;

function norm(table: string): string {
  return String(table || "").replace(/-/g, "_");
}

/** The generation a read of `table` (optionally one month) depends on. */
export function hotGen(table: string, period?: string): string {
  const t = norm(table);
  return `${S.all}.${S.gens.get(t) || 0}.${period ? S.gens.get(`${t}:${period}`) || 0 : ""}`;
}

/** A row of `table` (in `period`, if the table is per month) changed. */
export function bumpHotGen(table: string, period?: string | null): void {
  const t = norm(table);
  if (period) S.gens.set(`${t}:${period}`, (S.gens.get(`${t}:${period}`) || 0) + 1);
  else S.gens.set(t, (S.gens.get(t) || 0) + 1);
}

/** Bulk change (import, restore): every cached read is stale. */
export function bumpAllHotGens(): void {
  S.all += 1;
}

/** A feed notification (kind as on the change feed) → bump that table. */
export function bumpFromFeedKind(kind: string, k2?: string | null): void {
  if (kind === "*") return bumpAllHotGens();
  if (kind === "people") return bumpHotGen("people");
  if (kind === "target-cells") return bumpHotGen("target_cells");
  if (kind === "month-records" || kind === "reward-records") return bumpHotGen(kind, k2 || null);
  // Generic rows: not a hot table; org reads are keyed by kind.
  bumpHotGen(`e:${kind}`);
}

export function readCacheStats() {
  return { entries: S.entries.size, hits: S.hits, misses: S.misses, notModified: S.notModified };
}

export function resetReadCacheForTests(): void {
  S.all += 1;
  S.gens.clear();
  S.entries.clear();
  S.flights.clear();
  S.hits = 0;
  S.misses = 0;
  S.notModified = 0;
}

function acceptsGzip(request: Request): boolean {
  return (request.headers.get("accept-encoding") || "").includes("gzip");
}

function etagMatches(request: Request, etag: string): boolean {
  const inm = request.headers.get("if-none-match") || "";
  if (!inm) return false;
  return inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

/**
 * Serve `build()`'s JSON for `key` at generation `gen`: from memory when the
 * same generation was built within the TTL, 304 when the client already has it.
 */
export async function cachedJsonResponse(
  request: Request,
  key: string,
  gen: string,
  build: () => Promise<unknown>,
): Promise<Response> {
  const now = Date.now();
  let entry = S.entries.get(key);
  if (!entry || entry.gen !== gen || now - entry.at > READ_CACHE_TTL_MS) {
    const flightKey = `${key}#${gen}`;
    let flight = S.flights.get(flightKey);
    if (!flight) {
      S.misses += 1;
      flight = (async () => {
        const body = await build();
        const json = Buffer.from(JSON.stringify(body), "utf8");
        const gz = json.length >= GZIP_MIN_BYTES ? gzipSync(json, { level: 5 }) : null;
        const e: Entry = { key, gen, at: Date.now(), etag: `"r${S.all}-${hash(key + "|" + gen)}-${Date.now().toString(36)}"`, json, gz };
        S.entries.delete(key);
        S.entries.set(key, e);
        while (S.entries.size > MAX_ENTRIES) S.entries.delete(S.entries.keys().next().value as string);
        return e;
      })().finally(() => S.flights.delete(flightKey));
      S.flights.set(flightKey, flight);
    }
    entry = await flight;
  } else {
    S.hits += 1;
  }
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-cache",
    etag: entry.etag,
    vary: "Accept-Encoding",
  };
  if (etagMatches(request, entry.etag)) {
    S.notModified += 1;
    return new Response(null, { status: 304, headers });
  }
  if (entry.gz && acceptsGzip(request)) {
    return new Response(new Uint8Array(entry.gz), { status: 200, headers: { ...headers, "content-encoding": "gzip" } });
  }
  return new Response(new Uint8Array(entry.json), { status: 200, headers });
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
