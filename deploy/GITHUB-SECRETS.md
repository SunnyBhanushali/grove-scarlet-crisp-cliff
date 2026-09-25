# GitHub secrets for the deploy pipeline

Nothing secret is stored in the repository. Add these **9** secrets once
(the 10th, `VPS_PORT`, only if SSH is not on port 22).

**Where:** GitHub → the repository → **Settings** → (left menu) **Secrets and
variables** → **Actions** → green **New repository secret** → type the
*Name* exactly as below → paste the *Secret* → **Add secret**. Repeat for each.

| Name | What to paste | Where it comes from |
|---|---|---|
| `VPS_HOST` | the VPS IP address, e.g. `203.0.113.10` | Contabo panel / server owner |
| `VPS_PORT` | only if SSH is not 22 | server owner |
| `VPS_USER` | the CloudPanel site user that runs `apms-rewrite` | ROOT-CHECKLIST step 1 |
| `VPS_SSH_KEY` | the whole private key, from `-----BEGIN OPENSSH PRIVATE KEY-----` to `-----END OPENSSH PRIVATE KEY-----` | ROOT-CHECKLIST step 5 |
| `VPS_KNOWN_HOSTS` | the line `<ip> ssh-ed25519 AAAA…` (or `[<ip>]:<port> ssh-ed25519 …`) | ROOT-CHECKLIST step 5 |
| `LIVE_APP_DIR` | the live folder, e.g. `/home/SITEUSER/htdocs/apms.alienstattoo.in` (no trailing `/`) | ROOT-CHECKLIST step 1 |
| `APMS_CHECK_USER` | the username of the deploy-check login, e.g. `deploy.chec` | you, below |
| `APMS_CHECK_PASSWORD` | that login's password **on live** | you, below |
| `STAGING_PASSWORD` | a new password only for staging (12+ characters, used nowhere else) | you make it up |

## The deploy-check login (make it once, in APMS)

Every live deploy signs in with it, so it must be a real, working login:

1. In APMS (live) add a person, e.g. **Deploy Check (bot)**, lowest access role
   (employee), active, no team. Issue them a login the way you issue logins today.
2. Open a private/incognito window, sign in as that login, set a strong new
   password when asked. That username + new password are `APMS_CHECK_USER` /
   `APMS_CHECK_PASSWORD`.
3. Do not mark the person "left" (left people cannot sign in) and do not change
   its password without updating the secret — a wrong password makes every live
   deploy roll itself back (and 5 wrong tries lock the login for 15 minutes).

On staging the same username signs in with `STAGING_PASSWORD` (after
**Refresh staging data** copies the people across).

## Optional: a second click before live

GitHub → Settings → **Environments** → `live` (appears after the first run) →
**Required reviewers** → add yourself. Every live deploy and rollback then
waits for an **Approve** click.
