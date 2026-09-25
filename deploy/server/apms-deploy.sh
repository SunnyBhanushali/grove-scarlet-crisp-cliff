#!/usr/bin/env bash
# APMS deploy helper — runs ON the VPS as the site user (never root).
#
# GitHub Actions uploads this file (plus its two helpers) to ~/apms-deploy/bin
# on every run and calls one sub-command at a time over SSH. It can also be run
# by hand on the server:  bash ~/apms-deploy/bin/apms-deploy.sh help
#
# What it never does: drop, migrate or restore the live database; touch
# anything outside ~/apms-deploy and the live app folder; need root.
#
# Layout (DEPLOY_ROOT, default ~/apms-deploy):
#   bin/                      this script, sanitize-staging-db.mjs, apms-staging.config.cjs
#   live/releases/<id>/       one clean folder per build (source + node_modules + .output)
#   live/history              ids in the order they went live (last line = current)
#   live/backups/<stamp>/     app.tar.gz + db.dump taken right before each live swap
#   staging/releases/<id>/    same, for staging
#   staging/current           symlink -> the release apms-staging runs
#   shared/staging.env        staging DATABASE_URL etc. (chmod 600, never in git)
#   shared/live.env           optional: LIVE_DATABASE_URL= (else read from PM2)
#
# The live app folder (LIVE_APP_DIR, the folder PM2 `apms-rewrite` runs from)
# becomes a symlink into live/releases/. The first live deploy moves the
# existing folder to live/releases/<stamp>-pre-pipeline so it stays one
# rollback away.
set -Eeuo pipefail
umask 027

DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/apms-deploy}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
MIN_FREE_MB="${MIN_FREE_MB:-3072}"
# Files carried from the running folder into each new build (not in git).
KEEP_FILES="${KEEP_FILES:-.env .env.production}"
STAGE_DB_NAME="${STAGE_DB_NAME:-aliens_apms_stage2}"

LIVE_PM2="${LIVE_PM2:-apms-rewrite}"
LIVE_PORT="${LIVE_PORT:-3003}"
STAGING_PM2="${STAGING_PM2:-apms-staging}"
STAGING_PORT="${STAGING_PORT:-3013}"

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[apms-deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  printf '[apms-deploy] ERROR: %s\n' "$*" >&2
  printf '::error::%s\n' "$*"
  exit 1
}

# ---------------------------------------------------------------- node / pm2
# A non-interactive SSH session skips ~/.bashrc, where CloudPanel / nvm put
# node on the PATH. Load it the same way an interactive shell would.
load_node() {
  # (A system /usr/local/bin/node can be an older major — nvm's default wins.)
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    set +eu # nvm.sh is not written for `set -eu`
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    set -eu
  fi
  if [ -n "${NODE_BIN_DIR:-}" ]; then export PATH="$NODE_BIN_DIR:$PATH"; fi
  for d in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin; do
    case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$PATH:$d" ;; esac
  done
  command -v node >/dev/null 2>&1 || die "node not found for $(id -un). Set NODE_BIN_DIR or install nvm for this user."
  command -v npm >/dev/null 2>&1 || die "npm not found next to $(command -v node)."
  command -v pm2 >/dev/null 2>&1 || die "pm2 not found for $(id -un). Live must run under this user's PM2 (see deploy/ROOT-CHECKLIST.md)."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || die "node $major found; the app needs Node 22+."
}

# pm2 field for one app: pm2_field <name> <js expression on p (the jlist entry)>
pm2_field() {
  pm2 jlist 2>/dev/null | APMS_NAME="$1" APMS_EXPR="$2" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let list = [];
      for (const line of s.split("\n").reverse()) {
        if (!line.startsWith("[")) continue;
        try { list = JSON.parse(line); break; } catch {}
      }
      const p = list.find((x) => x.name === process.env.APMS_NAME);
      if (!p) process.exit(3);
      const v = new Function("p", "return (" + process.env.APMS_EXPR + ")")(p);
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    });'
}

pm2_exists() { pm2_field "$1" 'p.name' >/dev/null 2>&1; }

