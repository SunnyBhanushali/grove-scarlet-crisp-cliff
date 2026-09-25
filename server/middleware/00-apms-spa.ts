/**
 * Serve the recovered Aliens APMS SPA instead of the TanStack stub
 * on deployed hosts. Keep this HTML identical to recovered-site/index.html.
 */
import spaHtml from "../../scripts/apms-spa.html?raw";

interface Event {
  url: URL;
  req: { method: string; headers: Headers };
}

function acceptsHtml(accept: string | null): boolean {
  if (!accept) return true;
  return accept.includes("text/html") || accept.includes("*/*");
}

export default async function apmsSpaMiddleware(
  event: Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();

  const path = event.url.pathname;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/__grok") ||
    path.startsWith("/_serverFn") ||
    path.startsWith("/_server")
  ) {
    return next();
  }
  if (path.startsWith("/auth/")) return next();
  // Claude connector (03-apms-mcp.ts): its sign-in page and endpoints, not the SPA.
  if (path === "/mcp" || path.startsWith("/mcp/") || path.startsWith("/oauth/")) return next();
  if (event.url.searchParams.get("install") === "1") return next();
  if (path.includes(".") && path !== "/index.html" && path !== "/apms.html") return next();
  if (!acceptsHtml(event.req.headers.get("accept"))) return next();

  return new Response(spaHtml, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "x-apms-spa": "1",
    },
  });
}
