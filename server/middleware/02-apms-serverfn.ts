/**
 * Recovered Aliens APMS client calls hashed TanStack server fns at /_serverFn/<id>.
 * This host does not ship the original handlers, so we implement load/save here.
 */
import {
  companyIsEmpty,
  getCompanyWire,
  saveCompanySnapshot,
  warmCompanyWire,
} from "../../src/lib/company-notebook";
import { ensureHourlyBackup, startBackupScheduler } from "../../src/lib/company-backups";
import { hasSessionToken, unauthorizedJson } from "../../src/lib/apms-request-auth";
import { handleScreenReadHttp } from "../../src/lib/company-screen-read";
import { handleOrgHttp } from "../../src/lib/company-org-read";
import { handleCompanyGetRequest } from "../../src/lib/company-wire-http";

const LOAD = "5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5";
const SAVE = "b4b4aa7e0ac816b4d5b83f44cd4fa14cbee181632dfc30d951bda1da6d06ecdb";
const EMPTY = "dcd7bc2b15da053b70f7c67cd9d467cf0304406295d5c072a5c9196f3829fc7f";
const BACKUP = "60f853214adae026db975d19017ab9139db7a66a375e06ff5dd7163c493826df";

startBackupScheduler();
warmCompanyWire();

interface Event {
  url: URL;
  req: Request & { method: string; headers: Headers };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function extractSnapshotJson(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return null;
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return extractSnapshotJson(JSON.parse(t));
      } catch {
        return t;
      }
    }
    return t;
  }
  if (typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.json === "string" && rec.json.trim().startsWith("{")) return rec.json;
  if (rec.data !== undefined) return extractSnapshotJson(rec.data);
  if (rec.payload !== undefined) return extractSnapshotJson(rec.payload);
  return null;
}

async function readPayload(event: Event): Promise<unknown> {
  const method = (event.req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    const raw = event.url.searchParams.get("payload");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(decodeURIComponent(raw));
      } catch {
        return null;
      }
    }
  }
  try {
    const text = await event.req.clone().text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default async function apmsServerFnMiddleware(
  event: Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  const org = await handleOrgHttp(event.req);
  if (org) return org;
  if ((event.req.method || "GET").toUpperCase() === "GET") {
    const screen = await handleScreenReadHttp(event.req);
    if (screen) return screen;
  }
  if (!path.startsWith("/_serverFn/")) return next();
  const id = path.slice("/_serverFn/".length).split("?")[0] || "";
  try {
    if (id === LOAD || id === SAVE || id === BACKUP) {
      if (!hasSessionToken(event.req.headers)) return unauthorizedJson();
    }
    if (id === LOAD) {
      void ensureHourlyBackup().catch((err) => console.error("[company-backups] hourly", err));
      return handleCompanyGetRequest(event.req);
    }
    if (id === SAVE) {
      const payload = await readPayload(event);
      const snapshot = extractSnapshotJson(payload);
      if (!snapshot) return json({ ok: false, error: "missing snapshot" });
      return json(await saveCompanySnapshot(snapshot));
    }
    if (id === EMPTY) {
      return json(await companyIsEmpty());
    }
    if (id === BACKUP) {
      const wire = await getCompanyWire();
      return json({ json: wire.snapshotJson, ok: true });
    }
    return json({ ok: true });
  } catch (err) {
    console.error("[apms-serverfn]", id, err);
    return json({
      snapshotJson: null,
      personId: null,
      resets: [],
      bootstrap: true,
      forbidden: false,
    });
  }
}
