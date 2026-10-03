#!/usr/bin/env bash
# Le controle que je n'avais pas fait: ECHANGER LES DEUX CAMPS.
#
# Toutes les mesures d'aujourd'hui mettent le moteur livre en A et la variante en B. Le temoin
# (livre contre lui-meme) donne 50,0 % a toutes les profondeurs -- mais deux exemplaires du MEME
# moteur donnent 50 % meme si le banc favorise la place A, parce que les deux places ont le meme
# occupant. Il ne contredit donc rien.
#
# Si le banc est honnete, echanger les camps doit RENVERSER le resultat exactement: le livre
# marque 77 % en A a profondeur 8, donc la variante doit marquer 77 % quand c'est elle qui est en A.
# Si les deux marquent 77 %, c'est la PLACE qui gagne et pas le moteur, et tout ce que j'ai mesure
# aujourd'hui est a jeter.
cd "$(dirname "$0")"
S=path/engine.js
W=tools/lab/variants/engine-walls-wide.js
for D in 8 11; do
  echo "########## PROFONDEUR $D ##########"
  echo "=== sens normal: livre en A ==="
  PM_LABEL="prof $D, livre en A" A=$S B=$W DEPTH=$D PAIRS=150 WORKERS=7 SEED=1131 node parmatch.js 2>/dev/null | tail -2
  echo "=== camps echanges: elargi en A ==="
  PM_LABEL="prof $D, elargi en A" A=$W B=$S DEPTH=$D PAIRS=150 WORKERS=7 SEED=1131 node parmatch.js 2>/dev/null | tail -2
  echo
done
echo "fini"
