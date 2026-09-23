import { EventEmitter } from "node:events";
import type { BookGens } from "./company-books";
import { patchCompanyWireEntity, softInvalidateCompanyWire } from "./company-wire-cache.ts";

const TICK_ID = "live-tick";
const bus = new EventEmitter();
bus.setMaxListeners(250);

/** Tick/SSE never replay more than this many entity ids. */
export const LIVE_ENTITY_CAP = 20;

export type LiveEntityHint = {
  type: string;
  id: string;
  period?: string;
  at?: number;
};

let lastAt = 0;
let lastGens: BookGens | null = null;
let lastEntities: LiveEntityHint[] = [];
let lastEmitted: LiveEntityHint[] = [];

function entityKey(hint: LiveEntityHint): string {
  return `${hint.type}:${hint.id}:${hint.period || ""}`;
}

export function resetLiveForTests(): void {
  lastAt = 0;
  lastGens = null;
  lastEntities = [];
  lastEmitted = [];
}

export function hydrateLiveFromTickRow(parsed: {
  at?: unknown;
  bookGens?: BookGens | null;
  entities?: LiveEntityHint[];
}): void {
  const at = Number(parsed.at) || 0;
  if (at < lastAt) return;
  if (at > lastAt) lastAt = at;
  if (parsed.bookGens && typeof parsed.bookGens === "object") lastGens = parsed.bookGens;
  if (Array.isArray(parsed.entities) && parsed.entities.length) {
    for (const row of parsed.entities) {
      if (!row || !row.type || !row.id) continue;
      const next: LiveEntityHint = row.period
        ? { type: String(row.type), id: String(row.id), period: String(row.period), at: Number(row.at) || at }
        : { type: String(row.type), id: String(row.id), at: Number(row.at) || at };
      const key = entityKey(next);
      lastEntities = lastEntities.filter((item) => entityKey(item) !== key);
      lastEntities.push(next);
    }
    if (lastEntities.length > LIVE_ENTITY_CAP) lastEntities = lastEntities.slice(-LIVE_ENTITY_CAP);
  }
}

export function pushLiveEntities(hints: LiveEntityHint[], at?: number): LiveEntityHint[] {
  const stampAt = Number(at) || lastAt || Date.now();
  const stamped: LiveEntityHint[] = [];
  for (const hint of hints) {
    if (!hint || !hint.type || !hint.id) continue;
    const next: LiveEntityHint = hint.period
      ? { type: String(hint.type), id: String(hint.id), period: String(hint.period), at: stampAt }
      : { type: String(hint.type), id: String(hint.id), at: stampAt };
    const key = entityKey(next);
    lastEntities = lastEntities.filter((row) => entityKey(row) !== key);
    stamped.push(next);
    lastEntities.push(next);
  }
  if (lastEntities.length > LIVE_ENTITY_CAP) lastEntities = lastEntities.slice(-LIVE_ENTITY_CAP);
  return stamped.length ? stamped : lastEntities.slice();
}

export function currentLiveEntities(): LiveEntityHint[] {
  return lastEntities.slice();
}

/** Ids newer than the caller's seen `at`, newest last, hard cap. */
export function entitiesSince(since: number, cap = LIVE_ENTITY_CAP): LiveEntityHint[] {
  const s = Number(since) || 0;
  const newer = lastEntities.filter((row) => Number(row.at) > s);
  return newer.slice(-Math.max(0, cap));
}

export function encodeSse(
  at: number,
  gens?: BookGens | null,
  entities?: LiveEntityHint[] | null,
): string {
  const payload: Record<string, unknown> = gens ? { at, bookGens: gens } : { at };
  payload.entities = Array.isArray(entities) ? entities : [];
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function liveSseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

export function currentLiveAt(): number {
  return lastAt;
}

export function currentLiveGens(): BookGens | null {
  return lastGens;
}

export function currentEmittedEntities(): LiveEntityHint[] {
  return lastEmitted.slice();
}

/** In-process fan-out. PM2 workers also persist a tick row so pollers on other processes catch up. */
export function emitCompanyLive(
  at: number,
  gens?: BookGens | null,
  entities?: LiveEntityHint[] | null,
): number {
  const next = Math.max(lastAt + 1, Number(at) || Date.now());
  lastAt = next;
  if (gens) lastGens = gens;
  lastEmitted = (Array.isArray(entities) ? entities : [])
    .filter((row) => row && row.type && row.id)
    .map((row) =>
      row.period
        ? { type: String(row.type), id: String(row.id), period: String(row.period), at: next }
        : { type: String(row.type), id: String(row.id), at: next },
    )
    .slice(-LIVE_ENTITY_CAP);
  for (const row of lastEmitted) {
    const key = entityKey(row);
    lastEntities = lastEntities.filter((item) => entityKey(item) !== key);
    lastEntities.push(row);
  }
  if (lastEntities.length > LIVE_ENTITY_CAP) lastEntities = lastEntities.slice(-LIVE_ENTITY_CAP);
  bus.emit("tick", { at: lastAt, entities: lastEmitted.slice() });
  return lastAt;
}

export function subscribeCompanyLive(fn: (at: number) => void): () => void {
  const wrapped = (payload: number | { at?: number }) => {
    const at = typeof payload === "number" ? payload : Number(payload && payload.at) || lastAt;
    fn(at);
  };
  bus.on("tick", wrapped);
  return () => {
    bus.off("tick", wrapped);
  };
}

async function getSqlLazy() {
  const { getSql } = await import("./db");
  return getSql();
}

async function writeTick(at: number): Promise<void> {
  const sql = await getSqlLazy();
  await sql`
    insert into company_notebook (id, snapshot_json, updated_at)
    values (${TICK_ID}, ${JSON.stringify({ at, bookGens: lastGens, entities: lastEntities.slice(-LIVE_ENTITY_CAP) })}, now())
    on conflict (id) do update
      set snapshot_json = excluded.snapshot_json,
          updated_at = now()
  `;
}

/** Persist in-memory tick so another PM2 worker's readLiveAt sees entities[]. */
export async function persistLiveTick(): Promise<boolean> {
  if (!lastAt) return false;
  try {
    await writeTick(lastAt);
    return true;
  } catch (err) {
    console.error("[company-live] persistLiveTick failed", err);
    return false;
  }
}

export async function readLiveAt(): Promise<number> {
  try {
    const sql = await getSqlLazy();
    const rows = await sql<{ snapshot_json: string }>`
      select snapshot_json from company_notebook where id = ${TICK_ID} limit 1
    `;
    const raw = rows[0]?.snapshot_json;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        at?: unknown;
        bookGens?: BookGens;
        entities?: LiveEntityHint[];
      };
      hydrateLiveFromTickRow(parsed);
    }
  } catch {
    /* db not ready — in-memory tick is enough for this process */
  }
  return lastAt;
}

