import { createFileRoute } from "@tanstack/react-router";
import { handleOrgHttp } from "@/lib/company-org-read";

export const Route = createFileRoute("/api/org/$kind/$id")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const res = await handleOrgHttp(request);
        return res || Response.json({ ok: false, error: "not-found" }, { status: 404 });
      },
      PATCH: async ({ request }) => {
        const res = await handleOrgHttp(request);
        return res || Response.json({ ok: false, error: "not-found" }, { status: 404 });
      },
    },
  },
});
