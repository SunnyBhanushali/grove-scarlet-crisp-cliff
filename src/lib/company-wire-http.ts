import { hasValidSession, sessionPersonId, unauthorizedJson } from "./apms-request-auth";
import { getCompanyWire, type CompanyWire } from "./company-notebook";

function acceptGzip(headers: Headers): boolean {
  return (headers.get("accept-encoding") || "").includes("gzip");
}

function clientAt(request: Request): number {
  try {
    const url = new URL(request.url);
    const q = Number(url.searchParams.get("at") || 0);
    if (q) return q;
  } catch {
    /* ignore */
  }
  const inm = request.headers.get("if-none-match") || "";
  const m = inm.match(/apms-(\d+)/);
  return m ? Number(m[1]) || 0 : 0;
}

export async function personIdForWire(
  request: Request,
  _wire?: CompanyWire,
): Promise<string | null> {
  // BATCH-2: only a server-issued session token names the person.
  return sessionPersonId(request.headers);
}

/** Idle If-None-Match match: tiny JSON, no snapshotJson, no entity replay. */
export function unchangedWireBody(at: number, personId: string, bookGens?: Record<string, number>) {
  return JSON.stringify({
    unchanged: true,
    notebookUpdatedAt: at,
    snapshotJson: null,
    personId,
    bookGens: bookGens || undefined,
    entities: [],
    resets: [],
    bootstrap: false,
    forbidden: false,
  });
}

export function clientMatchesWire(clientAt: number, wireAt: number): boolean {
  return !!clientAt && !!wireAt && clientAt === wireAt;
}

/**
 * BATCH-3: per-viewer wire. Admins (and roles that read everything) share the
 * one cached full wire; anyone else gets the same wire filtered by their
 * access role (apms-permissions `filterSnapshot`), encoded once per viewer and
 * wire version and cached (small LRU).
 */
type ViewerWire = { at: number; jsonBody: Buffer; gzipBody: Buffer; snapshot: Record<string, unknown> };
const viewerWires = new Map<string, ViewerWire>();
const VIEWER_WIRE_MAX = 400;

export function resetViewerWiresForTests(): void {
  viewerWires.clear();
}

export async function wireForViewer(
  wire: CompanyWire,
  personId: string,
): Promise<{ full: true } | { full: false; view: ViewerWire }> {
  const { loadViewer, viewKey, filterSnapshot } = await import("./apms-permissions.ts");
  const viewer = await loadViewer(personId);
  const key = viewKey(viewer);
  if (key === "full") return { full: true };
  const hit = viewerWires.get(key);
  if (hit && hit.at === wire.at) return { full: false, view: hit };
  const slim =
    (wire.slim as Record<string, unknown> | undefined) ||
    (JSON.parse(wire.snapshotJson || "{}") as Record<string, unknown>);
  const filtered = filterSnapshot(viewer, slim);
  const { encodeCompanyWire } = await import("./company-wire-cache.ts");
  const enc = encodeCompanyWire(filtered, wire.at, wire.bookGens);
  const view = { at: wire.at, jsonBody: enc.jsonBody, gzipBody: enc.gzipBody, snapshot: enc.slim as Record<string, unknown> };
  viewerWires.delete(key);
  viewerWires.set(key, view);
  while (viewerWires.size > VIEWER_WIRE_MAX) viewerWires.delete(viewerWires.keys().next().value as string);
  return { full: false, view };
}

export async function handleCompanyGetRequest(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  const wire = await getCompanyWire();
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();
  const scoped = await wireForViewer(wire, personId);
  const at = clientAt(request);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-apms-person-id": personId,
    etag: `"apms-${wire.at}"`,
    vary: "Accept-Encoding",
  };
  if (clientMatchesWire(at, wire.at)) {
    return new Response(unchangedWireBody(wire.at, personId, wire.bookGens), { status: 200, headers });
  }
  const bodies = scoped.full ? wire : scoped.view;
  if (acceptGzip(request.headers)) {
    return new Response(new Uint8Array(bodies.gzipBody), {
      status: 200,
      headers: {
        ...headers,
        "content-encoding": "gzip",
      },
    });
  }
  return new Response(new Uint8Array(bodies.jsonBody), { status: 200, headers });
}
