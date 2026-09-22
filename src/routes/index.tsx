import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-sm text-muted-foreground">
      Opening Aliens APMS…
    </main>
  );
}
