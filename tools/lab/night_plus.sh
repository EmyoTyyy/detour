#!/usr/bin/env bash
# Le reseau reentraine sur 3,9 fois plus d'etiquettes, juge par des parties.
#
# Il predit nettement mieux: 207 points d'ecart a une recherche profonde contre 303 pour la
# formule seule, et la courbe montait encore (21 %, 27 %, 31 % de mieux a 25 %, 50 %, 100 % des
# etiquettes). Mais ce projet a deja paye pour savoir que mieux PREDIRE n'est pas mieux JOUER: un
# reseau qui predisait bien mieux a perdu 636 points a effort egal. Seules les parties tranchent.
#
# Deuxieme depart. Le premier mesurait un fichier mal etiquete: export_nnue.py lisait le drapeau
# "correction ou remplacement" dans sa propre variable d'environnement et non dans le reseau
# entraine, et l'export avait ete lance sur une ligne qui ne la portait pas. Le reseau avait appris
# une CORRECTION du fait main et le moteur rendait cette correction comme si elle etait le score
# entier. Corrige: le drapeau voyage maintenant dans le .npz. Verifie: sur la position temoin la
# formule dit +280, le reseau la corrige a +242, et attenuer de moitie donne +261 -- exactement
# la moitie de la correction, ce qui ne peut etre vrai que d'une correction.
cd "$(dirname "$0")"
WT=tools/lab/nnue_w_plus.js
R=tools/lab/variants/engine-nnue.js

echo "=== garde-fou ==="
node -e "
const L=require('./lib.js'); const t='000008000000000000000000000000006414a90';
const f=w=>{const A=L.loadEngine('$R',{weights:w});const s=L.decodePos(A.Rules,t);return A.Engine.evaluate(A.Engine.fromRules(s));};
const a=f(false), b=f('$WT'), h=f('tools/lab/nnue_w_plus_g50.js');
console.log('sans reseau', a, '| avec le nouveau reseau', b, '| a moitie', h);
if (a===b) { console.log('ARRET: poids non charges'); process.exit(1); }
if (Math.abs((b-a)/2 - (h-a)) > 2) { console.log('ARRET: ce n est pas une correction proportionnelle'); process.exit(1); }
console.log('ok: reseau actif, et c est bien une correction');
" || exit 1

echo
echo "=== formule seule contre formule + NOUVEAU reseau, 200 000 noeuds, graine 621 ==="
PM_LIVE=1 PM_LABEL="le nouveau reseau, 4x plus d etiquettes, 200 000 noeuds" \
  A=$R B=$R AW=0 BW=$WT NODES=200000 PAIRS=150 WORKERS=5 SEED=621 node parmatch.js 2>/dev/null | tail -3
echo "fini"
