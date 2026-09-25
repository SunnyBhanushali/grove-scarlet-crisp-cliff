# One-time steps for the server owner (root / CloudPanel)

Do these once, in order. Nothing here touches the live database's data or the
running app. Replace `SITEUSER` with the CloudPanel site user that owns
`apms.alienstattoo.in` (the one whose `pm2 ls` shows `apms-rewrite`).

## 1. Check who runs live (1 minute)

```sh
sudo -iu SITEUSER pm2 describe apms-rewrite | grep -E 'status|script path|exec cwd'
```

- Expect `online`, script path `…/htdocs/apms.alienstattoo.in/.output/server/index.mjs`,
  exec cwd `…/htdocs/apms.alienstattoo.in`. Send that folder path to Sunny —
  it is the GitHub secret `LIVE_APP_DIR`.
- If `apms-rewrite` is **not** found for SITEUSER (it runs under root's PM2),
  move it to SITEUSER once (as SITEUSER: `cd <folder> && pm2 start
  .output/server/index.mjs --name apms-rewrite` with the same environment
  variables it has today — `pm2 env <id>` as root shows them — then
  `pm2 save`; as root `pm2 delete apms-rewrite && pm2 save`). The pipeline
  never needs root, so **no sudoers line is needed** once it runs as SITEUSER.
- Reboot safety: `systemctl status pm2-SITEUSER` should be active. If not, as
  root: `pm2 startup systemd -u SITEUSER --hp /home/SITEUSER`, then as
  SITEUSER: `pm2 save`.

## 2. DNS + staging site + SSL (CloudPanel, 5 minutes)

1. At the DNS provider: `A` record `staging.apms` → the VPS IP (same as `apms`).
2. CloudPanel → **Add Site** → **Create a Reverse Proxy** → domain
   `staging.apms.alienstattoo.in`, reverse proxy URL `http://127.0.0.1:3013`.
   (Any site user is fine — the app itself runs under SITEUSER.)
3. That site → **SSL/TLS** → **Actions → New Let's Encrypt Certificate**.

## 3. Staging database, its own login, and the env file (2 minutes)

Run as root. It creates a separate Postgres login that owns only
`aliens_apms_stage2` and has no rights on live tables, and writes the file the
pipeline reads. The random password is generated on the server and never
leaves it.

```sh
STAGE_PW="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE apms_stage2 LOGIN PASSWORD '$STAGE_PW'" \
  -c "CREATE DATABASE aliens_apms_stage2 OWNER apms_stage2"
sudo -iu SITEUSER bash -c "mkdir -p ~/apms-deploy/shared && chmod 700 ~/apms-deploy/shared && umask 077 && \
  printf 'DATABASE_URL=postgres://apms_stage2:%s@127.0.0.1:5432/aliens_apms_stage2\n' '$STAGE_PW' > ~/apms-deploy/shared/staging.env"
unset STAGE_PW
```

Do **not** put `SMTP_PASS` in that file — staging refuses to start if it is
there. The pipeline adds its own `BETTER_AUTH_SECRET` on first run.

## 4. nginx for live and staging (CloudPanel → Sites → Vhost, 5 minutes)

- Live (`apms.alienstattoo.in`): apply `deploy/nginx/apms.alienstattoo.in.conf`
  — upstream `apms_live` → **127.0.0.1:3003**, HTTP/2, gzip, unbuffered
  `/api/company-live`.
- Staging: apply `deploy/nginx/staging.apms.alienstattoo.in.conf` — upstream
  `apms_stage` → **127.0.0.1:3013**, plus `noindex`.
- Save each vhost (CloudPanel checks the config before reloading). Afterwards
  `https://apms.alienstattoo.in` must still load.

## 5. Let GitHub log in as SITEUSER (2 minutes)

On the VPS, as root:

```sh
sudo -iu SITEUSER bash -c 'ssh-keygen -q -t ed25519 -N "" -C github-actions-apms -f ~/.ssh/apms_github && \
  cat ~/.ssh/apms_github.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
  echo "----- VPS_SSH_KEY (paste into GitHub, then this file is deleted) -----" && cat ~/.ssh/apms_github && rm ~/.ssh/apms_github'
ssh-keyscan -t ed25519 -p 22 VPS_PUBLIC_IP 2>/dev/null   # -> VPS_KNOWN_HOSTS (use the SSH port, and the same IP as VPS_HOST)
```

Hand both outputs to Sunny over a private channel (they go straight into
GitHub secrets — see `deploy/GITHUB-SECRETS.md`) and keep no other copy.
If SSH runs on a port other than 22, tell Sunny the port (`VPS_PORT`).

## Optional hardening (only if the live app's role is the only one that uses the live DB)

```sh
sudo -u postgres psql -c "REVOKE CONNECT ON DATABASE aliens_apms_staging FROM PUBLIC" \
                      -c "GRANT CONNECT ON DATABASE aliens_apms_staging TO <live app role>"
```

After that the staging login cannot even open the live database.
Not required: the staging login already has no rights on live tables, and
every staging script refuses a `DATABASE_URL` that is not `aliens_apms_stage2`
or that uses the live login.
