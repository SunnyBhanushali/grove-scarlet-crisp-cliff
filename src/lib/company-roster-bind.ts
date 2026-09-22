/**
 * Roster lock. Rewards month, APMS month, and award instance store rosterId.
 * Reads use that roster's assignments only.
 * Super-admin edits of Current Org do not switch the pointer.
 * Rebind is an explicit admin action with audit — never implicit.
 */

import { claimWriteId, type HotSql } from "./company-hot-tables.ts";
import {
  getRoster,
  isAdminAccess,
  isRosterPeriod,
  overlayOrgPeople,
  type OverlayPerson,
  type RosterAssignmentRow,
  type RosterGetBody,
} from "./company-roster.ts";

export const ROSTER_BIND_KINDS = ["rewards", "apms", "award"] as const;
export type RosterBindKind = (typeof ROSTER_BIND_KINDS)[number];

export type RosterBindRow = {
  kind: RosterBindKind;
  subjectId: string;
  rosterId: string;
  boundAt: string | null;
  boundBy: string;
  rev: number;
  updatedAt: string | null;
  updatedBy: string;
  deleted: boolean;
};

export type RosterBindAuditRow = {
  id: string;
  kind: RosterBindKind;
  subjectId: string;
  fromRosterId: string;
  toRosterId: string;
  reason: string;
  by: string;
  at: string | null;
  clientOpId: string;
};

export type RosterBindGetBody = RosterGetBody & {
  kind: RosterBindKind;
  subjectId: string;
  rosterId: string;
  bound: boolean;
  initial?: boolean;
  audit: RosterBindAuditRow[];
};

export type RosterBindWriteResult = {
  status: number;
  body: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function isRosterBindKind(value: unknown): value is RosterBindKind {
  return value === "rewards" || value === "apms" || value === "award";
}

export function parseRosterBindPath(pathname: string): {
  kind: string;
  subjectId: string;
  action: "get" | "rebind";
} | null {
  const path = pathname.replace(/\/+$/, "") || pathname;
  const rebind = path.match(/^\/api\/roster-bind\/([^/]+)\/([^/]+)\/rebind$/);
  if (rebind) {
    return { kind: decodePart(rebind[1]), subjectId: decodePart(rebind[2]), action: "rebind" };
  }
  const get = path.match(/^\/api\/roster-bind\/([^/]+)\/([^/]+)$/);
  if (get) return { kind: decodePart(get[1]), subjectId: decodePart(get[2]), action: "get" };
  return null;
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Pointer for a subject. Unbound months default to THEIR period, never current Org.
 * Awards default to the instance period passed in (award.period), never current Org.
 */
export function defaultRosterId(opts: {
  kind: RosterBindKind;
  subjectId: string;
  awardPeriod?: string | null;
  currentOrgPeriod?: string | null;
}): string {
  if (opts.kind === "award") {
    const period = asText(opts.awardPeriod);
    return isRosterPeriod(period) ? period : "";
  }
  const subject = asText(opts.subjectId);
  return isRosterPeriod(subject) ? subject : "";
}

function mapBind(row: Record<string, unknown>): RosterBindRow {
  const kind = isRosterBindKind(row.kind) ? row.kind : "rewards";
  return {
    kind,
    subjectId: asText(row.subject_id),
    rosterId: asText(row.roster_id),
    boundAt: row.bound_at ? String(row.bound_at) : null,
    boundBy: asText(row.bound_by),
    rev: asInt(row.rev, 1),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: asText(row.updated_by),
    deleted: !!row.deleted_at,
  };
}

function mapAudit(row: Record<string, unknown>): RosterBindAuditRow {
  const kind = isRosterBindKind(row.kind) ? row.kind : "rewards";
  return {
    id: asText(row.id),
    kind,
    subjectId: asText(row.subject_id),
    fromRosterId: asText(row.from_roster_id),
    toRosterId: asText(row.to_roster_id),
    reason: asText(row.reason),
    by: asText(row.by),
    at: row.at ? String(row.at) : null,
    clientOpId: asText(row.client_op_id),
  };
}

export async function readRosterBind(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
): Promise<RosterBindRow | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select kind, subject_id, roster_id, bound_at, bound_by, rev, updated_at, updated_by, deleted_at
       from roster_binds
      where kind = $1 and subject_id = $2 and deleted_at is null`,
    [kind, subjectId],
  );
  return rows[0] ? mapBind(rows[0]) : null;
}

export async function listRosterBindAudit(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  limit = 20,
): Promise<RosterBindAuditRow[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select id, kind, subject_id, from_roster_id, to_roster_id, reason, by, at, client_op_id
       from roster_bind_audit
      where kind = $1 and subject_id = $2
      order by at desc
      limit $3`,
    [kind, subjectId, limit],
  );
  return rows.map(mapAudit);
}

function newAuditId(kind: string, subjectId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `rba-${kind}-${subjectId}-${Date.now().toString(36)}-${rand}`.slice(0, 120);
}

