#!/usr/bin/env bash
# Le tableau de decision, revise: la tete courte a gagne sur les deux tableaux a la serie 4
# (0.2850 contre 0.2942 pour la tete longue, et 36 fois moins cher par evaluation), donc les
# questions restantes portent sur elle seule.
#
#   A. le filtre sur les positions reellement soumises au reseau vaut-il quelque chose ?
#      (a comparer au 0.2850 de la serie 4, meme forme, memes epoques, sans filtre)
#   B. un accumulateur deux fois moins large coute deux fois moins par coup: que perd-on ?
#   C. et deux fois plus large, est-ce que ca achete quelque chose ?
cd "$(dirname "$0")"
P=.venv/bin/python
quiet='^  epoque +([0-9]|[1-6][0-9]|7[0-8]) '

echo "=== A. tete courte, H=256, AVEC filtre ==="
HEAD= H1=256 REACH=1 EPOCHS=80 OUT=nnue_f256.npz $P -u train_nnue.py 2>&1 | grep -vE "$quiet"
echo; echo "=== B. tete courte, H=128, avec filtre ==="
HEAD= H1=128 REACH=1 EPOCHS=80 OUT=nnue_f128.npz $P -u train_nnue.py 2>&1 | grep -vE "$quiet"
echo; echo "=== C. tete courte, H=512, avec filtre ==="
HEAD= H1=512 REACH=1 EPOCHS=80 OUT=nnue_f512.npz $P -u train_nnue.py 2>&1 | grep -vE "$quiet"
