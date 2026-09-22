#!/usr/bin/env node
/**
 * Serves the Aliens APMS SPA on 0.0.0.0:8080 for the Grok live preview,
 * plus a preview-only login (sunny.b / 0000) and company snapshot.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../recovered-site", import.meta.url)));
const BACKUP = resolve(
  fileURLToPath(new URL("../artifacts/aliens-apms-backup-merged-2026-09-19.json", import.meta.url)),
);
const PORT = 8080;
const HOST = "0.0.0.0";
const SESSION = "apms-preview-sunny";
const COOKIE = "better-auth.session_token";
const PERSON_ID = "p-admin";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

const USER = {
  id: PERSON_ID,
  name: "Sunny",
  email: "sunny.b@aliens.local",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  username: "sunny.b",
  displayUsername: "sunny.b",
};

let snapshot = { people: [{ id: PERSON_ID, name: "Sunny", username: "sunny.b", email: USER.email, access: "super_admin" }] };
let bookGens = { org: 1, plans: 1, months: 1, targets: 1 };
let notebookUpdatedAt = Date.now();
try {
  const backup = JSON.parse(readFileSync(BACKUP, "utf8"));
  if (backup && backup.state && Array.isArray(backup.state.people)) {
    snapshot = backup.state;
    if (snapshot.bookGens && typeof snapshot.bookGens === "object") {
      bookGens = snapshot.bookGens;
    }
    notebookUpdatedAt = Number(snapshot.notebookUpdatedAt) || Date.now();
  }
} catch (err) {
  console.error("[preview] backup load failed, using stub snapshot", err);
}

const companyBody = JSON.stringify({
  ok: true,
  personId: PERSON_ID,
  notebookUpdatedAt,
  bookGens,
  entities: [],
  resets: [],
  bootstrap: false,
  forbidden: false,
  snapshotJson: JSON.stringify(snapshot),
});

function safeFile(urlPath) {
  const clean = decodeURIComponent((urlPath || "/").split("?")[0].split("#")[0]);
  const rel = clean.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) return join(ROOT, "index.html");
  const candidate = resolve(ROOT, rel);
  const relToRoot = relative(ROOT, candidate);
  if (relToRoot.startsWith("..") || normalize(relToRoot).startsWith("..")) {
    return join(ROOT, "index.html");
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const idx = join(candidate, "index.html");
    if (existsSync(idx)) return idx;
  }
  if (!rel.startsWith("assets/") && !rel.startsWith("api/") && !rel.startsWith("__grok") && !rel.startsWith("_serverFn")) {
    return join(ROOT, "index.html");
  }
  return null;
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        resolveBody({});
      }
    });
    req.on("error", () => resolveBody({}));
  });
}

function hasSession(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/Bearer\s+(.+)/i)?.[1]?.trim() || "";
  if (bearer === SESSION || bearer.startsWith("apms-login.")) return true;
  const cookie = String(req.headers.cookie || "");
  return (
    cookie.includes(`${COOKIE}=${SESSION}`) ||
    cookie.includes("apms-preview-sunny") ||
    cookie.includes(`apms-login.${PERSON_ID}`)
  );
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function sessionCookie() {
  return `${COOKIE}=${SESSION}; Path=/; HttpOnly; SameSite=Lax`;
}

function isSunnyLogin(username, email, password) {
  const u = String(username || email || "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  const p = String(password || "");
  const names = new Set(["sunny.b", "sunn.b", "sunny.bhan", "sunny"]);
  return names.has(u) && p === "0000";
}

function userPayload() {
  return {
    ...USER,
    createdAt: USER.createdAt.toISOString(),
    updatedAt: USER.updatedAt.toISOString(),
  };
}

function sessionPayload() {
  const now = new Date();
  const exp = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return {
    session: {
      id: "preview-session",
      userId: PERSON_ID,
      token: SESSION,
      expiresAt: exp.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ipAddress: "127.0.0.1",
      userAgent: "preview",
    },
    user: userPayload(),
  };
}

async function handleApi(req, res, path) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    });
    res.end();
    return true;
  }

  if (path === "/api/provision-logins" && method === "POST") {
    await readBody(req);
    json(res, 200, { ok: true, added: 1, failed: [], sent: 0 });
    return true;
  }

  if (path === "/api/password-reset" && method === "POST") {
    await readBody(req);
    json(res, 200, {
      ok: true,
      needHr: true,
      message: "Contact HR to reset this password.",
    });
    return true;
  }

  if (path.startsWith("/api/auth/sign-in/") && method === "POST") {
    const body = await readBody(req);
    const username = body.username || body.email || "";
    const password = body.password || "";
    if (!isSunnyLogin(username, body.email, password)) {
      json(res, 401, { message: "Invalid username or password", code: "INVALID_EMAIL_OR_PASSWORD" });
      return true;
    }
    json(
      res,
      200,
      {
        redirect: false,
        token: SESSION,
        user: userPayload(),
      },
      {
        "set-cookie": sessionCookie(),
        "set-auth-token": SESSION,
      },
    );
    return true;
  }

  if (path === "/api/auth/sign-out" && (method === "POST" || method === "GET")) {
    json(res, 200, { success: true }, { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0` });
    return true;
  }

  if (path === "/api/auth/get-session" && (method === "GET" || method === "POST")) {
    if (!hasSession(req)) {
      json(res, 200, null);
      return true;
    }
    json(res, 200, sessionPayload());
    return true;
  }

  if (path.startsWith("/api/auth/")) {
    if (!hasSession(req)) {
      json(res, 401, { message: "Unauthorized" });
      return true;
    }
    json(res, 200, { ok: true, user: userPayload() });
    return true;
  }

  if (path === "/api/company" && method === "GET") {
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-apms-person-id": PERSON_ID,
      etag: `"apms-${notebookUpdatedAt}"`,
    });
    res.end(companyBody);
    return true;
  }

  if (path === "/api/company" && method === "POST") {
    json(res, 410, {
      ok: false,
      error: "gone",
      message: "Full snapshot POST is disabled. Use PATCH /api/company with baseGens.",
    });
    return true;
  }

  if (path === "/api/company" && method === "PATCH") {
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    json(res, 200, { ok: true, applied: [], conflict: [], skipped: ["org", "plans", "months", "targets"], bookGens });
    return true;
  }

  if (path === "/api/company-tick" && method === "GET") {
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    json(res, 200, { at: notebookUpdatedAt, bookGens, entities: [] });
    return true;
  }

  if (path === "/api/company-live" && method === "GET") {
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ at: notebookUpdatedAt, bookGens, entities: [] })}\n\n`);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 15000);
    req.on("close", () => clearInterval(ping));
    return true;
  }

  if (path.startsWith("/api/") && method === "GET") {
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (path.startsWith("/api/")) {
    await readBody(req);
    if (!hasSession(req)) {
      json(res, 401, { ok: false, error: "Sign in required." });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const path = decodeURIComponent(url.split("?")[0]);
  try {
    if (path.startsWith("/api/") || path.startsWith("/_serverFn/")) {
      const handled = await handleApi(req, res, path.startsWith("/_serverFn/") ? "/api/company" : path);
      if (handled) return;
    }
  } catch (err) {
    console.error("[preview api]", err);
    if (!res.headersSent) json(res, 500, { ok: false });
    return;
  }

  const file = safeFile(url);
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`APMS preview listening on http://${HOST}:${PORT}/`);
});