async function writeAudit(
  sql: HotSql,
  row: {
    kind: RosterBindKind;
    subjectId: string;
    fromRosterId: string;
    toRosterId: string;
    reason: string;
    by: string;
    clientOpId?: string;
  },
) {
  await sql.query(
    `insert into roster_bind_audit (
       id, kind, subject_id, from_roster_id, to_roster_id, reason, by, at, client_op_id, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8, '{}'::jsonb)`,
    [
      newAuditId(row.kind, row.subjectId),
      row.kind,
      row.subjectId,
      row.fromRosterId,
      row.toRosterId,
      row.reason,
      row.by,
      row.clientOpId || "",
    ],
  );
}

/**
 * First bind only. Existing pointer is never moved here — that is rebind().
 * Missing key / later Org edits do not call this with a new rosterId.
 */
export async function ensureRosterBound(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  rosterId: string,
  opts: { updatedBy?: string } = {},
): Promise<{ bind: RosterBindRow; initial: boolean }> {
  const existing = await readRosterBind(sql, kind, subjectId);
  if (existing) return { bind: existing, initial: false };
  const by = opts.updatedBy || "roster-bind";
  await sql.query(
    `insert into roster_binds (
       kind, subject_id, roster_id, bound_at, bound_by, rev, payload, updated_at, updated_by, deleted_at
     ) values ($1, $2, $3, now(), $4, 1, '{"source":"initial-bind"}'::jsonb, now(), $4, null)
     on conflict (kind, subject_id) do nothing`,
    [kind, subjectId, rosterId, by],
  );
  const after = await readRosterBind(sql, kind, subjectId);
  if (!after) {
    throw new Error("roster-bind-insert-failed");
  }
  if (after.boundBy === by && after.rosterId === rosterId && after.rev === 1) {
    await writeAudit(sql, {
      kind,
      subjectId,
      fromRosterId: "",
      toRosterId: rosterId,
      reason: "initial-bind",
      by,
    });
    return { bind: after, initial: true };
  }
  return { bind: after, initial: false };
}

export async function seedMonthBinds(
  sql: HotSql,
  opts: { updatedBy?: string } = {},
): Promise<{ seeded: number }> {
  const rows = await sql.query<{ period: string }>(
    `select distinct period from reward_records where deleted_at is null
     union
     select distinct period from month_records where deleted_at is null`,
  );
  let seeded = 0;
  const by = opts.updatedBy || "roster-bind-seed";
  for (const row of rows) {
    if (!isRosterPeriod(row.period)) continue;
    const rewards = await ensureRosterBound(sql, "rewards", row.period, row.period, { updatedBy: by });
    if (rewards.initial) seeded += 1;
    const apms = await ensureRosterBound(sql, "apms", row.period, row.period, { updatedBy: by });
    if (apms.initial) seeded += 1;
  }
  return { seeded };
}

function awardPeriodFromSnapshot(snapshot: unknown, awardId: string): string {
  if (!isPlainObject(snapshot)) return "";
  const list = snapshot.awardInstances;
  const rows = Array.isArray(list) ? list : isPlainObject(list) ? Object.values(list) : [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    if (asText(row.id) !== awardId) continue;
    const period = asText(row.period) || asText(row.periodStart);
    return isRosterPeriod(period) ? period : "";
  }
  return "";
}

export async function awardPeriodFromBooks(sql: HotSql, awardId: string): Promise<string> {
  try {
    const rows = await sql.query<{ snapshot_json: string }>(
      `select snapshot_json from company_books where book = 'plans'`,
    );
    if (!rows[0]?.snapshot_json) return "";
    const parsed = JSON.parse(rows[0].snapshot_json);
    return awardPeriodFromSnapshot(parsed, awardId);
  } catch {
    return "";
  }
}

/**
 * Resolve the stored pointer. Unbound → default (subject period / award period).
 * Never falls back to current Org.
 */
export async function rosterIdForSubject(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  opts: { awardPeriod?: string | null; currentOrgPeriod?: string | null } = {},
): Promise<{ rosterId: string; bound: boolean }> {
  const bind = await readRosterBind(sql, kind, subjectId);
  if (bind?.rosterId) return { rosterId: bind.rosterId, bound: true };
  const rosterId = defaultRosterId({
    kind,
    subjectId,
    awardPeriod: opts.awardPeriod,
    currentOrgPeriod: opts.currentOrgPeriod,
  });
  return { rosterId, bound: false };
}

