#!/usr/bin/env bash
# Le reseau juge-t-il mieux, ou abime-t-il seulement la recherche ?
#
# Les deux reseaux residuels perdent a NOEUDS egaux: l'ancien de 31 points sur 900 parties, le
# nouveau -- entraine sur 3,9 fois plus d'etiquettes et predisant 31 % mieux -- de 36 points sur
# 300. Deux causes possibles et il faut les separer, parce qu'elles n'ont pas le meme remede:
#
#   a) son JUGEMENT est moins bon que la formule, malgre une meilleure prediction. Alors la piste
#      est morte, et c'est la lecon que ce projet a deja payee une fois.
#   b) son jugement est meilleur mais il ABIME la recherche: le moteur elague avec des seuils
#      regles sur l'echelle de la formule d'origine, et une correction ajoutee par-dessus leur
#      fait dire autre chose. Alors la piste est vivante et le remede est de regler les seuils.
#
# Un budget en PROFONDEUR tranche entre les deux: les deux cotes explorent le meme nombre de
# demi-coups, donc le nombre de noeuds ne favorise plus personne et ce qui reste est le jugement.
# Profondeur 11 vaut environ 30 000 noeuds, profondeur 13 environ 160 000 -- soit le budget d'une
# vraie partie.
cd "$(dirname "$0")"
WT=tools/lab/nnue_w_plus.js
R=tools/lab/variants/engine-nnue.js

for D in 11 13; do
  echo "=== profondeur $D, formule seule contre formule + nouveau reseau ==="
  PM_LIVE=1 PM_LABEL="profondeur $D, le jugement seul" \
    A=$R B=$R AW=0 BW=$WT DEPTH=$D PAIRS=150 WORKERS=5 SEED=801 node parmatch.js 2>/dev/null | tail -3
  echo
done
echo "fini"
