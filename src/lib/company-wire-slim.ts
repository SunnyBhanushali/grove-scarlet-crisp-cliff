import type { Snapshot } from "./company-books.ts";
import { stripSnapshotUiSession } from "./company-ui-session.ts";

/**
 * Secrets never ride the wire. `people[].password`, `people[].passwordHash`
 * and every `logins{}.password` are removed from what a browser downloads.
 * The server keeps them: auth reads the books directly (server/middleware),
 * people row PATCH preserves the stored password when the client sends none
 * (see company-entities.ts), and /api/provision-logins falls back to the
 * stored password when a row arrives without one.
 */
const PERSON_SECRET_FIELDS = ["password", "passwordHash"] as const;

export function slimPersonForWire(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const rec = row as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of PERSON_SECRET_FIELDS) {
    if (field in rec) {
      if (!next) next = { ...rec };
      delete next[field];
    }
  }
  return next || row;
}

export function slimLoginsForWire(logins: unknown): unknown {
  if (!logins || typeof logins !== "object" || Array.isArray(logins)) return logins;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(logins as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const rec = { ...(value as Record<string, unknown>) };
      delete rec.password;
      out[key] = rec;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function slimForWire(snapshot: Snapshot): Snapshot {
  const people = Array.isArray(snapshot.people) ? snapshot.people.map(slimPersonForWire) : snapshot.people;
  const next: Snapshot = { ...snapshot, people };
  if ("logins" in snapshot) next.logins = slimLoginsForWire(snapshot.logins);
  return stripSnapshotUiSession(next);
}
