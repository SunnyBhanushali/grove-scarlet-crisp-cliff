import { auth } from "@/lib/auth/server";
import { loginEmails, type LoginRow } from "./auth-login-match";

export type { LoginRow } from "./auth-login-match";
export { loginEmail, loginEmails, matchPerson } from "./auth-login-match";

async function upsertOneEmail(
  email: string,
  passwordHash: string,
  name: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (!existing) {
    const user = await ctx.internalAdapter.createUser({
      email,
      name,
      emailVerified: true,
    });
    if (!user?.id) return { ok: false, reason: `Could not create ${email}` };
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id || email,
      password: passwordHash,
    });
    return { ok: true };
  }
  const found = existing as { id?: string; user?: { id?: string } };
  const existingId = found.id || found.user?.id;
  if (!existingId) return { ok: false, reason: `Could not resolve ${email}` };
  const accounts = await ctx.internalAdapter.findAccounts(existingId);
  const cred = accounts.find((a) => a.providerId === "credential");
  if (cred) {
    await ctx.internalAdapter.updateAccount(cred.id, { password: passwordHash });
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: existingId,
      providerId: "credential",
      accountId: existingId || email,
      password: passwordHash,
    });
  }
  return { ok: true };
}

async function upsertCredential(row: LoginRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  const emails = loginEmails(row);
  const password = String(row.password || "");
  if (!emails.length) return { ok: false, reason: "Missing email/username" };
  if (!password) return { ok: false, reason: "Missing password" };
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const name = (row.name || row.username || emails[0].split("@")[0] || "User").trim();
  let last: { ok: true } | { ok: false; reason: string } = { ok: false, reason: "Missing email/username" };
  for (const email of emails) {
    try {
      last = await upsertOneEmail(email, hash, name);
    } catch (err) {
      last = { ok: false, reason: err instanceof Error ? err.message : "Could not save login" };
    }
  }
  return last;
}

export async function provisionLoginRows(rows: LoginRow[]): Promise<{
  added: number;
  failed: Array<{ email?: string; username?: string; reason: string }>;
}> {
  const failed: Array<{ email?: string; username?: string; reason: string }> = [];
  let added = 0;
  for (const row of rows) {
    try {
      const result = await upsertCredential(row);
      if (result.ok) added += 1;
      else failed.push({ email: row.email, username: row.username, reason: result.reason });
    } catch (err) {
      failed.push({
        email: row.email,
        username: row.username,
        reason: err instanceof Error ? err.message : "Could not save login",
      });
    }
  }
  return { added, failed };
}

export async function ensureSunnyLogin(): Promise<void> {
  await upsertCredential({
    email: "sunny.b@aliens.local",
    username: "sunny.b",
    password: "0000",
    name: "Sunny",
  });
}
