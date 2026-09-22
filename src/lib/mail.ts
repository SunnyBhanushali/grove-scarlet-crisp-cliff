import nodemailer from "nodemailer";

const DEFAULT_HOST = "smtp.gmail.com";
const DEFAULT_PORT = 587;
const DEFAULT_USER = "hr@alienstattoos.com";
const DEFAULT_FROM = "Aliens APMS <reset@alienstattoo.in>";

function env(key: string): string {
  return process.env[key]?.trim() || "";
}

export function mailFrom(): string {
  return env("SMTP_FROM") || DEFAULT_FROM;
}

export function mailUser(): string {
  return env("SMTP_USER") || DEFAULT_USER;
}

export function mailConfigured(): boolean {
  return Boolean(env("SMTP_PASS"));
}

function publicTo(address: string): string {
  const to = String(address || "").trim();
  if (!to || !to.includes("@")) return "";
  if (to.toLowerCase().endsWith("@aliens.local")) return "";
  return to;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!mailConfigured()) return { ok: false, reason: "mail not configured" };
  const to = publicTo(opts.to);
  if (!to) return { ok: false, reason: "no mailbox" };
  const port = Number(env("SMTP_PORT") || DEFAULT_PORT) || DEFAULT_PORT;
  const user = mailUser();
  const pass = env("SMTP_PASS");
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST") || DEFAULT_HOST,
    port,
    secure: port === 465,
    auth: pass ? { user, pass } : undefined,
  });
  await transporter.sendMail({
    from: mailFrom(),
    replyTo: user,
    envelope: { from: user, to },
    to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html || opts.text.replace(/\n/g, "<br/>"),
  });
  return { ok: true };
}
