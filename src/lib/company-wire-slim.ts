import type { Snapshot } from "./company-books.ts";
import { stripSnapshotUiSession } from "./company-ui-session.ts";

/** Drop passwordHash only. Keep logins + people.password — the SPA re-saves both. */
export function slimForWire(snapshot: Snapshot): Snapshot {
  const people = Array.isArray(snapshot.people)
    ? snapshot.people.map((row) => {
        if (!row || typeof row !== "object") return row;
        const rec = row as Record<string, unknown>;
        if (!rec.passwordHash) return row;
        const next = { ...rec };
        delete next.passwordHash;
        return next;
      })
    : snapshot.people;
  return stripSnapshotUiSession({ ...snapshot, people });
}
