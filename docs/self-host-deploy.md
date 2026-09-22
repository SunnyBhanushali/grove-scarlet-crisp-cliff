# Self-host on the Aliens VPS

**Live locks:** [`GROK-BUILD-LOCK.md`](../GROK-BUILD-LOCK.md). Follow that on every zip. Never wipe `aliens_apms`. Never pack `SMTP_PASS` into the zip.

This app is **not** a Vercel deploy. Production is a Node server behind nginx + PM2.

Do **not** cut over live `:3000` on first try. Run a side copy first (port **3010**, DB `aliens_apms_test`).

## Host (lock these)

| | Prod | First staging |
|---|---|---|
| Domain | https://app.alienstattoo.in | staging origin you choose |
| Path | `/home/alienstattoo-app/htdocs/app.alienstattoo.in` | a sibling folder |
| Process | PM2 | PM2 |
| Port | `3000` | `3010` |
| DB | `aliens_apms` on `127.0.0.1:5432` | `aliens_apms_test` |
| Bind | `0.0.0.0` | `0.0.0.0` |

Grok sandbox preview stays on **8080** (`npm run dev`). That is unrelated to PM2.

## Env (do not commit secrets)

Put these in the process environment (PM2 `env` / systemd / a root-owned `.env` that is **not** in git):

```
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/aliens_apms
VITE_AUTH_ENABLED=true
BETTER_AUTH_URL=https://app.alienstattoo.in
BETTER_AUTH_SECRET=<strong random, 32+ bytes>
PORT=3000
HOST=0.0.0.0
NITRO_HOST=0.0.0.0
NITRO_PRESET=node-server
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hr@alienstattoos.com
SMTP_PASS=<Workspace app password>
SMTP_FROM=Aliens APMS <reset@alienstattoo.in>
```

Staging: same keys, different `DATABASE_URL`, `BETTER_AUTH_URL`, `PORT=3010`.

`BETTER_AUTH_URL` must be the **public** origin browsers use (https://app.alienstattoo.in), not grok-sandbox.

## Build and run

From the app path, Node 22:

```sh
npm ci
NITRO_PRESET=node-server npm run build:app
npm run deploy:migrate
HOST=0.0.0.0 NITRO_HOST=0.0.0.0 PORT=3000 npm start
```

`npm start` is `node .output/server/index.mjs`.

PM2 (example, secrets stay in env, not in this file):

```sh
cd /home/alienstattoo-app/htdocs/app.alienstattoo.in
HOST=0.0.0.0 NITRO_HOST=0.0.0.0 PORT=3010 pm2 start npm --name aliens-apms-test -- start
# when staging is good:
# HOST=0.0.0.0 NITRO_HOST=0.0.0.0 PORT=3000 pm2 start npm --name aliens-apms -- start
```

Or `pm2 start ecosystem.config.cjs` after filling env in the process, not in git.

nginx should proxy the public host to `127.0.0.1:3000` (or 3010 for staging) with HTTPS.

## Auth

- Dual path: Better Auth session **or** legacy `apms-login.*` / `apms-preview-sunny`
- Signed-out `GET /api/company` → **401**
- Snapshot GET always includes `personId`. No person → 401. Middleware does not intercept `/api/company` with legacy-only tokens.
- Signed-out `/api/company-backups` → **401** (except loopback `?daily=1` for cron)

### Forgot password (email)

From **reset@alienstattoo.in** (alias of **hr@alienstattoos.com**).

Forgot password emails a **temporary password**. After they sign in with it they must set a new one (same gate as first login).

- Unknown login → `{ok:true}` only
- No real email / `@aliens.local` → `{needHr:true}` (SPA shows Contact HR)
- SMTP OK → `{emailed:true, sent:true}`
- SMTP fail on production → `{needHr:true}` — **never** `previewLink` on live
- `previewLink` / `previewPassword` only off production

Without `SMTP_PASS` the API still issues a temp password (sandbox can preview it). Live never returns the password in the browser.

### First login / after a temp password

People created with a starter password, and anyone who used Forgot password, have `mustResetPassword`. After sign-in they must set a new password (8+ characters, not `0000` / `Aliens2026`) before the app.

## Hourly backup (not Vercel)

`vercel.json` crons are **not** used on this host. The Node process takes a copy **every hour from 9am to 3am IST** (skips 4am–8am). Copies stay 30 days.

The running server ticks this itself. Optional crontab as a second trigger:

```
5 * * * * curl -fsS http://127.0.0.1:3000/api/company-backups?hourly=1 >/dev/null
```

Loopback only — that URL is rejected on the public host without a session. `?daily=1` still works (same hourly window).

Helper: `scripts/cron-daily-backup.sh` (`PORT` defaults to 3000).

## Login

After username/email sign-in the SPA does `window.location.assign('/')` (full reload). Do not use a second TanStack router on the login screen.

Hard reload must not request `*09c*` assets.

## UAT fixtures

Company snapshot save keeps `uat.*` / `p-uat-*` people and logins (`mergePreserveUatFixtures`). Org/People saves must not wipe those accounts.

## Zip / sync

1. Rebuild `node-server` if needed.
2. Check signed-out `/api/company` → 401; forgot-password has no live `previewLink`; `needHr` UI works.
3. Copy the build **keeping `.env` and the database**. Bounce `:3010` first.

## Check after start

1. `curl -s -o /dev/null -w '%{http_code}\n' https://app.alienstattoo.in/api/company` → 401 (or staging origin).
2. Sign in as a `uat.*` user → home, no `navigate` null in the console.
3. Network tab: no `*09c*` assets.
4. `npm start` keeps listening on the PORT you set.

## Continue building

Keep developing the recovered SPA and APIs in this repo. Preview here is still `npm run dev` on 8080. Ship to the VPS with `build:app` + `deploy:migrate` + PM2 `start`. Same tree, different env.
