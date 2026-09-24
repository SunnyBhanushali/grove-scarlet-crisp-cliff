import {
  BACKUP_RETENTION_DAYS,
  wrapBackupDownload,
  type BackupMeta,
} from "./company-backups-meta";
import {
  ensureHourlyBackup,
  getBackup,
  listBackups,
  restoreBackup,
  saveManualBackup,
  startBackupScheduler,
} from "./company-backups";
import { extractSnapshot } from "./company-notebook";
import { hasValidSession, isLoopbackRequest, unauthorizedJson } from "./apms-request-auth";

startBackupScheduler();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.json();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function filenameFor(item: BackupMeta) {
  const day = item.createdAt.slice(0, 10) || "copy";
  const kind =
    item.kind === "hourly"
      ? "hourly"
      : item.kind === "daily"
        ? "daily"
        : item.kind === "undo"
          ? "before-restore"
          : "saved";
  return `aliens-apms-backup-${day}-${kind}.json`;
}

function isCronQuery(url: URL): boolean {
  return url.searchParams.get("daily") === "1" || url.searchParams.get("hourly") === "1";
}

export async function handleCompanyBackupsRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const cron = isCronQuery(url);
  if (!((await hasValidSession(request.headers)) || (cron && isLoopbackRequest(request)))) {
    return unauthorizedJson();
  }
  if (!(cron && isLoopbackRequest(request))) {
    // BATCH-2: backups are whole-company copies (download / save / restore) — admins only.
    const { requireAdmin } = await import("./apms-admin-auth");
    const gate = await requireAdmin(request.headers);
    if (gate.response) return gate.response;
  }
  try {
    if (method === "GET" || method === "HEAD") {
      if (cron) {
        const hourly = await ensureHourlyBackup();
        return json({ ok: true, daily: hourly, hourly, retentionDays: BACKUP_RETENTION_DAYS });
      }
      const id = url.searchParams.get("id") || "";
      if (id) {
        const row = await getBackup(id);
        if (!row) return json({ ok: false, error: "That copy is not on the server any more." }, 404);
        const snapshot = extractSnapshot(row.snapshotJson);
        if (!snapshot) return json({ ok: false, error: "That copy could not be read." }, 500);
        return json({
          ok: true,
          item: row,
          snapshot,
          filename: filenameFor(row),
          file: wrapBackupDownload(snapshot, row),
        });
      }
      const hourly = await ensureHourlyBackup();
      const items = await listBackups();
      return json({
        ok: true,
        items,
        retentionDays: BACKUP_RETENTION_DAYS,
        daily: hourly.skipped ? hourly.skipped : "saved",
        hourly: hourly.skipped ? hourly.skipped : "saved",
      });
    }
    if (method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    const body = await readBody(request);
    const action = String(body.action || url.searchParams.get("action") || "");
    if (action === "daily" || action === "hourly") {
      const hourly = await ensureHourlyBackup();
      return json({ ok: true, daily: hourly, hourly });
    }
    if (action === "save") {
      const item = await saveManualBackup({
        json: typeof body.json === "string" ? body.json : undefined,
        createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
        label: typeof body.label === "string" ? body.label : undefined,
      });
      return json({ ok: true, item });
    }
    if (action === "restore") {
      const id = String(body.id || "");
      if (!id) return json({ ok: false, error: "Pick a copy to restore." }, 400);
      const result = await restoreBackup(id, {
        createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
      });
      return json({
        ok: true,
        item: result.item,
        undo: result.undo,
        snapshot: result.snapshot,
      });
    }
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[company-backups]", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Backup failed" },
      500,
    );
  }
}
