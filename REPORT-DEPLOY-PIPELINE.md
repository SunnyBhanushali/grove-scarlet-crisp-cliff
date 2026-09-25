# REPORT — Deploy pipeline (GitHub → Contabo)

Branch **`deploy-pipeline`** (from `perf-2`). Not merged to `main`. Live was
not touched: everything was built and tested on a throwaway copy of the
server (§8).

This replaces the manual Grok zip → unzip → build → restart routine. It keeps
the one long-running node-server under PM2, as the contract requires. It does
not use Vercel or serverless.

---

## 1. How to ship a change (the everyday flow)

1. **Claude Code makes the change** and pushes it to the **`staging`** branch
   (or you merge a pull request into `staging`).
2. GitHub builds it on the VPS and restarts **staging** by itself, in about
   3–5 minutes. Watch it under **GitHub → Actions → "Deploy to staging"**:
   green tick = done.
3. **Check it** at **https://staging.apms.alienstattoo.in**. It has
   yesterday's (or whenever you last refreshed) real data. **Everyone's
   password there is the staging password** (the `STAGING_PASSWORD` secret),
   and no email can go out from staging.
4. Happy? **GitHub → Actions → "Deploy to live" → Run workflow → Run**
   (leave "ref" as `staging`). This ships exactly what staging runs.
   (Pushing to a branch called **`release`** does the same thing.)
5. Wait for the green tick (about 5 minutes). Live has then been built,
   backed up, switched over and **checked with a real sign-in**. If any check
   failed, live was **put back automatically** and the run is **red** with the
   reason at the top.

Each live deploy restarts the app once. That is a few seconds where the site
answers "502". Open browsers reconnect by themselves.

## 2. How to roll back

- **Something looks wrong after a deploy?** **Actions → "Rollback live" → Run
  workflow → Run**, with the box left empty. Live goes back to the previous
  good build in under a minute (no rebuild). Press it again to go back one
  more.
- **A specific build:** the "Rollback live" run lists the builds kept on the
  server (the newest 5). Type the one you want (e.g.
  `20260925-170015-9a223ed0`) into the box.
- Rollback changes the **program only, never the data**. Anything people saved
  after the deploy stays. If you ever need the data from before a deploy, each
  live deploy saves a full database copy first (§5). Restoring it is a manual
  decision for the server owner. No button does it.

## 3. Refresh staging's data

**Actions → "Refresh staging data" → Run workflow.** This copies the live
database into staging's own database (`aliens_apms_stage2`) and then:

- sets **every** person's password to the staging password, and
- blanks **every** email address (in columns, in the stored data, even inside
  notes), and
- removes sign-in sessions, reset links, lock-outs and the BATCH-3 plain-text
  password backup table. Old backup copies are thinned to the newest 3 and
  cleaned the same way.

Live is only read (a `pg_dump`). Run it whenever you want fresh data on
staging. It takes 1–2 minutes and staging is offline meanwhile.

## 4. What protects live

- **The live database is never dropped, migrated or restored automatically.**
  The pipeline only *reads* it (backup dump, staging copy). The build runs
  with no `DATABASE_URL` at all.
- Every build goes into a **new empty folder** from a clean copy of the code.
  Nothing is unzipped over the old one, so leftovers like the old `server.js`
  can't come along.
- Live keeps running while the new build installs and compiles. Only then does
  the switch happen (one atomic folder swap + `pm2 restart apms-rewrite`).
  Live keeps the exact environment PM2 already has.
- Only one live deploy or rollback can run at a time, on GitHub and on the
  server.
- **Staging can never write to live:** it has its own Postgres login, which has
  no rights on live tables. Every staging script also refuses to start if its
  database is not `aliens_apms_stage2` or it uses the live login. It refuses
  if `SMTP_PASS` is set, and it forces mail off and the `0000` PIN off. (All
  of this was tested, §8.)

## 5. What a live deploy does, step by step

1. **Preflight:** checks that PM2 `apms-rewrite` runs from the live folder, that
   there is 3 GB free, and that `pg_dump` and database access work.
2. **Upload** the exact commit (a clean `git archive`; old zips and test
   evidence are left out).
3. **Install + build** in `~/apms-deploy/live/releases/<date>-<commit>/`:
   `npm install --include=dev && NITRO_PRESET=node-server npm run build:app`,
   the same commands as today.
4. **Backup:** the current live folder (without `node_modules`) plus a
   `pg_dump` of the live database, into `~/apms-deploy/live/backups/<date>/`.
   The dump is checked to be readable. If the backup fails, nothing is
   switched. The newest 5 backups are kept.
5. **Switch:** the live folder path now points at the new build.
   `pm2 restart apms-rewrite`.
6. **Server check** (on the VPS): PM2 online, home page 200, and it serves the
   new build's `apms-sync.js?v=` stamp. If not within 2 minutes, the server
   switches back to the previous build by itself.
7. **Public check** (from GitHub, over HTTPS): home 200; the stamp matches; a
   signed-out `/api/company` gives 401; **a real sign-in** with the
   deploy-check login gives 200; the signed-in `/api/company` gives 200; then
   it signs out. If any of these fail, GitHub **rolls live back**, checks it
   again, and marks the run red.
