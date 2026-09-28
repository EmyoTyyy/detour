#!/bin/bash
SP="$1"; shift
for v in "$@"; do
  for seed in 1 2 3; do
    printf "%s seed=%s " "$v" "$seed"
    DATA=$SP/g_$v.csv LAMBDA=0 SEED=$seed EPOCHS=30 OUT=$SP/net_$v_$seed.js python3 train.py 2>/dev/null \
      | grep 'final:' | sed 's/final: //'
  done
done
