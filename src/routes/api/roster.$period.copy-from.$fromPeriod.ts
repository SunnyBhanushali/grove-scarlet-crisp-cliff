import { createFileRoute } from "@tanstack/react-router";
import { handleRosterHttp } from "@/lib/company-roster-http";

export const Route = createFileRoute("/api/roster/$period/copy-from/$fromPeriod")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRosterHttp(request),
    },
  },
});
