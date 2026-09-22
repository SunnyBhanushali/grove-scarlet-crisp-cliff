/**
 * Monthly roster. People stay identity. Assignments are per period.
 * Past APMS / Rewards rows keyed by (personId, period) are never rewritten.
 * GET /api/company must NOT call overlayOrgPeople — overlay is a projection.
 */

import { claimWriteId, type HotSql } from "./company-hot-tables.ts";

export type RosterPeriodStatus = "draft" | "current" | "locked";
export type RosterLine = "solid" | "dotted";
export type RosterPersonStatus = "active" | "left" | "paused" | "joining";

export type RosterPeriodRow = {
  period: string;
  status: RosterPeriodStatus;
  lockedAt: string | null;
  lockedBy: string;
  copiedFrom: string;
  updatedAt: string | null;
  updatedBy: string;
  rev: number;
};

export type RosterAssignmentRow = {
  id: string;
  period: string;
  personId: string;
  sbuId: string;
  brandId: string;
  companyId: string;
  functionId: string;
  managerId: string;
  line: RosterLine;
  status: RosterPersonStatus;
  startDate: string;
  endDate: string;
  allocationPct: number;
  reason: string;
  payload: Record<string, unknown>;
  rev: number;
  updatedAt: string | null;
  updatedBy: string;
  deleted: boolean;
};

export type RosterPatchAssignment = {
  id?: string;
  personId?: string;
  sbuId?: string | null;
  brandId?: string | null;
  companyId?: string | null;
  functionId?: string | null;
  managerId?: string | null;
  line?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  allocationPct?: number | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  deleted?: boolean;
  rev?: number;
};

export type RosterGetBody = {
  ok: boolean;
  period: string;
  status: RosterPeriodStatus;
  rev: number;
  lockedAt: string | null;
  lockedBy: string;
  copiedFrom: string;
  rewardsLocked: boolean;
  assignments: RosterAssignmentRow[];
  missingPersonIds?: string[];
};

export type RosterWriteResult = {
  status: number;
  body: Record<string, unknown>;
};