8. **Record + tidy:** the build is marked "known-good". Only the newest 5
   builds are kept. Older ones keep just their compiled `.output` (enough to
   roll back to), not `node_modules`.

**The very first live deploy** also moves today's live folder (with its
leftovers) to `releases/<date>-pre-pipeline` and puts a link at the old path.
PM2, nginx and the path all stay the same.

## 6. One-time setup (in this order)

1. **Server owner:** `deploy/ROOT-CHECKLIST.md`. Steps: check PM2 (no sudoers
   needed), DNS + staging site + SSL in CloudPanel, the staging database and
   its env file, nginx for live (:3003) and staging (:3013), and the SSH key
   for GitHub.
2. **Sunny:** add the GitHub secrets in `deploy/GITHUB-SECRETS.md` (9 of them)
   and make the **deploy-check login** in APMS.
3. **Make the buttons appear.** GitHub only shows "Run workflow" buttons for
   workflow files that are on the **default branch (`main`)**. This branch is
   not merged to `main`, so until the `.github/` folder is on `main`:
   - staging deploys work (push to `staging`),
   - "Deploy to live" works by pushing to `release`,
   - "Rollback live" and "Refresh staging data" have **no button**.

   To get the buttons without merging any app code, put only `.github/` and
   `deploy/` on `main` (a small pull request; I can open it when you say so).
4. **First run:** "Refresh staging data". Then create the branch `staging` from
   `deploy-pipeline` (this triggers the first staging deploy). Check staging.
   Then run "Deploy to live". That first live deploy is the **p0as82 + p0as83
   cut** (see §7), so do it at a quiet hour.
5. Stop using the Grok deploy for this app. Its `npm run build` also runs
   `db:migrate`, which the pipeline never does.

## 7. Things to know

- **First cut and old-folder rollback.** The first live deploy runs BATCH-3
  code, which hashes every stored password on its first start
  (REPORT-BATCH-3 §BATCH-3 cut). The old live build (p0as39) cannot check
  hashed passwords. If that first deploy fails and is rolled back to the
  pre-pipeline folder, people who are already signed in keep working, but
  **new sign-ins fail** until you either deploy a fixed build or restore the
  passwords. You can restore them from the `apms_password_backup_<stamp>`
  table, or from the database copy taken just before the deploy. For this
  reason "Rollback live" **never goes to the pre-pipeline folder unless you
  type its name.** Also, every browser signs in once after this cut (BATCH-2
  note).
- **Database changes are one-way.** Rolling back the program does not undo
  tables or rows a newer build created at runtime. Builds so far only *add*
  things, so older builds ignore them.
- **Deploy-check login.** It appears in People like any person. If its
  password changes, update the secret. Otherwise every live deploy rolls
  back, and 5 wrong tries lock it for 15 minutes.
- **Disk:** a build is about 0.8 GB while it is current and 0.1–0.2 GB once
  slimmed. With 5 kept per side plus 5 backups, plan for about 3–5 GB under
  `~/apms-deploy`. The pre-pipeline copy is removed once 5 newer builds exist.
- **Staging runs 127.0.0.1:3013**, PM2 `apms-staging`, 1 GB heap, and
  restarts on reboot through the same `pm2 save`. It runs its own hourly
  backups inside its own database.
- `nginx`: the optional "serve `/assets/` straight from disk" block from
  NGINX-AND-SERVER.md is left out on purpose (§ in `deploy/nginx/*.conf`).

## 8. How it was verified

There is no SSH to the real VPS from here, and nothing was run against it. A
**throwaway VPS** was built inside this sandbox (Ubuntu 24.04, Postgres 16)
with the same layout as live:

- site user `alienstattoo-apms` with Node 22 only through `~/.nvm` (the system
  `node` is v20, as a trap);
- PM2 `apms-rewrite` on :3003, run from `~/htdocs/apms.alienstattoo.in`, with a
  stray `server.js` in the folder;
- live DB `aliens_apms_staging` with people who have real-looking emails and
  passwords, backup copies and a plain-text password backup table;
- the staging role and database created exactly as in ROOT-CHECKLIST step 3;
- sshd with key login.

`deploy/test/run-workflow.py` then ran **the real workflow files** step by
step, as a separate "runner" user over SSH, with the same secrets names. Only
the public URLs pointed at the ports instead of HTTPS. `deploy/test/e2e.sh`
does all of it in one go. Results are in `docs/deploy/E2E-RUN.txt`: **all
checks pass**. The runs:

