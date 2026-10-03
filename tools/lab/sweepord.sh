#!/usr/bin/env bash
# Balaye la constante "le mur croise NOTRE chemin" contre les noeuds pour la meme profondeur.
# Le code a +8000; l'ajustement sur etiquettes disait -18000 et s'est trompe. Quelle valeur est
# reellement la moins chere ? Un temoin a +8000 doit rendre exactement 1,000.
cd "$(dirname "$0")"
for V in 8000 0 -8000 -18000 4000 16000 32000; do
  F=$(P1=$V node mkordc.js)
  R=$(B="tools/lab/variants/$(basename $F)" N=150 DEPTHS=8,10 node ordcost.js 2>/dev/null \
      | awk '/^ *(8|10) /{printf "  prof %-3s rapport %s", $1, $5}')
  printf "P1=%-7s %s\n" "$V" "$R"
done
echo "fini"
