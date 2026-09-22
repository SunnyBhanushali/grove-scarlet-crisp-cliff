import { createFileRoute } from "@tanstack/react-router";
import { handleRosterBindHttp } from "@/lib/company-roster-bind-http";

export const Route = createFileRoute("/api/roster-bind/$kind/$subjectId")({
  server: {
    handlers: {
      GET: async ({ request }) => handleRosterBindHttp(request),
    },
  },
});
