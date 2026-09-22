import { createFileRoute } from "@tanstack/react-router";
import { handleEntityHttp } from "@/lib/company-entities";

export const Route = createFileRoute("/api/people/$id")({
  server: {
    handlers: {
      GET: async ({ request }) => handleEntityHttp(request),
      PATCH: async ({ request }) => handleEntityHttp(request),
    },
  },
});
