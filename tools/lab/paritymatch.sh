#!/usr/bin/env bash
# Le reglage de parite vaut-il de la force, dans les conditions d'une VRAIE partie ?
#
# engine.js porte depuis le debut un reglage `parity: 'even'` -- repondre depuis la derniere
# iteration de profondeur PAIRE plutot que l'impaire, qui se termine sur notre propre coup et voit
# donc notre avance sans la reponse. Il est documente comme "tuning surface only" et rien ne s'en
# servait, donc rien ne l'avait mesure.
#
# Ici les deux camps sont LE MEME FICHIER, avec et sans le reglage: aucun risque de fichier perime
# ni de liste de coups differente, la seule difference est de quelle iteration vient la reponse.
# Et le budget est en NOEUDS, parce que c'est ainsi qu'une vraie partie se joue -- une profondeur
# fixe imposerait la parite au lieu de la laisser se produire.
cd "$(dirname "$0")"
S=path/engine.js
echo "########## TEMOIN ##########"
echo "=== livre contre lui-meme, 200 000 noeuds ==="
PM_LABEL="temoin parite" A=$S B=$S NODES=200000 PAIRS=12 WORKERS=7 SEED=1141 node parmatch.js 2>/dev/null | tail -2
echo
# Les budgets couvrent la plage reelle: les niveaux faibles cherchent peu, la pleine force beaucoup.
for N in 20000 60000 200000 400000; do
  echo "########## $N NOEUDS ##########"
  echo "=== sans reglage (A) contre parite paire (B) ==="
  PM_LABEL="parite paire, $N noeuds" A=$S B=$S BPARITY=even NODES=$N PAIRS=150 WORKERS=7 SEED=1151 node parmatch.js 2>/dev/null | tail -2
  echo
done
echo "########## CONTROLE: CAMPS ECHANGES ##########"
echo "# Si le gain est reel il doit survivre a l'echange des places, comme il l'a fait pour le filtre."
PM_LABEL="parite paire en A, 200 000 noeuds" A=$S B=$S APARITY=even NODES=200000 PAIRS=150 WORKERS=7 SEED=1151 node parmatch.js 2>/dev/null | tail -2
echo
echo "fini"
