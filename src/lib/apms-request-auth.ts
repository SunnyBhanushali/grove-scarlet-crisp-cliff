/**
 * Shared session check for every APMS HTTP route (one auth path).
 *
 * BATCH-2: only tokens the server issued at sign-in are accepted
 * (`apms-sessions.ts`). The old static `apms-preview-sunny` and the
 * guessable `apms-login.<personId>` tokens, and "any bearer longer than 8
 * characters", are gone.
 */
import { personIdForSessionToken } from "./apms-sessions.ts";

const SESSION_COOKIE = "better-auth.session_token";

export function readSessionToken(headers: Headers): string | null {
  const cookie = headers.get("cookie") || "";
  const auth = headers.get("authorization") || "";
  const fromAuth = auth.match(/Bearer\s+(.+)/i)?.[1]?.trim();
  if (fromAuth) return fromAuth;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** The server-issued session on this request (bearer first, then cookie), or null. */
export async function sessionFromHeaders(headers: Headers): Promise<{ personId: string; token: string } | null> {
  const bearer = readSessionToken(headers);
  const byBearer = await personIdForSessionToken(bearer);
  if (byBearer && bearer) return { personId: byBearer, token: bearer };
  // A stale bearer kept by the client must not hide a valid cookie session.
  const cookieOnly = new Headers(headers);
  cookieOnly.delete("authorization");
  const cookie = readSessionToken(cookieOnly);
  if (!cookie || cookie === bearer) return null;
  const byCookie = await personIdForSessionToken(cookie);
  return byCookie ? { personId: byCookie, token: cookie } : null;
}

/** The signed-in person for this request, or null (unknown / forged / expired token). */
export async function sessionPersonId(headers: Headers): Promise<string | null> {
  return (await sessionFromHeaders(headers))?.personId ?? null;
}

export async function hasValidSession(headers: Headers): Promise<boolean> {
  return (await sessionPersonId(headers)) !== null;
}

export function forbiddenJson(message = "Only an admin can do that.", kind?: string, field?: string) {
  // BATCH-3: every refusal has the same shape: { error: "forbidden", kind, field, message }.
  return new Response(JSON.stringify({ ok: false, error: "forbidden", ...(kind ? { kind } : {}), ...(field ? { field } : {}), message }), {
    status: 403,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
