/**
 * BATCH-3: restore and passwords.
 *
 * A backup a browser downloads no longer carries passwords or hashes (nothing
 * secret ever reaches a client). Restoring such a file must not blank anyone's
 * password: a person / logins row that arrives without one keeps the password
 * stored now (like NO-SECRETS-WIRE on normal writes). Whatever plain text an
 * older file still carries is hashed before it is stored.
 */
import { hashSnapshotSecrets } from "./apms-password.ts";

type Q = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function keepStoredSecretsOnRestore(sql: Q, snap: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stored = new Map<string, Record<string, unknown>>();
  try {
    const rows = await sql.query<{ id: string; payload: Record<string, unknown> }>(
      `select id, payload from people where coalesce(payload->>'password','') <> '' or coalesce(payload->>'passwordHash','') <> ''`,
    );
    for (const r of rows) stored.set(r.id, r.payload || {});
  } catch {
    /* fresh install: nothing stored */
  }
  const storedLogins = new Map<string, string>();
  try {
    const rows = await sql.query<{ k1: string; payload: Record<string, unknown> }>(
      `select k1, payload from entities where kind = 'logins' and deleted_at is null and coalesce(payload->>'password','') <> ''`,
    );
    for (const r of rows) storedLogins.set(String(r.k1), String(r.payload.password));
  } catch {
    /* no entities yet */
  }
  const out: Record<string, unknown> = { ...snap };
  if (Array.isArray(snap.people)) {
    out.people = (snap.people as unknown[]).map((raw) => {
      const p = obj(raw);
      if (!p) return raw;
      const have = stored.get(String(p.id || ""));
      if (!have) return p;
      const next = { ...p };
      for (const f of ["password", "passwordHash"]) {
        if (!next[f] && have[f]) next[f] = have[f];
      }
      return next;
    });
  }
  const logins = obj(snap.logins);
  if (logins) {
    const next: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(logins)) {
      const r = obj(raw);
      if (r && !r.password && storedLogins.get(k)) next[k] = { ...r, password: storedLogins.get(k) };
      else next[k] = raw;
    }
    out.logins = next;
  }
  hashSnapshotSecrets(out);
  return out;
}