| # | Run | Expected | What was checked |
|---|---|---|---|
| 01 | Refresh staging data (before any staging build) | ✅ | no email left in the staging DB (`pg_dump \| grep`), one staging hash for everyone, plain-text backup table not copied, sessions cleared, backups thinned to 3, live DB unchanged |
| 02 | Deploy to staging (push) | ✅ | staging password signs in; the **live** password is refused; `0000` refused; PM2 env: no `SMTP_PASS`, stage2 URL; the staging login can't write live tables |
| 03 | Deploy to live (button, ref `staging`) — first one | ✅ | old folder → `*-pre-pipeline` (with its `server.js`); new build has none; the running process is in the new folder; backup tarball + readable dump; new stamp served; real sign-in |
| 04 | Live: a build that crashes on boot | ❌ red | the server rolled itself back; live stays on the good build; that build is marked bad |
| 05 | Live: a build whose sign-in is broken (home page fine) | ❌ red | the public check caught it, GitHub rolled live back, re-checked it: "back on … and healthy" |
| 06 | Live: a build that does not compile | ❌ red | live untouched, no backup and no swap attempted |
| 07 | Deploy to live (push to `release`) | ✅ | second good build live |
| 08 | Rollback live (empty) | ✅ | skips bad builds, lands on the previous good one; the one it left is marked bad |
| 09 | Rollback live (empty) again | ❌ red | refuses to pick the pre-pipeline folder by itself, and says why |
| 09b | Rollback live `…-pre-pipeline` (by name) | ✅ | works, and warns about BATCH-3 passwords |
| 10 | Rollback live to a named build | ✅ | works |
| 11 | Deploy to live with a **wrong** deploy-check password | ❌ red | rolled back, and it says loudly that the rollback couldn't be verified either |
| 12 | 3 more live deploys | ✅ | ≤ 5 builds + running one; old builds slimmed; ≤ 5 backups |
| 13 | Rollback to a slimmed build | ✅ | healthy with `.output` only |
| 14–16 | Staging pointed at the live DB / live DB refresh / `SMTP_PASS` set | ❌ red | each refused with a clear message; live data intact |
| 17–18 | Refresh while staging runs; deploy staging again | ✅ | |

Also checked: the nginx blocks pass `nginx -t` (nginx 1.24) and serve both
sites over HTTP/2, with gzip and `noindex` on staging, and the 401 lock is
unchanged. `scripts/deploy-sanitize.test.mjs` proves that the staging hash
signs in through the app's own `verifyPassword`, and it is part of `npm test`.

Bugs this testing found and fixed before commit:
- GitHub's default shell hides a failed `ssh … | tee`, so every step now runs
  under `pipefail`.
- PM2 only reads config files named `*.config.cjs`.
- A non-interactive SSH login sees the system Node 20 instead of nvm's
  Node 22.
- A cleanup trap could fail the staging refresh at the very end.
- A failed `pm2 restart` skipped the rollback.
- The default rollback could pick a build that had already failed.

**Not verified here** (needs the real server): CloudPanel's own vhost screen,
Let's Encrypt, the real PM2 start command and env of `apms-rewrite` (preflight
checks these and stops with instructions), and GitHub-hosted runner specifics
(the workflow files use only standard features).

## 9. Files

| File | What it is |
|---|---|
| `.github/workflows/deploy-staging.yml` | push to `staging` → staging |
| `.github/workflows/deploy-live.yml` | push to `release` or the "Deploy to live" button |
| `.github/workflows/rollback-live.yml` | "Rollback live" button |
| `.github/workflows/refresh-staging-data.yml` | "Refresh staging data" button |
| `.github/actions/vps/action.yml` | SSH setup (pinned host key) + uploads the server scripts |
| `deploy/server/apms-deploy.sh` | runs on the VPS as the site user: preflight / receive / build / backup / activate / rollback / confirm / list / prune / refresh-staging |
| `deploy/server/sanitize-staging-db.mjs` | staging data cleaning (one transaction; it proves itself before commit) |
| `deploy/server/apms-staging.config.cjs` | PM2 app for staging (refuses unsafe env) |
| `deploy/ci/health-check.sh` | the public check (home, stamp, 401, sign-in, company, sign-out) |
| `deploy/nginx/*.conf` | nginx for live (:3003) and staging (:3013) |
| `deploy/ROOT-CHECKLIST.md` | one-time server-owner steps |
| `deploy/GITHUB-SECRETS.md` | the secrets, click by click |
| `deploy/test/*` | throwaway-VPS builder, local workflow runner, end-to-end test |
| `.gitattributes` | keeps old zips, test evidence and the stale `.output`/`dist` out of the upload |

On the server, run `bash ~/apms-deploy/bin/apms-deploy.sh list live` (or
`status live`) to see the builds and which one is running.

## HANDOFF

- Stamp / host: tree **p0as83** unchanged (no app code touched). Branch
  **`deploy-pipeline`** (from `perf-2`). Live still **p0as39 / p0as14**, not
  touched.
- Done: pipeline, scripts, checklists; end-to-end on a throwaway VPS
  (`docs/deploy/E2E-RUN.txt`, all pass); `npm test` includes the sanitizer
  test.
- Open: ROOT-CHECKLIST (server owner), GitHub secrets + deploy-check login
  (Sunny), and `.github/` + `deploy/` on `main` for the buttons (a PR, when
  asked).
- Next named job: the first "Deploy to live" is the p0as82 + p0as83 cut, at a
  quiet hour, after staging has been checked. Do not start Step 8.
