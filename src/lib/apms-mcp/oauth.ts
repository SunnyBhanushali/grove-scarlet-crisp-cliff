/**
 * OAuth 2.1 for the Claude connector: Claude signs in with an APMS login.
 *
 *   /.well-known/oauth-protected-resource[/mcp]  RFC 9728 — where to sign in
 *   /.well-known/oauth-authorization-server       RFC 8414 — endpoints
 *   POST /oauth/register                          RFC 7591 — Claude registers itself
 *   GET|POST /oauth/authorize                     APMS username + password page → code
 *   POST /oauth/token                             code (+PKCE S256) / refresh → tokens
 *   POST /oauth/revoke                            RFC 7009
 *
 * The access token IS an ordinary APMS session token (apms-sessions.ts): the
 * same 30-day expiry, and an APMS password change or reset signs it out like
 * any browser session. Refresh tokens are kept hashed and die the same way.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPE = "apms.read";
const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_S = 30 * 24 * 60 * 60;

export type OAuthClient = {
  clientId: string;
  secretHash: string | null;
  redirectUris: string[];
  name: string;
};

export type CodeRow = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  personId: string;
  scope: string;
  resource: string;
  expiresAt: number;
};

export type RefreshRow = { clientId: string; personId: string; scope: string; createdAt: number; expiresAt: number };

export type OAuthStore = {
  saveClient(c: OAuthClient): Promise<void>;
  getClient(id: string): Promise<OAuthClient | null>;
  saveCode(hash: string, row: CodeRow): Promise<void>;
  /** Single use: returns the row and deletes it. */
  takeCode(hash: string): Promise<CodeRow | null>;
  saveRefresh(hash: string, row: RefreshRow): Promise<void>;
  takeRefresh(hash: string): Promise<RefreshRow | null>;
  dropRefresh(hash: string): Promise<void>;
};

export type LoginResult = { personId: string; name: string } | { error: string; status: number };

export type OAuthDeps = {
  store: OAuthStore;
  /** Check an APMS username + password (with the app's lock-out rules). */
  login(username: string, password: string, headers: Headers): Promise<LoginResult>;
  /** May this person use the connector at all? null = yes, else the reason. */
  refuse(personId: string): Promise<string | null>;
  issueAccessToken(personId: string): Promise<string>;
  revokeAccessToken(token: string): Promise<void>;
  /** When this person's password last changed (ms), or 0. */
  passwordChangedAt(personId: string): Promise<number>;
  /** Extra hosts allowed as redirect targets (besides Claude's own). */
  redirectHosts?: string[];
  log?: (line: string) => void;
};

export const DEFAULT_REDIRECT_HOSTS = ["claude.ai", "claude.com", "localhost", "127.0.0.1"];

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64url");
const token = (prefix: string) => prefix + b64url(randomBytes(32));

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ origin ---

/** Public origin of this server (APMS_PUBLIC_URL, else what the proxy says). */
export function publicOrigin(request: Request, env: Record<string, string | undefined> = process.env): string {
  const fixed = (env.APMS_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const url = new URL(request.url);
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0].trim();
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host).split(",")[0].trim();
  return `${proto}://${host}`;
}

// --------------------------------------------------------------- metadata ---

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Aliens APMS",
  };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    service_documentation: `${origin}/`,
  };
}

// ------------------------------------------------------------------ helpers ---

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", pragma: "no-cache", ...extra },
  });
}

function oauthError(status: number, error: string, description: string): Response {
  return json(status, { error, error_description: description });
}

async function readParams(request: Request): Promise<Record<string, string>> {
  const text = await request.text().catch(() => "");
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(text || "{}");
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null) out[k] = typeof v === "string" ? v : JSON.stringify(v);
      return out;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export function redirectAllowed(uri: string, extraHosts: string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const hosts = new Set([...DEFAULT_REDIRECT_HOSTS, ...extraHosts].map((h) => h.toLowerCase()));
  const host = u.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1";
  if (u.protocol !== "https:" && !(loopback && u.protocol === "http:")) return false;
  if (hosts.has(host)) return true;
  return [...hosts].some((h) => host.endsWith(`.${h}`) && !["localhost", "127.0.0.1"].includes(h));
}

