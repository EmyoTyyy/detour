#!/usr/bin/env bash
# La nuit du 2026-10-02 : mesurer le residuel au budget AUQUEL LE JEU JOUE VRAIMENT.
#
# Le trou du dossier. Toutes les mesures du reseau residuel ont ete faites a 8 000 et 32 000
# noeuds, alors que la partie livree cherche 200 000 a 700 000 noeuds par coup
# (Brain.budget(700, 2500)). Or le signe du residuel SUIT le budget : nuisible a 8 000, utile a
# 32 000, sur trois graines. Extrapoler d'un facteur 20 n'est pas une mesure. Celle-ci l'est.
#
# L'ordre n'est pas arbitraire : le temoin d'abord (il doit imprimer exactement 50,0 %, sinon
# rien de ce qui suit ne veut dire quoi que ce soit), puis le taux de change d'un doublement
# (sans lui on ne peut pas convertir la lenteur du reseau en points), puis la question elle-meme.
#
# 3 ouvriers : la notation des positions garde les 5 autres coeurs. Un budget en NOEUDS est
# insensible a la charge de la machine -- c'est precisement pourquoi on ne mesure pas en secondes.
cd "$(dirname "$0")"
N=200000
R=tools/lab/variants/engine-nnue.js

run() { echo "=== $1 ==="; shift; "$@" 2>/dev/null | tail -2; echo; }

echo "###################### A. TEMOIN ######################"
echo "# Meme moteur des deux cotes au budget reel. Doit donner 50,0 % pile."
run "temoin, formule seule contre elle-meme, $N noeuds" \
  env A=$R B=$R AW=0 BW=0 NODES=$N PAIRS=12 WORKERS=3 SEED=301 node parmatch.js

echo "############ B. COMBIEN VAUT UN DOUBLEMENT ############"
echo "# Meme moteur, seul le budget change. L'ecart mesure EST la valeur d'un doublement."
run "100 000 contre 200 000 noeuds" \
  env A=path/engine.js B=path/engine.js NODES=100000 BNODES=200000 PAIRS=40 WORKERS=3 SEED=311 node parmatch.js

echo "######### C. LE RESIDUEL AU BUDGET REEL #########"
echo "# A = formule ecrite a la main seule. B = la meme + la correction apprise."
run "formule seule contre formule + reseau, $N noeuds, graine 321" \
  env A=$R B=$R AW=0 BW=nnue_w_resid.js NODES=$N PAIRS=120 WORKERS=3 SEED=321 node parmatch.js

echo "######### D. DOUBLEMENT AU BUDGET REEL #########"
run "200 000 contre 400 000 noeuds" \
  env A=path/engine.js B=path/engine.js NODES=200000 BNODES=400000 PAIRS=40 WORKERS=3 SEED=331 node parmatch.js

echo "fini"
