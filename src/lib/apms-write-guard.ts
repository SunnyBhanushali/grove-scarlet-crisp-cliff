/**
 * BATCH-2 security: row writes only an admin may make.
 *
 * The SPA hides these screens from non-admins, but the API accepted them from
 * any signed-in person, so an employee could raise their own access role or
 * set another person's password with one PATCH. The server now refuses (403):
 *
 *   - people: changing `access` / `accessRoleId` (anyone's, own included), or
 *     setting a password on someone else — unless the caller is an admin;
 *   - access-roles rows: any write by a non-admin;
 *   - logins rows: a non-admin may only write their own username's row.
 *
 * Everything else keeps the current (client-side) permission model; see
 * REPORT-BATCH-2.md → Security for the list of what is still open.
 */
import { isAdminPerson, loadSessionPerson } from "./apms-admin-auth.ts";
import { usernameKey } from "./apms-credentials.ts";

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The payload a PATCH body carries (`{ payload, baseRev }` or `{ data: { payload } }`). */
export function patchPayload(input: unknown): Record<string, unknown> {
  const rec = obj(input);
  const inner = rec.data && typeof rec.data === "object" ? obj(rec.data) : rec;
  return obj(inner.payload);
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** Reason a non-admin may not make this people write, or "" when it is fine. */
export function peopleWriteRefusal(
  requesterId: string,
  targetId: string,
  payload: Record<string, unknown>,
  stored: Record<string, unknown> | null,
): string {
  const before = stored || {};
  const merged = { ...before, ...payload };
  const accessOf = (p: Record<string, unknown>) => str(p.access) || str(p.accessRoleId) || "employee";
  const roleOf = (p: Record<string, unknown>) => str(p.accessRoleId) || str(p.access) || "employee";
  if (accessOf(merged) !== accessOf(before) || roleOf(merged) !== roleOf(before)) {
    return "only an admin can change an access role";
  }
  const pw = payload.password;
  if (typeof pw === "string" && pw.length > 0 && targetId !== requesterId && pw !== str(before.password)) {
    return "only an admin can set another person's password";
  }
  return "";
}

export async function requesterIsAdmin(personId: string): Promise<boolean> {
  return isAdminPerson(await loadSessionPerson(personId));
}

/** Entity-v2 kinds: reason a non-admin may not write this row, or "". */
export async function entityWriteRefusal(kind: string, k1: string, personId: string): Promise<string> {
  if (kind !== "access-roles" && kind !== "logins") return "";
  const me = await loadSessionPerson(personId);
  if (await isAdminPerson(me)) return "";
  if (kind === "logins" && me && usernameKey(k1) && usernameKey(k1) === usernameKey(me.username || me.email)) return "";
  return kind === "access-roles" ? "only an admin can change access roles" : "only an admin can change logins";
}
