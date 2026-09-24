/**
 * BATCH-3: stored passwords are scrypt hashes (node:crypto, no packages).
 *
 * Format: `scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url>` (32-byte key).
 * Every place that stores a password (issued_logins, the people row, logins
 * rows, the books) stores this string. `verifyPassword` also accepts a legacy
 * plain-text value so a row written before the one-time conversion (or put in
 * by hand) still signs in; the conversion (`apms-password-migrate.ts`) and
 * every write path turn plain text into a hash.
 *
 * Nothing here is ever sent to a browser: the wire strips `password` /
 * `passwordHash` (NO-SECRETS-WIRE).
 */
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

export const HASH_PREFIX = "scrypt$";
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export function isPasswordHash(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(HASH_PREFIX) && value.split("$").length === 6;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `${HASH_PREFIX}${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** A stored value as it must be written: hashes stay, plain text is hashed, empty stays empty. */
export function ensureHashed(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s || isPasswordHash(s)) return s;
  return hashPassword(s);
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when `password` matches the stored value (a hash, or legacy plain text). */
export function verifyPassword(password: string, stored: unknown): boolean {
  const pass = String(password || "");
  const s = stored === undefined || stored === null ? "" : String(stored);
  if (!pass || !s) return false;
  if (!isPasswordHash(s)) return safeEqual(Buffer.from(pass), Buffer.from(s));
  const [, n, r, p, saltB64, keyB64] = s.split("$");
  try {
    const key = Buffer.from(keyB64, "base64url");
    const got = scryptSync(pass, Buffer.from(saltB64, "base64url"), key.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return safeEqual(got, key);
  } catch {
    return false;
  }
}

/**
 * PERF: `verifyPassword` off the event loop. scrypt (N=16384) costs ~50 ms of
 * CPU; at sign-in time (a burst when the day starts) that blocked every other
 * request. Same result as `verifyPassword`, computed on the libuv pool.
 */
export async function verifyPasswordAsync(password: string, stored: unknown): Promise<boolean> {
  const pass = String(password || "");
  const s = stored === undefined || stored === null ? "" : String(stored);
  if (!pass || !s) return false;
  if (!isPasswordHash(s)) return safeEqual(Buffer.from(pass), Buffer.from(s));
  const [, n, r, p, saltB64, keyB64] = s.split("$");
  try {
    const key = Buffer.from(keyB64, "base64url");
    const got = await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        pass,
        Buffer.from(saltB64, "base64url"),
        key.length,
        { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)),
      ),
    );
    return safeEqual(got, key);
  } catch {
    return false;
  }
}

/** Remove password material from a person / logins record (for anything a client sees). */
export function withoutSecrets<T extends Record<string, unknown>>(rec: T): T {
  if (!rec || typeof rec !== "object") return rec;
  if (!("password" in rec) && !("passwordHash" in rec)) return rec;
  const next = { ...rec };
  delete (next as Record<string, unknown>).password;
  delete (next as Record<string, unknown>).passwordHash;
  return next;
}

/** In a whole snapshot (books / backup file), hash every stored password in place. Returns the count. */
export function hashSnapshotSecrets(
  snap: Record<string, unknown> | null | undefined,
  cache?: Map<string, string>,
): number {
  if (!snap || typeof snap !== "object") return 0;
  let n = 0;
  const conv = (key: string, v: unknown): string => {
    const s = String(v);
    const k = `${key}\u0000${s}`;
    const hit = cache?.get(k);
    if (hit) return hit;
    const h = hashPassword(s);
    cache?.set(k, h);
    return h;
  };
  const people = Array.isArray(snap.people) ? (snap.people as Array<Record<string, unknown>>) : [];
  for (const p of people) {
    if (!p || typeof p !== "object") continue;
    for (const f of ["password", "passwordHash"]) {
      const v = p[f];
      if (typeof v === "string" && v && !isPasswordHash(v)) {
        p[f] = conv(`p:${p.id}`, v);
        n += 1;
      }
    }
  }
  const logins = snap.logins;
  if (logins && typeof logins === "object" && !Array.isArray(logins)) {
    for (const [key, row] of Object.entries(logins as Record<string, Record<string, unknown>>)) {
      if (!row || typeof row !== "object") continue;
      const v = row.password;
      if (typeof v === "string" && v && !isPasswordHash(v)) {
        row.password = conv(`l:${row.personId || key}`, v);
        n += 1;
      }
    }
  }
  return n;
}
