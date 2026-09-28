#!/bin/bash
SP="$1"
for seed in 4 5 6 7 8; do
  for v in v1 v4; do
    printf "%s seed=%s " "$v" "$seed"
    DATA=$SP/g_$v.csv LAMBDA=0 SEED=$seed EPOCHS=30 OUT=/dev/null python3 train.py 2>/dev/null \
      | grep 'final:' | sed 's/final: //'
  done
done
