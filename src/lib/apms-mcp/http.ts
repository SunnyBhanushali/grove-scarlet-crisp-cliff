/**
 * HTTP entry for the Claude connector. Returns a Response for the connector's
 * paths, or null so the request carries on to the app.
 *
 *   POST /mcp                                       MCP (JSON-RPC), Bearer token required
 *   /.well-known/oauth-protected-resource[/mcp]     where to sign in
 *   /.well-known/oauth-authorization-server[/…]     OAuth endpoints
 *   /oauth/register | /oauth/authorize | /oauth/token | /oauth/revoke
 *
 * Switch off with APMS_MCP=off (every path then falls through to the app → 404).
 */
import { handleMcpBody, parseError, type McpContext } from "./protocol.ts";
import {
  authServerMetadata,
  handleAuthorize,
  handleRegister,
  handleRevoke,
  handleToken,
  protectedResourceMetadata,
  publicOrigin,
  type OAuthDeps,
} from "./oauth.ts";
import type { ToolEnv } from "./tools.ts";

export type McpHttpDeps = OAuthDeps & {
  /** The person behind a Bearer token, or null. */
  personForToken(token: string): Promise<string | null>;
  /** Tool environment for this person (their filtered company snapshot). */
  envFor(personId: string): Promise<ToolEnv>;
  enabled?: () => boolean;
};

export const MCP_PATHS = ["/mcp", "/oauth/", "/.well-known/oauth-"];

export function isMcpPath(path: string): boolean {
  return path === "/mcp" || path === "/mcp/" || path.startsWith("/oauth/") || path.startsWith("/.well-known/oauth-");
}

function cors(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
    "access-control-expose-headers": "www-authenticate, mcp-session-id",
    ...extra,
  };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(), ...extra },
  });
}

function bearer(headers: Headers): string | null {
  const m = (headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function unauthorized(origin: string, description = "Sign in to APMS to use this connector"): Response {
  return json(
    401,
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: description } },
    {
      "www-authenticate": `Bearer realm="apms", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="apms.read", error="invalid_token", error_description="${description.replace(/"/g, "'")}"`,
    },
  );
}

/** Browsers may only call /mcp from Claude's own sites (DNS-rebinding guard); servers send no Origin. */
function originAllowed(request: Request, self: string): boolean {
  const o = request.headers.get("origin");
  if (!o) return true;
  try {
    const host = new URL(o).hostname.toLowerCase();
    if (o === self) return true;
    return host === "claude.ai" || host.endsWith(".claude.ai") || host === "claude.com" || host.endsWith(".claude.com") || host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function handleMcpHttp(request: Request, deps: McpHttpDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!isMcpPath(path)) return null;
  if (deps.enabled && !deps.enabled()) return null;
  const method = request.method.toUpperCase();
  const origin = publicOrigin(request);

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors({ "access-control-max-age": "86400" }) });

  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return json(200, protectedResourceMetadata(origin), { "cache-control": "public, max-age=300" });
  }
  if (path.startsWith("/.well-known/oauth-authorization-server")) {
    return json(200, authServerMetadata(origin), { "cache-control": "public, max-age=300" });
  }
  if (path.startsWith("/.well-known/oauth-")) return null;

  if (path === "/oauth/register") {
    if (method !== "POST") return json(405, { error: "invalid_request" });
    return withCors(await handleRegister(request, deps));
  }
  if (path === "/oauth/authorize") return handleAuthorize(request, deps, origin);
  if (path === "/oauth/token") return withCors(await handleToken(request, deps));
  if (path === "/oauth/revoke") return withCors(await handleRevoke(request, deps));
  if (path.startsWith("/oauth/")) return json(404, { error: "not_found" });

  // ---- /mcp
  if (!originAllowed(request, origin)) return json(403, { error: "origin not allowed" });
  if (method === "GET" || method === "DELETE") {
    // No server-initiated stream and no sessions in this stateless server.
    return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...cors() } });
  }
  if (method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...cors() } });
  const tok = bearer(request.headers);
  if (!tok) return unauthorized(origin);
  const personId = await deps.personForToken(tok);
  if (!personId) return unauthorized(origin, "The APMS sign-in has expired or was revoked");
  const refused = await deps.refuse(personId);
  if (refused) return json(403, { jsonrpc: "2.0", id: null, error: { code: -32003, message: refused } });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, parseError());
  }
  let envPromise: Promise<ToolEnv> | null = null;
  const ctx: McpContext = {
    personId,
    env: () => (envPromise ??= deps.envFor(personId)),
    log: deps.log,
  };
  const reply = await handleMcpBody(body, ctx);
  if (reply === null) return new Response(null, { status: 202, headers: cors() });
  return json(200, reply);
}

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors())) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
