import { existsSync, readFileSync, statSync, mkdirSync, copyFileSync, readdirSync, createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "recovered-site");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const SESSION_COOKIE = "better-auth.session_token";
const TOKEN_SUNNY = "apms-preview-sunny";
const TOKEN_PREFIX = "apms-login.";

const LOAD = "5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5";
const SAVE = "b4b4aa7e0ac816b4d5b83f44cd4fa14cbee181632dfc30d951bda1da6d06ecdb";
const EMPTY = "dcd7bc2b15da053b70f7c67cd9d467cf0304406295d5c072a5c9196f3829fc7f";
const BACKUP = "60f853214adae026db975d19017ab9139db7a66a375e06ff5dd7163c493826df";

const PREVIEW_BRIDGE = `<script>
(function(){
  if (window.parent === window) return;
  var CH="grok-preview-bridge", VER=1;
  function announce(target){
    var origin = target || "*";
    function post(type, extra){
      try { window.parent.postMessage(Object.assign({channel:CH, version:VER, type:type}, extra || {}), origin); } catch (e) {}
    }
    post("location", {path: location.pathname || "/", search: location.search, hash: location.hash});
    post("routes", {paths:["/","/apms.html"]});
    post("ready");
  }
  window.addEventListener("message", function(ev){
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || d.channel !== CH) return;
    if (d.type === "hello") announce(ev.origin || "*");
  });
  announce("*");
  setTimeout(function(){ announce("*"); }, 0);
  setTimeout(function(){ announce("*"); }, 250);
})();
</script>`;

function grokAppId() {
  return (
    String(process.env.VITE_PROJECT_ID || process.env.GROK_PROJECT_ID || "").trim() ||
    "01a0af52-dcd2-7a13-aa64-de51478b64bd"
  );
}

function injectHtmlExtras(html) {
  let next = String(html || "");
  const id = grokAppId();
  if (id && !next.includes('name="grok-project-id"')) {
    next = next.replace("<head>", `<head>\n<meta name="grok-project-id" content="${id}"/>`);
  }
  if (!next.includes("/assets/apms-sync.js")) {
    const tag = `<script src="/assets/apms-sync.js?v=p0as5"></script>`;
    next = next.includes("</head>") ? next.replace("</head>", `${tag}</head>`) : tag + next;
  }
  if (!next.includes("grok-preview-bridge")) {
    next = next.includes("</head>")
      ? next.replace("</head>", `${PREVIEW_BRIDGE}</head>`)
      : PREVIEW_BRIDGE + next;
  }
  return next;
}



function skip(url) {
  return (
    url.startsWith("/@") ||
    url.startsWith("/src/") ||
    url.startsWith("/node_modules") ||
    url.startsWith("/__vite") ||
    url.startsWith("/__app-env") ||
    url.startsWith("/__grok") ||
    url.startsWith("/__grok-preview") ||
    url.startsWith("/auth/")
  );
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(json);
}

function tokenFor(personId) {
  if (personId === "p-admin") return TOKEN_SUNNY;
  return `${TOKEN_PREFIX}${personId}`;
}

function personIdFromToken(token) {
  if (!token) return null;
  if (token === TOKEN_SUNNY) return "p-admin";
  if (token.startsWith(TOKEN_PREFIX)) return token.slice(TOKEN_PREFIX.length) || null;
  return null;
}

function readToken(req) {
  const cookie = String(req.headers.cookie || "");
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/Bearer\s+(.+)/i)?.[1]?.trim();
  if (bearer) return bearer;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function sessionPayload(person, cred) {
  const user = cred.sessionUser(person);
  const token = tokenFor(person.id);
  return {
    session: {
      id: `sess-${person.id}`,
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    },
    user,
    token,
    redirect: false,
  };
}

function isSignedIn(req) {
  return Boolean(personIdFromToken(readToken(req)));
}

