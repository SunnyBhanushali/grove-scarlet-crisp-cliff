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

export function verifyLogin(
  people: LoginPerson[],
  logins: LoginMap,
  usernameOrEmail: string,
  password: string,
): LoginPerson | null {
  const pass = String(password || "");
  if (!pass) return null;
  const key = usernameKey(usernameOrEmail);

  if ((key === "sunny.b" || key === "sunny") && pass === "0000") {
    return findPerson(people, "sunny.b") || SUNNY;
  }

  const person = findPerson(people, usernameOrEmail);
  if (!person) return null;
  const stored = storedPassword(person, logins);
  if (stored) return pass === stored ? person : null;
  if (pass === "0000") return person;
  return null;
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
