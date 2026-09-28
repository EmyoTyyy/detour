#!/usr/bin/env bash
# Le meme reseau a plusieurs budgets. Une seule mesure ne distingue pas "mauvais reseau" de
# "reseau qui destabilise une recherche profonde", et les deux menent ailleurs.
cd "$(dirname "$0")"
for n in 5000 20000 80000; do
  printf "%7d noeuds  " "$n"
  A=path/engine.js B=path/engine.js BW=tools/lab/netweights_deep.js \
    NODES=$n PAIRS=100 WORKERS=8 SEED=81 node parmatch.js 2>/dev/null | tail -1
done
