import { createFileRoute } from "@tanstack/react-router";
import { handleEntityV2Http } from "@/lib/company-entities-v2";

const handler = async ({ request }: { request: Request }) =>
  (await handleEntityV2Http(request)) || Response.json({ ok: false, error: "not-found" }, { status: 404 });

export const Route = createFileRoute("/api/e/$kind/$k1/$k2")({
  server: { handlers: { GET: handler, PATCH: handler } },
});
