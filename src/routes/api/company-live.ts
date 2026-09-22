import { createFileRoute } from "@tanstack/react-router";
import { handleCompanyLiveRequest } from "@/lib/company-live-http";

export const Route = createFileRoute("/api/company-live")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCompanyLiveRequest(request),
    },
  },
});
