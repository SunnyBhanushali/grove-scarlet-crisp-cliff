import { createFileRoute } from "@tanstack/react-router";
import { handleCompanyTickRequest } from "@/lib/company-live-http";

export const Route = createFileRoute("/api/company-tick")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCompanyTickRequest(request),
    },
  },
});