# ------------------------------------------------------------------- targets
target_config() {
  TARGET="${1:-}"
  case "$TARGET" in
    live)
      [ -n "${LIVE_APP_DIR:-}" ] || die "LIVE_APP_DIR is not set (GitHub secret LIVE_APP_DIR)."
      APP_DIR="${LIVE_APP_DIR%/}"
      PM2_NAME="$LIVE_PM2"
      PORT="$LIVE_PORT"
      ;;
    staging)
      APP_DIR="$DEPLOY_ROOT/staging/current"
      PM2_NAME="$STAGING_PM2"
      PORT="$STAGING_PORT"
      ;;
    *) die "target must be live or staging (got '$TARGET')" ;;
  esac
  TDIR="$DEPLOY_ROOT/$TARGET"
  REL_DIR="$TDIR/releases"
  HISTORY="$TDIR/history"
  mkdir -p "$REL_DIR"
  touch "$HISTORY"
}

take_lock() {
  mkdir -p "$DEPLOY_ROOT"
  exec 9>"$DEPLOY_ROOT/.lock-$1"
  flock -w "${LOCK_WAIT:-600}" 9 || die "another $1 deploy is still running (lock $DEPLOY_ROOT/.lock-$1)."
}

valid_id() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad release id '$1'"; }