export type OverlayPerson = {
  id: string;
  buId?: string | null;
  managerId?: string | null;
  functionId?: string | null;
  brandId?: string | null;
  companyId?: string | null;
  status?: string | null;
  rosterSet?: boolean;
  [key: string]: unknown;
};

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERSON_STATUSES = new Set(["active", "left", "paused", "joining"]);
const LINES = new Set(["solid", "dotted"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asPct(value: unknown, fallback = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function nullId(value: unknown): string | null {
  const s = asText(value);
  return s ? s : null;
}

export function isRosterPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD_RE.test(value);
}

export function currentRosterPeriod(now: Date | string = new Date()): string {
  const d = typeof now === "string" ? new Date(now) : now;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function periodBounds(period: string): { start: string; end: string } {
  const match = String(period).match(PERIOD_RE);
  if (!match) return { start: `${period}-01`, end: `${period}-28` };
  const y = Number(match[1]);
  const m = Number(match[2]);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(last).padStart(2, "0")}`,
  };
}

export function shiftPeriod(period: string, delta: number): string {
  const match = String(period).match(PERIOD_RE);
  if (!match) return period;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function seedAssignmentId(period: string, personId: string): string {
  return `ra-${period}-${personId}-solid`;
}

export function newAssignmentId(period: string, personId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ra-${period}-${personId}-${rand}`;
}

function normalizeStatus(value: unknown, fallback: RosterPersonStatus = "active"): RosterPersonStatus {
  const s = asText(value);
  return PERSON_STATUSES.has(s) ? (s as RosterPersonStatus) : fallback;
}

function normalizeLine(value: unknown): RosterLine {
  const s = asText(value) || "solid";
  return LINES.has(s) ? (s as RosterLine) : "solid";
}

function normalizePeriodStatus(value: unknown, fallback: RosterPeriodStatus = "draft"): RosterPeriodStatus {
  const s = asText(value);
  if (s === "draft" || s === "current" || s === "locked") return s;
  return fallback;
}

function mapPeriod(row: Record<string, unknown>): RosterPeriodRow {
  return {
    period: asText(row.period),
    status: normalizePeriodStatus(row.status),
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    lockedBy: asText(row.locked_by),
    copiedFrom: asText(row.copied_from),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: asText(row.updated_by),
    rev: asInt(row.rev, 1),
  };
}

function mapAssignment(row: Record<string, unknown>): RosterAssignmentRow {
  return {
    id: asText(row.id),
    period: asText(row.period),
    personId: asText(row.person_id),
    sbuId: asText(row.sbu_id),
    brandId: asText(row.brand_id),
    companyId: asText(row.company_id),
    functionId: asText(row.function_id),
    managerId: asText(row.manager_id),
    line: normalizeLine(row.line),
    status: normalizeStatus(row.status),
    startDate: asDate(row.start_date),
    endDate: asDate(row.end_date),
    allocationPct: asPct(row.allocation_pct, 100),
    reason: asText(row.reason),
    payload: asPayload(row.payload),
    rev: asInt(row.rev, 1),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: asText(row.updated_by),
    deleted: !!row.deleted_at,
  };
}

async function readPeriod(sql: HotSql, period: string): Promise<RosterPeriodRow | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select period, status, locked_at, locked_by, copied_from, updated_at, updated_by, rev
       from roster_periods where period = $1`,
    [period],
  );
  return rows[0] ? mapPeriod(rows[0]) : null;
}

async function readAssignments(sql: HotSql, period: string, includeDeleted = false): Promise<RosterAssignmentRow[]> {
  const rows = await sql.query<Record<string, unknown>>(
    includeDeleted
      ? `select * from roster_assignments where period = $1 order by person_id, line, id`
      : `select * from roster_assignments where period = $1 and deleted_at is null order by person_id, line, id`,
    [period],
  );
  return rows.map(mapAssignment);
}

async function upsertPeriod(
  sql: HotSql,
  period: string,
  fields: {
    status?: RosterPeriodStatus;
    lockedAt?: string | null;
    lockedBy?: string;
    copiedFrom?: string;
    updatedBy?: string;
    bump?: boolean;
  },
): Promise<RosterPeriodRow> {
  const existing = await readPeriod(sql, period);
  const status = fields.status || existing?.status || "draft";
  const lockedBy = fields.lockedBy ?? existing?.lockedBy ?? "";
  const copiedFrom = fields.copiedFrom ?? existing?.copiedFrom ?? "";
  const updatedBy = fields.updatedBy || "roster";
  if (!existing) {
    await sql.query(
      `insert into roster_periods (period, status, locked_at, locked_by, copied_from, updated_at, updated_by, rev)
       values ($1, $2, $3, $4, $5, now(), $6, 1)
       on conflict (period) do nothing`,
      [
        period,
        status,
        fields.lockedAt === undefined ? null : fields.lockedAt,
        lockedBy,
        copiedFrom,
        updatedBy,
      ],
    );
    return (await readPeriod(sql, period))!;
  }
  const bump = fields.bump !== false;
  await sql.query(
    `update roster_periods
        set status = $2,
            locked_at = $3,
            locked_by = $4,
            copied_from = $5,
            updated_at = now(),
            updated_by = $6,
            rev = case when $7 then rev + 1 else rev end
      where period = $1`,
    [
      period,
      status,
      fields.lockedAt === undefined ? existing.lockedAt : fields.lockedAt,
      lockedBy,
      copiedFrom,
      updatedBy,
      bump,
    ],
  );
  return (await readPeriod(sql, period))!;
}

export async function rewardsMonthLocked(sql: HotSql, period: string): Promise<boolean> {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n
       from reward_records
      where period = $1
        and deleted_at is null
        and coalesce(payload->>'status','') in ('plan_locked','locked','closed')`,
    [period],
  );
  return asInt(rows[0]?.n) > 0;
}

function monthsAround(current: string, extra: string[] = []): string[] {
  const set = new Set<string>();
  if (isRosterPeriod(current)) {
    set.add(current);
    set.add(shiftPeriod(current, -1));
    set.add(shiftPeriod(current, -2));
    set.add(shiftPeriod(current, -3));
  }
  for (const m of extra) if (isRosterPeriod(m)) set.add(m);
  return [...set].sort();
}

