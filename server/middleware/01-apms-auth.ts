/**
 * Preview/published login for Aliens APMS.
 * Authenticates against the company people list plus issued_logins.
 * sunny.b / 0000 always works as the super-admin fallback.
 */
import {
  loadCompanySnapshot,
} from "../../src/lib/company-notebook";
import {
  SUNNY,
  sessionUser,
  verifyLogin,
  type LoginMap,
  type LoginPerson,
} from "../../src/lib/apms-credentials";
import { loadIssuedLogins, mergeLogins, upsertIssuedLogins } from "../../src/lib/issued-logins";
import { applyPasswordReset, requestPasswordReset } from "../../src/lib/password-reset";

const SESSION_COOKIE = "better-auth.session_token";
const TOKEN_SUNNY = "apms-preview-sunny";
const TOKEN_PREFIX = "apms-login.";

interface Event {
  url: URL;
  req: Request & { method: string; headers: Headers };
}

function tokenFor(personId: string): string {
  if (personId === "p-admin") return TOKEN_SUNNY;
  return `${TOKEN_PREFIX}${personId}`;
}

function personIdFromToken(token: string): string | null {
  if (!token) return null;
  if (token === TOKEN_SUNNY) return "p-admin";
  if (token.startsWith(TOKEN_PREFIX)) return token.slice(TOKEN_PREFIX.length) || null;
  return null;
}

function readToken(req: { headers: Headers }): string | null {
  const cookie = req.headers.get("cookie") || "";
  const auth = req.headers.get("authorization") || "";
  const fromAuth = auth.match(/Bearer\s+(.+)/i)?.[1]?.trim();
  if (fromAuth) return fromAuth;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function readCompany(): Promise<{ people: LoginPerson[]; logins: LoginMap }> {
  try {
    const loaded = await loadCompanySnapshot();
    const snap = loaded.snapshotJson ? JSON.parse(loaded.snapshotJson) : null;
    const people = Array.isArray(snap?.people) ? (snap.people as LoginPerson[]) : [];
    const snapshotLogins =
      snap?.logins && typeof snap.logins === "object" && !Array.isArray(snap.logins)
        ? (snap.logins as LoginMap)
        : {};
    const issued = await loadIssuedLogins();
    return { people, logins: mergeLogins(snapshotLogins, issued) };
  } catch (err) {
    console.error("[apms-auth] snapshot", err);
    return { people: [], logins: await loadIssuedLogins().catch(() => ({})) };
  }
}

async function personFromToken(token: string | null): Promise<LoginPerson | null> {
  const id = personIdFromToken(token || "");
  if (!id) return null;
  const { people } = await readCompany();
  if (id === "p-admin") return people.find((p) => p.id === "p-admin" || p.username === "sunny.b") || SUNNY;
  return people.find((p) => p.id === id) || null;
}

function sessionPayload(person: LoginPerson) {
  const user = sessionUser(person);
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

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.clone().text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function sessionCookie(token: string | null, https: boolean): string {
  const base = token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=2592000`
    : `${SESSION_COOKIE}=; Path=/; Max-Age=0`;
  return https ? `${base}; SameSite=None; Secure` : `${base}; SameSite=Lax`;
}

function requestIsHttps(event: Event): boolean {
  const xf = (event.req.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (xf.includes("https")) return true;
  return event.url.protocol === "https:";
}

function rowsFrom(body: Record<string, unknown>) {
  const inner = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : body;
  const rows = inner.rows;
  if (Array.isArray(rows)) return rows;
  if (inner.username || inner.password) return [inner];
  return [];
}

export default async function apmsAuthMiddleware(
  event: Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  const method = (event.req.method || "GET").toUpperCase();

  if (path === "/api/company") return next();

  if (path === "/api/password-reset" || path === "/api/password-reset/apply") {
    if (method !== "POST") return json(405, { ok: false });
    try {
      const body = await readJson(event.req);
      const inner = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : body;
      const token = String(inner.token || "");
      const password = String(inner.password || "");
      if (token && password) return json(200, await applyPasswordReset(token, password));
      return json(
        200,
        await requestPasswordReset(
          String(inner.login || inner.username || inner.email || ""),
          String(inner.origin || ""),
        ),
      );
    } catch (err) {
      console.error("[password-reset]", err);
      return json(200, { ok: true });
    }
  }

  if (path === "/api/issued-logins" || path === "/api/provision-logins") {
    if (method === "GET" || method === "HEAD") {
      return json(200, { ok: true, added: 0, sent: 0, failed: [] });
    }
    if (method === "POST") {
      try {
        const body = await readJson(event.req);
        const rows = rowsFrom(body);
        const added = await upsertIssuedLogins(rows);
        return json(200, { ok: true, added, sent: 0, failed: [] });
      } catch (err) {
        console.error("[issued-logins]", err);
        return json(200, {
          ok: false,
          added: 0,
          sent: 0,
          failed: [{ reason: err instanceof Error ? err.message : "failed" }],
        });
      }
    }
  }

  if (!path.startsWith("/api/auth")) return next();

  if (path.endsWith("/get-session") && (method === "GET" || method === "POST")) {
    const person = await personFromToken(readToken(event.req));
    if (!person) return json(200, null);
    return json(200, sessionPayload(person));
  }

  if (
    (path.endsWith("/sign-in/username") || path.endsWith("/sign-in/email")) &&
    method === "POST"
  ) {
    const body = await readJson(event.req);
    const user = String(body.username || body.email || "");
    const pass = String(body.password || "");
    const { people, logins } = await readCompany();
    const person = verifyLogin(people, logins, user, pass);
    if (!person) {
      return json(401, { message: "Invalid username or password" });
    }
    const payload = sessionPayload(person);
    return json(200, payload, {
      "set-cookie": sessionCookie(payload.token, requestIsHttps(event)),
      "set-auth-token": payload.token,
    });
  }

  if (path.endsWith("/sign-out") && (method === "POST" || method === "GET")) {
    return json(200, { success: true }, {
      "set-cookie": sessionCookie(null, requestIsHttps(event)),
    });
  }

  return next();
}
