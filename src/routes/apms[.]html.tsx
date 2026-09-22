import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/apms.html")({
  ssr: false,
  component: ApmsHtml,
});

function ApmsHtml() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-sm text-muted-foreground">
      Opening Aliens APMS…
    </main>
  );
}
