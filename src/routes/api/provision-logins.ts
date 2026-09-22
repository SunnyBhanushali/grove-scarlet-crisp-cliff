import { createFileRoute } from "@tanstack/react-router";
import { ensureSunnyLogin, provisionLoginRows, type LoginRow } from "@/lib/auth-logins";
import { upsertIssuedLogins } from "@/lib/issued-logins";

function rowsFrom(body: unknown): LoginRow[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  const inner = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : rec;
  const rows = inner.rows;
  return Array.isArray(rows) ? (rows as LoginRow[]) : [];
}

export const Route = createFileRoute("/api/provision-logins")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => null);
          const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
          const bootstrap = rec.bootstrap === true || rec.ensureSunny === true;
          if (bootstrap) {
            try {
              await ensureSunnyLogin();
            } catch (err) {
              console.error("[provision-logins] sunny", err);
            }
          }
          const rows = rowsFrom(body);
          if (!rows.length) {
            return Response.json({ ok: true, added: bootstrap ? 1 : 0, failed: [], sent: 0 });
          }
          try {
            await upsertIssuedLogins(rows);
          } catch (err) {
            console.error("[provision-logins] issued", err);
          }
          const result = await provisionLoginRows(rows);
          return Response.json({ ok: true, sent: 0, ...result });
        } catch (err) {
          console.error("[provision-logins]", err);
          return Response.json(
            { ok: false, added: 0, sent: 0, failed: [{ reason: err instanceof Error ? err.message : "failed" }] },
            { status: 500 },
          );
        }
      },
    },
  },
});
