import { createFileRoute } from "@tanstack/react-router";
import {
  companyIsEmpty,
  getCompanyWire,
  isAdminRestorePost,
  loadRequestedBooks,
  patchCompanyBooks,
  replaceCompanySnapshot,
} from "@/lib/company-notebook";
import {
  handleCompanyGetRequest,
  personIdForWire,
} from "@/lib/company-wire-http";
import { hasValidSession, unauthorizedJson } from "@/lib/apms-request-auth";
import { BOOK_IDS, type BookId } from "@/lib/company-books";
import { RestoreRejectedError } from "@/lib/company-restore-targets";

function extractSnapshotJson(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return null;
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return extractSnapshotJson(JSON.parse(t));
      } catch {
        return t;
      }
    }
    return t;
  }
  if (typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.json === "string" && rec.json.trim().startsWith("{")) return rec.json;
  if (rec.state && typeof rec.state === "object" && !Array.isArray(rec.state)) {
    return JSON.stringify(rec.state);
  }
  if (rec.data !== undefined) return extractSnapshotJson(rec.data);
  if (rec.payload !== undefined) return extractSnapshotJson(rec.payload);
  if (Array.isArray(rec.people) && rec.roles && typeof rec.roles === "object") {
    return JSON.stringify(rec);
  }
  return null;
}

function requestedBookIds(request: Request): BookId[] {
  try {
    const raw = new URL(request.url).searchParams.get("books") || "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is BookId => (BOOK_IDS as readonly string[]).includes(s));
    return ids;
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/company")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ids = requestedBookIds(request);
          if (ids.length) {
            if (!(await hasValidSession(request.headers))) return unauthorizedJson();
            const wire = await getCompanyWire({ encode: false });
            const personId = await personIdForWire(request, wire);
            if (!personId) return unauthorizedJson();
            const body = await loadRequestedBooks(ids, personId);
            return Response.json({ ok: true, personId, ...body });
          }
          const response = await handleCompanyGetRequest(request);
          return response;
        } catch (err) {
          console.error("[api/company GET]", err);
          return unauthorizedJson();
        }
      },
      POST: async ({ request }) => {
        try {
          if (!(await hasValidSession(request.headers))) return unauthorizedJson();
          const wire = await getCompanyWire({ encode: false });
          const personId = await personIdForWire(request, wire);
          if (!personId) return unauthorizedJson();
          const body = await request.json().catch(() => null);
          if (isAdminRestorePost(body)) {
            // BATCH-2: a full restore replaces the company — admins only.
            const { requireAdmin } = await import("@/lib/apms-admin-auth");
            const gate = await requireAdmin(request.headers);
            if (gate.response) return gate.response;
          }
          if (!isAdminRestorePost(body)) {
            console.error("[api/company POST] refused full snapshot (410) — use PATCH /api/company");
            return Response.json(
              { ok: false, error: "gone", message: "Full snapshot POST is disabled. Use PATCH /api/company with baseGens." },
              { status: 410 },
            );
          }
          const snapshot = extractSnapshotJson(body);
          if (!snapshot) {
            const empty = await companyIsEmpty();
            return Response.json({ ok: false, empty, error: "missing snapshot" });
          }
          const done = await replaceCompanySnapshot(snapshot);
          // BATCH-3: no password or hash goes back to the browser.
          const { slimForWire } = await import("@/lib/company-wire-slim");
          return Response.json({ ...done, snapshotJson: JSON.stringify(slimForWire(JSON.parse(done.snapshotJson))) });
        } catch (err) {
          if (err instanceof RestoreRejectedError) {
            return Response.json({ ok: false, error: err.message }, { status: 400 });
          }
          console.error("[api/company POST]", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          if (!(await hasValidSession(request.headers))) return unauthorizedJson();
          const body = await request.json().catch(() => null);
          // BATCH-3: tombstones (deletions carried by the book) are kept only
          // where the caller may delete; a 409 reply's books are filtered and
          // carry no password material.
          const { sessionPersonId } = await import("@/lib/apms-request-auth");
          const perm = await import("@/lib/apms-permissions");
          const viewer = await perm.loadViewer(String(await sessionPersonId(request.headers)));
          if (!viewer.admin && body && typeof body === "object") {
            const { readOrgBook } = await import("@/lib/company-notebook");
            const org = await readOrgBook();
            const storedTombs = (org.tombstones || {}) as Record<string, Record<string, unknown>>;
            const rec = body as Record<string, unknown>;
            const inner = (rec.data && typeof rec.data === "object" ? rec.data : rec) as Record<string, unknown>;
            const dropped: string[] = [];
            if (inner.tombstones && typeof inner.tombstones === "object") {
              const f = perm.filterTombstones(viewer, inner.tombstones as Record<string, Record<string, unknown>>, storedTombs);
              inner.tombstones = f.tombs;
              dropped.push(...f.dropped);
            }
            const orgBook = (inner.books as Record<string, Record<string, unknown>> | undefined)?.org;
            if (orgBook && orgBook.tombstones && typeof orgBook.tombstones === "object") {
              const f = perm.filterTombstones(viewer, orgBook.tombstones as Record<string, Record<string, unknown>>, storedTombs);
              orgBook.tombstones = f.tombs;
              dropped.push(...f.dropped);
            }
            if (dropped.length) {
              console.warn(`[api/company PATCH] ${viewer.id}: dropped ${dropped.length} tombstone(s) the caller may not apply: ${dropped.slice(0, 5).join(", ")}`);
            }
          }
          const result = await patchCompanyBooks(body);
          const ack = result.body as unknown as Record<string, unknown>;
          if (ack && ack.books && typeof ack.books === "object") {
            const { slimForWire } = await import("@/lib/company-wire-slim");
            const books: Record<string, unknown> = {};
            for (const [id, b] of Object.entries(ack.books as Record<string, Record<string, unknown>>)) {
              books[id] = perm.filterSnapshot(viewer, slimForWire(b as never) as Record<string, unknown>);
            }
            ack.books = books;
          }
          return Response.json(ack, { status: result.status });
        } catch (err) {
          const message = err instanceof Error ? err.stack || err.message : String(err);
          console.error("[api/company PATCH] patch-failed", message);
          const text = String((err as { message?: string })?.message || err || "");
          if (/stale|baseGen|conflict/i.test(text)) {
            return Response.json({ ok: false, error: "stale", message: text }, { status: 409 });
          }
          return Response.json({ ok: false, error: "patch-failed", message: text }, { status: 500 });
        }
      },
    },
  },
});
