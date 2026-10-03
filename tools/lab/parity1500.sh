#!/usr/bin/env bash
# Les budgets que les NIVEAUX utilisent reellement, d'apres la table LEVELS de engine.js:
# 1 500 noeuds du niveau 1950 vers le bas, 5 000 a 2350, 15 000 a 2500, 50 000 a 3000, et aucun
# plafond a pleine force. Le +163 mesure a 20 000 tombe entre deux rungs; voici les vrais.
cd "$(dirname "$0")"
S=path/engine.js
for N in 1500 5000 15000 50000; do
  echo "########## $N NOEUDS ##########"
  PM_LABEL="temoin $N" A=$S B=$S NODES=$N PAIRS=12 WORKERS=7 SEED=1191 node parmatch.js 2>/dev/null | tail -1
  PM_LABEL="parite paire, $N noeuds" A=$S B=$S BPARITY=even NODES=$N PAIRS=200 WORKERS=7 SEED=1201 node parmatch.js 2>/dev/null | tail -2
  echo
done
echo "fini"
