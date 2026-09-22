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
import { hasSessionToken, unauthorizedJson } from "@/lib/apms-request-auth";
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
            if (!hasSessionToken(request.headers)) return unauthorizedJson();
            const wire = await getCompanyWire();
            const personId = await personIdForWire(request, wire);
            if (!personId) return unauthorizedJson();
            const body = await loadRequestedBooks(ids);
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
          if (!hasSessionToken(request.headers)) return unauthorizedJson();
          const wire = await getCompanyWire();
          const personId = await personIdForWire(request, wire);
          if (!personId) return unauthorizedJson();
          const body = await request.json().catch(() => null);
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
          return Response.json(await replaceCompanySnapshot(snapshot));
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
          if (!hasSessionToken(request.headers)) return unauthorizedJson();
          const body = await request.json().catch(() => null);
          const result = await patchCompanyBooks(body);
          return Response.json(result.body, { status: result.status });
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