export async function notifyCompanyLive(
  at: number,
  gens?: BookGens | null,
  entities?: LiveEntityHint[] | null,
): Promise<number> {
  const writeAt = Number(at) || Date.now();
  // Stamp hints with the emitted live `at` (lastAt+1), not raw Date.now().
  // Wire cache patch-in-place also uses Date.now(); if hint.at <= B's lastWireAt
  // the tick returns empty entities[] and B pullLive's the company file (pulls++ / entityGets=0).
  const liveAt = Math.max(lastAt + 1, writeAt);
  const stamped =
    entities && entities.length ? pushLiveEntities(entities, liveAt) : [];
  const next = emitCompanyLive(writeAt, gens, stamped);
  try {
    await writeTick(next);
  } catch (err) {
    console.error("[company-live] tick write failed", err);
  }
  return next;
}

function emptyGens(): BookGens {
  return { org: 0, plans: 0, months: 0, targets: 0 };
}

export function liveTypeFromTable(table: string): string {
  if (table === "people") return "people";
  if (table === "reward_records" || table === "reward-records") return "reward-records";
  if (table === "month_records" || table === "month-records") return "month-records";
  if (table === "target_cells" || table === "target-cells") return "target-cells";
  return String(table || "").replace(/_/g, "-");
}

export function bookForEntityTable(table: string): keyof BookGens {
  if (table === "people") return "org";
  if (table === "target_cells" || table === "target-cells") return "targets";
  return "months";
}

export function hintFromEntityTable(
  table: string,
  ids: { id?: string; personId?: string; period?: string },
): LiveEntityHint {
  const type = liveTypeFromTable(table);
  const id = String(ids.personId || ids.id || "");
  if (type === "people" || type === "target-cells") {
    return { type, id };
  }
  return {
    type,
    id,
    period: ids.period ? String(ids.period) : undefined,
  };
}

/** After an entity row commits: bump SSE/tick gens. Patch or soft-invalidate GET wire (SWR). */
export async function publishEntityWrite(
  table: string,
  hint?: LiveEntityHint | null,
  rec?: { payload?: Record<string, unknown> | null; deleted?: boolean } | null,
): Promise<BookGens> {
  const book = bookForEntityTable(table);
  const prev = currentLiveGens() || emptyGens();
  const gens: BookGens = {
    org: Number(prev.org) || 0,
    plans: Number(prev.plans) || 0,
    months: Number(prev.months) || 0,
    targets: Number(prev.targets) || 0,
  };
  gens[book] = (Number(gens[book]) || 0) + 1;
  const entities = hint && hint.id ? [hint] : [];
  await notifyCompanyLive(Date.now(), gens, entities);
  try {
    const patched = patchCompanyWireEntity(table, hint, rec);
    if (!patched) softInvalidateCompanyWire();
  } catch (err) {
    console.error("[company-live] wire update after entity write failed", err);
  }
  return gens;
}

/**
 * Row commits `pg_notify('apms_entities')` (ROWS-V2). The SSE stream of this
 * process only heard commits handled by this same module copy / worker; the
 * rest arrived through the 2 s tick-row poll. Listening to the notify pushes a
 * live tick to this process's SSE clients right away; they then read the
 * change feed. One connection per process, reconnects on error. No-op without
 * a Postgres DATABASE_URL (PGlite preview has no LISTEN).
 */
let entityListenStarted = false;
export function startEntityListen(): void {
  if (entityListenStarted) return;
  entityListenStarted = true;
  const url = typeof process !== "undefined" ? String(process.env.DATABASE_URL || "").trim() : "";
  if (!url) return;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const onNotify = () => {
    // Coalesce the burst of rows one save commits into one tick.
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      emitCompanyLive(Date.now(), lastGens, []);
    }, 60);
  };
  const connect = async (): Promise<void> => {
    try {
      const pg = (await import("pg")).default;
      const client = new pg.Client({ connectionString: url });
      let retried = false;
      const retry = () => {
        if (retried) return;
        retried = true;
        client.end().catch(() => {});
        setTimeout(() => void connect(), 2000);
      };
      client.on("error", retry);
      client.on("end", retry);
      client.on("notification", (msg: { channel: string }) => {
        if (msg.channel === "apms_entities") onNotify();
      });
      await client.connect();
      await client.query("LISTEN apms_entities");
    } catch (err) {
      console.error("[company-live] LISTEN apms_entities failed; retrying", err);
      setTimeout(() => void connect(), 5000);
    }
  };
  void connect();
}
