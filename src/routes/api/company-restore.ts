import { createFileRoute } from "@tanstack/react-router";
import { handleCompanyRestoreRequest } from "@/lib/company-restore-http";

export const Route = createFileRoute("/api/company-restore")({
  server: {
    handlers: {
      POST: async ({ request }) => handleCompanyRestoreRequest(request),
    },
  },
});
