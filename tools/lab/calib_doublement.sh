#!/usr/bin/env bash
# Combien vaut un doublement de noeuds, dans CE moteur et a CE budget ?
#
# Le chiffre manque partout: STATUS.md convertit des ecarts de vitesse en Elo ("27,8 % de moins,
# soit 0,47 doublement, soit -25 a -40 Elo") avec une valeur supposee. Or c'est exactement le taux
# de change qui decide si une evaluation plus couteuse est rentable. Meme moteur des deux cotes,
# seul le budget change: l'ecart mesure EST la valeur d'un doublement.
cd "$(dirname "$0")"
for n in 50000 100000; do
  echo "=== $n noeuds contre $((n*2)) ==="
  A=path/engine.js B=path/engine.js NODES=$n BNODES=$((n*2)) PAIRS=60 WORKERS=7 SEED=121 \
    node parmatch.js 2>/dev/null | tail -2
done