current_release() {
  # Prints the release id APP_DIR points at, or "" when it is not one of ours.
  [ -L "$APP_DIR" ] || { echo ""; return; }
  local real
  real="$(readlink -f "$APP_DIR" || true)"
  case "$real" in "$(readlink -f "$REL_DIR")"/*) basename "$real" ;; *) echo "" ;; esac
}

meta() { # meta <release dir> <KEY>
  [ -f "$1/.apms-release" ] && sed -n "s/^$2=//p" "$1/.apms-release" | tail -n1 || true
}

free_mb() { df -Pm "$1" | awk 'NR==2 {print $4}'; }

# Stamp the SPA loads (`apms-sync.js?v=<stamp>`) from a built folder.
stamp_of() {
  local f
  for f in "$1/.output/public/index.html" "$1/.output/public/apms.html" "$1/scripts/apms-spa.html"; do
    if [ -f "$f" ]; then
      grep -o 'apms-sync\.js?v=[A-Za-z0-9._-]*' "$f" | head -n1 | sed 's/.*v=//' && return 0
    fi
  done
  echo ""
}

# What the running app serves on loopback.
served_stamp() {
  curl -fsS --max-time 10 -H 'Accept: text/html' "http://127.0.0.1:$PORT/" 2>/dev/null |
    grep -o 'apms-sync\.js?v=[A-Za-z0-9._-]*' | head -n1 | sed 's/.*v=//' || true
}

wait_healthy() { # wait_healthy <expected stamp or "">
  local want="$1" deadline code status got
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    status="$(pm2_field "$PM2_NAME" 'p.pm2_env.status' 2>/dev/null || true)"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Accept: text/html' "http://127.0.0.1:$PORT/" || true)"
    if [ "$status" = "online" ] && [ "$code" = "200" ]; then
      got="$(served_stamp)"
      if [ -z "$want" ] || [ "$got" = "$want" ]; then
        # still up a few seconds later (no crash loop right after boot)?
        local restarts
        restarts="$(pm2_field "$PM2_NAME" 'p.pm2_env.restart_time' 2>/dev/null || true)"
        sleep 5
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Accept: text/html' "http://127.0.0.1:$PORT/" || true)"
        if [ "$code" = "200" ] && [ "$(pm2_field "$PM2_NAME" 'p.pm2_env.restart_time' 2>/dev/null || true)" = "$restarts" ]; then
          log "healthy: $PM2_NAME online, http://127.0.0.1:$PORT/ -> 200, stamp ${got:-?}"
          return 0
        fi
        log "came up, then fell over (http $code) — waiting…"
        continue
      fi
      log "up but serving stamp '$got', want '$want'…"
    fi
    sleep 3
  done
  log "not healthy after ${HEALTH_TIMEOUT}s (pm2 status '${status:-?}', http ${code:-?})"
  pm2 logs "$PM2_NAME" --nostream --lines 40 2>&1 | tail -n 60 >&2 || true
  return 1
}

# Atomic symlink swap: APP_DIR -> REL_DIR/<id>
point_to() {
  local target="$REL_DIR/$1" tmp="$APP_DIR.apms-swap"
  [ -f "$target/.output/server/index.mjs" ] || die "release $1 has no .output/server/index.mjs"
  ln -sfn "$target" "$tmp"
  mv -Tf "$tmp" "$APP_DIR"
}

restart_app() {
  if [ "$TARGET" = "staging" ]; then
    staging_env_check
    APMS_DEPLOY_ROOT="$DEPLOY_ROOT" STAGING_PM2="$STAGING_PM2" STAGING_PORT="$STAGING_PORT" \
      pm2 startOrRestart "$BIN_DIR/apms-staging.config.cjs" --update-env >/dev/null
    pm2 save >/dev/null 2>&1 || true
  else
    # No --update-env: live keeps exactly the environment it was started with.
    pm2 restart "$PM2_NAME" >/dev/null
  fi
}

# ------------------------------------------------------------ live DB access
# Read-only uses only: pg_dump for the pre-deploy backup and the staging refresh.
live_db_url() {
  local url=""
  if [ -f "$DEPLOY_ROOT/shared/live.env" ]; then
    url="$(sed -n 's/^LIVE_DATABASE_URL=//p' "$DEPLOY_ROOT/shared/live.env" | tail -n1 | sed 's/^"\(.*\)"$/\1/')"
  fi
  if [ -z "$url" ]; then
    url="$(pm2_field "$LIVE_PM2" '(p.pm2_env && (p.pm2_env.DATABASE_URL || (p.pm2_env.env && p.pm2_env.env.DATABASE_URL)))' 2>/dev/null || true)"
  fi
  [ -n "$url" ] || die "cannot find the live DATABASE_URL (not in PM2 '$LIVE_PM2' env). Put LIVE_DATABASE_URL=... in $DEPLOY_ROOT/shared/live.env (chmod 600)."
  printf '%s' "$url"
}

url_part() { # url_part <url> <db|user|host>
  APMS_URL="$1" APMS_PART="$2" node -e '
    const u = new URL(process.env.APMS_URL);
    const part = process.env.APMS_PART;
    const v = part === "db" ? decodeURIComponent(u.pathname.replace(/^\//, "")) : part === "user" ? decodeURIComponent(u.username) : u.hostname;
    process.stdout.write(v);'
}

staging_env_file() { echo "$DEPLOY_ROOT/shared/staging.env"; }

staging_db_url() {
  local f
  f="$(staging_env_file)"
  [ -f "$f" ] || die "$f is missing. Create it once (deploy/ROOT-CHECKLIST.md step 3)."
  sed -n 's/^DATABASE_URL=//p' "$f" | tail -n1 | sed 's/^"\(.*\)"$/\1/'
}

# Staging must never be able to reach the live database or send mail.
staging_env_check() {
  local f surl sdb suser lurl ldb luser
  f="$(staging_env_file)"
  surl="$(staging_db_url)"
  [ -n "$surl" ] || die "DATABASE_URL missing in $f"
  sdb="$(url_part "$surl" db)"
  suser="$(url_part "$surl" user)"
  [ "$sdb" = "$STAGE_DB_NAME" ] || die "staging DATABASE_URL points at '$sdb', must be '$STAGE_DB_NAME'. Refusing."
  if lurl="$(live_db_url 2>/dev/null)" && [ -n "$lurl" ]; then
    ldb="$(url_part "$lurl" db)"
    luser="$(url_part "$lurl" user)"
    [ "$sdb" != "$ldb" ] || die "staging and live use the same database '$sdb'. Refusing."
    [ "$suser" != "$luser" ] || die "staging uses the live database login '$suser'. Give staging its own role (ROOT-CHECKLIST step 3). Refusing."
  fi
  if grep -Eq '^SMTP_PASS=.+' "$f"; then die "$f sets SMTP_PASS — staging must never send mail. Remove it."; fi
  if ! grep -q '^BETTER_AUTH_SECRET=.' "$f"; then
    log "adding a random BETTER_AUTH_SECRET to $f (generated here, never leaves the server)"
    printf 'BETTER_AUTH_SECRET=%s\n' "$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')" >>"$f"
  fi
  chmod 600 "$f"
}

# ------------------------------------------------------------- sub-commands
cmd_preflight() {
  target_config "$1"
  load_node
  command -v flock >/dev/null || die "flock missing"
  command -v curl >/dev/null || die "curl missing"
  command -v tar >/dev/null || die "tar missing"
  mkdir -p "$DEPLOY_ROOT/shared"
  chmod 700 "$DEPLOY_ROOT/shared"
  local free
  free="$(free_mb "$DEPLOY_ROOT")"
  [ "$free" -ge "$MIN_FREE_MB" ] || die "only ${free} MB free under $DEPLOY_ROOT (need $MIN_FREE_MB). Run the prune or free disk."
  if [ "$TARGET" = "live" ]; then
    pm2_exists "$PM2_NAME" || die "PM2 process '$PM2_NAME' not found for user $(id -un). Live must run under this user's PM2."
    local cwd exe real_app
    cwd="$(pm2_field "$PM2_NAME" 'p.pm2_env.pm_cwd')"
    exe="$(pm2_field "$PM2_NAME" 'p.pm2_env.pm_exec_path')"
    real_app="$(readlink -f "$APP_DIR" 2>/dev/null || echo "$APP_DIR")"
    case "$cwd" in "$APP_DIR"|"$real_app") ;; *) die "PM2 '$PM2_NAME' runs from '$cwd', not LIVE_APP_DIR '$APP_DIR'. Fix the LIVE_APP_DIR secret." ;; esac
    case "$exe" in
      "$APP_DIR/.output/server/index.mjs") ;;
      "$real_app/.output/server/index.mjs")
        [ ! -L "$APP_DIR" ] || die "PM2 '$PM2_NAME' was started with the resolved path '$exe'; a swap would not reach it. Re-register it once: pm2 delete $PM2_NAME && cd $APP_DIR && pm2 start $APP_DIR/.output/server/index.mjs --name $PM2_NAME (with its env) && pm2 save"
        ;;
      */npm|*/npm-cli.js) log "note: PM2 '$PM2_NAME' runs npm (npm start) from $cwd — fine, it follows the folder." ;;
      *) die "PM2 '$PM2_NAME' runs '$exe'. Expected $APP_DIR/.output/server/index.mjs. See ROOT-CHECKLIST step 4." ;;
    esac
    [ -w "$(dirname "$APP_DIR")" ] || die "$(id -un) cannot write $(dirname "$APP_DIR") (needed to swap the app folder)."
    command -v pg_dump >/dev/null || die "pg_dump missing (postgresql-client) — needed for the pre-deploy database backup."
    live_db_url >/dev/null
    log "live: PM2 '$PM2_NAME' $(pm2_field "$PM2_NAME" 'p.pm2_env.status'), folder $APP_DIR ($( [ -L "$APP_DIR" ] && echo "release $(current_release)" || echo "not yet adopted — first deploy moves it into releases/"))"
  else
    staging_env_check
    log "staging: folder $APP_DIR, PM2 '$PM2_NAME' $(pm2_field "$PM2_NAME" 'p.pm2_env.status' 2>/dev/null || echo 'not started yet')"
  fi
  echo "PREFLIGHT_OK=1"
}

