#!/bin/sh
# Fresh database + built server for the three-user e2e runs.
#   PGURL=postgres://postgres:pg@127.0.0.1:5432 DB=aliens_apms_test PORT=3010 [OUTPUT=.output] sh scripts/e2e/fresh-server.sh
set -e
PGURL=${PGURL:-postgres://postgres:pg@127.0.0.1:5432}
DB=${DB:-aliens_apms_test}
PORT=${PORT:-3010}
LOG=${LOG:-/tmp/apms-e2e-server.log}
OUTPUT=${OUTPUT:-.output}
# Stop the server a previous run started on this PORT (found by its environment).
for d in /proc/[0-9]*; do
  if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "PORT=$PORT"; then
    case "$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" in node*index.mjs*) kill "${d#/proc/}" 2>/dev/null ;; esac
  fi
done
sleep 1
psql "$PGURL/postgres" -qc "drop database if exists $DB with (force)" -c "create database $DB"
DATABASE_URL="$PGURL/$DB" node scripts/migrate.mjs
DATABASE_URL="$PGURL/$DB" PORT=$PORT HOST=127.0.0.1 nohup node "$OUTPUT/server/index.mjs" > "$LOG" 2>&1 &
for i in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done
echo "server up on :$PORT (log $LOG)"
