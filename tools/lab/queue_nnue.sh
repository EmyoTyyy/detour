#!/usr/bin/env bash
# Trois mesures, dans l'ordre ou elles decident quelque chose. Sequentielles et pas en parallele:
# huit coeurs partages entre trois entrainements donnent trois resultats en meme temps a la fin,
# alors qu'en file le premier verdict arrive en deux minutes.
cd "$(dirname "$0")"
P=.venv/bin/python

# 1. Les 14 anciennes entrees dans CE code. C'est le controle qui rend la comparaison propre:
#    meme optimiseur, memes epoques, meme decoupe -- seules les entrees changent.
echo "=== 1. 14 entrees faites main, dans torch (controle a entrees identiques) ==="
SPARSE=0 DENSE_FILE=f14.f32 DENSE_N=14 HEAD=16 EPOCHS=24 OUT=nnue_f14.npz $P -u train_nnue.py 2>&1 | grep -vE "^  epoque +([0-9]|1[0-9]|2[0-2]) "

# 2. La tete courte: accumulateur puis une seule matrice vers la sortie. 260 multiplications par
#    evaluation au lieu de 9 400. Si elle tient, c'est elle qu'on embarque.
echo; echo "=== 2. plateau, tete courte (256+4 -> 1) ==="
HEAD= EPOCHS=24 OUT=nnue_short.npz $P -u train_nnue.py 2>&1 | grep -vE "^  epoque +([0-9]|1[0-9]|2[0-2]) "

# 3. La tete longue, plus longtemps: la courbe descendait encore a la 24e epoque.
echo; echo "=== 3. plateau, tete longue, 80 epoques ==="
HEAD=32,32 EPOCHS=80 OUT=nnue_board80.npz $P -u train_nnue.py 2>&1 | grep -vE "^  epoque +([0-9]|[1-6][0-9]|7[0-8]) "

# 4. Et la tete courte sur la meme duree, pour que la comparaison des deux tetes porte sur des
#    entrainements de meme longueur et pas sur un avantage de patience.
echo; echo "=== 4. plateau, tete courte, 80 epoques ==="
HEAD= EPOCHS=80 OUT=nnue_short80.npz $P -u train_nnue.py 2>&1 | grep -vE "^  epoque +([0-9]|[1-6][0-9]|7[0-8]) "
