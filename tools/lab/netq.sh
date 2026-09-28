#!/usr/bin/env bash
# The network questions, re-asked with weights that are actually alive.
#
# Every one of these was answered last night against a network that evaluated every position as
# exactly 0 -- setNet reads w.b2[0], train.py wrote b2 as a scalar, and (scale * NaN) | 0 is 0.
# The engine played blind and lost 120-0, which reads as "weak network" and was "no network".
# netcheck.js now refuses any weights file whose evaluations are all the same value.
cd "$(dirname "$0")"
# Wait for the table experiments: two queues sharing the cores make both slower and neither
# answers sooner.
while pgrep -f 'bash \./rr3\.sh|bash \./rr500\.sh' > /dev/null; do sleep 30; done
W=${W:-7}
LOG=net_results.log
run() {
  local name="$1"; shift
  if grep -A6 -F "=== $name" $LOG 2>/dev/null | grep -q 'A scores'; then echo "[deja fait] $name"; return; fi
  echo "=== $name  ($(date +%H:%M)) ===" | tee -a $LOG
  ( env "$@" WORKERS=$W node parmatch.js 2>/dev/null ) | tee -a $LOG
  echo | tee -a $LOG
}

# Refuse to run anything on a dead network.
for w in tools/lab/netweights_out14.js:path/engine.js \
         tools/lab/netweights_v6.js:tools/lab/variants/engine-feat6.js \
         tools/lab/netweights_v4.js:tools/lab/variants/engine-feat5.js; do
  node netcheck.js "${w%%:*}" "${w##*:}" || { echo "ARRET: ${w%%:*} n evalue pas"; exit 1; }
done

# 1. The distillation ceiling, finally asked properly. The shipped network was trained to predict
#    a 20,000-node search and is worth nothing beyond 20,000 nodes -- you cannot distil a teacher
#    and then outrun it. This one was trained on who actually won, which has no teacher to outrun.
#    Same 14 features on both sides, so the two run at the same speed and nodes are fair.
run "reseau livre (etiquettes de recherche) contre reseau resultat, 14 features" \
  A=path/engine.js B=path/engine.js BW=tools/lab/netweights_out14.js \
  NODES=500000 PAIRS=60 SEED=61

# 2. The wall features, at equal nodes: an upper bound that does not charge them their cost.
run "14 features contre 16 features, noeuds egaux" \
  A=path/engine.js B=tools/lab/variants/engine-feat6.js BW=tools/lab/netweights_v6.js \
  NODES=500000 PAIRS=60 SEED=62

# 3. And charged: 16 features run at 141k nodes/s against 177k, so 398 000 against 500 000.
run "14 features contre 16 features, TEMPS egal" \
  A=path/engine.js B=tools/lab/variants/engine-feat6.js BW=tools/lab/netweights_v6.js \
  NODES=500000 BNODES=398000 PAIRS=60 SEED=63

# 4. The full six, charged: 127k against 177k.
run "14 features contre 20 features, TEMPS egal" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 BNODES=359000 PAIRS=60 SEED=64

echo "=== file reseau terminee $(date +%H:%M) ===" | tee -a $LOG
