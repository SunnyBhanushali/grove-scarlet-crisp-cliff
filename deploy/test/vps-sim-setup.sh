#!/usr/bin/env bash
# Build a throwaway "VPS" inside a disposable Ubuntu 24.04 container (run as
# root there, NEVER on the real server). It mirrors the live Contabo layout:
#
#   site user alienstattoo-apms, node 22 only via ~/.nvm (system node is older),
#   PM2 `apms-rewrite` on :3003 running from
#   /home/alienstattoo-apms/htdocs/apms.alienstattoo.in (with a stray server.js),
#   Postgres: live DB aliens_apms_staging (role apms_live),
#             staging DB aliens_apms_stage2 (role apms_stage2),
#   sshd on 127.0.0.1:2222, key login for the site user,
#   a tiny TLS-less stand-in for nginx: the public URLs map to the ports.
#
# Usage: vps-sim-setup.sh <built app folder to install as "old live"> <workdir>
set -Eeuo pipefail
SRC="${1:?built app folder}"
WORK="${2:?work dir}"
SITE=alienstattoo-apms
HOME_DIR=/home/$SITE
LIVE=$HOME_DIR/htdocs/apms.alienstattoo.in
NODE22=/opt/node22/bin
mkdir -p "$WORK"

# --- Postgres
pg_ctlcluster 16 main start 2>/dev/null || true
su postgres -c "psql -v ON_ERROR_STOP=1 -q" <<'SQL'
drop database if exists aliens_apms_staging;
drop database if exists aliens_apms_stage2;
drop role if exists apms_live;
drop role if exists apms_stage2;
create role apms_live login password 'live-db-pw';
create database aliens_apms_staging owner apms_live;
create role apms_stage2 login password 'stage-db-pw';
create database aliens_apms_stage2 owner apms_stage2;
SQL

# --- site user with node 22 only through nvm (like CloudPanel)
id "$SITE" >/dev/null 2>&1 || useradd -m -s /bin/bash "$SITE"
install -d -o "$SITE" -g "$SITE" "$HOME_DIR/.nvm" "$HOME_DIR/htdocs" "$HOME_DIR/.ssh"
cat >"$HOME_DIR/.nvm/nvm.sh" <<EOF
# stand-in for nvm: default alias = node 22
export PATH="$NODE22:\$PATH"
EOF
chown "$SITE:" "$HOME_DIR/.nvm/nvm.sh"

# --- "old live": today's build + a stray server.js, started by hand under PM2
if pm2_pid=$(su - "$SITE" -c "PATH=$NODE22:\$PATH pm2 pid apms-rewrite" 2>/dev/null) && [ -n "$pm2_pid" ]; then
  su - "$SITE" -c "PATH=$NODE22:\$PATH pm2 kill" >/dev/null 2>&1 || true
fi
rm -rf "$HOME_DIR/apms-deploy" "$LIVE"
cp -a "$SRC" "$LIVE"
echo "console.log('stray leftover from an old unzip-over');" >"$LIVE/server.js"
# mark the old build so the swap is visible
sed -i 's/apms-sync\.js?v=[A-Za-z0-9._-]*/apms-sync.js?v=p0as39old/' "$LIVE/.output/public/index.html" "$LIVE/.output/public/apms.html"
chown -R "$SITE:" "$LIVE"
su - "$SITE" -c "cd $LIVE && PATH=$NODE22:\$PATH DATABASE_URL=postgres://apms_live:live-db-pw@127.0.0.1:5432/aliens_apms_staging PORT=3003 HOST=127.0.0.1 NITRO_PORT=3003 NITRO_HOST=127.0.0.1 NODE_ENV=production VITE_AUTH_ENABLED=true SMTP_PASS=live-smtp-secret pm2 start $LIVE/.output/server/index.mjs --name apms-rewrite >/dev/null && PATH=$NODE22:\$PATH pm2 save >/dev/null"

# --- sshd for the "runner"
mkdir -p /run/sshd
ssh-keygen -A >/dev/null
rm -f "$WORK/id_ed25519" "$WORK/id_ed25519.pub"
ssh-keygen -q -t ed25519 -N '' -C apms-deploy-sim -f "$WORK/id_ed25519"
install -m 600 -o "$SITE" -g "$SITE" "$WORK/id_ed25519.pub" "$HOME_DIR/.ssh/authorized_keys"
pkill -f 'sshd -p 2222' 2>/dev/null || true
/usr/sbin/sshd -p 2222 -o ListenAddress=127.0.0.1 -o PasswordAuthentication=no -o PidFile=/run/sshd-2222.pid
sleep 1
ssh-keyscan -p 2222 127.0.0.1 2>/dev/null >"$WORK/known_hosts"

echo "SIM_READY site=$SITE live=$LIVE ssh=127.0.0.1:2222 key=$WORK/id_ed25519"