# Source tarball (git archive) on stdin -> fresh folder. Never unzips over anything.
cmd_receive() {
  target_config "$1"
  local id="${2:-}" sha="${3:-}" ref="${4:-}"
  valid_id "$id"
  local dest="$REL_DIR/$id"
  [ ! -e "$dest" ] || die "release $id already exists"
  rm -rf "$dest.partial"
  mkdir -p "$dest.partial"
  tar -xzf - -C "$dest.partial"
  [ -f "$dest.partial/package.json" ] || die "upload has no package.json"
  {
    echo "ID=$id"
    echo "SHA=$sha"
    echo "REF=$ref"
    echo "RECEIVED_AT=$(date -u +%FT%TZ)"
  } >"$dest.partial/.apms-release"
  mv "$dest.partial" "$dest"
  log "received $id ($(du -sh "$dest" | cut -f1))"
}

cmd_build() {
  target_config "$1"
  load_node
  local id="${2:-}" rel
  valid_id "$id"
  rel="$REL_DIR/$id"
  [ -d "$rel" ] || die "release $id not found"
  take_lock "build-$TARGET"
  # Not-in-git files the running copy needs (e.g. a .env) come across by copy.
  local cur f
  cur="$(readlink -f "$APP_DIR" 2>/dev/null || true)"
  if [ -n "$cur" ] && [ -d "$cur" ]; then
    for f in $KEEP_FILES; do
      if [ -f "$cur/$f" ]; then cp -p "$cur/$f" "$rel/$f"; log "kept $f from the running folder"; fi
    done
  fi
  cd "$rel"
  rm -rf .output node_modules/.vite
  log "npm install --include=dev"
  # The build must never see a database: drop DATABASE_URL from its env.
  env -u DATABASE_URL npm install --include=dev --no-audit --no-fund --loglevel=error >"$rel/.apms-install.log" 2>&1 ||
    { tail -n 40 "$rel/.apms-install.log" >&2; die "npm install failed for $id"; }
  log "NITRO_PRESET=node-server npm run build:app"
  env -u DATABASE_URL NITRO_PRESET=node-server npm run build:app >"$rel/.apms-build.log" 2>&1 ||
    { tail -n 60 "$rel/.apms-build.log" >&2; die "build failed for $id"; }
  [ -f .output/server/index.mjs ] || die "build produced no .output/server/index.mjs"
  local stamp
  stamp="$(stamp_of "$rel")"
  [ -n "$stamp" ] || die "built HTML has no apms-sync.js?v= stamp"
  {
    echo "STAMP=$stamp"
    echo "BUILT_AT=$(date -u +%FT%TZ)"
    echo "NODE=$(node -v)"
  } >>"$rel/.apms-release"
  touch "$rel/.apms-built"
  log "built $id: stamp $stamp, $(du -sh "$rel" | cut -f1)"
  echo "STAMP=$stamp"
}