async function loadPeoplePayloads(sql: HotSql): Promise<Array<Record<string, unknown>>> {
  const rows = await sql.query<{ payload: unknown }>(
    `select payload from people where deleted_at is null`,
  );
  return rows.map((r) => asPayload(r.payload)).filter((p) => asText(p.id));
}

async function loadKnownMonths(sql: HotSql): Promise<string[]> {
  const rows = await sql.query<{ period: string }>(
    `select distinct period from month_records
     union
     select distinct period from reward_records
     union
     select period from roster_periods`,
  );
  return rows.map((r) => r.period).filter(isRosterPeriod);
}

/**
 * Idempotent. Creates period rows for current + last 3 + known months.
 * Copies live people team fields into the current period when it has no live assignments.
 * Never touches people / month_records / reward_records / target_cells.
 */
export async function ensureRosterSeeded(
  sql: HotSql,
  opts: { now?: Date | string; updatedBy?: string; months?: string[] } = {},
): Promise<{ period: string; seeded: number; periods: number }> {
  const current = currentRosterPeriod(opts.now);
  const known = opts.months?.length ? opts.months : await loadKnownMonths(sql);
  const periods = monthsAround(current, known);
  const updatedBy = opts.updatedBy || "roster-seed";

  for (const period of periods) {
    const existing = await readPeriod(sql, period);
    if (existing) continue;
    const status: RosterPeriodStatus = period === current ? "current" : "draft";
    await sql.query(
      `insert into roster_periods (period, status, locked_at, locked_by, copied_from, updated_at, updated_by, rev)
       values ($1, $2, null, '', '', now(), $3, 1)
       on conflict (period) do nothing`,
      [period, status, updatedBy],
    );
  }

  const currentRow = await readPeriod(sql, current);
  if (currentRow && currentRow.status !== "locked" && currentRow.status !== "current") {
    await sql.query(
      `update roster_periods set status = 'current', updated_at = now(), updated_by = $2
        where period = $1 and status <> 'locked'`,
      [current, updatedBy],
    );
  }
  await sql.query(
    `update roster_periods
        set status = 'draft', updated_at = now()
      where period <> $1 and status = 'current'`,
    [current],
  );

  const live = await readAssignments(sql, current);
  if (live.length > 0) {
    return { period: current, seeded: 0, periods: periods.length };
  }

  const people = await loadPeoplePayloads(sql);
  const bounds = periodBounds(current);
  let seeded = 0;
  for (const person of people) {
    const personId = asText(person.id);
    if (!personId) continue;
    const status = normalizeStatus(person.status);
    if (status === "left") continue;
    const id = seedAssignmentId(current, personId);
    await sql.query(
      `insert into roster_assignments (
         id, period, person_id, sbu_id, brand_id, company_id, function_id, manager_id,
         line, status, start_date, end_date, allocation_pct, reason, payload,
         rev, updated_at, updated_by, deleted_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         'solid', $9, $10::date, $11::date, 100, '', '{}'::jsonb,
         1, now(), $12, null
       )
       on conflict (id) do nothing`,
      [
        id,
        current,
        personId,
        nullId(person.buId),
        nullId(person.brandId),
        nullId(person.companyId),
        nullId(person.functionId),
        nullId(person.managerId),
        status,
        bounds.start,
        bounds.end,
        updatedBy,
      ],
    );
    seeded += 1;
  }
  return { period: current, seeded, periods: periods.length };
}

export async function getRoster(
  sql: HotSql,
  period: string,
  opts: { now?: Date | string; seed?: boolean } = {},
): Promise<RosterGetBody> {
  if (opts.seed !== false) await ensureRosterSeeded(sql, { now: opts.now });
  let row = await readPeriod(sql, period);
  if (!row) {
    await upsertPeriod(sql, period, {
      status: period === currentRosterPeriod(opts.now) ? "current" : "draft",
      bump: false,
      updatedBy: "roster-get",
    });
    row = (await readPeriod(sql, period))!;
  }
  const assignments = await readAssignments(sql, period);
  const rewardsLocked = await rewardsMonthLocked(sql, period);
  return {
    ok: true,
    period,
    status: row.status,
    rev: row.rev,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    copiedFrom: row.copiedFrom,
    rewardsLocked,
    assignments,
  };
}

