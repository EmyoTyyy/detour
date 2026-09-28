#!/usr/bin/env bash
# La largeur de l'accumulateur, qui est le vrai cout a l'execution.
#
# Avec une tete courte, la tete ne coute que 260 multiplications par position evaluee, mais
# l'accumulateur coute 2 x H additions ENTIERES par coup joue (deux points de vue), et un coup est
# joue puis annule a chaque noeud. A H=256 cela fait environ mille operations par noeud, soit plus
# que la tete. Diviser H par deux divise ce cout par deux; la question est ce que ca retire a la
# prediction. On mesure au lieu de choisir.
cd "$(dirname "$0")"
P=.venv/bin/python
for h in 128 64; do
  echo "=== accumulateur H=$h, tete courte, 80 epoques ==="
  H1=$h HEAD= EPOCHS=80 OUT=nnue_h$h.npz $P -u train_nnue.py 2>&1 | grep -vE "^  epoque +([0-9]|[1-6][0-9]|7[0-8]) "
  echo
done
