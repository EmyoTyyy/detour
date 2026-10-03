#!/usr/bin/env bash
# Le +163 a 20 000 noeuds: reproductible, et survit-il a l'echange des camps ?
#
# Le premier script n'echangeait les places qu'a 200 000 noeuds -- et a 200 000 l'effet est nul,
# donc ce controle-la ne dit rien du resultat a 20 000. C'est precisement la que le controle est
# necessaire, parce que c'est la que le gain est annonce. Plus une deuxieme serie d'ouvertures:
# un seul resultat a 300 parties n'est pas un resultat.
cd "$(dirname "$0")"
S=path/engine.js
echo "########## TEMOIN A 20 000 ##########"
PM_LABEL="temoin 20k" A=$S B=$S NODES=20000 PAIRS=12 WORKERS=7 SEED=1161 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## 20 000, AUTRE SERIE D OUVERTURES ##########"
PM_LABEL="parite paire, 20k, graine 1171" A=$S B=$S BPARITY=even NODES=20000 PAIRS=200 WORKERS=7 SEED=1171 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## 20 000, CAMPS ECHANGES ##########"
echo "# La parite paire passe en A: le resultat doit se renverser, soit environ 72 %."
PM_LABEL="parite paire en A, 20k" A=$S B=$S APARITY=even NODES=20000 PAIRS=150 WORKERS=7 SEED=1151 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## 8 000 NOEUDS, PLUS BAS ENCORE ##########"
echo "# Si l'effet grandit quand le budget baisse, les niveaux faciles sont la ou il compte."
PM_LABEL="parite paire, 8k" A=$S B=$S BPARITY=even NODES=8000 PAIRS=200 WORKERS=7 SEED=1181 node parmatch.js 2>/dev/null | tail -2
echo
echo "fini"
