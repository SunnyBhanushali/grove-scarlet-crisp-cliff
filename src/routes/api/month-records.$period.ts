import { createFileRoute } from "@tanstack/react-router";
import { handleScreenReadHttp } from "@/lib/company-screen-read";

export const Route = createFileRoute("/api/month-records/$period")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const res = await handleScreenReadHttp(request);
        return res || Response.json({ ok: false, error: "not-found" }, { status: 404 });
      },
    },
  },
});