function isLoopbackReq(req) {
  const host = String(req.headers.host || "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function sendUnauthorized(res) {
  sendJson(res, 401, { ok: false, error: "Sign in required." });
}

function sessionCookie(token, https) {
  const base = token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=2592000`
    : `${SESSION_COOKIE}=; Path=/; Max-Age=0`;
  return https ? `${base}; SameSite=None; Secure` : `${base}; SameSite=Lax`;
}

function requestIsHttps(req) {
  const xf = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (xf.includes("https")) return true;
  if (req.socket && req.socket.encrypted) return true;
  const host = String(req.headers.host || "");
  return host.includes("alienstattoo.in");
}

async function loadPeople(server) {
  const nb = await server.ssrLoadModule("/src/lib/company-notebook.ts");
  const issuedMod = await server.ssrLoadModule("/src/lib/issued-logins.ts");
  const loaded = await nb.loadCompanySnapshot();
  const snap = loaded.snapshotJson ? JSON.parse(loaded.snapshotJson) : null;
  const people = Array.isArray(snap?.people) ? snap.people : [];
  const snapshotLogins =
    snap?.logins && typeof snap.logins === "object" && !Array.isArray(snap.logins)
      ? snap.logins
      : {};
  const issued = await issuedMod.loadIssuedLogins();
  return { people, logins: issuedMod.mergeLogins(snapshotLogins, issued) };
}

async function handleAuth(req, res, url, server) {
  const method = (req.method || "GET").toUpperCase();
  const cred = await server.ssrLoadModule("/src/lib/apms-credentials.ts");
  if (url.endsWith("/get-session") && (method === "GET" || method === "POST")) {
    const id = personIdFromToken(readToken(req));
    if (!id) {
      sendJson(res, 200, null);
      return;
    }
    const { people } = await loadPeople(server);
    const person =
      id === "p-admin"
        ? people.find((p) => p.id === "p-admin" || p.username === "sunny.b") || cred.SUNNY
        : people.find((p) => p.id === id);
    if (!person) {
      sendJson(res, 200, null);
      return;
    }
    sendJson(res, 200, sessionPayload(person, cred));
    return;
  }
  if (url.endsWith("/sign-in/username") || url.endsWith("/sign-in/email")) {
    const body = await readBody(req);
    const user = String(body.username || body.email || "");
    const pass = String(body.password || "");
    const { people, logins } = await loadPeople(server);
    const person = cred.verifyLogin(people, logins, user, pass);
    if (!person) {
      sendJson(res, 401, { message: "Invalid username or password" });
      return;
    }
    const payload = sessionPayload(person, cred);
    sendJson(res, 200, payload, {
      "set-cookie": sessionCookie(payload.token, requestIsHttps(req)),
      "set-auth-token": payload.token,
    });
    return;
  }
  if (url.endsWith("/sign-out")) {
    sendJson(res, 200, { success: true }, {
      "set-cookie": sessionCookie(null, requestIsHttps(req)),
    });
    return;
  }
  sendJson(res, 404, { message: "Not found" });
}

async function handleIssued(req, res, server) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    sendJson(res, 200, { ok: true, added: 0, sent: 0, failed: [] });
    return;
  }
  if (method !== "POST") {
    sendJson(res, 405, { message: "Method Not Allowed", sent: 0, failed: [] });
    return;
  }
  try {
    const body = await readBody(req);
    const inner = body?.data && typeof body.data === "object" ? body.data : body;
    const rows = Array.isArray(inner?.rows)
      ? inner.rows
      : inner?.username || inner?.password
        ? [inner]
        : [];
    const issuedMod = await server.ssrLoadModule("/src/lib/issued-logins.ts");
    const added = await issuedMod.upsertIssuedLogins(rows);
    sendJson(res, 200, { ok: true, added, sent: 0, failed: [] });
  } catch (err) {
    console.error("[issued-logins]", err);
    sendJson(res, 200, {
      ok: false,
      added: 0,
      sent: 0,
      failed: [{ reason: err instanceof Error ? err.message : "failed" }],
    });
  }
}

function extractSnapshotJson(input) {
  if (input == null) return null;
  if (typeof input !== "object" && typeof input !== "string") return null;
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
  if (typeof input.json === "string" && input.json.trim().startsWith("{")) return input.json;
  if (input.state && typeof input.state === "object" && !Array.isArray(input.state)) {
    return JSON.stringify(input.state);
  }
  if (input.data !== undefined) return extractSnapshotJson(input.data);
  if (input.payload !== undefined) return extractSnapshotJson(input.payload);
  if (Array.isArray(input.people) && input.roles && typeof input.roles === "object") {
    return JSON.stringify(input);
  }
  return null;
}

function isCompanyAuthed(req) {
  const token = readToken(req);
  if (personIdFromToken(token)) return true;
  return Boolean(token && String(token).length > 8);
}

async function handleCompanyTick(req, res, server) {
  if (!isCompanyAuthed(req)) {
    sendUnauthorized(res);
    return;
  }
  try {
    const live = await server.ssrLoadModule("/src/lib/company-live.ts");
    const at = await live.readLiveAt();
    sendJson(res, 200, { at }, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[api/company-tick]", err);
    sendJson(res, 200, { at: 0 }, { "cache-control": "no-store" });
  }
}

async function handleCompanyLive(req, res, server) {
  if (!isCompanyAuthed(req)) {
    sendUnauthorized(res);
    return;
  }
  try {
    const live = await server.ssrLoadModule("/src/lib/company-live.ts");
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store, no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    const send = (at) => {
      try {
        res.write(live.encodeSse(at, live.currentLiveGens()));
      } catch {
        /* closed */
      }
    };
    const at = await live.readLiveAt();
    if (at) send(at);
    const unsub = live.subscribeCompanyLive(send);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* closed */
      }
    }, 15000);
    const close = () => {
      clearInterval(ping);
      unsub();
    };
    req.on("close", close);
    req.on("aborted", close);
  } catch (err) {
    console.error("[api/company-live]", err);
    if (!res.headersSent) sendUnauthorized(res);
  }
}

async function handleCompany(req, res, server, next) {
  const method = (req.method || "GET").toUpperCase();
  const token = readToken(req);
  const personId = personIdFromToken(token);
  if (!personId) {
    if (token && String(token).length > 8) return next();
    sendUnauthorized(res);
    return;
  }
  try {
    const mod = await server.ssrLoadModule("/src/lib/company-notebook.ts");
    if (method === "GET" || method === "HEAD") {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const booksParam = String(url.searchParams.get("books") || "");
      if (booksParam) {
        const booksMod = await server.ssrLoadModule("/src/lib/company-books.ts");
        const ids = booksParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => booksMod.BOOK_IDS.includes(s));
        if (!ids.length) {
          sendJson(res, 400, { ok: false, error: "bad books" });
          return;
        }
        const body = await mod.loadRequestedBooks(ids);
        sendJson(res, 200, { ok: true, personId, ...body });
        return;
      }
      const wire = await mod.getCompanyWire();
      const at = Number(url.searchParams.get("at") || 0);
      const extra = {
        "x-apms-person-id": personId,
        etag: `"apms-${wire.at}"`,
        vary: "Accept-Encoding",
        "cache-control": "private, no-store",
      };
      if (at && at === wire.at) {
        sendJson(
          res,
          200,
          {
            unchanged: true,
            notebookUpdatedAt: wire.at,
            snapshotJson: null,
            personId,
            resets: [],
            bootstrap: false,
            forbidden: false,
          },
          extra,
        );
      } else {
        const accept = String(req.headers["accept-encoding"] || "");
        if (accept.includes("gzip") && wire.gzipBody) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("content-encoding", "gzip");
          res.setHeader("cache-control", "private, no-store");
          for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
          res.end(Buffer.from(wire.gzipBody));
        } else {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "private, no-store");
          for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
          res.end(Buffer.from(wire.jsonBody));
        }
      }
      server.ssrLoadModule("/src/lib/company-backups.ts").then((b) => b.ensureHourlyBackup()).catch((err) => console.error("[company-backups] hourly", err));
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      if (!mod.isAdminRestorePost(body)) {
        sendJson(res, 410, {
          ok: false,
          error: "gone",
          message: "Full snapshot POST is disabled. Use PATCH /api/company with baseGens.",
        });
        return;
      }
      const snapshot = extractSnapshotJson(body);
      if (!snapshot) {
        sendJson(res, 400, { ok: false, error: "missing snapshot" });
        return;
      }
      try {
        const http = await server.ssrLoadModule("/src/lib/company-restore-http.ts");
        const result = await http.restoreCompanyFromUpload(JSON.parse(snapshot));
        const status = Number(result.status) || (result.ok ? 200 : 400);
        const { status: _s, ...rest } = result;
        sendJson(res, status, rest);
      } catch (err) {
        console.error("[api/company restore]", err);
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : "Restore failed.",
        });
      }
      return;
    }
    if (method === "PATCH") {
      const body = await readBody(req);
      const result = await mod.patchCompanyBooks(body);
      sendJson(res, result.status, result.body);
      return;
    }
    sendJson(res, 405, { message: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/company]", err);
    sendUnauthorized(res);
  }
}

async function handleBackups(req, res, server) {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(","));
    }
    const method = (req.method || "GET").toUpperCase();
    let body;
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const parsed = await readBody(req);
      body = JSON.stringify(parsed ?? {});
    }
    const request = new Request(url, { method, headers, body });
    const mod = await server.ssrLoadModule("/src/lib/company-backups-http.ts");
    const response = await mod.handleCompanyBackupsRequest(request);
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(text);
  } catch (err) {
    console.error("[api/company-backups]", err);
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : "Backup failed",
    });
  }
}

async function handleServerFn(req, res, url, server) {
  const id = url.slice("/_serverFn/".length).split("?")[0] || "";
  const method = (req.method || "GET").toUpperCase();
  let payload = {};
  if (method === "POST") payload = await readBody(req);
  else {
    try {
      const q = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("payload");
      payload = q ? JSON.parse(q) : {};
    } catch {
      payload = {};
    }
  }
  try {
    const mod = await server.ssrLoadModule("/src/lib/company-notebook.ts");
    if (id === LOAD) {
      if (!isSignedIn(req)) {
        sendUnauthorized(res);
        return;
      }
      const loaded = await mod.loadCompanySnapshot();
      sendJson(res, 200, { ...loaded, personId: personIdFromToken(readToken(req)) });
      server.ssrLoadModule("/src/lib/company-backups.ts").then((b) => b.ensureHourlyBackup()).catch((err) => console.error("[company-backups] hourly", err));
      return;
    }
    if (id === SAVE) {
      if (!isSignedIn(req)) {
        sendUnauthorized(res);
        return;
      }
      const snapshot = extractSnapshotJson(payload);
      if (!snapshot) {
        sendJson(res, 200, { ok: false, error: "missing snapshot" });
        return;
      }
      sendJson(res, 200, await mod.saveCompanySnapshot(snapshot));
      return;
    }
    if (id === EMPTY) {
      sendJson(res, 200, await mod.companyIsEmpty());
      return;
    }
    if (id === BACKUP) {
      if (!isSignedIn(req)) {
        sendUnauthorized(res);
        return;
      }
      const loaded = await mod.loadCompanySnapshot();
      sendJson(res, 200, { json: loaded.snapshotJson, ok: true });
      return;
    }
    sendJson(res, 200, { ok: true, sent: 0, failed: [], added: 0 });
  } catch (err) {
    console.error("[apms-serverfn]", id, err);
    sendJson(res, 200, {
      snapshotJson: null,
      personId: null,
      resets: [],
      bootstrap: true,
      forbidden: false,
      sent: 0,
      failed: [],
    });
  }
}

function serveRecovered(req, res, next, server) {
  return (async () => {
    const raw = req.url ?? "/";
    const url = raw.split("?")[0] || "/";
    if (skip(url)) return next();
    const canSsr = typeof server?.ssrLoadModule === "function";
    if (!canSsr && (url.startsWith("/api/") || url.startsWith("/_serverFn/"))) return next();
    if (url.startsWith("/api/auth")) {
      await handleAuth(req, res, url, server);
      return;
    }
    if (
      url === "/api/issued-logins" ||
      url.startsWith("/api/issued-logins?") ||
      url === "/api/provision-logins" ||
      url.startsWith("/api/provision-logins?")
    ) {
      await handleIssued(req, res, server);
      return;
    }
    if (
      url === "/api/password-reset" ||
      url.startsWith("/api/password-reset?") ||
      url === "/api/password-reset/apply" ||
      url.startsWith("/api/password-reset/apply?")
    ) {
      if ((req.method || "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { ok: false });
        return;
      }
      try {
        const body = await readBody(req);
        const inner = body?.data && typeof body.data === "object" ? body.data : body || {};
        const mod = await server.ssrLoadModule("/src/lib/password-reset.ts");
        if (inner.token && inner.password) {
          sendJson(res, 200, await mod.applyPasswordReset(String(inner.token), String(inner.password)));
        } else {
          sendJson(
            res,
            200,
            await mod.requestPasswordReset(String(inner.login || inner.username || inner.email || ""), String(inner.origin || "")),
          );
        }
      } catch (err) {
        console.error("[password-reset]", err);
        sendJson(res, 200, { ok: true });
      }
      return;
    }
    if (url === "/api/company-restore" || url.startsWith("/api/company-restore?")) {
      if (!isSignedIn(req)) {
        sendUnauthorized(res);
        return;
      }
      if ((req.method || "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { ok: false, error: "POST a backup file." });
        return;
      }
      try {
        const body = await readBody(req);
        const http = await server.ssrLoadModule("/src/lib/company-restore-http.ts");
        const result = await http.restoreCompanyFromUpload(body);
        const status = Number(result.status) || (result.ok ? 200 : 400);
        const { status: _s, ...rest } = result;
        sendJson(res, status, rest);
      } catch (err) {
        console.error("[api/company-restore]", err);
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : "Restore failed.",
        });
      }
      return;
    }
    if (url === "/api/company-live" || url.startsWith("/api/company-live?")) {
      await handleCompanyLive(req, res, server);
      return;
    }
    if (url === "/api/company-tick" || url.startsWith("/api/company-tick?")) {
      await handleCompanyTick(req, res, server);
      return;
    }
    if (url === "/api/company" || url.startsWith("/api/company?")) {
      await handleCompany(req, res, server, next);
      return;
    }
    if (url === "/api/company-backups" || url.startsWith("/api/company-backups?")) {
      const qs = String(raw.split("?")[1] || "");
      const cron = qs.includes("daily=1") || qs.includes("hourly=1");
      if (!isSignedIn(req) && !(cron && isLoopbackReq(req))) {
        sendUnauthorized(res);
        return;
      }
      await handleBackups(req, res, server);
      return;
    }
    if (url.startsWith("/_serverFn/")) {
      await handleServerFn(req, res, url, server);
      return;
    }
    if (url.startsWith("/api/")) return next();

    const packFile = join(process.cwd(), "dist/apms-pack.zip");
    if ((url === "/apms-pack.zip" || url === "/pack.zip" || url.startsWith("/apms-pack.zip?") || url === "/aliens-apms-full.zip" || url === "/aliens-apms-all.zip") && existsSync(packFile)) {
      const st = statSync(packFile);
      res.statusCode = 200;
      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", "attachment; filename=\"aliens-apms-all-files.zip\"");
      res.setHeader("content-length", String(st.size));
      res.setHeader("cache-control", "no-store");
      createReadStream(packFile).pipe(res);
      return;
    }
    const catalogNames = [
      join(process.cwd(), "dist/aliens-apms-field-catalog.xlsx"),
      join(process.cwd(), "public/aliens-apms-field-catalog.xlsx"),
      join(ROOT, "aliens-apms-field-catalog.xlsx"),
    ];
    const catalogFile = catalogNames.find((p) => existsSync(p));
    if (
      catalogFile &&
      (url === "/aliens-apms-field-catalog.xlsx" ||
        url === "/field-catalog.xlsx" ||
        url === "/catalog.xlsx" ||
        url.startsWith("/aliens-apms-field-catalog.xlsx?"))
    ) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("content-disposition", 'attachment; filename="aliens-apms-field-catalog.xlsx"');
      res.setHeader("cache-control", "no-store");
      res.end(readFileSync(catalogFile));
      return;
    }
    if (url === "/pack" || url === "/pack.html") {
      const ready = existsSync(packFile);
      const size = ready ? statSync(packFile).size : 0;
      const mb = (size / 1024 / 1024).toFixed(1);
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Download APMS pack</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:IBM Plex Sans,system-ui,sans-serif;background:#F4EFE6;color:#1A1612}a{display:inline-block;padding:14px 22px;border-radius:999px;background:#1F3D34;color:#fff;text-decoration:none;font-weight:600}p{max-width:36rem;text-align:center;line-height:1.45}</style></head>
<body><div style="padding:24px">
<h1 style="font-family:Fraunces,Georgia,serif;text-align:center">grok.me pack</h1>
<p>${ready ? `Ready · ${mb} MB. Keep the live database and .env. Unpack over the app, restart, hard-reload.` : "Pack is not on this preview yet."}</p>
<p>${ready ? `<a href="/apms-pack.zip">Download zip</a>` : ""}</p>
<p><a href="/aliens-apms-field-catalog.xlsx">Download field catalog (xlsx)</a></p>
</div></body></html>`);
      return;
    }

    const spa =
      url === "/" ||
      url === "/login" ||
      url === "/index.html" ||
      url === "/apms.html" ||
      !url.includes(".");
    const rel = spa ? "/index.html" : url;
    const fp = normalize(join(ROOT, rel));
    if (!fp.startsWith(ROOT)) return next();
    if (!existsSync(fp) || !statSync(fp).isFile()) return next();

    res.statusCode = 200;
    res.setHeader("content-type", MIME[extname(fp)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("pragma", "no-cache");
    if (extname(fp) === ".html") {
      let html = injectHtmlExtras(readFileSync(fp, "utf8"));
      if (existsSync(join(process.cwd(), "dist/apms-pack.zip"))) {
        const bar = `<a href="/apms-pack.zip" download="aliens-apms-full.zip" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;display:block;padding:14px 18px;background:#1F3D34;color:#fff;text-align:center;font:700 16px/1.3 IBM Plex Sans,system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.25)">Download full APMS package — 34 MB zip</a>`;
        html = html.includes("</body>") ? html.replace("</body>", `${bar}</body>`) : html + bar;
      }
      res.end(html);
      return;
    }
    res.end(readFileSync(fp));
  })().catch(next);
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

