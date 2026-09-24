/**
 * BATCH-2 security: who may issue / reset logins and do other admin-only work.
 *
 * Admin = the person's access role has base `admin` or `super_admin`
 * (built-in roles by id, custom roles by their `base`). Read from the hot
 * `people` row and the `access-roles` entity rows — never from the client.
 */
import { usernameKey } from "./apms-credentials.ts";
import { forbiddenJson, sessionPersonId, unauthorizedJson } from "./apms-request-auth.ts";

export const ADMIN_BASES = new Set(["admin", "super_admin"]);

export type SessionPerson = {
  id: string;
  username: string;
  email: string;
  access: string;
  accessRoleId: string;
};

type Row = { payload: Record<string, unknown> | string };

function obj(v: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v;
}

export async function loadSessionPerson(personId: string): Promise<SessionPerson | null> {
  const { getSql } = await import("./db.ts");
  const sql = await getSql();
  let p: Record<string, unknown> | null = null;
  try {
    const rows = await sql.query<Row>(
      `select payload from people where id = $1 and deleted_at is null`,
      [personId],
    );
    if (rows[0]) p = obj(rows[0].payload);
  } catch {
    /* hot table missing (fresh install) → books below */
  }
  if (!p) {
    const { readLiveSnapshot } = await import("./company-notebook.ts");
    const snap = (await readLiveSnapshot().catch(() => null)) as {
      people?: Array<Record<string, unknown>>;
    } | null;
    p = (snap?.people || []).find((x) => x && x.id === personId) || null;
  }
  if (!p) return null;
  return {
    id: personId,
    username: String(p.username || ""),
    email: String(p.email || ""),
    access: String(p.access || ""),
    accessRoleId: String(p.accessRoleId || p.access || ""),
  };
}

async function accessRoleBase(roleId: string): Promise<string> {
  if (!roleId) return "";
  if (ADMIN_BASES.has(roleId)) return roleId;
  try {
    const { getSql } = await import("./db.ts");
    const sql = await getSql();
    const rows = await sql.query<Row>(
      `select payload from entities where kind = 'access-roles' and k1 = $1 and deleted_at is null`,
      [roleId],
    );
    if (rows[0]) return String(obj(rows[0].payload).base || roleId);
  } catch {
    /* no entity table yet */
  }
  return roleId;
}

export async function isAdminPerson(person: SessionPerson | null): Promise<boolean> {
  if (!person) return false;
  const base = await accessRoleBase(person.accessRoleId);
  return ADMIN_BASES.has(base);
}

/** 401 without a server-issued session, 403 when signed in but not an admin, else the admin. */
export async function requireAdmin(
  headers: Headers,
): Promise<{ person: SessionPerson; response: null } | { person: null; response: Response }> {
  const id = await sessionPersonId(headers);
  if (!id) return { person: null, response: unauthorizedJson() };
  const person = await loadSessionPerson(id);
  if (!(await isAdminPerson(person))) return { person: null, response: forbiddenJson() };
  return { person: person!, response: null };
}

export type LoginRowLike = {
  username?: string;
  email?: string;
  personId?: string;
  password?: string;
};

/** True when every row is the caller's own login (Me → change password, first-sign-in reset). */
export function rowsAreOwn(rows: LoginRowLike[], me: SessionPerson): boolean {
  if (!rows.length) return false;
  const mine = usernameKey(me.username || me.email);
  return rows.every((r) => {
    if (!r) return false;
    if (r.personId && String(r.personId) !== me.id) return false;
    const u = usernameKey(String(r.username || r.email || ""));
    return !!u && u === mine;
  });
}

/**
 * POST /api/issued-logins and /api/provision-logins.
 * Anonymous → 401. Admin → any rows. Anyone else → only their own row on
 * /api/issued-logins (the SPA's own-password change posts there); otherwise 403.
 */
export async function authorizeLoginWrite(
  headers: Headers,
  rows: LoginRowLike[],
  opts: { allowOwn: boolean },
): Promise<Response | null> {
  const id = await sessionPersonId(headers);
  if (!id) return unauthorizedJson();
  const person = await loadSessionPerson(id);
  if (!person) return unauthorizedJson();
  if (await isAdminPerson(person)) return null;
  if (opts.allowOwn && rowsAreOwn(rows, person)) return null;
  return forbiddenJson();
}
