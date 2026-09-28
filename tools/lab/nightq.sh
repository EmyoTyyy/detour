#!/usr/bin/env bash
# The whole night's queue, resumable.
#
# Every question carries a name, and a question whose name is already in night_results.log is
# skipped. So this can be started at any time, as many times as necessary: after a reboot, after
# a crash, or behind the two one-shot queues that were already running when it was written. It
# costs at most the match that was in flight.
#
# Deliberately a SEPARATE file from night.sh and night2.sh: bash reads a script incrementally
# while it runs it, so editing a running queue corrupts it mid-flight.
cd "$(dirname "$0")"
W=${W:-6}
LOG=night_results.log
touch $LOG

run() {
  local name="$1"; shift
  # -A6, not -A3. The result line sits FOUR lines below the header (engine A, engine B, the
  # node/seed line, then the score), so -A3 never reached it, the test was always false, and the
  # queue re-ran every question it had already answered -- six hours of cores, same seeds, same
  # numbers. Checked against the real log format rather than assumed this time.
  if grep -A6 -F "=== $name" $LOG 2>/dev/null | grep -q 'A scores'; then
    echo "[deja fait] $name"; return
  fi
  echo "=== $name  ($(date +%H:%M)) ===" | tee -a $LOG
  ( env "$@" WORKERS=$W node parmatch.js 2>/dev/null ) | tee -a $LOG
  echo | tee -a $LOG
}

run "godets 2^20 contre direct 2^22" \
  A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22 NODES=500000 PAIRS=60 SEED=31
run "direct 2^20 contre direct 2^22 (replication)" \
  A=path/engine.js B=path/engine.js BBITS=22 NODES=500000 PAIRS=60 SEED=33
run "reseau 14 features contre 20 features (murs), noeuds egaux" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 PAIRS=60 SEED=41
run "direct 2^20 contre godets 2^20 (memoire egale)" \
  A=path/engine.js B=tools/lab/variants/engine-tt4way.js NODES=500000 PAIRS=60 SEED=32
run "2^21 contre 2^22" \
  A=path/engine.js ABITS=21 B=path/engine.js BBITS=22 NODES=500000 PAIRS=60 SEED=34
run "2^22 contre 2^23" \
  A=path/engine.js ABITS=22 B=path/engine.js BBITS=23 NODES=500000 PAIRS=60 SEED=35
run "filtre de murs contre tous les murs, 500k" \
  A=path/engine.js B=tools/lab/variants/engine-allwalls.js NODES=500000 PAIRS=60 SEED=51
run "filtre de murs contre tous les murs, 1.5M" \
  A=path/engine.js B=tools/lab/variants/engine-allwalls.js NODES=1500000 PAIRS=30 SEED=52
run "14 features contre 20 features, TEMPS egal" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 BNODES=361000 PAIRS=60 SEED=53

# Once the planned questions are answered, keep measuring rather than idling: the same matches
# at a fresh seed narrow the error bar, and every one of these sits at +/- 63 Elo alone.
run "godets 2^20 contre direct 2^22 (graine 2)" \
  A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22 NODES=500000 PAIRS=60 SEED=131
run "direct 2^20 contre direct 2^22 (graine 3)" \
  A=path/engine.js B=path/engine.js BBITS=22 NODES=500000 PAIRS=60 SEED=133
run "14 features contre 20 features, TEMPS egal (graine 2)" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 BNODES=361000 PAIRS=60 SEED=153

echo "=== file complete $(date +%H:%M) ===" | tee -a $LOG
