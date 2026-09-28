#!/usr/bin/env bash
# The night's queue, run one at a time across every spare core.
#
# Seven matches sharing eight cores all finish at once, three and a half hours later. The same
# work run one at a time, each spread across the cores by parmatch, delivers the first verdict in
# forty minutes and every later one as it lands -- same total, but each answer can be acted on.
cd "$(dirname "$0")"
W=${W:-6}
LOG=night_results.log
run() {
  local name="$1"; shift
  echo "=== $name  ($(date +%H:%M)) ===" | tee -a $LOG
  ( env "$@" WORKERS=$W node parmatch.js 2>/dev/null ) | tee -a $LOG
  echo | tee -a $LOG
}

# 1. Can the bucketed table at 19 MB match the direct-mapped one at 76 MB? If yes, ship the
#    bucket: the same ~220 Elo without asking a phone for 76 MB. This is the night's big one.
run "godets 2^20 contre direct 2^22" \
  A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22 \
  NODES=500000 PAIRS=60 SEED=31

# 2. Confirm the headline on a fresh seed. 21.7% came from 60 games with a clean control, but
#    the claim is large enough to deserve a second sample.
run "direct 2^20 contre direct 2^22 (replication)" \
  A=path/engine.js B=path/engine.js BBITS=22 \
  NODES=500000 PAIRS=60 SEED=33

# 3. Do the wall-geometry features actually win games? Equal NODES, so this does not charge
#    them their cost -- it is an upper bound, and a loss here kills them outright.
run "reseau 14 features contre 20 features (murs), noeuds egaux" \
  A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 PAIRS=60 SEED=41

# 4. Does bucketing help at the SAME memory? Separates "buckets are good" from "memory is good".
run "direct 2^20 contre godets 2^20 (memoire egale)" \
  A=path/engine.js B=tools/lab/variants/engine-tt4way.js \
  NODES=500000 PAIRS=60 SEED=32

# 5. Where is the knee? Only worth asking if 2^22 beat 2^20 again.
run "2^21 contre 2^22" \
  A=path/engine.js ABITS=21 B=path/engine.js BBITS=22 \
  NODES=500000 PAIRS=60 SEED=34

run "2^22 contre 2^23" \
  A=path/engine.js ABITS=22 B=path/engine.js BBITS=23 \
  NODES=500000 PAIRS=60 SEED=35

echo "=== file terminee $(date +%H:%M) ===" | tee -a $LOG
