import { createFileRoute } from "@tanstack/react-router";
import { applyPasswordReset, requestPasswordReset } from "@/lib/password-reset";

export const Route = createFileRoute("/api/password-reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
          const inner = body?.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : body || {};
          const token = String(inner.token || "");
          const password = String(inner.password || "");
          if (token && password) return Response.json(await applyPasswordReset(token, password));
          const login = String(inner.login || inner.username || inner.email || "");
          const origin = String(inner.origin || request.headers.get("origin") || "");
          if (!login.trim()) return Response.json({ ok: true });
          return Response.json(await requestPasswordReset(login, origin));
        } catch (err) {
          console.error("[password-reset]", err);
          return Response.json({ ok: true });
        }
      },
    },
  },
});
