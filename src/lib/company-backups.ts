import { getSql } from "./db";
import {
  extractSnapshot,
  readAuthoritativeSnapshot,
  replaceCompanySnapshot,
} from "./company-notebook";
import { peopleCount, type Snapshot } from "./company-books";
import {
  BACKUP_RETENTION_DAYS,
  BACKUP_TZ,
  hourlyBackupLabel,
  inHourlyBackupWindow,
  istDay,
  istHourKey,
  type BackupKind,
  type BackupMeta,
} from "./company-backups-meta";

export {
  BACKUP_RETENTION_DAYS,
  BACKUP_TZ,
  backupKindLabel,
  hourlyBackupLabel,
  inHourlyBackupWindow,
  istDay,
  istHour,
  istHourKey,
  wrapBackupDownload,
  type BackupKind,
  type BackupMeta,
} from "./company-backups-meta";

export type BackupRow = BackupMeta & { snapshotJson: string };

type SqlBackup = {
  id: string;
  kind: string;
  created_at: string | Date;
  expires_at: string | Date;
  created_by: string;
  label: string;
  people_count: number | string;
  bytes: number | string;
  snapshot_json?: string;
  restored_at: string | Date | null;
  restored_by: string;
  restore_of: string;
};

let tableReady = false;
let hourlyLock: Promise<{ ok: true; skipped?: string; item?: BackupMeta }> | null = null;
let schedulerStarted = false;

function iso(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function asInt(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function newId(): string {
  return `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toMeta(row: SqlBackup): BackupMeta {
  return {
    id: row.id,
    kind: (row.kind as BackupKind) || "manual",
    createdAt: iso(row.created_at) || new Date().toISOString(),
    expiresAt: iso(row.expires_at) || new Date().toISOString(),
    createdBy: row.created_by || "",
    label: row.label || "",
    peopleCount: asInt(row.people_count),
    bytes: asInt(row.bytes),
    restoredAt: iso(row.restored_at),
    restoredBy: row.restored_by || "",
    restoreOf: row.restore_of || "",
  };
}

async function ensureTable() {
  if (tableReady) return;
  const sql = await getSql();
  await sql.query(`
    create table if not exists company_backups (
      id             text primary key,
      kind           text not null,
      created_at     timestamptz not null default now(),
      expires_at     timestamptz not null,
      created_by     text not null default '',
      label          text not null default '',
      people_count   integer not null default 0,
      bytes          integer not null default 0,
      snapshot_json  text not null,
      restored_at    timestamptz,
      restored_by    text not null default '',
      restore_of     text not null default ''
    )
  `);
  await sql.query(
    `create index if not exists company_backups_created on company_backups (created_at desc)`,
  );
  tableReady = true;
}

export async function pruneExpiredBackups(): Promise<number> {
  await ensureTable();
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from company_backups where expires_at < now() returning id`,
  );
  return rows.length;
}

async function insertBackup(input: {
  kind: BackupKind;
  snapshot: Snapshot;
  createdBy?: string;
  label?: string;
  restoreOf?: string;
}): Promise<BackupMeta> {
  await ensureTable();
  const json = JSON.stringify(input.snapshot);
  const id = newId();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const sql = await getSql();
  const rows = await sql.query<SqlBackup>(
    `insert into company_backups (
        id, kind, created_at, expires_at, created_by, label,
        people_count, bytes, snapshot_json, restore_of
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning id, kind, created_at, expires_at, created_by, label,
                people_count, bytes, restored_at, restored_by, restore_of`,
    [
      id,
      input.kind,
      createdAt.toISOString(),
      expiresAt.toISOString(),
      input.createdBy || "",
      input.label || "",
      peopleCount(input.snapshot),
      Buffer.byteLength(json, "utf8"),
      json,
      input.restoreOf || "",
    ],
  );
  return toMeta(rows[0]);
}

export async function listBackups(): Promise<BackupMeta[]> {
  await ensureTable();
  await pruneExpiredBackups().catch(() => 0);
  const sql = await getSql();
  const rows = await sql.query<SqlBackup>(
    `select id, kind, created_at, expires_at, created_by, label,
            people_count, bytes, restored_at, restored_by, restore_of
       from company_backups
      order by created_at desc`,
  );
  return rows.map(toMeta);
}

export async function getBackup(id: string): Promise<BackupRow | null> {
  await ensureTable();
  const sql = await getSql();
  const rows = await sql.query<SqlBackup>(
    `select id, kind, created_at, expires_at, created_by, label,
            people_count, bytes, snapshot_json, restored_at, restored_by, restore_of
       from company_backups where id = $1 limit 1`,
    [id],
  );
  const row = rows[0];
  if (!row || typeof row.snapshot_json !== "string") return null;
  return { ...toMeta(row), snapshotJson: row.snapshot_json };
}

export async function saveManualBackup(opts?: {
  json?: string;
  createdBy?: string;
  label?: string;
}): Promise<BackupMeta> {
  const live = await readAuthoritativeSnapshot();
  const incoming = opts?.json ? extractSnapshot(opts.json) : null;
  const snapshot = incoming && peopleCount(incoming) > 0 ? incoming : live;
  if (!snapshot || peopleCount(snapshot) < 1) {
    throw new Error("Nothing to save — the company notebook is empty.");
  }
  const item = await insertBackup({
    kind: "manual",
    snapshot,
    createdBy: opts?.createdBy,
    label: opts?.label || "Saved now",
  });
  await pruneExpiredBackups().catch(() => 0);
  return item;
}

export async function ensureHourlyBackup(at: Date = new Date()): Promise<{
  ok: true;
  skipped?: string;
  item?: BackupMeta;
}> {
  if (hourlyLock) return hourlyLock;
  hourlyLock = (async () => {
    if (!inHourlyBackupWindow(at)) return { ok: true as const, skipped: "window" };
    const live = await readAuthoritativeSnapshot();
    if (!live || peopleCount(live) < 1) return { ok: true as const, skipped: "empty" };
    const key = istHourKey(at);
    const recent = await listBackups();
    const have = recent.find(
      (row) =>
        (row.kind === "hourly" || row.kind === "daily") &&
        istHourKey(new Date(row.createdAt)) === key,
    );
    if (have) return { ok: true as const, skipped: "have", item: have };
    const item = await insertBackup({
      kind: "hourly",
      snapshot: live,
      createdBy: "hourly",
      label: hourlyBackupLabel(at),
    });
    await pruneExpiredBackups().catch(() => 0);
    return { ok: true as const, item };
  })().finally(() => {
    hourlyLock = null;
  });
  return hourlyLock;
}

/** Alias for the old daily cron URL — same hourly window. */
export async function ensureDailyBackup(): Promise<{
  ok: true;
  skipped?: string;
  item?: BackupMeta;
}> {
  return ensureHourlyBackup();
}

export function startBackupScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = () => {
    void ensureHourlyBackup().catch((err) => console.error("[company-backups] hourly", err));
  };
  tick();
  const timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
}

