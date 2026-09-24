import { verifyPassword } from "./apms-password.ts";

export type LoginPerson = {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  password?: string;
  status?: string;
  mustResetPassword?: boolean;
};

export type LoginMap = Record<string, { personId?: string; password?: string }>;

export function usernameKey(value: string): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

export const SUNNY: LoginPerson = {
  id: "p-admin",
  name: "Sunny",
  email: "sunny.b@aliens.local",
  username: "sunny.b",
  password: "0000",
  status: "active",
};

function isLeft(person: LoginPerson | undefined): boolean {
  return (person?.status || "active") === "left";
}

function storedPassword(person: LoginPerson, logins: LoginMap): string {
  const u = usernameKey(person.username || "");
  const fromMap =
    (u && logins[u]?.password) ||
    (person.id && logins[person.id]?.password) ||
    "";
  return String(fromMap || person.password || "");
}

export function findPerson(
  people: LoginPerson[],
  usernameOrEmail: string,
): LoginPerson | null {
  const key = usernameKey(usernameOrEmail);
  const email = String(usernameOrEmail || "").trim().toLowerCase();
  if (!key && !email) return null;
  const hit = (people || []).find((p) => {
    if (!p || isLeft(p)) return false;
    const u = usernameKey(p.username || "");
    const e = String(p.email || "").trim().toLowerCase();
    return (
      (u && u === key) ||
      (e && e === email) ||
      (e && key && e === `${key}@aliens.local`) ||
      (u && email && `${u}@aliens.local` === email)
    );
  });
  return hit || null;
}

/**
 * BATCH-3: `APMS_DEFAULT_PIN=on|off` (default on). When off, `0000` never
 * signs anyone in: not the `sunny.b` / `sunny` shortcut, not the fallback for
 * a person with no stored password, not a stored `0000`.
 */
export function defaultPinEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.APMS_DEFAULT_PIN ?? "on").trim().toLowerCase();
  return !["off", "0", "false", "no"].includes(v);
}

export const DEFAULT_PIN = "0000";

export type LoginVerdict =
  | { person: LoginPerson; reason: "ok" }
  | { person: null; reason: "wrong" | "default-pin-off" };

export function verifyLoginDetailed(
  people: LoginPerson[],
  logins: LoginMap,
  usernameOrEmail: string,
  password: string,
  opts: { defaultPin?: boolean } = {},
): LoginVerdict {
  const pass = String(password || "");
  if (!pass) return { person: null, reason: "wrong" };
  const key = usernameKey(usernameOrEmail);
  const pinOn = opts.defaultPin ?? defaultPinEnabled();

  if (pass === DEFAULT_PIN && !pinOn) return { person: null, reason: "default-pin-off" };
  if ((key === "sunny.b" || key === "sunny") && pass === DEFAULT_PIN) {
    return { person: findPerson(people, "sunny.b") || SUNNY, reason: "ok" };
  }

  const person = findPerson(people, usernameOrEmail);
  if (!person) return { person: null, reason: "wrong" };
  const stored = storedPassword(person, logins);
  if (stored) return verifyPassword(pass, stored) ? { person, reason: "ok" } : { person: null, reason: "wrong" };
  if (pass === DEFAULT_PIN) return { person, reason: "ok" };
  return { person: null, reason: "wrong" };
}

export function verifyLogin(
  people: LoginPerson[],
  logins: LoginMap,
  usernameOrEmail: string,
  password: string,
  opts: { defaultPin?: boolean } = {},
): LoginPerson | null {
  return verifyLoginDetailed(people, logins, usernameOrEmail, password, opts).person;
}

export function sessionUser(person: LoginPerson) {
  const username = usernameKey(person.username || person.email || "") || "user";
  const email =
    String(person.email || "").trim() || `${username}@aliens.local`;
  return {
    id: person.id,
    name: person.name || username,
    email,
    username,
    emailVerified: true,
    mustResetPassword: person.mustResetPassword === true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
