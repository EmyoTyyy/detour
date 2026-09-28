#!/usr/bin/env bash
# La courbe de donnees du residuel, avant de payer la notation de 1,6 million de positions.
#
# Le residuel n'apprend que sur les positions portant un score profond: 84 218 lignes, soit 8 %
# des donnees. `scorepass.js` peut en fabriquer dix fois plus, mais cela coute une nuit de calcul.
# La question a trancher AVANT est donc: la courbe monte-t-elle encore a 84 218 ?
#
# Une seule chose change d'un point a l'autre -- la fraction de l'apprentissage. La validation est
# la meme a chaque fois, donc les points se comparent entre eux. Ce qu'on lit n'est pas la perte
# mais "fait main + reseau", en points de score d'ecart a la recherche a 240 000 noeuds: c'est la
# quantite que le residuel est cense reduire, et 432 est la valeur du fait main seul.
cd "$(dirname "$0")"
for f in 0.125 0.25 0.5 1.0; do
  echo "=== TRAIN_FRAC=$f ==="
  TRAIN_FRAC=$f SCORED_ONLY=1 RESIDUAL=1 LOSS=mse H1=256 HEAD=32,32 EPOCHS=20 \
    THREADS=8 SEED=7 OUT=curve_tmp.npz \
    .venv/bin/python -u train_nnue.py 2>&1 | grep -E "retenu|fait main|erreur moyenne|precision de signe"
  echo
done
