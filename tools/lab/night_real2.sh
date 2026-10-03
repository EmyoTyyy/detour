#!/usr/bin/env bash
# Reprise de la mesure du residuel, avec le bon chemin de poids.
#
# La premiere tentative a mesure le moteur contre lui-meme: les poids etaient nommes
# "nnue_w_resid.js" alors que les chemins partent de la racine du depot et que le fichier vit
# dans tools/lab. Le chargeur passait outre sans un mot. 240 parties a 200 000 noeuds ont rendu
# "50,0 % +/- 0,0", soit exactement ce que rend un moteur contre lui-meme -- le signe qu'il
# fallait lire, et qui n'avait rien a voir avec le reseau. lib.js leve maintenant une erreur.
#
# A effort EGAL des deux cotes: la question posee ici est seulement "cette evaluation est-elle
# meilleure". Le cout de sa lenteur se deduit apres coup, maintenant qu'un doublement a un prix
# mesure: +37 points de 100 000 a 200 000 noeuds, +26 de 200 000 a 400 000.
cd "$(dirname "$0")"
WT=tools/lab/nnue_w_resid.js
R=tools/lab/variants/engine-nnue.js

echo "=== temoin de non-regression: le reseau change-t-il vraiment l evaluation ? ==="
node -e "
const L=require('./lib.js'); const t='000008000000000000000000000000006414a90';
const f=w=>{const A=L.loadEngine('$R',{weights:w});const s=L.decodePos(A.Rules,t);return A.Engine.evaluate(A.Engine.fromRules(s));};
const a=f(false), b=f('$WT');
console.log('sans reseau', a, '| avec reseau', b);
if (a===b) { console.log('ARRET: le reseau ne change rien, les poids ne sont pas charges'); process.exit(1); }
console.log('ok, le reseau est bien actif');
" || exit 1

echo
echo "=== formule seule contre formule + reseau, 200 000 noeuds, graine 321 ==="
A=$R B=$R AW=0 BW=$WT NODES=200000 PAIRS=150 WORKERS=3 SEED=321 node parmatch.js 2>/dev/null | tail -3
echo "fini"
