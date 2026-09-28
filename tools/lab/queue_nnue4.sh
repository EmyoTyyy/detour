#!/usr/bin/env bash
# Deux mesures qui repondent aux deux questions ouvertes.
#
# D. Le controle a 14 entrees sur la population QUI COMPTE. Le 0.3403 de reference porte sur toute
#    la validation, or le moteur n'appelle son reseau que sur 69,4 % des positions -- et celles-la
#    sont bien plus dures (0.4042 contre 0.2912 pour le meme reseau). Sans ce controle, comparer
#    0.4042 a 0.3403 serait comparer deux populations, exactement l'erreur que le reste de ce
#    fichier passe son temps a eviter.
#
# E. La cible de RECHERCHE au lieu de l'issue. Le reseau entraine sur les issues predit mieux et
#    choisit le coup d'une recherche profonde deux fois moins souvent (32 % contre 56 %). Un
#    alpha-beta demande a son evaluation de feuille d'approximer ce qu'une recherche plus profonde
#    repondrait, pas de deviner qui gagnera la partie -- deux quantites differentes, et seule la
#    premiere lui sert. Peu de lignes portent un score (8,2 %), donc ce n'est pas un candidat a
#    embarquer: c'est un test d'hypothese.
cd "$(dirname "$0")"
P=.venv/bin/python
quiet='^  epoque +([0-9]|[1-6][0-9]|7[0-8]) '

echo "=== D. 14 entrees faites main, sur les positions soumises au reseau ==="
SPARSE=0 DENSE_FILE=f14.f32 DENSE_N=14 HEAD=16 REACH=1 EPOCHS=80 OUT=nnue_f14_reach.npz $P -u train_nnue.py 2>&1 | grep -vE "$quiet"

echo; echo "=== E. plateau, cible de recherche, lignes notees seulement ==="
HEAD= H1=256 REACH=1 SCORED_ONLY=1 EPOCHS=80 OUT=nnue_score.npz $P -u train_nnue.py 2>&1 | grep -vE "$quiet"
