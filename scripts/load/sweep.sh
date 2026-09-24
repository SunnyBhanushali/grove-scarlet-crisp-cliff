#!/bin/sh
# PERF: the five user levels, one fresh database each; CPU profiles at 50 and 250.
#   LABEL=before OUT=docs/perf/runs sh scripts/load/sweep.sh [levels…]
LABEL=${LABEL:-run}
OUT=${OUT:-docs/perf/runs}
LEVELS=${*:-1 10 50 100 250}
for u in $LEVELS; do
  PROF=""
  [ "$u" = 50 ] || [ "$u" = 250 ] && PROF="--profile"
  node scripts/load/run.mjs --users=$u --steady=${STEADY:-180} --label=$LABEL --out=$OUT $PROF $EXTRA || echo "run $u failed"
done
