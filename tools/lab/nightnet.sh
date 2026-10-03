#!/usr/bin/env bash
# Reconstruire le jeu d'entrainement avec les etiquettes de la nuit, puis reentrainer.
#
# La question est celle de l'etape 10 : le reseau plafonne-t-il parce qu'il manque d'exemples ?
# Seules 137 721 des 1 675 810 positions stockees portaient le verdict d'une longue recherche --
# 8 % -- et ce sont les seules dont le residuel peut apprendre. La notation de cette nuit en
# fabrique des centaines de milliers d'autres sans rejouer une seule partie.
#
# Ce qui rend la comparaison valable, et c'est tout l'enjeu : les MEMES 89 fichiers, dans le MEME
# ordre, donc les memes lignes et le meme decoupage de validation (RandomState(7) sur N). Une
# seule chose change, le nombre de lignes qui portent une etiquette. Si le fichier avait change,
# le nouveau chiffre et l'ancien seraient deux chiffres sur deux ensembles differents -- et ce
# piege a deja coute une journee dans ce projet.
#
# Reference a battre : 432 points d'ecart a une recherche de 240 000 noeuds pour la formule
# ecrite a la main seule, 304 pour le residuel entraine sur 8 % des etiquettes.
cd "$(dirname "$0")"
set -u

echo "########## 1. RECONSTRUCTION DU JEU D ENTRAINEMENT ##########"
date '+%H:%M:%S'
FILES="$(cat nnue_files.txt)" SCORED=data/scored OUTDIR=data/nnue_plus \
  node nnuedata.js 2>&1 | tail -4

echo
echo "########## 2. COMBIEN D ETIQUETTES EN PLUS ##########"
python3 - <<'PY'
import json, io
a = json.load(io.open('data/nnue/meta.json', encoding='utf-8'))
b = json.load(io.open('data/nnue_plus/meta.json', encoding='utf-8'))
print(f"lignes        : {a['rows']:,} -> {b['rows']:,}   (doivent etre egales)")
print(f"etiquetees    : {a['scored']:,} -> {b['scored']:,}   x{b['scored']/max(1,a['scored']):.1f}")
print(f"dont jointes  : {b.get('joined', 0):,}")
PY

echo
echo "########## 3. LA COURBE DE DONNEES ##########"
echo "# Une seule chose change d un point a l autre : la fraction des etiquettes utilisee."
echo "# Si la courbe monte encore a 1.0, il faut continuer a noter. Si elle plafonne, le"
echo "# manque d exemples n etait pas le probleme et il faut chercher ailleurs."
for f in 0.25 0.5 1.0; do
  echo "=== TRAIN_FRAC=$f ==="
  DATA=data/nnue_plus TRAIN_FRAC=$f SCORED_ONLY=1 RESIDUAL=1 LOSS=mse H1=256 HEAD=32,32 \
    EPOCHS=20 THREADS=4 SEED=7 OUT=nnue_plus_$f.npz \
    .venv/bin/python -u train_nnue.py 2>&1 | grep -E "retenu|fait main|ce reseau|erreur moyenne|precision de signe|final"
  echo
done

echo "########## 4. LE MEILLEUR, EXPORTE POUR LE MOTEUR ##########"
.venv/bin/python export_nnue.py nnue_plus_1.0.npz nnue_w_plus.js 2>&1 | tail -3
ls -l nnue_w_plus.js
echo "fini"
