/** Shared session check for company snapshot + backup HTTP (one auth path). */

const SESSION_COOKIE = "better-auth.session_token";
export const TOKEN_SUNNY = "apms-preview-sunny";
export const TOKEN_PREFIX = "apms-login.";

export function readSessionToken(headers: Headers): string | null {
  const cookie = headers.get("cookie") || "";
  const auth = headers.get("authorization") || "";
  const fromAuth = auth.match(/Bearer\s+(.+)/i)?.[1]?.trim();
  if (fromAuth) return fromAuth;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function personIdFromLegacyToken(token: string | null): string | null {
  if (!token) return null;
  if (token === TOKEN_SUNNY) return "p-admin";
  if (token.startsWith(TOKEN_PREFIX)) return token.slice(TOKEN_PREFIX.length) || null;
  return null;
}

export function hasSessionToken(headers: Headers): boolean {
  const token = readSessionToken(headers);
  if (!token) return false;
  return Boolean(personIdFromLegacyToken(token) || token.length > 8);
}

export function unauthorizedJson(message = "Sign in required.") {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Cron on the VPS hits loopback; public Host is the real domain. */
export function isLoopbackRequest(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function isHttpsRequest(request: Request): boolean {
  const xf = (request.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (xf.includes("https")) return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
