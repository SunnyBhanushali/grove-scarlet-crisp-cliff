/** Forgot-password JSON the SPA reads. Keep in sync with GROK-BUILD-LOCK.md. */

export const HR_RESET_MESSAGE = "Contact HR to reset this password.";

export function hasPublicMailbox(email: string): boolean {
  const to = String(email || "").trim().toLowerCase();
  if (!to || !to.includes("@")) return false;
  if (to.endsWith("@aliens.local")) return false;
  return true;
}

export function passwordResetClientPayload(opts: {
  found: boolean;
  hasPublicEmail: boolean;
  mailed: boolean;
  live: boolean;
  temp?: string;
  previewLink?: string;
}): {
  ok: true;
  emailed?: boolean;
  sent?: boolean;
  needHr?: boolean;
  message?: string;
  previewPassword?: string;
  previewLink?: string;
} {
  if (!opts.found) return { ok: true };
  if (!opts.hasPublicEmail) {
    return { ok: true, needHr: true, message: HR_RESET_MESSAGE };
  }
  if (opts.mailed) return { ok: true, emailed: true, sent: true };
  if (opts.live) {
    return { ok: true, needHr: true, message: HR_RESET_MESSAGE };
  }
  return {
    ok: true,
    sent: false,
    ...(opts.temp ? { previewPassword: opts.temp } : {}),
    ...(opts.previewLink ? { previewLink: opts.previewLink } : {}),
  };
}