async function loadSolidByPerson(
  sql: HotSql,
  period: string,
): Promise<Map<string, RosterAssignmentRow>> {
  const live = await readAssignments(sql, period);
  const map = new Map<string, RosterAssignmentRow>();
  for (const row of live) {
    if (row.line !== "solid") continue;
    if (!map.has(row.personId)) map.set(row.personId, row);
  }
  return map;
}

async function writeAssignment(
  sql: HotSql,
  row: {
    id: string;
    period: string;
    personId: string;
    sbuId: string | null;
    brandId: string | null;
    companyId: string | null;
    functionId: string | null;
    managerId: string | null;
    line: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    allocationPct: number;
    reason: string;
    payload: Record<string, unknown>;
    rev: number;
    deleted: boolean;
    updatedBy: string;
  },
) {
  const deletedSql = row.deleted ? "now()" : "null";
  await sql.query(
    `insert into roster_assignments (
       id, period, person_id, sbu_id, brand_id, company_id, function_id, manager_id,
       line, status, start_date, end_date, allocation_pct, reason, payload,
       rev, updated_at, updated_by, deleted_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11::date, $12::date, $13, $14, $15::jsonb,
       $16, now(), $17, ${deletedSql}
     )
     on conflict (id) do update set
       period = excluded.period,
       person_id = excluded.person_id,
       sbu_id = excluded.sbu_id,
       brand_id = excluded.brand_id,
       company_id = excluded.company_id,
       function_id = excluded.function_id,
       manager_id = excluded.manager_id,
       line = excluded.line,
       status = excluded.status,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       allocation_pct = excluded.allocation_pct,
       reason = excluded.reason,
       payload = excluded.payload,
       rev = excluded.rev,
       updated_at = now(),
       updated_by = excluded.updated_by,
       deleted_at = ${deletedSql}`,
    [
      row.id,
      row.period,
      row.personId,
      row.sbuId,
      row.brandId,
      row.companyId,
      row.functionId,
      row.managerId,
      row.line,
      row.status,
      row.startDate,
      row.endDate,
      row.allocationPct,
      row.reason,
      JSON.stringify(row.payload || {}),
      row.rev,
      row.updatedBy,
    ],
  );
}

function getBodyFrom(
  period: RosterPeriodRow,
  assignments: RosterAssignmentRow[],
  rewardsLocked: boolean,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    period: period.period,
    status: period.status,
    rev: period.rev,
    lockedAt: period.lockedAt,
    lockedBy: period.lockedBy,
    copiedFrom: period.copiedFrom,
    rewardsLocked,
    assignments,
    ...extra,
  };
}

/**
 * OCC on roster_periods.rev. Missing assignment keys are not deletes.
 * Same clientOpId → no rev bump. Soft-delete only.
 */
