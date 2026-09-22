import { createFileRoute } from "@tanstack/react-router";
import { handleCompanyBackupsRequest } from "@/lib/company-backups-http";

export const Route = createFileRoute("/api/company-backups")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCompanyBackupsRequest(request),
      POST: async ({ request }) => handleCompanyBackupsRequest(request),
    },
  },
});