function withQuery(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  return u.toString();
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function clientAuth(request: Request, params: Record<string, string>): { id: string; secret: string | null } {
  const basic = (request.headers.get("authorization") || "").match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const raw = Buffer.from(basic[1], "base64").toString("utf8");
      const i = raw.indexOf(":");
      if (i > 0) return { id: decodeURIComponent(raw.slice(0, i)), secret: decodeURIComponent(raw.slice(i + 1)) };
    } catch {
      /* fall through */
    }
  }
  return { id: params.client_id || "", secret: params.client_secret ?? null };
}

async function authenticateClient(deps: OAuthDeps, request: Request, params: Record<string, string>): Promise<OAuthClient | Response> {
  const { id, secret } = clientAuth(request, params);
  if (!id) return oauthError(401, "invalid_client", "client_id is required");
  const client = await deps.store.getClient(id);
  if (!client) return oauthError(401, "invalid_client", "Unknown client");
  if (client.secretHash) {
    if (!secret || !safeEqual(sha256(secret), client.secretHash)) return oauthError(401, "invalid_client", "Bad client secret");
  }
  return client;
}

// ---------------------------------------------------------------- register ---

export async function handleRegister(request: Request, deps: OAuthDeps): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError(400, "invalid_client_metadata", "JSON body required");
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return oauthError(400, "invalid_redirect_uri", "redirect_uris is required");
  const bad = uris.find((u) => !redirectAllowed(u, deps.redirectHosts));
  if (bad) return oauthError(400, "invalid_redirect_uri", `Redirect not allowed: ${bad}`);
  const method = String(body.token_endpoint_auth_method || "none");
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    return oauthError(400, "invalid_client_metadata", "Unsupported token_endpoint_auth_method");
  }
  const clientId = token("apms-mcp-client.");
  const secret = method === "none" ? null : token("apms-mcp-secret.");
  const name = String(body.client_name || "MCP client").slice(0, 120);
  await deps.store.saveClient({ clientId, secretHash: secret ? sha256(secret) : null, redirectUris: uris, name });
  deps.log?.(`[apms-mcp] registered client "${name}" ${clientId.slice(0, 24)}… → ${uris.join(" ")}`);
  const out: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
  if (secret) {
    out.client_secret = secret;
    out.client_secret_expires_at = 0;
  }
  return json(201, out);
}

// --------------------------------------------------------------- authorize ---

type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
  response_type: string;
};

function authorizeParams(src: Record<string, string>): AuthorizeParams {
  return {
    client_id: src.client_id || "",
    redirect_uri: src.redirect_uri || "",
    state: src.state || "",
    code_challenge: src.code_challenge || "",
    code_challenge_method: src.code_challenge_method || "",
    scope: src.scope || SCOPE,
    resource: src.resource || "",
    response_type: src.response_type || "",
  };
}

/** Validate what can be validated before redirecting back is safe. */
async function checkAuthorize(p: AuthorizeParams, deps: OAuthDeps): Promise<{ client: OAuthClient; redirectUri: string } | { page: string }> {
  if (!p.client_id) return { page: "The sign-in link is missing its client id. Start again from Claude." };
  const client = await deps.store.getClient(p.client_id);
  if (!client) return { page: "This connection request is unknown or expired. Remove the connector in Claude and add it again." };
  let redirectUri = p.redirect_uri;
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!client.redirectUris.includes(redirectUri)) return { page: "The return address of this sign-in does not match the registered one." };
  return { client, redirectUri };
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
};