# app folder tarball + pg_dump of the live DB (read-only), right before a swap.
cmd_backup() {
  target_config live
  load_node
  take_lock "backup-live"
  local stamp dir real url
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  dir="$TDIR/backups/$stamp"
  mkdir -p "$dir"
  chmod 700 "$TDIR/backups" "$dir"
  real="$(readlink -f "$APP_DIR")"
  log "backing up app folder $real (without node_modules)"
  tar -czf "$dir/app.tar.gz" --exclude='./node_modules' --exclude='./.output/server/node_modules/.cache' -C "$real" .
  url="$(live_db_url)"
  log "pg_dump of the live database $(url_part "$url" db) (read-only)"
  pg_dump --format=custom --no-owner --no-acl --file="$dir/db.dump" "$url" ||
    { rm -rf "$dir"; die "pg_dump of the live database failed — not deploying."; }
  pg_restore --list "$dir/db.dump" >/dev/null || { rm -rf "$dir"; die "db.dump is unreadable — not deploying."; }
  echo "FROM=$(basename "$real")" >"$dir/info"
  log "backup $stamp: app $(du -h "$dir/app.tar.gz" | cut -f1), db $(du -h "$dir/db.dump" | cut -f1)"
  # keep the newest KEEP_BACKUPS
  ls -1d "$TDIR/backups"/*/ 2>/dev/null | sort | head -n "-$KEEP_BACKUPS" | while read -r old; do
    log "removing old backup $(basename "$old")"
    rm -rf "$old"
  done
  echo "BACKUP=$stamp"
}

# First live deploy: the existing folder becomes a release, the path a symlink.
adopt_live_folder() {
  [ -L "$APP_DIR" ] && return 0
  [ -d "$APP_DIR" ] || die "$APP_DIR does not exist"
  local id
  # named by the folder's own last-change time so it sorts before every pipeline build
  id="$(date -u -r "$APP_DIR" +%Y%m%d-%H%M%S)-pre-pipeline"
  log "first pipeline deploy: moving the current live folder to releases/$id (it stays a rollback target)"
  mv "$APP_DIR" "$REL_DIR/$id"
  {
    echo "ID=$id"
    echo "SHA=pre-pipeline"
    echo "STAMP=$(stamp_of "$REL_DIR/$id")"
  } >>"$REL_DIR/$id/.apms-release"
  ln -sfn "$REL_DIR/$id" "$APP_DIR"
  echo "$id" >>"$HISTORY"
}

cmd_activate() {
  target_config "$1"
  load_node
  local id="${2:-}" rel want prev
  valid_id "$id"
  rel="$REL_DIR/$id"
  [ -f "$rel/.apms-built" ] || die "release $id is not built"
  take_lock "activate-$TARGET"
  want="$(meta "$rel" STAMP)"
  if [ "$TARGET" = "live" ]; then
    pm2_exists "$PM2_NAME" || die "PM2 process '$PM2_NAME' not found"
    adopt_live_folder
  fi
  prev="$(current_release)"
  echo "PREVIOUS=${prev}"
  log "switching $TARGET: ${prev:-<none>} -> $id (stamp $want)"
  point_to "$id"
  if restart_app && wait_healthy "$want"; then
    [ "$(tail -n1 "$HISTORY" 2>/dev/null)" = "$id" ] || echo "$id" >>"$HISTORY"
    log "$TARGET is on $id"
    echo "ACTIVE=$id"
    return 0
  fi
  if [ -n "$prev" ] && [ -d "$REL_DIR/$prev" ]; then
    log "ROLLING BACK $TARGET to $prev"
    point_to "$prev"
    { restart_app && wait_healthy "$(meta "$REL_DIR/$prev" STAMP)"; } || die "$id failed its health check AND the rollback to $prev is not healthy. Check 'pm2 logs $PM2_NAME' on the server NOW."
    die "$id failed its health check on the server; $TARGET was rolled back to $prev and is healthy."
  fi
  die "$id failed its health check and there is no previous release to roll back to."
}

cmd_rollback() {
  target_config "$1"
  load_node
  local to="${2:-}" cur
  take_lock "activate-$TARGET"
  cur="$(current_release)"
  if [ -z "$to" ]; then
    # newest history entry that is not the current one and still exists
    to="$(grep -vxF "${cur:-<none>}" "$HISTORY" | tac | while read -r r; do [ -f "$REL_DIR/$r/.output/server/index.mjs" ] && { echo "$r"; break; }; done || true)"
    [ -n "$to" ] || die "no earlier $TARGET release to roll back to"
  fi
  valid_id "$to"
  [ "$to" != "$cur" ] || die "$TARGET is already on $to"
  [ -d "$REL_DIR/$to" ] || die "release $to not found (see: apms-deploy.sh list $TARGET)"
  log "rolling $TARGET back: ${cur:-?} -> $to"
  point_to "$to"
  { restart_app && wait_healthy "$(meta "$REL_DIR/$to" STAMP)"; } || die "rollback to $to is not healthy — check 'pm2 logs $PM2_NAME'."
  echo "$to" >>"$HISTORY"
  echo "ACTIVE=$to"
  echo "STAMP=$(meta "$REL_DIR/$to" STAMP)"
}

cmd_list() {
  target_config "$1"
  local cur d id
  cur="$(current_release)"
  printf '%-3s %-40s %-10s %-10s %s\n' "" "RELEASE" "STAMP" "COMMIT" "BUILT"
  for d in $(ls -1d "$REL_DIR"/*/ 2>/dev/null | sort -r); do
    id="$(basename "$d")"
    printf '%-3s %-40s %-10s %-10s %s\n' "$([ "$id" = "$cur" ] && echo '*' || echo '')" "$id" \
      "$(meta "$d" STAMP)" "$(meta "$d" SHA | cut -c1-8)" "$(meta "$d" BUILT_AT)"
  done
}

