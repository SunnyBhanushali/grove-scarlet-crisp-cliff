import { randomBytes } from "node:crypto";
import { getSql } from "./db";
import { loadCompanySnapshot, saveCompanySnapshot } from "./company-notebook";
import { ensureHashed } from "./apms-password.ts";
import { findPerson, usernameKey, type LoginPerson } from "./apms-credentials";
import { upsertIssuedLogins } from "./issued-logins";
import { mailConfigured, sendMail } from "./mail";
import { hasPublicMailbox, passwordResetClientPayload } from "./password-reset-payload";

type ResetRow = {
  token: string;
  person_id: string;
  username: string;
  expires_at: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  const sql = await getSql();
  await sql.query(`
    create table if not exists password_resets (
      token text primary key,
      person_id text not null,
      username text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `);
  ensured = true;
}

function peopleFrom(json: string | null): LoginPerson[] {
  if (!json) return [];
  try {
    const snap = JSON.parse(json);
    return Array.isArray(snap?.people) ? (snap.people as LoginPerson[]) : [];
  } catch {
    return [];
  }
}

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

function isLiveOrigin(): boolean {
  return (process.env.BETTER_AUTH_URL || "").includes("alienstattoo.in");
}

function publicOrigin(origin: string): string {
  return (
    (process.env.BETTER_AUTH_URL || "").replace(/\/$/, "") ||
    String(origin || "").replace(/\/$/, "") ||
    "https://app.alienstattoo.in"
  );
}

function resetEmail(person: LoginPerson, temp: string, signIn: string) {
  const name = String(person.name || person.username || "there").split(" ")[0];
  const username = usernameKey(person.username || person.email || "");
  const text = `Hi ${name},

You asked for a new Aliens APMS password.

Temporary password: ${temp}
Username: ${username}

Sign in at ${signIn}

You will be asked to set a new password of your own right after you sign in. This temporary password stops working once you do.

If you did not ask for this, tell HR (hr@alienstattoos.com).

— Aliens APMS
`;
  const html = `<div style="font:16px/1.5 IBM Plex Sans,Helvetica,sans-serif;color:#1A1612;background:#F4EFE6;padding:24px">
  <div style="max-width:32rem;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e7e0d4">
    <p style="margin:0 0 12px">Hi ${name},</p>
    <p style="margin:0 0 16px">You asked for a new Aliens APMS password.</p>
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b645c">Temporary password</p>
    <p style="margin:0 0 16px;font:20px/1.3 ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:.04em">${temp}</p>
    <p style="margin:0 0 16px">Username: <strong>${username}</strong></p>
    <p style="margin:0 0 16px"><a href="${signIn}" style="color:#1A1612">Sign in at app.alienstattoo.in</a></p>
    <p style="margin:0 0 16px">You will be asked to set a new password of your own right after you sign in.</p>
    <p style="margin:0;font-size:13px;color:#6b645c">If you did not ask for this, tell HR — hr@alienstattoos.com</p>
  </div>
</div>`;
  return { text, html };
}

async function writePassword(personId: string, username: string, password: string, mustReset: boolean) {
  const loaded = await loadCompanySnapshot();
  let person: LoginPerson | null = null;
  if (loaded.snapshotJson) {
    try {
      const snap = JSON.parse(loaded.snapshotJson) as { people?: LoginPerson[] };
      const people = Array.isArray(snap.people) ? snap.people : [];
      snap.people = people.map((p) => {
        if (p.id !== personId) return p;
        person = {
          ...p,
          password: ensureHashed(password),
          mustResetPassword: mustReset,
          username: p.username || username,
        };
        return person;
      }) as LoginPerson[];
      await saveCompanySnapshot(JSON.stringify(snap));
    } catch (err) {
      console.error("[password-reset] snapshot", err);
    }
  }
  if (!person) person = findPerson(peopleFrom(loaded.snapshotJson), username);
  await upsertIssuedLogins([
    {
      username,
      password,
      personId,
      name: person?.name,
      email: person?.email,
    },
  ]);
  return person;
}

/**
 * Forgot password (anonymous). BATCH-2: the account is changed only once the
 * temporary password has actually been emailed to the person's own mailbox.
 * Before, any anonymous caller could overwrite anyone's password (lock-out),
 * and off the live host the temp password came back in the response
 * (take-over). The temp / link are shown on screen only when the server is
 * started with APMS_RESET_PREVIEW=1 (local testing).
 */
export async function requestPasswordReset(login: string, origin: string) {
  await ensureTable();
  const loaded = await loadCompanySnapshot();
  const person = findPerson(peopleFrom(loaded.snapshotJson), login);
  const live = isLiveOrigin();
  const preview = process.env.APMS_RESET_PREVIEW === "1";
  if (!person) return passwordResetClientPayload({ found: false, hasPublicEmail: false, mailed: false, live });

  const publicEmail = hasPublicMailbox(String(person.email || ""));
  if (!publicEmail && !preview) {
    return passwordResetClientPayload({ found: true, hasPublicEmail: false, mailed: false, live });
  }

  const username = usernameKey(person.username || login);
  const temp = generateTempPassword();
  const token = randomBytes(24).toString("hex");
  const base = publicOrigin(origin);
  const signIn = `${base}/login`;

  let mailed = false;
  if (publicEmail && mailConfigured()) {
    const mail = resetEmail(person, temp, signIn);
    try {
      const sent = await sendMail({
        to: String(person.email || ""),
        subject: "Your temporary Aliens APMS password",
        text: mail.text,
        html: mail.html,
      });
      mailed = sent.ok;
      if (!sent.ok) console.error("[password-reset] mail", "reason" in sent ? sent.reason : "failed");
    } catch (err) {
      console.error("[password-reset] mail", err);
    }
  }
  if (!mailed && !preview) {
    // Nothing reached the person: leave their password alone.
    return passwordResetClientPayload({ found: true, hasPublicEmail: publicEmail, mailed: false, live: true });
  }

  await writePassword(person.id, username, temp, true);
  const sql = await getSql();
  await sql.query(`delete from password_resets where person_id = $1`, [person.id]);
  await sql.query(
    `insert into password_resets (token, person_id, username, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [token, person.id, username],
  );

  return passwordResetClientPayload({
    found: true,
    hasPublicEmail: true,
    mailed,
    live: live && !preview,
    temp,
    previewLink: `${base}/login?reset=${token}`,
  });
}

export async function applyPasswordReset(token: string, password: string) {
  const pass = String(password || "");
  if (pass.length < 8) return { ok: false as const, reason: "Password must be at least 8 characters." };
  if (pass === "0000" || pass === "Aliens2026") {
    return { ok: false as const, reason: "Choose a password that is not a starter password (not 0000)." };
  }
  await ensureTable();
  const sql = await getSql();
  const rows = await sql.query<ResetRow>(
    `select token, person_id, username, expires_at::text as expires_at
     from password_resets where token = $1 limit 1`,
    [String(token || "")],
  );
  const row = rows[0];
  if (!row) return { ok: false as const, reason: "That reset link is invalid or expired." };
  if (Date.parse(row.expires_at) < Date.now()) {
    await sql.query(`delete from password_resets where token = $1`, [row.token]);
    return { ok: false as const, reason: "That reset link has expired. Request a new one." };
  }

  await writePassword(row.person_id, row.username, pass, false);
  await sql.query(`delete from password_resets where token = $1`, [row.token]);
  return { ok: true as const };
}
