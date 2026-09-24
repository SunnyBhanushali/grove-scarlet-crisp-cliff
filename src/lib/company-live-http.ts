import { hasValidSession, sessionPersonId, unauthorizedJson } from "./apms-request-auth.ts";
import { filterChange, filterHints, loadViewer, viewKey, type Viewer } from "./apms-permissions.ts";
import {
  LIVE_ENTITY_CAP,
  currentEmittedEntities,
  currentFeedSeq,
  currentLiveAt,
  currentLiveEntities,
  currentLiveGens,
  encodeSse,
  liveSseHeaders,
  onFeedSeq,
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
      // PERF: the client skips its change-feed poll when its cursor is here.
      ...(currentFeedSeq() ? { seq: currentFeedSeq() } : {}),
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

/**
 * PERF (server p0aw5): the change feed is pushed down the live stream.
 *
 * Before, every save made every open tab send `GET /api/changes` (up to three
 * times): at 250 users that was ~800 requests a second, each paying the full
 * request pipeline for a few rows. Now, when the feed head moves, the rows are
 * read once (coalesced over ~30 ms), filtered per viewer (batch 3 rules, one
 * shared frame for everyone who sees everything) and written to each stream as
 * `{ …tick, since, seq, changes, push: 1 }`. A tab applies a frame that starts
 * at or before its cursor exactly like a poll answer; a gap (frame starts past
 * its cursor) or a missed frame falls back to the poll.
 */
type LiveStream = {
  viewer: Viewer | null;
  write: (chunk: string) => boolean;
};
const liveStreams = new Set<LiveStream>();
let pushSeq = 0;
let pushStarted = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushRunning = false;
let pushHookInstalled = false;
const PUSH_COALESCE_MS = 40;
const TICK_COALESCE_MS = 150;
const PUSH_PAGE = 500;

function installPushHook(): void {
  if (pushHookInstalled) return;
  pushHookInstalled = true;
  onFeedSeq(() => schedulePush());
}

function schedulePush(): void {
  if (pushTimer || !liveStreams.size) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushChanges();
  }, PUSH_COALESCE_MS);
  (pushTimer as unknown as { unref?: () => void }).unref?.();
}

async function pushChanges(): Promise<void> {
  if (pushRunning) {
    schedulePush();
    return;
  }
  pushRunning = true;
  try {
    const { getSql } = await import("./db");
    const { changesSince, latestSeq } = await import("./company-entity-store.ts");
    const sql = (await getSql()) as unknown as Parameters<typeof changesSince>[0];
    if (!pushStarted) {
      // First push of this process: start at the head; earlier rows come from polls.
      pushSeq = await latestSeq(sql);
      pushStarted = true;
      return;
    }
    for (let guard = 0; guard < 20 && liveStreams.size; guard++) {
      const since = pushSeq;
      if (currentFeedSeq() && currentFeedSeq() <= since) break;
      const changes = await changesSince(sql, since, PUSH_PAGE, { withPayload: true });
      if (!changes.length) break;
      const seq = changes[changes.length - 1].seq;
      const at = currentLiveAt();
      const gens = currentLiveGens();
      let fullFrame: string | null = null;
      for (const st of liveStreams) {
        const v = st.viewer;
        if (!v) continue;
        let frame: string;
        if (viewKey(v) === "full") {
          fullFrame ??= encodeSse(at, gens, [], { push: 1, since, seq, changes });
          frame = fullFrame;
        } else {
          const seen = changes.map((c) => filterChange(v, c)).filter((c) => c !== null);
          frame = encodeSse(at, gens, [], { push: 1, since, seq, changes: seen });
        }
        st.write(frame);
      }
      pushSeq = seq;
      if (changes.length < PUSH_PAGE) break;
    }
  } catch (err) {
    console.error("[company-live] change push failed; clients poll", err);
  } finally {
    pushRunning = false;
  }
}

export async function handleCompanyLiveRequest(request: Request): Promise<Response> {
  if (!(await hasValidSession(request.headers))) return unauthorizedJson();
  startEntityListen();
  const pid = await sessionPersonId(request.headers);
  let viewer: Viewer | null = pid ? await loadViewer(pid) : null;
  const encoder = new TextEncoder();
  installPushHook();
  if (!pushStarted) void pushChanges();
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
          // `push: 1`: this stream will carry the feed rows; do not poll for them.
          controller.enqueue(encoder.encode(encodeSse(at, currentLiveGens(), list, { push: 1 })));
        } catch {
          closed = true;
        }
      };
      const stream: LiveStream = {
        viewer,
        write: (chunk) => {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            closed = true;
            return false;
          }
        },
      };
      liveStreams.add(stream);
      send(currentLiveAt(), currentLiveEntities());
      void readLiveAt().then((at) => {
        send(at || currentLiveAt(), currentLiveEntities());
      });
      // PERF: one save moves `at` up to three times within ~100 ms (commit,
      // LISTEN, book mirror); one frame per stream for the burst (the feed rows
      // themselves come in the push frame).
      let tickTimer: ReturnType<typeof setTimeout> | null = null;
      let tickEnts: { type: string; id: string; period?: string; at?: number }[] = [];
      const unsub = subscribeCompanyLive(() => {
        const ents = currentEmittedEntities();
        for (const e of ents) tickEnts.push(e);
        if (tickTimer) return;
        tickTimer = setTimeout(() => {
          tickTimer = null;
          const list = tickEnts.length ? tickEnts.slice(-LIVE_ENTITY_CAP) : currentLiveEntities();
          tickEnts = [];
          send(currentLiveAt(), list);
        }, TICK_COALESCE_MS);
      });
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
        if (pid) void loadViewer(pid).then((v) => (viewer = stream.viewer = v)).catch(() => undefined);
        // PERF / BATCH-3: an ended session (password reset / change, sign-out
        // elsewhere) is told on its stream within ~2 s — the tab no longer
        // learns it from a 2.5 s tick — and the stream closes.
        void sessionPersonId(request.headers).then((still) => {
          if (closed || still) return;
          stream.write(`data: ${JSON.stringify({ sessionEnded: 1 })}\n\n`);
          abort();
        });
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
        if (tickTimer) clearTimeout(tickTimer);
        unsub();
        liveStreams.delete(stream);
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
