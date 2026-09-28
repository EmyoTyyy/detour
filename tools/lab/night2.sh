#!/usr/bin/env bash
# Runs once the first queue is done. Waits rather than competing: two queues sharing the cores
# would just make both slower and neither would answer sooner.
cd "$(dirname "$0")"
while pgrep -f 'bash .*night\.sh' > /dev/null; do sleep 60; done
W=${W:-6}
LOG=night_results.log
run() {
  echo "=== $1  ($(date +%H:%M)) ===" | tee -a $LOG; shift
  ( env "$@" WORKERS=$W node parmatch.js 2>/dev/null ) | tee -a $LOG
  echo | tee -a $LOG
}

# Does the wall candidate filter cost strength? It drops 58 of 123 legal walls in a typical
# position, and a move that is never generated is one no amount of depth can find. Generating
# every wall costs breadth, so it should lose at a fixed budget -- the question is by how much.
run "filtre de murs contre tous les murs, 500k" \
  A=path/engine.js B=tools/lab/variants/engine-allwalls.js \
  NODES=500000 PAIRS=60 SEED=51

# Same question with three times the budget. If the filter is merely a good use of a small
# budget, the gap shrinks as the budget grows; if it is throwing away real moves, it does not.
run "filtre de murs contre tous les murs, 1.5M" \
  A=path/engine.js B=tools/lab/variants/engine-allwalls.js \
  NODES=1500000 PAIRS=30 SEED=52

# The wall features charged their real cost: 27.8% slower, so 361k nodes against 500k.
run "14 features contre 20 features, TEMPS egal" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 BNODES=361000 PAIRS=60 SEED=53

echo "=== deuxieme file terminee $(date +%H:%M) ===" | tee -a $LOG
