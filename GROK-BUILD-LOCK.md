# APMS — do not regress (live locks)

Paste this into Grok Build as locks. Production is **https://app.alienstattoo.in**.

These rules beat any later “simplify auth / drop mail / Vercel preset” suggestion.

## Deploy

- Self-host Node. **Always `node-server`.** Ignore `NITRO_PRESET=vercel` (Grok injects it). Real `.output/server/index.mjs` (`npm start`). A zip with only `.output/public` is **broken** — do not ship it.
- `npm run build` / `build:app` must fail if `.output/server/index.mjs` is missing.
- Keep server **`.env` + DB `aliens_apms`** on every zip. **Never wipe the DB.** **Never put `SMTP_PASS` in the zip.**
- Keep **nodemailer** in `package.json` dependencies and in the server bundle.
- `vercel.json` is empty on purpose. Crons are host crontab / PM2, not Vercel.

Staging may use port **3010** + DB `aliens_apms_test`. Same build, different env.


## `/api/company`

- Always auth. Anon → **401**.
- Route-level **dual auth**: better-auth session **or** legacy `apms-login.*` / `apms-preview-sunny`.
- **Never** return the full snapshot without a resolved `personId`.
- Do **not** intercept this path in middleware with legacy tokens only (that broke People / Me / Roles). Middleware must `next()` and let the route resolve the person.

## Forgot password (Sunny lock)

API `POST /api/password-reset`:

| Case | Body |
|---|---|
| Unknown login | `{ ok: true }` only |
| No real email / `@aliens.local` | `{ ok: true, needHr: true, message: "Contact HR to reset this password." }` |
| SMTP OK | `{ ok: true, emailed: true, sent: true }` |
| SMTP fail on production | `{ ok: true, needHr: true, … }` — **never** `previewLink` on live |
| `previewLink` / `previewPassword` | **non-prod only** |

SPA: `needHr` → show **Contact HR** (not “check your email”).

Temp password sets `mustResetPassword: true`. After they set a new one → `false`.

## SMTP (already on the server)

Env (do not hardcode the password):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hr@alienstattoos.com
SMTP_PASS=<app password>
SMTP_FROM=Aliens APMS <reset@alienstattoo.in>
```

New builds must keep sending via this env. Alias `reset@alienstattoo.in` → mailbox `hr@alienstattoos.com`.

## Usernames

**Do not** collapse to `johnsmit`. Live rule:

`lowercaseFirstName` + `.` + first **4** letters of last name (`john.smit`, `sunny.bhan`).

On collision grow last-name letters (5…full), then `.xxxx1`, `.xxxx2`… Keep **`sunny.b` / `0000`** as the super-admin fallback.

Provision / temp password → `mustResetPassword: true`. After reset → `false`.

## Client

- Null-safe `localeCompare` on roles / people sorts (`String(name||"").localeCompare`).
- Session cookies: **`Secure` only on HTTPS**. HTTP (local) uses `SameSite=Lax` without Secure.
- Login success uses `window.location.assign('/')` — do not `navigate()` on `/login` when the router can be null.

## Drive zip / VPS sync

1. Rebuild `node-server` if needed (`npm ci` → `npm run build:app` → `npm run deploy:migrate`).
2. Check signed-out `GET /api/company` → **401**.
3. Check forgot-password: **no** `previewLink` when `BETTER_AUTH_URL` is `app.alienstattoo.in`; `needHr` UI works.
4. Sync the build **keeping `.env` and DB**. Bounce staging `:3010` first.

Keep developing here. Preview is still 8080. Live is PM2 + nginx.