cmd_status() {
  target_config "$1"
  local cur
  cur="$(current_release)"
  echo "RELEASE=${cur}"
  echo "SHA=$( [ -n "$cur" ] && meta "$REL_DIR/$cur" SHA )"
  echo "STAMP=$( [ -n "$cur" ] && meta "$REL_DIR/$cur" STAMP )"
  if [ "$TARGET" = "staging" ] && [ -f "$DEPLOY_ROOT/shared/staging-refreshed-at" ]; then
    echo "DATA_REFRESHED_AT=$(cat "$DEPLOY_ROOT/shared/staging-refreshed-at")"
  fi
}

cmd_prune() {
  target_config "$1"
  local cur keep_list d id
  cur="$(current_release)"
  # Failed / unfinished builds go first (never the running one)…
  for d in $(ls -1d "$REL_DIR"/*/ 2>/dev/null); do
    id="$(basename "$d")"
    [ "$id" = "$cur" ] && continue
    if [ ! -f "$d/.apms-built" ] && [ ! -f "$d/.output/server/index.mjs" ]; then
      log "removing unbuilt $TARGET release $id"
      rm -rf "$d"
    fi
  done
  # …then the newest KEEP_RELEASES releases, plus the running one, stay.
  keep_list="$(ls -1d "$REL_DIR"/*/ 2>/dev/null | sort -r | head -n "$KEEP_RELEASES" | xargs -r -n1 basename)"
  for d in $(ls -1d "$REL_DIR"/*/ 2>/dev/null | sort); do
    id="$(basename "$d")"
    [ "$id" = "$cur" ] && continue
    if printf '%s\n' "$keep_list" | grep -qxF "$id"; then continue; fi
    log "pruning $TARGET release $id"
    rm -rf "$REL_DIR/$id"
  done
  # Inactive builds keep .output (self-contained: a rollback needs nothing
  # else) but drop node_modules (~430 MB each). The pre-pipeline copy of the
  # old live folder is left exactly as it was.
  for d in $(ls -1d "$REL_DIR"/*/ 2>/dev/null); do
    id="$(basename "$d")"
    [ "$id" = "$cur" ] && continue
    case "$id" in *-pre-pipeline) continue ;; esac
    if [ -d "$d/node_modules" ] && [ -f "$d/.output/server/index.mjs" ]; then
      rm -rf "$d/node_modules"
      log "slimmed $id (node_modules removed; .output kept for rollback)"
    fi
  done
  # an unfinished build never counts
  find "$REL_DIR" -maxdepth 1 -name '*.partial' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  cmd_list "$TARGET"
}

