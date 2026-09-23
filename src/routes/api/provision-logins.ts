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

/**
 * The wire no longer carries passwords, so a client re-provisioning existing
 * people sends rows without one. Fill from what the server already holds
 * (issued_logins, then the person row) before hashing.
 */
async function fillMissingPasswords(rows: LoginRow[]): Promise<LoginRow[]> {
  if (!rows.some((r) => !r || !String(r.password || ""))) return rows;
  let issued: Record<string, { personId?: string; password?: string }> = {};
  let people: Array<Record<string, unknown>> = [];
  try {
    const { loadIssuedLogins } = await import("@/lib/issued-logins");
    issued = await loadIssuedLogins();
  } catch {
    /* ignore */
  }
  try {
    const { readLiveSnapshot } = await import("@/lib/company-notebook");
    const snap = await readLiveSnapshot();
    people = Array.isArray(snap?.people) ? (snap!.people as Array<Record<string, unknown>>) : [];
  } catch {
    /* ignore */
  }
  return rows.map((row) => {
    if (!row || String(row.password || "")) return row;
    const uname = String(row.username || "").trim().toLowerCase();
    const pid = String(row.personId || "");
    const fromIssued = (uname && issued[uname]?.password) || (pid && issued[pid]?.password) || "";
    const person = people.find((p) => (pid && String(p.id) === pid) || (uname && String(p.username || "").toLowerCase() === uname));
    const fromPerson = person && typeof person.password === "string" ? person.password : "";
    const password = String(fromIssued || fromPerson || "");
    return password ? { ...row, password } : row;
  });
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
          const rows = await fillMissingPasswords(rowsFrom(body));
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
