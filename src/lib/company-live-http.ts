import { hasSessionToken, unauthorizedJson } from "./apms-request-auth.ts";
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
  if (!hasSessionToken(request.headers)) return unauthorizedJson();
  await readLiveAt();
  let since = 0;
  try {
    since = Number(new URL(request.url).searchParams.get("since") || 0) || 0;
  } catch {
    since = 0;
  }
  const at = currentLiveAt();
  const entities = currentLiveEntities()
    .filter((row) => !since || Number(row.at) > since)
    .slice(-LIVE_ENTITY_CAP);
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
  if (!hasSessionToken(request.headers)) return unauthorizedJson();
  startEntityListen();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSentAt = 0;
      let lastSentKey = "";
      const send = (at: number, ents?: { type: string; id: string; period?: string; at?: number }[]) => {
        if (closed) return;
        try {
          const list = Array.isArray(ents) ? ents.slice(-LIVE_ENTITY_CAP) : currentLiveEntities();
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
