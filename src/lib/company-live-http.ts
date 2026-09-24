import { hasValidSession, sessionPersonId, unauthorizedJson } from "./apms-request-auth.ts";
import { filterHints, loadViewer, type Viewer } from "./apms-permissions.ts";
import {
  LIVE_ENTITY_CAP,
  currentEmittedEntities,
  currentLiveAt,
  currentLiveEntities,
  currentLiveGens,
  encodeSse,
  liveSseHeaders,
  readLiveAt,
  startEntityListen,
  subscribeCompanyLive,
} from "./company-live.ts";

export async function handleCompanyTickRequest(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  await readLiveAt();
  let since = 0;
  try {
    since = Number(new URL(request.url).searchParams.get("since") || 0) || 0;
  } catch {
    since = 0;
  }
  const at = currentLiveAt();
  const pid = await sessionPersonId(request.headers);
  const viewer = pid ? await loadViewer(pid) : null;
  const all = currentLiveEntities()
    .filter((row) => !since || Number(row.at) > since)
    .slice(-LIVE_ENTITY_CAP);
  // BATCH-3: hints for rows the caller cannot read are not sent.
  const entities = viewer ? filterHints(viewer, all) : [];
  return new Response(
    JSON.stringify({
      at,
      bookGens: currentLiveGens(),
      entities,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export async function handleCompanyLiveRequest(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  startEntityListen();
  const pid = await sessionPersonId(request.headers);
  let viewer: Viewer | null = pid ? await loadViewer(pid) : null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSentAt = 0;
      let lastSentKey = "";
      const send = (at: number, ents?: { type: string; id: string; period?: string; at?: number }[]) => {
        if (closed) return;
        try {
          const raw = Array.isArray(ents) ? ents.slice(-LIVE_ENTITY_CAP) : currentLiveEntities();
          const list = viewer ? filterHints(viewer, raw) : [];
          lastSentAt = at;
          lastSentKey = list.map((row) => `${row.type}:${row.id}:${row.period || ""}`).join("|");
          controller.enqueue(encoder.encode(encodeSse(at, currentLiveGens(), list)));
        } catch {
          closed = true;
        }
      };
      send(currentLiveAt(), currentLiveEntities());
      void readLiveAt().then((at) => {
        send(at || currentLiveAt(), currentLiveEntities());
      });
      const unsub = subscribeCompanyLive((at) => send(at, currentEmittedEntities().length ? currentEmittedEntities() : currentLiveEntities()));
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);
      const poll = setInterval(() => {
        if (closed) return;
        if (pid) void loadViewer(pid).then((v) => (viewer = v)).catch(() => undefined);
        void readLiveAt().then((at) => {
          if (closed || !at) return;
          const list = currentLiveEntities();
          const key = list.map((row) => `${row.type}:${row.id}:${row.period || ""}`).join("|");
          if (at === lastSentAt && key === lastSentKey) return;
          send(at, list);
        });
      }, 2000);
      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        clearInterval(poll);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", abort);
    },
  });
  return new Response(stream, { headers: liveSseHeaders() });
}
