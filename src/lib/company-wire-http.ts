import { matchPerson } from "./auth-login-match";
import { auth } from "./auth/server";
import {
  hasSessionToken,
  personIdFromLegacyToken,
  readSessionToken,
  unauthorizedJson,
} from "./apms-request-auth";
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
  wire: CompanyWire,
): Promise<string | null> {
  const legacy = personIdFromLegacyToken(readSessionToken(request.headers));
  if (legacy) return legacy;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const email = session?.user?.email || "";
    if (!email) return null;
    const person = matchPerson(wire.people, {
      email,
      username: email.split("@")[0],
    });
    return person && typeof person.id === "string" ? person.id : null;
  } catch {
    return null;
  }
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

export async function handleCompanyGetRequest(request: Request): Promise<Response> {
  if (!hasSessionToken(request.headers)) return unauthorizedJson();
  const wire = await getCompanyWire();
  const personId = await personIdForWire(request, wire);
  if (!personId) return unauthorizedJson();
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
  if (acceptGzip(request.headers)) {
    return new Response(new Uint8Array(wire.gzipBody), {
      status: 200,
      headers: {
        ...headers,
        "content-encoding": "gzip",
      },
    });
  }
  return new Response(new Uint8Array(wire.jsonBody), { status: 200, headers });
}
