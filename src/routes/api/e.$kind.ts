import { createFileRoute } from "@tanstack/react-router";
import { handleEntityV2Http } from "@/lib/company-entities-v2";

export const Route = createFileRoute("/api/e/$kind")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await handleEntityV2Http(request)) || Response.json({ ok: false, error: "not-found" }, { status: 404 }),
    },
  },
});
