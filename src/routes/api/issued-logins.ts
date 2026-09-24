import { createFileRoute } from "@tanstack/react-router";
import { upsertIssuedLogins, type IssuedRow } from "@/lib/issued-logins";
import { authorizeLoginWrite } from "@/lib/apms-admin-auth";

function rowsFrom(body: unknown): IssuedRow[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  const inner = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : rec;
  const rows = inner.rows;
  if (Array.isArray(rows)) return rows as IssuedRow[];
  if (inner.username || inner.password) return [inner as IssuedRow];
  return [];
}

export const Route = createFileRoute("/api/issued-logins")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => null);
          const rows = rowsFrom(body);
          // Admin: any rows. Anyone else: only their own row (own-password change).
          const refused = await authorizeLoginWrite(request.headers, rows, { allowOwn: true });
          if (refused) return refused;
          const added = await upsertIssuedLogins(rows);
          return Response.json({ ok: true, added, sent: 0, failed: [] });
        } catch (err) {
          console.error("[issued-logins]", err);
          return Response.json(
            {
              ok: false,
              added: 0,
              sent: 0,
              failed: [{ reason: err instanceof Error ? err.message : "failed" }],
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