export async function patchRoster(
  sql: HotSql,
  period: string,
  input: unknown,
  opts: { updatedBy?: string; now?: Date | string } = {},
): Promise<RosterWriteResult> {
  if (!isRosterPeriod(period)) {
    return { status: 400, body: { ok: false, error: "bad-period" } };
  }
  if (!isPlainObject(input)) {
    return { status: 400, body: { ok: false, error: "bad-body" } };
  }
  const baseRev = Number(input.baseRev);
  if (!Number.isFinite(baseRev) || baseRev < 0) {
    return { status: 400, body: { ok: false, error: "bad-rev" } };
  }
  const clientOpId =
    typeof input.clientOpId === "string" && input.clientOpId.trim()
      ? input.clientOpId.trim().slice(0, 200)
      : "";
  const updatedBy = opts.updatedBy || "roster";
  await ensureRosterSeeded(sql, { now: opts.now, updatedBy });

  let row = await readPeriod(sql, period);
  if (!row) {
    row = await upsertPeriod(sql, period, { status: "draft", bump: false, updatedBy });
  }

  if (clientOpId) {
    const fresh = await claimWriteId(
      sql,
      `roster:${period}:${clientOpId}`,
      { period, baseRev },
      updatedBy,
    );
    if (!fresh) {
      const assignments = await readAssignments(sql, period);
      const rewardsLocked = await rewardsMonthLocked(sql, period);
      return {
        status: 200,
        body: getBodyFrom(row, assignments, rewardsLocked, { replayed: true }),
      };
    }
  }

  if (row.rev !== baseRev) {
    const assignments = await readAssignments(sql, period);
    const rewardsLocked = await rewardsMonthLocked(sql, period);
    return {
      status: 409,
      body: {
        ...getBodyFrom(row, assignments, rewardsLocked),
        ok: false,
        error: "stale",
      },
    };
  }

  if (row.status === "locked") {
    const assignments = await readAssignments(sql, period);
    const rewardsLocked = await rewardsMonthLocked(sql, period);
    return {
      status: 409,
      body: {
        ...getBodyFrom(row, assignments, rewardsLocked),
        ok: false,
        error: "roster-locked",
      },
    };
  }

  const incoming = Array.isArray(input.assignments) ? input.assignments : [];
  const bounds = periodBounds(period);
  const byPerson = await loadSolidByPerson(sql, period);

  for (const raw of incoming) {
    if (!isPlainObject(raw)) continue;
    const patch = raw as RosterPatchAssignment;
    const personId = asText(patch.personId);
    const existing =
      (patch.id &&
        (await sql.query<Record<string, unknown>>(
          `select * from roster_assignments where id = $1`,
          [patch.id],
        ).then((rows) => (rows[0] ? mapAssignment(rows[0]) : null)))) ||
      (personId ? byPerson.get(personId) : undefined) ||
      null;

    if (patch.deleted === true) {
      if (!existing || existing.deleted) continue;
      await sql.query(
        `update roster_assignments
            set deleted_at = coalesce(deleted_at, now()),
                rev = rev + 1,
                updated_at = now(),
                updated_by = $2
          where id = $1 and deleted_at is null`,
        [existing.id, updatedBy],
      );
      continue;
    }

    const nextPerson = personId || existing?.personId || "";
    if (!nextPerson) continue;
    const id = existing?.id || asText(patch.id) || seedAssignmentId(period, nextPerson);
    const start = asDate(patch.startDate) || existing?.startDate || bounds.start;
    const end = asDate(patch.endDate) || existing?.endDate || bounds.end;
    await writeAssignment(sql, {
      id,
      period,
      personId: nextPerson,
      sbuId: patch.sbuId !== undefined ? nullId(patch.sbuId) : nullId(existing?.sbuId),
      brandId: patch.brandId !== undefined ? nullId(patch.brandId) : nullId(existing?.brandId),
      companyId: patch.companyId !== undefined ? nullId(patch.companyId) : nullId(existing?.companyId),
      functionId: patch.functionId !== undefined ? nullId(patch.functionId) : nullId(existing?.functionId),
      managerId: patch.managerId !== undefined ? nullId(patch.managerId) : nullId(existing?.managerId),
      line: normalizeLine(patch.line ?? existing?.line),
      status: normalizeStatus(patch.status ?? existing?.status),
      startDate: start || bounds.start,
      endDate: end || bounds.end,
      allocationPct: patch.allocationPct != null ? asPct(patch.allocationPct) : existing?.allocationPct ?? 100,
      reason: patch.reason !== undefined ? asText(patch.reason) : existing?.reason || "",
      payload: patch.payload && isPlainObject(patch.payload) ? patch.payload : existing?.payload || {},
      rev: (existing?.rev || 0) + 1,
      deleted: false,
      updatedBy,
    });
  }

  const nextStatus =
    typeof input.status === "string" && (input.status === "draft" || input.status === "current")
      ? (input.status as RosterPeriodStatus)
      : row.status;
  const next = await upsertPeriod(sql, period, {
    status: nextStatus,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    copiedFrom: row.copiedFrom,
    updatedBy,
    bump: true,
  });
  const assignments = await readAssignments(sql, period);
  const rewardsLocked = await rewardsMonthLocked(sql, period);
  return { status: 200, body: getBodyFrom(next, assignments, rewardsLocked) };
}

