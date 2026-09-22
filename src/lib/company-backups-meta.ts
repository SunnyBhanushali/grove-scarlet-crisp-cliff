import type { Snapshot } from "./company-books";

export const BACKUP_RETENTION_DAYS = 30;
export const BACKUP_TZ = "Asia/Kolkata";
/** Inclusive IST hours: 9am … 3am the next morning (skips 4am–8am). */
export const BACKUP_HOURLY_START = 9;
export const BACKUP_HOURLY_END = 3;

export type BackupKind = "daily" | "hourly" | "manual" | "undo";

export type BackupMeta = {
  id: string;
  kind: BackupKind;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  label: string;
  peopleCount: number;
  bytes: number;
  restoredAt: string | null;
  restoredBy: string;
  restoreOf: string;
};

export function istDay(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: BACKUP_TZ });
}

export function istHour(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BACKUP_TZ,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  return Number(parts.find((part) => part.type === "hour")?.value || "0");
}

/** `YYYY-MM-DD-HH` in India time — one auto copy per hour. */
export function istHourKey(at: Date = new Date()): string {
  return `${istDay(at)}-${String(istHour(at)).padStart(2, "0")}`;
}

export function inHourlyBackupWindow(at: Date = new Date()): boolean {
  const hour = istHour(at);
  return hour >= BACKUP_HOURLY_START || hour <= BACKUP_HOURLY_END;
}

export function hourlyBackupLabel(at: Date = new Date()): string {
  const when = at.toLocaleString("en-IN", {
    timeZone: BACKUP_TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `Hourly · ${when}`;
}

export function backupKindLabel(kind: string): string {
  if (kind === "hourly") return "Hourly";
  if (kind === "daily") return "Daily";
  if (kind === "undo") return "Before restore";
  if (kind === "manual") return "Saved";
  return "Copy";
}

export function wrapBackupDownload(snapshot: Snapshot, meta: BackupMeta) {
  return {
    format: "aliens-apms-backup",
    formatVersion: 1,
    persistKey: "aliens-apms-complete-v38",
    exportedAt: meta.createdAt,
    note: "Restore this file from Settings → Backup → Restore. Closed months stay as stored.",
    vault: {
      id: meta.id,
      kind: meta.kind,
      label: meta.label,
      restoredAt: meta.restoredAt,
    },
    state: snapshot,
  };
}
