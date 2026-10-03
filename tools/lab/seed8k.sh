#!/usr/bin/env bash
# Le -204 a 8 000 noeuds tient-il sur d'autres ouvertures ?
#
# C'est la faiblesse de mes propres mesures: a 20 000 noeuds le resultat a ete reproduit sur deux
# series d'ouvertures et verifie par l'echange des camps, mais 1 500, 5 000 et 8 000 n'ont eu
# qu'une seule serie chacun. Or 8 000 est precisement celui qui casse le motif, avec un signe
# oppose a ses voisins. Si son signe ne survit pas a d'autres ouvertures, ce n'est pas le budget
# qui retourne le resultat, ce sont mes mesures a une seule serie qui ne valent rien -- et il
# faudrait alors relire de la meme facon le balayage a profondeur egale, ou les profondeurs 5, 6,
# 7 et 10 n'ont elles aussi qu'une seule serie.
cd "$(dirname "$0")"
S=path/engine.js
for SEED in 1301 1311 1321; do
  echo "########## 8 000 NOEUDS, GRAINE $SEED ##########"
  PM_LABEL="parite paire, 8k, graine $SEED" A=$S B=$S BPARITY=even NODES=8000 PAIRS=200 WORKERS=7 SEED=$SEED node parmatch.js 2>/dev/null | tail -2
  echo
done
echo "########## ET 5 000, DEUXIEME SERIE ##########"
PM_LABEL="parite paire, 5k, graine 1331" A=$S B=$S BPARITY=even NODES=5000 PAIRS=200 WORKERS=7 SEED=1331 node parmatch.js 2>/dev/null | tail -2
echo
echo "fini"
