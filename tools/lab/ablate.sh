#!/usr/bin/env bash
# Which of the six wall features earn their place? Each row trains on the same 1.26M positions
# with the same seeds, differing only in which columns it is allowed to see.
SP="$1"
B=$(seq -s, 0 13)                       # the 14 that shipped
declare -A SETS=(
  ["14 de base"]="$B"
  ["+ murs devant (14,15)"]="$B,14,15"
  ["+ murs autour du pion (16,17)"]="$B,16,17"
  ["+ directions ouvertes (18,19)"]="$B,18,19"
  ["les 20"]="$B,14,15,16,17,18,19"
)
for name in "14 de base" "+ murs devant (14,15)" "+ murs autour du pion (16,17)" "+ directions ouvertes (18,19)" "les 20"; do
  tot=0; n=0
  for seed in 1 2 3; do
    v=$(DATA=$SP/g_v4.csv FEATS="${SETS[$name]}" LAMBDA=0 SEED=$seed EPOCHS=30 OUT=/dev/null \
        python3 train.py 2>/dev/null | grep 'final:' | sed 's/.*val loss \([0-9.]*\).*/\1/')
    tot=$(python3 -c "print($tot + $v)"); n=$((n+1))
  done
  python3 -c "print(f'{\"$name\":34s} perte moyenne {$tot/$n:.4f}')"
done