export function recoveredApmsPlugin() {
  return {
    name: "recovered-apms",
    configureServer(server) {
      server.ssrLoadModule("/src/lib/company-backups.ts").then((b) => {
        b.startBackupScheduler();
      }).catch((err) => console.error("[company-backups] scheduler", err));
      server.middlewares.use((req, res, next) => serveRecovered(req, res, next, server));
    },
    configurePreviewServer(server) {
      if (typeof server.ssrLoadModule === "function") {
        server.ssrLoadModule("/src/lib/company-backups.ts").then((b) => {
          b.startBackupScheduler();
        }).catch((err) => console.error("[company-backups] scheduler", err));
      }
      server.middlewares.use((req, res, next) => serveRecovered(req, res, next, server));
    },
    closeBundle() {
      const dests = [
        join(process.cwd(), ".output/public"),
        join(process.cwd(), "dist/client"),
        join(process.cwd(), "dist"),
        join(process.cwd(), ".vercel/output/static"),
      ];
      for (const dest of dests) {
        const parent = dest.endsWith("public") || dest.endsWith("client") ? dest : null;
        if (!parent) continue;
        try {
          copyDir(ROOT, parent);
        } catch {
          /* output dir may not exist yet */
        }
      }
      try {
        copyDir(join(ROOT, "assets"), join(process.cwd(), "public/assets"));
        copyFileSync(join(ROOT, "index.html"), join(process.cwd(), "public/index.html"));
      } catch (err) {
        console.warn("[recovered-apms] public sync failed", err);
      }
      try {
        const libs = join(process.cwd(), ".vercel/output/functions/__server.func/_libs");
        const pglite = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
        if (existsSync(libs) && existsSync(join(pglite, "pglite.data"))) {
          for (const name of readdirSync(pglite)) {
            if (!name.endsWith(".data") && !name.endsWith(".wasm")) continue;
            copyFileSync(join(pglite, name), join(libs, name));
          }
        }
      } catch (err) {
        console.warn("[recovered-apms] pglite data copy failed", err);
      }
    },
  };
}
