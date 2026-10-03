#!/usr/bin/env bash
# Path contre Ishtar au reglage "Medium" (200000 visites), 32 ouvertures appariees = 64 parties.
#
# Niveau 3 sur 4. Le dossier ne contient RIEN au-dessus de 3200 visites: c'est la premiere mesure.
# 200000 visites, c'est 62 fois la reflexion de "Short" -- mais elle se passe sur LEUR serveur, donc
# elle ne coute rien ici. Huit tranches, huit connexions, pour diviser l'attente par huit.
#
# MOVEMS: a ce niveau un coup peut depasser les 180 s par defaut, et un timeout compterait comme
# une partie perdue alors que c'est nous qui aurions abandonne.
cd "$(dirname "$0")"
for i in 0 1 2 3 4 5 6 7; do
  F=$((i * 4)); T=$(((i + 1) * 4))
  VISITS=200000 PAIRS=32 FROM=$F TO=$T SEED=77 NODES=500000 MOVEMS=900000 \
    nohup node qmatch.js > med_$i.log 2> med_$i.err &
done
wait
echo "=== tranches terminees ==="
for i in 0 1 2 3 4 5 6 7; do echo "--- tranche $i ---"; cat med_$i.log; done
