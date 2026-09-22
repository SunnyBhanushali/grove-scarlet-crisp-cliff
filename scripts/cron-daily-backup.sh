#!/bin/sh
# Host crontab — loopback auto copy (hourly 9am–3am IST; API no-ops 4–8am).
# Every hour:
#   5 * * * * /home/alienstattoo-app/htdocs/app.alienstattoo.in/scripts/cron-daily-backup.sh
# The Node process also ticks itself every minute, so this is a backup trigger.
set -eu
PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:${PORT}/api/company-backups?hourly=1" >/dev/null
