/** firstname.xxxx — 4 letters of last name, then 5…full, then xxxx1, xxxx2… */

export function nameLetters(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function splitName(person: {
  firstName?: string;
  lastName?: string;
  name?: string;
}): { first: string; last: string } {
  const bits = String(person.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    first: String(person.firstName || bits[0] || "").trim(),
    last: String(person.lastName || bits.slice(1).join(" ") || "").trim(),
  };
}

export function usernameFits(username: string, first: string, last: string): boolean {
  const u = String(username || "")
    .trim()
    .toLowerCase();
  const f = nameLetters(first);
  const l = nameLetters(last);
  if (!u || !f) return false;
  if (u === "sunny.b" && f === "sunny") return true;
  const m = u.match(new RegExp(`^${f}\\.([a-z]+)(\\d*)$`));
  if (!m || !l.startsWith(m[1])) return false;
  const min = Math.min(4, l.length);
  if (m[2]) return m[1].length === min;
  return m[1].length >= min && m[1].length <= l.length;
}

export function makeUsername(
  first: string,
  last: string,
  taken: Set<string> = new Set(),
): string {
  const used = taken;
  const f = nameLetters(first);
  const l = nameLetters(last);
  if (!f) return "";
  const take = (u: string) => {
    if (used.has(u)) return false;
    used.add(u);
    return true;
  };
  if (!l) {
    if (take(f)) return f;
    for (let n = 1; ; n++) if (take(f + n)) return f + n;
  }
  const start = Math.min(4, l.length);
  for (let len = start; len <= l.length; len++) {
    const c = `${f}.${l.slice(0, len)}`;
    if (take(c)) return c;
  }
  const stem = `${f}.${l.slice(0, start)}`;
  for (let n = 1; ; n++) {
    const c = stem + n;
    if (take(c)) return c;
  }
}
