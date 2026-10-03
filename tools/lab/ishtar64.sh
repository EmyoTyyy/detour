#!/usr/bin/env bash
# Path contre Ishtar au reglage "Short" (3200 visites), 32 ouvertures appariees = 64 parties.
#
# Pourquoi ce reglage: les quatre niveaux d'Ishtar sont 2 / 3200 / 200000 / 1000000 visites. Les 52
# parties deja au dossier etaient a 2 visites, son plancher, et donnaient 26-26. A 3200 il n'existe
# que deux parties en direct, 1-1. C'est donc le premier niveau ou le dossier ne dit rien.
#
# Quatre tranches, quatre connexions, parce que l'attente vient de LEUR serveur et pas de notre
# processeur. Quatre parties a la fois, c'est quatre joueurs: on ne martele rien.
cd "$(dirname "$0")"
for i in 0 1 2 3; do
  F=$((i * 8)); T=$(((i + 1) * 8))
  VISITS=3200 PAIRS=32 FROM=$F TO=$T SEED=77 NODES=500000 \
    nohup node qmatch.js > ish_$i.log 2> ish_$i.err &
done
wait
echo "=== tranches terminees ==="
for i in 0 1 2 3; do echo "--- tranche $i ---"; cat ish_$i.log; done
