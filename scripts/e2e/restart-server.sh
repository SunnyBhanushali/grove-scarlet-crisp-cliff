#!/bin/sh
# Restart the built server on PORT without touching the database.
#   PORT=3010 DATABASE_URL=… [OUTPUT=.output] [LOG=…] sh scripts/e2e/restart-server.sh
PORT=${PORT:-3010}
LOG=${LOG:-/tmp/apms-e2e-server.log}
OUTPUT=${OUTPUT:-.output}
for d in /proc/[0-9]*; do
  if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "PORT=$PORT"; then
    case "$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" in node*index.mjs*) kill "${d#/proc/}" 2>/dev/null ;; esac
  fi
done 2>/dev/null
sleep 1
PORT=$PORT HOST=127.0.0.1 nohup node "$OUTPUT/server/index.mjs" > "$LOG" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
echo "server up on :$PORT (log $LOG)"
