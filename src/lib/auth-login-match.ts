export type LoginRow = {
  email?: string;
  username?: string;
  password?: string;
  name?: string;
  personId?: string;
};

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function usernameKey(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

/** Sign-in uses username, mapped to username@aliens.local. Work email is an extra key. */
export function loginEmails(row: LoginRow): string[] {
  const emails = new Set<string>();
  const username = usernameKey(row.username || "");
  const work = (row.email || "").trim().toLowerCase();
  if (username) emails.add(`${username}@aliens.local`);
  if (work && isEmail(work)) emails.add(work);
  return [...emails];
}

export function loginEmail(row: LoginRow): string {
  const emails = loginEmails(row);
  return emails.find((e) => e.endsWith("@aliens.local")) || emails[0] || "";
}

export function matchPerson(
  people: Array<Record<string, unknown>>,
  opts: { email?: string | null; username?: string | null; personId?: string | null },
): Record<string, unknown> | null {
  const id = (opts.personId || "").trim();
  if (id) {
    const hit = people.find((p) => p.id === id);
    if (hit) return hit;
  }
  const email = (opts.email || "").trim().toLowerCase();
  const username = usernameKey(opts.username || email);
  if (!email && !username) return null;
  return (
    (email
      ? people.find((p) => String(p.email || "").toLowerCase() === email)
      : undefined) ||
    (username
      ? people.find((p) => usernameKey(String(p.username || "")) === username)
      : undefined) ||
    (username
      ? people.find((p) => String(p.email || "").toLowerCase() === `${username}@aliens.local`)
      : undefined) ||
    null
  );
}

