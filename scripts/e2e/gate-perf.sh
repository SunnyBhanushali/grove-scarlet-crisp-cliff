#!/bin/sh
# PERF gate: every browser + security suite, each on its own fresh database,
# against the built server (.output). Reports in docs/e2e/perf-2/.
#   sh scripts/e2e/gate-perf.sh [security3 security2 batch2 batch1 batch3]
PG=${PGURL:-postgres://postgres:pg@127.0.0.1:5432}
OUTDIR=${OUTDIR:-docs/e2e/perf-2}
mkdir -p "$OUTDIR"
SUITES=${*:-security3 security2 batch2 batch1 batch3}
BPW=Floyd-e2e-1; CPW=Ronlind-e2e-1; NPW=Nikhil-e2e-1
# The fresh server imports the seed's people at boot; test logins need them.
waitpeople() {
  for i in $(seq 1 120); do
    n=$(psql -tA "$PG/$1" -c "select count(*) from people where deleted_at is null" 2>/dev/null || echo 0)
    [ "${n:-0}" -ge 100 ] && return 0
    sleep 0.5
  done
  echo "people not imported in $1"; return 1
}
for s in $SUITES; do
  case $s in
    security3)
      PORT=3015 DB=aliens_apms_sec OUTPUT=.output LOG=/tmp/apms-sec-server.log sh scripts/e2e/fresh-server.sh
      BASE_URL=http://127.0.0.1:3015 DATABASE_URL=$PG/aliens_apms_sec PORT=3015 OUTPUT=.output OUT=$OUTDIR/e2e-security-batch3.json \
        node scripts/e2e/security-batch3.mjs > $OUTDIR/security-batch3.log 2>&1; echo "security3 exit $?" ;;
    security2)
      PORT=3010 DB=aliens_apms_test sh scripts/e2e/fresh-server.sh; waitpeople aliens_apms_test
      DATABASE_URL=$PG/aliens_apms_test node scripts/e2e/seed-logins.mjs nikhil.pati=$NPW floyd.dsil=$BPW ronlind.mene=$CPW
      BASE_URL=http://127.0.0.1:3010 N_USER=nikhil.pati N_PASS=$NPW OUT=$OUTDIR/e2e-security.json \
        node scripts/e2e/security-batch2.mjs > $OUTDIR/security-batch2.log 2>&1; echo "security2 exit $?" ;;
    batch2)
      PORT=3010 DB=aliens_apms_test sh scripts/e2e/fresh-server.sh; waitpeople aliens_apms_test
      DATABASE_URL=$PG/aliens_apms_test node scripts/e2e/seed-logins.mjs nikhil.pati=$NPW floyd.dsil=$BPW ronlind.mene=$CPW
      BASE_URL=http://127.0.0.1:3010 DATABASE_URL=$PG/aliens_apms_test B_PASS=$BPW C_PASS=$CPW N_USER=nikhil.pati N_PASS=$NPW \
        OUT=$OUTDIR/e2e-batch2.json node scripts/e2e/batch2-three-users.mjs > $OUTDIR/batch2.log 2>&1; echo "batch2 exit $?" ;;
    batch1)
      PORT=3010 DB=aliens_apms_test sh scripts/e2e/fresh-server.sh; waitpeople aliens_apms_test
      DATABASE_URL=$PG/aliens_apms_test node scripts/e2e/seed-logins.mjs floyd.dsil=$BPW ronlind.mene=$CPW
      BASE_URL=http://127.0.0.1:3010 DATABASE_URL=$PG/aliens_apms_test B_PASS=$BPW C_PASS=$CPW \
        OUT=$OUTDIR/e2e-batch1.json node scripts/e2e/rows-v2-three-users.mjs > $OUTDIR/batch1.log 2>&1; echo "batch1 exit $?" ;;
    batch3)
      PORT=3016 DB=aliens_apms_b3 OUTPUT=.output sh scripts/e2e/fresh-server.sh; waitpeople aliens_apms_b3
      DATABASE_URL=$PG/aliens_apms_b3 node scripts/e2e/seed-logins.mjs floyd.dsil=$BPW ronlind.mene=$CPW
      BASE_URL=http://127.0.0.1:3016 DATABASE_URL=$PG/aliens_apms_b3 PORT=3016 OUTPUT=.output B_PASS=$BPW C_PASS=$CPW \
        OUT=$OUTDIR/e2e-batch3.json node scripts/e2e/batch3-four-users.mjs > $OUTDIR/batch3.log 2>&1; echo "batch3 exit $?" ;;
  esac
done