export async function lockRoster(
  sql: HotSql,
  period: string,
  opts: { updatedBy?: string } = {},
): Promise<RosterWriteResult> {
  if (!isRosterPeriod(period)) return { status: 400, body: { ok: false, error: "bad-period" } };
  const updatedBy = opts.updatedBy || "roster";
  let row = await readPeriod(sql, period);
  if (!row) row = await upsertPeriod(sql, period, { status: "draft", bump: false, updatedBy });
  if (row.status === "locked") {
    const assignments = await readAssignments(sql, period);
    const rewardsLocked = await rewardsMonthLocked(sql, period);
    return { status: 200, body: getBodyFrom(row, assignments, rewardsLocked) };
  }
  await upsertPeriod(sql, period, {
    status: "locked",
    lockedAt: new Date().toISOString(),
    lockedBy: updatedBy,
    copiedFrom: row.copiedFrom,
    updatedBy,
    bump: true,
  });
  await sql.query(
    `update roster_periods set locked_at = now() where period = $1`,
    [period],
  );
  const locked = (await readPeriod(sql, period))!;
  const assignments = await readAssignments(sql, period);
  const rewardsLocked = await rewardsMonthLocked(sql, period);
  return { status: 200, body: getBodyFrom(locked, assignments, rewardsLocked) };
}

export async function unlockRoster(
  sql: HotSql,
  period: string,
  opts: { updatedBy?: string; access?: string; now?: Date | string } = {},
): Promise<RosterWriteResult> {
  if (!isRosterPeriod(period)) return { status: 400, body: { ok: false, error: "bad-period" } };
  const updatedBy = opts.updatedBy || "roster";
  const access = asText(opts.access);
  const row = await readPeriod(sql, period);
  if (!row) return { status: 404, body: { ok: false, error: "missing" } };
  const rewardsLocked = await rewardsMonthLocked(sql, period);
  if (rewardsLocked && access !== "admin" && access !== "super_admin") {
    console.warn("[roster] unlock refused — Rewards locked for", period, "by", updatedBy, access);
    const assignments = await readAssignments(sql, period);
    return {
      status: 403,
      body: {
        ...getBodyFrom(row, assignments, rewardsLocked),
        ok: false,
        error: "rewards-locked",
      },
    };
  }
  if (rewardsLocked) {
    console.warn("[roster] admin unlock while Rewards locked", period, updatedBy);
  }
  const current = currentRosterPeriod(opts.now);
  const nextStatus: RosterPeriodStatus = period === current ? "current" : "draft";
  await sql.query(
    `update roster_periods
        set status = $2,
            locked_at = null,
            locked_by = '',
            updated_at = now(),
            updated_by = $3,
            rev = rev + 1
      where period = $1`,
    [period, nextStatus, updatedBy],
  );
  const next = (await readPeriod(sql, period))!;
  const assignments = await readAssignments(sql, period);
  return { status: 200, body: getBodyFrom(next, assignments, rewardsLocked) };
}

/**
 * Copy source assignments onto the target period. New assignment ids.
 * Never overwrite a locked period. Source is untouched.
 */
