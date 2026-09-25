#!/usr/bin/env bash
# End-to-end test of the deploy pipeline against a throwaway VPS (see
# vps-sim-setup.sh). Runs the REAL workflow files step by step with
# run-workflow.py, as a separate "runner" user over SSH, and checks the result
# of every run plus the server state after it.
#
# Run as root inside a disposable Ubuntu 24.04 container that has Postgres 16,
# Node 22 in /opt/node22, pm2, openssh-server, jq and python3-yaml:
#   deploy/test/e2e.sh <a node-server build of the app, used as "old live"> <workdir>
# Only the public URLs differ from GitHub: they point at the sim's ports
# (nginx + TLS are not part of the sim).
set -uo pipefail
SRC="${1:?built app folder}"
WORK="${2:?work dir}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SITE=alienstattoo-apms
H=/home/$SITE
LIVE_DIR=$H/htdocs/apms.alienstattoo.in
LIVE_DB=postgres://apms_live:live-db-pw@127.0.0.1:5432/aliens_apms_staging
STAGE_DB=postgres://apms_stage2:stage-db-pw@127.0.0.1:5432/aliens_apms_stage2
RUNNER=ghrunner
RH=/home/$RUNNER
PASS=0
FAIL=0
export PATH=/opt/node22/bin:$PATH

