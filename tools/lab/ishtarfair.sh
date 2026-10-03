#!/usr/bin/env bash
# Path contre Ishtar Medium A TEMPS EGAL. 8 ouvertures appariees = 16 parties.
#
# Pourquoi: Ishtar a 200000 visites prend 36,6 s par coup (mesure: 47 / 37 / 35 / 27). Path en
# prend 1,75 a 500000 noeuds, le budget que le jeu livre lui donne. La defaite 1-20 melange donc
# deux choses: "plus faible" et "vingt fois moins de temps". Celle-ci ne mesure que la premiere.
#
# 10 500 000 noeuds = 36,6 s au regime mesure de Path (210 a 242 k noeuds/s, pratiquement plat de
# 500 k a 6 M), ce qui l'amene vers la profondeur 23. On passe par les NOEUDS et non par les
# millisecondes exactement pour que la charge de la machine ne change pas les parties: un budget en
# temps donnerait moins de reflexion quand la machine est occupee, un budget en noeuds non.
cd "$(dirname "$0")"
for i in 0 1 2 3; do
  F=$((i * 2)); T=$(((i + 1) * 2))
  VISITS=200000 PAIRS=8 FROM=$F TO=$T SEED=77 NODES=10500000 MOVEMS=900000 \
    nohup node qmatch.js > fair_$i.log 2> fair_$i.err &
done
wait
echo "=== a temps egal, Path 10,5 M noeuds contre Ishtar 200 k visites ==="
cat fair_*.log