# Live dump -> aliens_apms_stage2, then every password reset to the staging
# value and every email blanked. Staging password arrives on stdin.
cmd_refresh_staging() {
  target_config staging
  load_node
  take_lock "activate-staging"
  local pw
  IFS= read -r pw || true
  [ "${#pw}" -ge 8 ] || die "staging password (stdin) must be at least 8 characters"
  staging_env_check
  local surl lurl sdb pg_from dump list
  surl="$(staging_db_url)"
  lurl="$(live_db_url)"
  sdb="$(url_part "$surl" db)"
  command -v pg_dump >/dev/null && command -v pg_restore >/dev/null && command -v psql >/dev/null ||
    die "pg_dump / pg_restore / psql missing"
  # `pg` for the sanitizer comes from any built release (staging first, else live).
  pg_from=""
  for d in "$APP_DIR" "${LIVE_APP_DIR:-/nonexistent}" $(ls -1d "$REL_DIR"/*/ 2>/dev/null | sort -r); do
    if [ -f "$d/node_modules/pg/package.json" ]; then pg_from="$(readlink -f "$d")"; break; fi
  done
  [ -n "$pg_from" ] || die "no built release with node_modules/pg found (deploy staging once, or set LIVE_APP_DIR)"

  dump="$DEPLOY_ROOT/shared/.live-for-staging.dump"
  list="$DEPLOY_ROOT/shared/.live-for-staging.list"
  # shellcheck disable=SC2064  # expand now: the locals are gone at EXIT
  trap "rm -f '$dump' '$list' '$DEPLOY_ROOT/shared/.restore.err'" EXIT
  log "pg_dump of the live database (read-only)"
  pg_dump --format=custom --no-owner --no-acl --file="$dump" "$lurl"
  # Leave out the BATCH-3 plain-text password backup tables entirely.
  pg_restore --list "$dump" | grep -v -i 'apms_password_backup_' >"$list"

  if pm2_exists "$PM2_NAME"; then log "stopping $PM2_NAME"; pm2 stop "$PM2_NAME" >/dev/null; fi
  log "emptying $sdb (objects owned by the staging role only)"
  [ "$(psql "$surl" -v ON_ERROR_STOP=1 -tAq -c "select current_database()")" = "$sdb" ] ||
    die "psql did not land in $sdb — refusing"
  psql "$surl" -v ON_ERROR_STOP=1 -q -c "SET client_min_messages = warning" \
    -c "DROP OWNED BY CURRENT_USER CASCADE" -c "CREATE SCHEMA IF NOT EXISTS public"
  log "restoring into $sdb"
  pg_restore --no-owner --no-acl --no-comments --use-list="$list" --dbname="$surl" "$dump" 2>"$DEPLOY_ROOT/shared/.restore.err" || {
    grep -v -i 'extension\|must be owner' "$DEPLOY_ROOT/shared/.restore.err" | grep -q . &&
      { cat "$DEPLOY_ROOT/shared/.restore.err" >&2; die "pg_restore into $sdb failed"; }
    log "pg_restore warnings (extensions/ownership only) ignored"
  }
  rm -f "$dump" "$list"
  log "sanitising $sdb"
  APMS_STAGE_URL="$surl" APMS_STAGE_DB="$STAGE_DB_NAME" APMS_LIVE_USER="$(url_part "$lurl" user)" \
    APMS_STAGE_PASSWORD="$pw" APMS_PG_FROM="$pg_from" node "$BIN_DIR/sanitize-staging-db.mjs"
  date -u +%FT%TZ >"$DEPLOY_ROOT/shared/staging-refreshed-at"
  if [ -f "$APP_DIR/.output/server/index.mjs" ]; then
    restart_app
    wait_healthy "" || die "staging did not come back after the refresh"
  else
    log "no staging build yet — push to the staging branch to start it"
  fi
  echo "REFRESHED=1"
}

usage() {
  cat <<'EOF'
apms-deploy.sh <command> …   (run as the site user; DEPLOY_ROOT defaults to ~/apms-deploy)

  preflight live|staging            check PM2, folders, disk, database access
  receive   live|staging ID [SHA]   read a git-archive .tar.gz on stdin into releases/ID
  build     live|staging ID         npm install + node-server build in that clean folder
  backup                            app folder tarball + pg_dump of the live DB (read-only)
  activate  live|staging ID         swap, restart, health check; auto-rollback on failure
  rollback  live|staging [ID]       back to ID (default: the previous release)
  list      live|staging            releases, * = running
  status    live|staging            running release / commit / stamp
  prune     live|staging            keep the newest KEEP_RELEASES (5) + the running one
  refresh-staging                   live dump -> aliens_apms_stage2, passwords reset
                                    (staging password on stdin), emails blanked

Live needs LIVE_APP_DIR=/home/<site-user>/htdocs/<live domain> in the environment.
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    preflight) cmd_preflight "$@" ;;
    receive) cmd_receive "$@" ;;
    build) cmd_build "$@" ;;
    backup) cmd_backup ;;
    activate) cmd_activate "$@" ;;
    rollback) cmd_rollback "$@" ;;
    list) cmd_list "$@" ;;
    status) cmd_status "$@" ;;
    prune) cmd_prune "$@" ;;
    refresh-staging) cmd_refresh_staging ;;
    help | -h | --help) usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