export async function copyRosterFrom(
  sql: HotSql,
  period: string,
  fromPeriod: string,
  opts: { updatedBy?: string; now?: Date | string } = {},
): Promise<RosterWriteResult> {
  if (!isRosterPeriod(period) || !isRosterPeriod(fromPeriod)) {
    return { status: 400, body: { ok: false, error: "bad-period" } };
  }
  if (period === fromPeriod) {
    return { status: 400, body: { ok: false, error: "same-period" } };
  }
  const updatedBy = opts.updatedBy || "roster";
  await ensureRosterSeeded(sql, { now: opts.now, updatedBy });
  const source = await readPeriod(sql, fromPeriod);
  if (!source) return { status: 404, body: { ok: false, error: "missing-source" } };
  const sourceRows = await readAssignments(sql, fromPeriod);
  let target = await readPeriod(sql, period);
  if (target?.status === "locked") {
    const assignments = await readAssignments(sql, period);
    const rewardsLocked = await rewardsMonthLocked(sql, period);
    return {
      status: 409,
      body: {
        ...getBodyFrom(target, assignments, rewardsLocked),
        ok: false,
        error: "roster-locked",
      },
    };
  }
  const current = currentRosterPeriod(opts.now);
  const status: RosterPeriodStatus = period === current ? "current" : "draft";
  if (!target) {
    target = await upsertPeriod(sql, period, { status, bump: false, updatedBy });
  }

  await sql.query(
    `update roster_assignments
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now(),
            updated_by = $2
      where period = $1 and deleted_at is null`,
    [period, updatedBy],
  );

  const bounds = periodBounds(period);
  for (const row of sourceRows) {
    await writeAssignment(sql, {
      id: newAssignmentId(period, row.personId),
      period,
      personId: row.personId,
      sbuId: nullId(row.sbuId),
      brandId: nullId(row.brandId),
      companyId: nullId(row.companyId),
      functionId: nullId(row.functionId),
      managerId: nullId(row.managerId),
      line: row.line,
      status: row.status,
      startDate: bounds.start,
      endDate: bounds.end,
      allocationPct: row.allocationPct,
      reason: row.reason,
      payload: row.payload,
      rev: 1,
      deleted: false,
      updatedBy,
    });
  }

  await sql.query(
    `update roster_periods
        set status = $2,
            copied_from = $3,
            updated_at = now(),
            updated_by = $4,
            rev = rev + 1
      where period = $1 and status <> 'locked'`,
    [period, status, fromPeriod, updatedBy],
  );
  const next = (await readPeriod(sql, period))!;
  const assignments = await readAssignments(sql, period);
  const rewardsLocked = await rewardsMonthLocked(sql, period);
  const sourceAfter = await readPeriod(sql, fromPeriod);
  return {
    status: 200,
    body: {
      ...getBodyFrom(next, assignments, rewardsLocked),
      fromPeriod,
      sourceRev: sourceAfter?.rev ?? source.rev,
      sourceStatus: sourceAfter?.status ?? source.status,
    },
  };
}

/**
 * Projection only. Does not mutate identity people on GET /api/company.
 * Missing roster row → keep existing person fields and mark rosterSet=false.
 */
export function overlayOrgPeople<T extends OverlayPerson>(
  people: T[] | null | undefined,
  assignments:
    | Array<
        Pick<
          RosterAssignmentRow,
          "personId" | "sbuId" | "brandId" | "companyId" | "functionId" | "managerId" | "status" | "line"
        >
      >
    | null
    | undefined,
): { people: Array<T & { rosterSet: boolean }>; missingIds: string[]; setCount: number } {
  type Assign = Pick<
    RosterAssignmentRow,
    "personId" | "sbuId" | "brandId" | "companyId" | "functionId" | "managerId" | "status" | "line"
  >;
  const byPerson = new Map<string, Assign>();
  for (const row of assignments || []) {
    if (!row || !row.personId) continue;
    if (row.line && row.line !== "solid") continue;
    if (!byPerson.has(row.personId)) byPerson.set(row.personId, row);
  }
  const missingIds: string[] = [];
  const out: Array<T & { rosterSet: boolean }> = [];
  for (const person of people || []) {
    if (!person?.id) continue;
    const a = byPerson.get(person.id);
    if (!a) {
      missingIds.push(person.id);
      out.push({ ...person, rosterSet: false });
      continue;
    }
    out.push({
      ...person,
      buId: a.sbuId ?? "",
      managerId: a.managerId ?? "",
      functionId: a.functionId ?? "",
      brandId: a.brandId ?? "",
      companyId: a.companyId ?? "",
      status: a.status || person.status,
      rosterSet: true,
    });
  }
  return { people: out, missingIds, setCount: byPerson.size };
}

export function overlayBanner(setCount: number, peopleCount: number): string | null {
  if (peopleCount < 1) return null;
  if (setCount < 1) return "Roster not set for this month.";
  return null;
}

export function isHrAccess(access: string | null | undefined): boolean {
  return access === "hr" || access === "admin" || access === "super_admin";
}

export function isAdminAccess(access: string | null | undefined): boolean {
  return access === "admin" || access === "super_admin";
}