export async function getRosterBind(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  opts: {
    now?: Date | string;
    updatedBy?: string;
    awardPeriod?: string | null;
    persistInitial?: boolean;
  } = {},
): Promise<RosterBindWriteResult> {
  if (!isRosterBindKind(kind)) {
    return { status: 400, body: { ok: false, error: "bad-kind" } };
  }
  const id = asText(subjectId);
  if (!id) return { status: 400, body: { ok: false, error: "bad-subject" } };

  let awardPeriod = asText(opts.awardPeriod);
  if (kind === "award" && !isRosterPeriod(awardPeriod)) {
    awardPeriod = await awardPeriodFromBooks(sql, id);
  }
  const fallback = defaultRosterId({
    kind,
    subjectId: id,
    awardPeriod,
  });
  if (!fallback) {
    return { status: 400, body: { ok: false, error: "no-default-roster" } };
  }

  const persist = opts.persistInitial !== false;
  let bind = await readRosterBind(sql, kind, id);
  let initial = false;
  if (!bind && persist) {
    const ensured = await ensureRosterBound(sql, kind, id, fallback, {
      updatedBy: opts.updatedBy || "roster-bind",
    });
    bind = ensured.bind;
    initial = ensured.initial;
  }
  const rosterId = bind?.rosterId || fallback;
  const roster = await getRoster(sql, rosterId, { now: opts.now });
  const audit = await listRosterBindAudit(sql, kind, id, 10);
  const body: RosterBindGetBody = {
    ...roster,
    kind,
    subjectId: id,
    rosterId,
    bound: !!bind,
    initial,
    audit,
  };
  return { status: 200, body };
}

/**
 * Explicit admin rebind. Never called from people PATCH, Org edit, or implicit lock.
 * Same clientOpId → 200, rev unchanged.
 */
export async function rebindRoster(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  input: unknown,
  opts: { updatedBy?: string; access?: string; now?: Date | string } = {},
): Promise<RosterBindWriteResult> {
  if (!isAdminAccess(opts.access)) {
    return { status: 403, body: { ok: false, error: "admin-only" } };
  }
  if (!isRosterBindKind(kind)) {
    return { status: 400, body: { ok: false, error: "bad-kind" } };
  }
  const id = asText(subjectId);
  if (!id) return { status: 400, body: { ok: false, error: "bad-subject" } };
  if (!isPlainObject(input)) {
    return { status: 400, body: { ok: false, error: "bad-body" } };
  }
  const toRosterId = asText(input.rosterId);
  if (!isRosterPeriod(toRosterId)) {
    return { status: 400, body: { ok: false, error: "bad-roster" } };
  }
  const reason = asText(input.reason);
  if (!reason) {
    return { status: 400, body: { ok: false, error: "reason-required" } };
  }
  const clientOpId =
    typeof input.clientOpId === "string" && input.clientOpId.trim()
      ? input.clientOpId.trim().slice(0, 200)
      : "";
  const updatedBy = opts.updatedBy || "admin";

  if (clientOpId) {
    const fresh = await claimWriteId(
      sql,
      `roster-bind:${kind}:${id}:${clientOpId}`,
      { toRosterId, reason },
      updatedBy,
    );
    if (!fresh) {
      const current = await getRosterBind(sql, kind, id, {
        now: opts.now,
        updatedBy,
        persistInitial: true,
      });
      return { status: 200, body: { ...current.body, replayed: true } };
    }
  }

  let existing = await readRosterBind(sql, kind, id);
  if (!existing) {
    const fallback = defaultRosterId({ kind, subjectId: id, awardPeriod: asText(input.awardPeriod) });
    const seedId = fallback || toRosterId;
    const ensured = await ensureRosterBound(sql, kind, id, seedId, { updatedBy });
    existing = ensured.bind;
  }

  if (existing.rosterId === toRosterId) {
    const current = await getRosterBind(sql, kind, id, { now: opts.now, persistInitial: false });
    return { status: 200, body: { ...current.body, unchanged: true } };
  }

  const fromRosterId = existing.rosterId;
  await sql.query(
    `update roster_binds
        set roster_id = $3,
            rev = rev + 1,
            payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('source', 'rebind', 'reason', $4::text),
            updated_at = now(),
            updated_by = $5
      where kind = $1 and subject_id = $2 and deleted_at is null`,
    [kind, id, toRosterId, reason.slice(0, 500), updatedBy],
  );
  await writeAudit(sql, {
    kind,
    subjectId: id,
    fromRosterId,
    toRosterId,
    reason: reason.slice(0, 500),
    by: updatedBy,
    clientOpId,
  });

  const current = await getRosterBind(sql, kind, id, { now: opts.now, persistInitial: false });
  return {
    status: 200,
    body: {
      ...current.body,
      fromRosterId,
      rebound: true,
    },
  };
}

/** Overlay people using the bound roster, not current Org. */
export async function overlayBoundPeople<T extends OverlayPerson>(
  sql: HotSql,
  kind: RosterBindKind,
  subjectId: string,
  people: T[],
  opts: { awardPeriod?: string | null; now?: Date | string } = {},
): Promise<{
  people: Array<T & { rosterSet: boolean }>;
  rosterId: string;
  bound: boolean;
  assignments: RosterAssignmentRow[];
}> {
  const got = await getRosterBind(sql, kind, subjectId, {
    now: opts.now,
    awardPeriod: opts.awardPeriod,
    persistInitial: true,
  });
  const rosterId = asText(got.body.rosterId);
  const assignments = Array.isArray(got.body.assignments)
    ? (got.body.assignments as RosterAssignmentRow[])
    : [];
  const overlay = overlayOrgPeople(people, assignments);
  return {
    people: overlay.people,
    rosterId,
    bound: !!got.body.bound,
    assignments,
  };
}
