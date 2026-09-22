import { createFileRoute } from "@tanstack/react-router";
import { handleChangesHttp } from "@/lib/company-entities-v2";

export const Route = createFileRoute("/api/changes")({
  server: { handlers: { GET: async ({ request }) => handleChangesHttp(request) } },
});
