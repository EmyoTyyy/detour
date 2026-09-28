#!/bin/bash
# Compare feature sets by held-out loss over several seeds. Loss is free and far more sensitive
# than a match: a 120-game match resolves nothing finer than +/- 63 Elo, so screening feature
# sets by match play would burn days to learn nothing. Only the survivor gets a match.
SP="$1"; shift
for v in "$@"; do
  for seed in 1 2 3 4 5; do
    printf "%s seed=%s " "$v" "$seed"
    DATA=$SP/f_$v.csv LAMBDA=0 SEED=$seed EPOCHS=40 OUT=/dev/null python3 train.py 2>/dev/null \
      | grep 'final:' | sed 's/final: //'
  done
done