export async function restoreBackup(
  id: string,
  opts?: { createdBy?: string },
): Promise<{ ok: true; item: BackupMeta; undo: BackupMeta | null; snapshot: Snapshot }> {
  const target = await getBackup(id);
  if (!target) throw new Error("That copy is not on the server any more.");
  const snapshot = extractSnapshot(target.snapshotJson);
  if (!snapshot) throw new Error("That copy could not be read.");
  const live = await readAuthoritativeSnapshot();
  let undo: BackupMeta | null = null;
  if (live && peopleCount(live) > 0) {
    undo = await insertBackup({
      kind: "undo",
      snapshot: live,
      createdBy: opts?.createdBy,
      restoreOf: id,
      label: `Before restore of ${new Date(target.createdAt).toLocaleString("en-IN", {
        timeZone: BACKUP_TZ,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    });
  }
  await replaceCompanySnapshot(JSON.stringify(snapshot));
  const sql = await getSql();
  await sql.query(
    `update company_backups
        set restored_at = now(), restored_by = $2
      where id = $1`,
    [id, opts?.createdBy || ""],
  );
  await pruneExpiredBackups().catch(() => 0);
  const item = { ...toMeta({ ...(target as unknown as SqlBackup), restored_at: new Date(), restored_by: opts?.createdBy || "" }), restoredAt: new Date().toISOString(), restoredBy: opts?.createdBy || "" };
  return { ok: true, item, undo, snapshot };
}