ok() { PASS=$((PASS + 1)); echo "PASS  $*"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL  $*"; }
check() { local what="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }
as_site() { su - "$SITE" -c "PATH=/opt/node22/bin:\$PATH $*"; }
live_release() { basename "$(readlink -f "$LIVE_DIR")"; }
signin() { # signin <port> <user> <password> -> http code
  curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
    -d "$(jq -n --arg u "$2" --arg p "$3" '{username:$u,password:$p}')" "http://127.0.0.1:$1/api/auth/sign-in/username"
}

wf() { # wf <label> <expected exit 0|1> <workflow file> [runner args…]
  local label="$1" want="$2" file="$3"
  shift 3
  echo
  echo "================ $label"
  su "$RUNNER" -c "cd $RH && python3 $RH/e2e-repo/deploy/test/run-workflow.py .github/workflows/$file --repo $RH/e2e-repo --work $RH/runs --secrets ${SECRETS:-$RH/secrets.json} $* --env LIVE_URL=http://127.0.0.1:3003 --env STAGING_URL=http://127.0.0.1:3013" \
    >"$WORK/logs/$label.log" 2>&1
  local rc=$?
  grep -E '^(---|!!!|===|  ok|HEALTH|::error|::warning|\[apms-deploy|\[sanitize|ACTIVE|PREVIOUS|STAMP|REFRESHED|CONFIRMED|### )' "$WORK/logs/$label.log" | grep -v add-mask | sed 's/^/    /' | tail -n 45
  if [ "$rc" = "$want" ]; then ok "$label: workflow exit $rc as expected"; else bad "$label: workflow exit $rc, expected $want"; fi
}

mkdir -p "$WORK/logs"
echo "######## setting up the throwaway VPS"
bash "$REPO/deploy/test/vps-sim-setup.sh" "$SRC" "$WORK/sim" | tail -n1

# --- live data: people with real-looking emails and passwords, backups, a plain-text backup table
node --input-type=module -e "
import { hashPassword } from '$REPO/src/lib/apms-password.ts';
const people = [
  { id: 'p-dc', name: 'Deploy Check (bot)', username: 'deploy.chec', email: 'deploy-check@alienstattoos.com', password: hashPassword('Deploy-Check-Live-1'), status: 'active', accessRole: 'employee' },
  { id: 'p-1', name: 'Asha Rao', username: 'asha.rao', email: 'asha.rao@gmail.com', personalEmail: 'asha@yahoo.in', password: hashPassword('Asha-Real-Pw-9'), status: 'active' },
  { id: 'p-2', name: 'Ravi Kumar', username: 'ravi.kuma', email: 'ravi@alienstattoos.com', status: 'active', mustResetPassword: true },
];
const e = (s) => s.replace(/'/g, \"''\");
let q = 'begin;\n';
for (const p of people) q += \`insert into people (id, payload) values ('\${p.id}', '\${e(JSON.stringify(p))}'::jsonb);\n\`;
q += \`insert into issued_logins (username, person_id, password) values ('asha.rao','p-1','\${people[1].password}'), ('deploy.chec','p-dc','\${people[0].password}');\n\`;
q += \`insert into entities (kind, id, k1, payload) values ('logins','ravi.kuma','ravi.kuma','\${e(JSON.stringify({ personId: 'p-2', password: hashPassword('Ravi-Old-7'), email: 'ravi@alienstattoos.com' }))}'::jsonb);\n\`;
const book = { people: people.map(({ password, ...p }) => ({ ...p, password: 'plain-in-book' })), notices: [{ text: 'Write to hr@alienstattoos.com for payslips' }] };
q += \`insert into company_books (book, snapshot_json) values ('org', '\${e(JSON.stringify(book))}');\n\`;
for (let i = 0; i < 6; i++) q += \`insert into company_backups (id, kind, expires_at, snapshot_json, created_at) values ('bk\${i}','hourly', now() + interval '30 days', '\${e(JSON.stringify(book))}', now() - interval '\${i} hours');\n\`;
q += \"create table apms_password_backup_20260920101010 (source text, ref text, password text); insert into apms_password_backup_20260920101010 values ('x','y','PlainTextSecret');\n\";
process.stdout.write(q + 'commit;\n');
" >"$WORK/seed.sql"
(cd "$SRC" && DATABASE_URL=$LIVE_DB node scripts/migrate.mjs >/dev/null) # sim only: create the live tables
psql "$LIVE_DB" -q -v ON_ERROR_STOP=1 -f "$WORK/seed.sql"
as_site "pm2 restart apms-rewrite" >/dev/null
sleep 4
check "sim live answers sign-in for the deploy-check login" test "$(signin 3003 deploy.chec Deploy-Check-Live-1)" = 200

# --- ROOT-CHECKLIST step 3 (staging DB login + env file), as written there
as_site 'mkdir -p ~/apms-deploy/shared && chmod 700 ~/apms-deploy/shared && umask 077 && printf "DATABASE_URL=postgres://apms_stage2:stage-db-pw@127.0.0.1:5432/aliens_apms_stage2\n" > ~/apms-deploy/shared/staging.env'

# --- the "GitHub" side: runner user, a clone with the branches + three broken test builds
id "$RUNNER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUNNER"
rm -rf "$RH/e2e-repo" "$RH/runs"
git config --system --add safe.directory '*' 2>/dev/null || true
su "$RUNNER" -c "git clone -q --no-local $REPO $RH/e2e-repo && cd $RH/e2e-repo && git config user.email e2e@local && git config user.name e2e \
  && git branch -f staging HEAD && git branch -f release HEAD \
  && git checkout -q -b sim-crash && sed -i '1i throw new Error(\"SIM crash on boot\");' server/middleware/00-apms-spa.ts && git commit -qam crash \
  && git checkout -q HEAD~1 -b sim-signin && python3 -c \"
p='server/middleware/01-apms-auth.ts'; s=open(p).read()
s=s.replace('    const body = await readJson(event.req);\n    const user = String(body.username', '    return json(503, { message: \\\"SIM: sign-in broken\\\" });\n    const body = await readJson(event.req);\n    const user = String(body.username', 1); open(p,'w').write(s)\" \
  && git commit -qam signin && git checkout -q release && git checkout -q -b sim-syntax && echo 'const = ;' >> server/middleware/00-apms-spa.ts && git commit -qam syntax \
  && git checkout -q release"
python3 - "$WORK/sim" "$RH" <<'EOF'
import json, sys
sim, rh = sys.argv[1], sys.argv[2]
s = {"VPS_HOST": "127.0.0.1", "VPS_PORT": "2222", "VPS_USER": "alienstattoo-apms",
     "VPS_SSH_KEY": open(f"{sim}/id_ed25519").read(), "VPS_KNOWN_HOSTS": open(f"{sim}/known_hosts").read(),
     "LIVE_APP_DIR": "/home/alienstattoo-apms/htdocs/apms.alienstattoo.in",
     "APMS_CHECK_USER": "deploy.chec", "APMS_CHECK_PASSWORD": "Deploy-Check-Live-1", "STAGING_PASSWORD": "Staging-Only-2026"}
json.dump(s, open(f"{rh}/secrets.json", "w"))
s["APMS_CHECK_PASSWORD"] = "wrong-password"
json.dump(s, open(f"{rh}/secrets-wrong.json", "w"))
EOF
chown "$RUNNER:" "$RH"/secrets*.json && chmod 600 "$RH"/secrets*.json

# ============================================================ staging
wf "01-refresh-staging-before-any-build" 0 refresh-staging-data.yml --event workflow_dispatch --ref release
wf "02-deploy-staging" 0 deploy-staging.yml --event push --ref staging
check "staging: staging password signs in (asha.rao)" test "$(signin 3013 asha.rao Staging-Only-2026)" = 200
check "staging: asha.rao's LIVE password is refused" test "$(signin 3013 asha.rao Asha-Real-Pw-9)" = 401
check "staging: 0000 is refused (APMS_DEFAULT_PIN=off)" test "$(signin 3013 sunny.b 0000)" = 401
check "staging: no email address left anywhere in its database" bash -c "! pg_dump '$STAGE_DB' | grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' | grep -v '@aliens\.local' | grep -q ."
check "staging: plain-text password backup table not copied" test -z "$(psql "$STAGE_DB" -tAc "select tablename from pg_tables where tablename like 'apms_password_backup%'")"
check "staging: backup copies thinned to 3" test "$(psql "$STAGE_DB" -tAc 'select count(*) from company_backups')" = 3
check "staging: PM2 env has no SMTP_PASS and the stage2 DATABASE_URL" bash -c "su - $SITE -c 'PATH=/opt/node22/bin:\$PATH pm2 jlist' | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const p=JSON.parse(s.slice(s.indexOf(\"[{\"))).find(x=>x.name===\"apms-staging\").pm2_env; process.exit(p.SMTP_PASS===\"\" && /aliens_apms_stage2\$/.test(p.DATABASE_URL) && p.APMS_DEFAULT_PIN===\"off\" ? 0 : 1)})'"
check "staging: its DB login cannot write live tables" bash -c "! psql 'postgres://apms_stage2:stage-db-pw@127.0.0.1:5432/aliens_apms_staging' -c 'update people set payload = payload' 2>/dev/null"
check "live DB untouched by the refresh (emails still there)" test "$(psql "$LIVE_DB" -tAc "select count(*) from people where payload->>'email' like '%@alienstattoos.com' or payload->>'email' like '%@gmail.com'")" = 3

# ============================================================ live: first deploy (adopts the old folder)
wf "03-deploy-live-first-dispatch-staging" 0 deploy-live.yml --event workflow_dispatch --ref release
GOOD1="$(live_release)"
check "live folder is now a symlink into releases/" test -L "$LIVE_DIR"
check "old live folder kept as *-pre-pipeline (with its stray server.js)" bash -c "ls -d $H/apms-deploy/live/releases/*-pre-pipeline/server.js"
check "new live build has no stray server.js" test ! -e "$LIVE_DIR/server.js"
check "running process lives in the new release" bash -c "readlink /proc/\$(pgrep -u $SITE -f 'htdocs/apms.alienstattoo.in/.output/server/index.mjs' | head -n1)/cwd | grep -q $GOOD1"
check "backup: app.tar.gz + a readable db.dump" bash -c "f=\$(ls -d $H/apms-deploy/live/backups/*/ | tail -n1); test -s \$f/app.tar.gz && pg_restore -l \$f/db.dump | grep -q 'TABLE DATA public people'"
check "live serves the new stamp" test "$(curl -s -H 'Accept: text/html' http://127.0.0.1:3003/ | grep -o 'apms-sync.js?v=[a-z0-9]*')" = "apms-sync.js?v=p0as83"

# ============================================================ live: failures
NB=$(ls -d $H/apms-deploy/live/backups/*/ | wc -l)
wf "04-deploy-live-crash-on-boot" 1 deploy-live.yml --event workflow_dispatch --input ref=sim-crash --ref release
check "crash build: live is back on the good build" test "$(live_release)" = "$GOOD1"
check "crash build: marked bad" bash -c "ls $H/apms-deploy/live/releases/*/.apms-bad | grep -q ."

wf "05-deploy-live-broken-signin" 1 deploy-live.yml --event workflow_dispatch --input ref=sim-signin --ref release
check "broken sign-in: workflow rolled live back to the good build" test "$(live_release)" = "$GOOD1"
check "broken sign-in: 'Rolled back … healthy' reported" grep -q "Live is back on $GOOD1 and healthy" "$WORK/logs/05-deploy-live-broken-signin.log"

NB=$(ls -d $H/apms-deploy/live/backups/*/ | wc -l)
wf "06-deploy-live-build-fails" 1 deploy-live.yml --event workflow_dispatch --input ref=sim-syntax --ref release
check "build failure: live untouched" test "$(live_release)" = "$GOOD1"
check "build failure: no backup, no swap attempted" test "$(ls -d $H/apms-deploy/live/backups/*/ | wc -l)" = "$NB"

# ============================================================ live: second good deploy (push to release), then rollbacks
wf "07-deploy-live-push-release" 0 deploy-live.yml --event push --ref release
GOOD2="$(live_release)"
check "second deploy is live" test "$GOOD2" != "$GOOD1"

wf "08-rollback-live-default" 0 rollback-live.yml --event workflow_dispatch --ref release
check "default rollback skips the bad builds and lands on the previous good one" test "$(live_release)" = "$GOOD1"
check "the build rolled back from is marked bad" test -f "$H/apms-deploy/live/releases/$GOOD2/.apms-bad"

wf "09-rollback-live-default-again" 1 rollback-live.yml --event workflow_dispatch --ref release
check "default rollback never picks the pre-pipeline folder (says why)" grep -q "no earlier known-good live release" "$WORK/logs/09-rollback-live-default-again.log"
check "live unchanged by the refused rollback" test "$(live_release)" = "$GOOD1"
PRE="$(basename "$(ls -d $H/apms-deploy/live/releases/*-pre-pipeline)")"
wf "09b-rollback-live-named-pre-pipeline" 0 rollback-live.yml --event workflow_dispatch --ref release --input release="$PRE"
check "named rollback to the old folder works and warns about BATCH-3 passwords" grep -q "cannot check hashed passwords" "$WORK/logs/09b-rollback-live-named-pre-pipeline.log"
check "the old folder serves its own stamp again" test "$(curl -s -H 'Accept: text/html' http://127.0.0.1:3003/ | grep -o 'apms-sync.js?v=[a-z0-9]*')" = "apms-sync.js?v=p0as39old"

wf "10-rollback-live-named" 0 rollback-live.yml --event workflow_dispatch --ref release --input release="$GOOD2"
check "rollback to a named build works" test "$(live_release)" = "$GOOD2"

# ============================================================ wrong deploy-check secret
SECRETS=$RH/secrets-wrong.json wf "11-deploy-live-wrong-check-secret" 1 deploy-live.yml --event push --ref release
check "wrong secret: rolled back to the build that was live" test "$(live_release)" = "$GOOD2"
check "wrong secret: says loudly the rollback could not be verified either" grep -q "ROLLBACK ALSO UNHEALTHY" "$WORK/logs/11-deploy-live-wrong-check-secret.log"
psql "$LIVE_DB" -q -c "delete from apms_signin_failures" # clear the lock-out counter the test caused

# ============================================================ keep the last 5
for i in 1 2 3; do wf "12-deploy-live-more-$i" 0 deploy-live.yml --event push --ref release; done
check "at most 5 builds kept + the running one" test "$(ls -d $H/apms-deploy/live/releases/*/ | wc -l)" -le 6
check "inactive builds slimmed (no node_modules), running one intact" bash -c "cur=\$(readlink -f $LIVE_DIR); test -d \$cur/node_modules && for d in $H/apms-deploy/live/releases/*/; do [ \"\${d%/}\" = \"\$cur\" ] && continue; case \$d in *-pre-pipeline/) continue;; esac; test ! -d \$d/node_modules || exit 1; done"
check "at most 5 backups kept" test "$(ls -d $H/apms-deploy/live/backups/*/ | wc -l)" -le 5
wf "13-rollback-after-prune" 0 rollback-live.yml --event workflow_dispatch --ref release
check "rollback to a slimmed (.output only) build is healthy" grep -q "HEALTH CHECK PASSED" "$WORK/logs/13-rollback-after-prune.log"

# ============================================================ staging guards
cp "$H/apms-deploy/shared/staging.env" "$WORK/staging.env.good"
sed -i 's#^DATABASE_URL=.*#DATABASE_URL=postgres://apms_live:live-db-pw@127.0.0.1:5432/aliens_apms_staging#' "$H/apms-deploy/shared/staging.env"
wf "14-staging-pointed-at-live-db-refused" 1 deploy-staging.yml --event push --ref staging
check "refusal names the database" grep -q "must be 'aliens_apms_stage2'" "$WORK/logs/14-staging-pointed-at-live-db-refused.log"
wf "15-refresh-pointed-at-live-db-refused" 1 refresh-staging-data.yml --event workflow_dispatch --ref release
check "live DB still has its data after the refused refresh" test "$(psql "$LIVE_DB" -tAc 'select count(*) from people')" = 3
cp "$WORK/staging.env.good" "$H/apms-deploy/shared/staging.env"
echo "SMTP_PASS=oops" >>"$H/apms-deploy/shared/staging.env"
wf "16-staging-with-smtp-refused" 1 deploy-staging.yml --event push --ref staging
cp "$WORK/staging.env.good" "$H/apms-deploy/shared/staging.env"
chown "$SITE:" "$H/apms-deploy/shared/staging.env"
wf "17-refresh-staging-while-running" 0 refresh-staging-data.yml --event workflow_dispatch --ref release
wf "18-deploy-staging-again" 0 deploy-staging.yml --event push --ref staging

echo
echo "######## RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
