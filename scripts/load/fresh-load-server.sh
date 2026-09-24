#!/bin/sh
# PERF: fresh database with the production-sized fixture + built server.
#   FIXTURE=/tmp/apms-load-fixture.json PORT=3020 DB=aliens_apms_load [CPUS=0-3] [NODE_OPTS=--cpu-prof] sh scripts/load/fresh-load-server.sh
set -e
PGURL=${PGURL:-postgres://postgres:pg@127.0.0.1:5432}
DB=${DB:-aliens_apms_load}
PORT=${PORT:-3020}
LOG=${LOG:-/tmp/apms-load-server.log}
OUTPUT=${OUTPUT:-.output}
FIXTURE=${FIXTURE:-/tmp/apms-load-fixture.json}
[ -f "$FIXTURE" ] || node scripts/load/scale-fixture.mjs "$FIXTURE"
for d in /proc/[0-9]*; do
  if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "PORT=$PORT"; then
    case "$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" in node*index.mjs*) kill "${d#/proc/}" 2>/dev/null ;; esac
  fi
done
sleep 1
if [ "${REUSE_DB:-0}" != "1" ]; then
  psql "$PGURL/postgres" -qc "drop database if exists $DB with (force)" -c "create database $DB"
  DATABASE_URL="$PGURL/$DB" node scripts/migrate.mjs > /dev/null
  DATABASE_URL="$PGURL/$DB" FIXTURE="$FIXTURE" node -e '
    const pg = require("pg"); const fs = require("fs");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    (async () => {
      await pool.query(`create table if not exists company_notebook (id text primary key, snapshot_json text not null, updated_at timestamptz not null default now())`);
      await pool.query(`insert into company_notebook (id, snapshot_json) values ($1, $2) on conflict (id) do update set snapshot_json = excluded.snapshot_json`, ["aliens-apms", fs.readFileSync(process.env.FIXTURE, "utf8")]);
      await pool.end();
    })().catch((e) => { console.error(e); process.exit(1); });
  '
fi
TASKSET=""
[ -n "$CPUS" ] && TASKSET="taskset -c $CPUS"
DATABASE_URL="$PGURL/$DB" PORT=$PORT HOST=127.0.0.1 NODE_ENV=production nohup $TASKSET node $NODE_OPTS "$OUTPUT/server/index.mjs" > "$LOG" 2>&1 &
echo $! > /tmp/apms-load-server.pid
for i in $(seq 1 120); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done
echo "server up on :$PORT pid $(cat /tmp/apms-load-server.pid) (log $LOG)"
