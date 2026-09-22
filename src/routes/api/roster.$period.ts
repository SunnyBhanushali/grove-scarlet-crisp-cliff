import { createFileRoute } from "@tanstack/react-router";
import { handleRosterHttp } from "@/lib/company-roster-http";

export const Route = createFileRoute("/api/roster/$period")({
  server: {
    handlers: {
      GET: async ({ request }) => handleRosterHttp(request),
      PATCH: async ({ request }) => handleRosterHttp(request),
    },
  },
});
