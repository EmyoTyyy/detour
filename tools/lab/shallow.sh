#!/usr/bin/env bash
# OU le filtre elargi commence-t-il a payer, et paie-t-il NEGATIVEMENT avant ?
#
# Le tournoi a profondeur egale 11 a repondu a la question du cycle: a profondeur egale les trois
# variantes s'emboitent (elargi +234 sur livre, +235 sur "tous les murs"), et le cycle n'existait
# que sous un budget en noeuds. Mais un trou reste, et il decide de tout:
#
#   a 60 000 noeuds le moteur LIVRE ne fait pas match nul, il GAGNE de 193 points sur 600 parties.
#   L'ecart de profondeur entre les deux variantes est constant, 0,15 a 0,35 demi-coup, ce qui
#   vaut une dizaine de points. Pas deux cents.
#
# Deux explications possibles, et elles n'ont pas les memes consequences:
#
#   a) le filtre elargi est VRAIMENT plus faible en recherche peu profonde. L'elagage ne regarde
#      que 3 + profondeur^2 coups: avec 79 candidats au lieu de 57, une plus grande part des bons
#      coups tombe hors de cette fenetre, et a faible profondeur la fenetre est petite. Alors tout
#      est coherent -- mauvais en bas, bon en haut -- et il ne faut PAS livrer le changement tel
#      quel, parce que les niveaux faibles vivent en bas.
#   b) il reste un artefact du banc d'essai a budget en noeuds. Alors les 193 points n'existent pas
#      et le changement vaut ses +230.
#
# A PROFONDEUR EGALE la distinction est nette: si (a) est vrai, le moteur livre doit gagner aux
# profondeurs basses, a profondeur egale, sans qu'aucun budget n'entre en jeu. Si (b) est vrai, les
# profondeurs basses doivent donner l'egalite, comme la profondeur 9 l'a donnee (49,0 %).
cd "$(dirname "$0")"
A=path/engine.js
B=tools/lab/variants/engine-walls-wide.js
W=7

echo "########## TEMOIN ##########"
echo "=== livre contre lui-meme, profondeur 8 ==="
PM_LABEL="temoin profondeur 8" A=$A B=$A DEPTH=8 PAIRS=12 WORKERS=$W SEED=1101 node parmatch.js 2>/dev/null | tail -2
echo
for D in 5 6 7 8 10; do
  echo "########## PROFONDEUR $D ##########"
  PM_LABEL="livre contre elargi, profondeur $D" \
    A=$A B=$B DEPTH=$D PAIRS=150 WORKERS=$W SEED=1111 node parmatch.js 2>/dev/null | tail -2
  echo
done
echo "########## PROFONDEUR 9, DEUXIEME SERIE ##########"
echo "# La profondeur 9 avait donne 49,0 % sur une seule serie d'ouvertures. A verifier."
PM_LABEL="livre contre elargi, profondeur 9, autre serie" \
  A=$A B=$B DEPTH=9 PAIRS=150 WORKERS=$W SEED=1121 node parmatch.js 2>/dev/null | tail -2
echo
echo "fini"
