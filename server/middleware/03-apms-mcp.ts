/**
 * Claude connector (MCP) for Aliens APMS — read-only.
 *
 * Paths: POST /mcp, /oauth/*, /.well-known/oauth-*. Everything else goes on
 * to the app untouched. See src/lib/apms-mcp/ and REPORT-MCP-CONNECTOR.md.
 * APMS_MCP=off switches it off.
 */
import { handleApmsMcp } from "../../src/lib/apms-mcp/server";
import { isMcpPath } from "../../src/lib/apms-mcp/http";

interface Event {
  url: URL;
  req: Request & { method: string; headers: Headers };
}

export default async function apmsMcpMiddleware(
  event: Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!isMcpPath(event.url.pathname)) return next();
  try {
    // Rebuild the request on the public URL so the handler sees path + query as sent.
    const request = new Request(event.url.toString(), {
      method: event.req.method,
      headers: event.req.headers,
      body: event.req.method === "GET" || event.req.method === "HEAD" ? undefined : await event.req.clone().arrayBuffer(),
    });
    const res = await handleApmsMcp(request);
    return res ?? next();
  } catch (err) {
    console.error("[apms-mcp]", err);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