function page(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#0b0b0c;--card:#16161a;--fg:#f3f3f4;--muted:#a1a1aa;--line:#2a2a31;--accent:#e5e5e5;--err:#f87171}
@media (prefers-color-scheme: light){:root{--bg:#f6f6f7;--card:#fff;--fg:#111114;--muted:#5b5b66;--line:#e3e3e8;--accent:#111114;--err:#b91c1c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:19px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}label{display:block;font-size:13px;margin:14px 0 6px;color:var(--muted)}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);font-size:15px}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:11px;border-radius:8px;border:1px solid var(--line);font-size:15px;cursor:pointer;background:transparent;color:var(--fg)}
button.primary{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:600}.err{color:var(--err);margin:12px 0 0}
ul{color:var(--muted);padding-left:18px;margin:0 0 8px;font-size:13px}.brand{font-weight:700;letter-spacing:.08em;font-size:12px;color:var(--muted);margin-bottom:14px}
</style></head><body><main class="card"><div class="brand">ALIENS APMS</div>${inner}</main></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function loginPage(p: AuthorizeParams, clientName: string, message = "", username = "", status = 200): Response {
  const hidden = (Object.keys(p) as Array<keyof AuthorizeParams>)
    .map((k) => `<input type="hidden" name="${k}" value="${htmlEscape(p[k])}">`)
    .join("");
  return page(
    "Connect Claude to APMS",
    `<h1>Connect ${htmlEscape(clientName || "Claude")} to APMS</h1>
<p>Sign in with your APMS login to let it read APMS for you.</p>
<ul><li>Read-only: it cannot change anything.</li><li>It sees only what your login can see in the app.</li><li>Changing your APMS password disconnects it.</li></ul>
<form method="post" action="/oauth/authorize" autocomplete="on">${hidden}
<label for="u">Username</label><input id="u" name="username" autocomplete="username" required value="${htmlEscape(username)}" autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
${message ? `<p class="err" role="alert">${htmlEscape(message)}</p>` : ""}
<div class="row"><button type="submit" name="action" value="deny" formnovalidate>Cancel</button><button class="primary" type="submit" name="action" value="allow">Allow</button></div>
</form>`,
    status,
  );
}

export async function handleAuthorize(request: Request, deps: OAuthDeps, origin: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const src = method === "POST" ? await readParams(request) : Object.fromEntries(new URL(request.url).searchParams);
  const p = authorizeParams(src);
  const checked = await checkAuthorize(p, deps);
  if ("page" in checked) return page("APMS sign-in", `<h1>Can't connect</h1><p>${htmlEscape(checked.page)}</p>`, 400);
  const { client, redirectUri } = checked;
  p.redirect_uri = redirectUri;
  const back = (params: Record<string, string | undefined>) => redirect(withQuery(redirectUri, { ...params, state: p.state || undefined, iss: origin }));
  if (p.response_type !== "code") return back({ error: "unsupported_response_type", error_description: "Only response_type=code is supported" });
  if (!p.code_challenge || p.code_challenge_method !== "S256") {
    return back({ error: "invalid_request", error_description: "PKCE with code_challenge_method=S256 is required" });
  }
  const scopes = p.scope.split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== SCOPE)) return back({ error: "invalid_scope", error_description: `Only ${SCOPE} is available` });
  if (method === "GET") return loginPage(p, client.name);
  if (method !== "POST") return new Response(null, { status: 405 });
  if (src.action === "deny") return back({ error: "access_denied", error_description: "The APMS user cancelled" });
  const username = (src.username || "").trim();
  const password = src.password || "";
  if (!username || !password) return loginPage(p, client.name, "Enter your username and password.", username, 400);
  const who = await deps.login(username, password, request.headers);
  if ("error" in who) return loginPage(p, client.name, who.error, username, who.status);
  const refused = await deps.refuse(who.personId);
  if (refused) {
    deps.log?.(`[apms-mcp] refused ${who.personId}: ${refused}`);
    return loginPage(p, client.name, refused, username, 403);
  }
  const code = token("apms-mcp-code.");
  await deps.store.saveCode(sha256(code), {
    clientId: client.clientId,
    redirectUri,
    challenge: p.code_challenge,
    personId: who.personId,
    scope: SCOPE,
    resource: p.resource,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  deps.log?.(`[apms-mcp] ${who.personId} (${who.name}) allowed "${client.name}"`);
  return back({ code });
}

// ------------------------------------------------------------------- token ---

async function issueTokens(deps: OAuthDeps, clientId: string, personId: string): Promise<Response> {
  const access = await deps.issueAccessToken(personId);
  const refresh = token("apms-mcp-refresh.");
  const now = Date.now();
  await deps.store.saveRefresh(sha256(refresh), { clientId, personId, scope: SCOPE, createdAt: now, expiresAt: now + REFRESH_TTL_MS });
  return json(200, { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE });
}

export async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return oauthError(405, "invalid_request", "POST only");
  const params = await readParams(request);
  const client = await authenticateClient(deps, request, params);
  if (client instanceof Response) return client;
  const grant = params.grant_type || "";
  if (grant === "authorization_code") {
    const code = params.code || "";
    if (!code) return oauthError(400, "invalid_request", "code is required");
    const row = await deps.store.takeCode(sha256(code));
    if (!row || row.expiresAt < Date.now()) return oauthError(400, "invalid_grant", "The code is invalid or expired");
    if (row.clientId !== client.clientId) return oauthError(400, "invalid_grant", "The code was issued to another client");
    if (params.redirect_uri && params.redirect_uri !== row.redirectUri) return oauthError(400, "invalid_grant", "redirect_uri does not match");
    const verifier = params.code_verifier || "";
    if (!verifier || b64url(createHash("sha256").update(verifier).digest()) !== row.challenge) {
      return oauthError(400, "invalid_grant", "PKCE verification failed");
    }
    const refused = await deps.refuse(row.personId);
    if (refused) return oauthError(400, "invalid_grant", refused);
    return issueTokens(deps, client.clientId, row.personId);
  }
  if (grant === "refresh_token") {
    const rt = params.refresh_token || "";
    if (!rt) return oauthError(400, "invalid_request", "refresh_token is required");
    const row = await deps.store.takeRefresh(sha256(rt));
    if (!row || row.expiresAt < Date.now()) return oauthError(400, "invalid_grant", "The refresh token is invalid or expired");
    if (row.clientId !== client.clientId) return oauthError(400, "invalid_grant", "The refresh token was issued to another client");
    if ((await deps.passwordChangedAt(row.personId)) > row.createdAt) {
      return oauthError(400, "invalid_grant", "The APMS password changed since this connection was made; sign in again");
    }
    const refused = await deps.refuse(row.personId);
    if (refused) return oauthError(400, "invalid_grant", refused);
    return issueTokens(deps, client.clientId, row.personId);
  }
  return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
}

export async function handleRevoke(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return oauthError(405, "invalid_request", "POST only");
  const params = await readParams(request);
  const client = await authenticateClient(deps, request, params);
  if (client instanceof Response) return client;
  const t = params.token || "";
  if (t.startsWith("apms-mcp-refresh.")) await deps.store.dropRefresh(sha256(t));
  else if (t) await deps.revokeAccessToken(t);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}

// ------------------------------------------------------------ memory store ---

export function memoryStore(): OAuthStore {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, CodeRow>();
  const refresh = new Map<string, RefreshRow>();
  return {
    async saveClient(c) {
      clients.set(c.clientId, c);
    },
    async getClient(id) {
      return clients.get(id) || null;
    },
    async saveCode(h, r) {
      codes.set(h, r);
    },
    async takeCode(h) {
      const r = codes.get(h) || null;
      codes.delete(h);
      return r;
    },
    async saveRefresh(h, r) {
      refresh.set(h, r);
    },
    async takeRefresh(h) {
      const r = refresh.get(h) || null;
      refresh.delete(h);
      return r;
    },
    async dropRefresh(h) {
      refresh.delete(h);
    },
  };
}

// --------------------------------------------------------------- SQL store ---

type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

/** Postgres store. Tables are created at runtime (live does not apply migration files on boot). */
export function sqlStore(getSql: () => Promise<Q>): OAuthStore {
  let ready: Promise<void> | null = null;
  const db = async () => {
    const sql = await getSql();
    ready ??= (async () => {
      await sql.query(`create table if not exists apms_mcp_clients (
        client_id text primary key, secret_hash text, redirect_uris jsonb not null default '[]'::jsonb,
        name text not null default '', created_at timestamptz not null default now())`);
      await sql.query(`create table if not exists apms_mcp_codes (
        code_hash text primary key, payload jsonb not null, expires_at timestamptz not null)`);
      await sql.query(`create table if not exists apms_mcp_refresh (
        token_hash text primary key, client_id text not null, person_id text not null, scope text not null default '',
        created_at timestamptz not null default now(), expires_at timestamptz not null)`);
      await sql.query(`create index if not exists apms_mcp_refresh_person on apms_mcp_refresh (person_id)`);
    })().catch((err) => {
      ready = null;
      throw err;
    });
    await ready;
    return sql;
  };
  return {
    async saveClient(c) {
      const sql = await db();
      await sql.query(`insert into apms_mcp_clients (client_id, secret_hash, redirect_uris, name) values ($1, $2, $3::jsonb, $4)`, [
        c.clientId,
        c.secretHash,
        JSON.stringify(c.redirectUris),
        c.name,
      ]);
    },
    async getClient(id) {
      const sql = await db();
      const rows = await sql.query<{ client_id: string; secret_hash: string | null; redirect_uris: unknown; name: string }>(
        `select client_id, secret_hash, redirect_uris, name from apms_mcp_clients where client_id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      const uris = typeof r.redirect_uris === "string" ? JSON.parse(r.redirect_uris) : r.redirect_uris;
      return { clientId: r.client_id, secretHash: r.secret_hash, redirectUris: Array.isArray(uris) ? uris.map(String) : [], name: r.name };
    },
    async saveCode(h, row) {
      const sql = await db();
      await sql.query(`delete from apms_mcp_codes where expires_at < now()`);
      await sql.query(`insert into apms_mcp_codes (code_hash, payload, expires_at) values ($1, $2::jsonb, $3)`, [h, JSON.stringify(row), new Date(row.expiresAt).toISOString()]);
    },
    async takeCode(h) {
      const sql = await db();
      const rows = await sql.query<{ payload: unknown }>(`delete from apms_mcp_codes where code_hash = $1 returning payload`, [h]);
      const p = rows[0]?.payload;
      if (!p) return null;
      return (typeof p === "string" ? JSON.parse(p) : p) as CodeRow;
    },
    async saveRefresh(h, row) {
      const sql = await db();
      await sql.query(`delete from apms_mcp_refresh where expires_at < now()`);
      await sql.query(
        `insert into apms_mcp_refresh (token_hash, client_id, person_id, scope, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)`,
        [h, row.clientId, row.personId, row.scope, new Date(row.createdAt).toISOString(), new Date(row.expiresAt).toISOString()],
      );
    },
    async takeRefresh(h) {
      const sql = await db();
      const rows = await sql.query<{ client_id: string; person_id: string; scope: string; created_at: string | Date; expires_at: string | Date }>(
        `delete from apms_mcp_refresh where token_hash = $1 returning client_id, person_id, scope, created_at, expires_at`,
        [h],
      );
      const r = rows[0];
      if (!r) return null;
      return { clientId: r.client_id, personId: r.person_id, scope: r.scope, createdAt: new Date(r.created_at).getTime(), expiresAt: new Date(r.expires_at).getTime() };
    },
    async dropRefresh(h) {
      const sql = await db();
      await sql.query(`delete from apms_mcp_refresh where token_hash = $1`, [h]);
    },
  };
}
