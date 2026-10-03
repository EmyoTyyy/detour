#!/usr/bin/env bash
# Parite, ou simple recul d'une iteration ?
cd "$(dirname "$0")"
S=path/engine.js
L=tools/lab/variants/engine-lag.js
echo "########## GARDE-FOU: LA VARIANTE SANS DRAPEAU EST LE MOTEUR LIVRE ##########"
echo "# Sans parity=lag les trois lignes ajoutees ne font rien. Si ce match n'est pas"
echo "# exactement 50,0 % +/- 0,0, la variante a change autre chose et rien d'autre ne compte."
PM_LABEL="garde-fou lag" A=$S B=$L NODES=20000 PAIRS=24 WORKERS=7 SEED=1211 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## RECUL D UNE ITERATION, 20 000 NOEUDS ##########"
echo "# Si ca vaut aussi ~+163, ce n'est pas la parite: c'est que la derniere iteration achevee"
echo "# ne vaut pas celle d'avant quand le budget est serre."
PM_LABEL="recul d une iteration, 20k" A=$S B=$L BPARITY=lag NODES=20000 PAIRS=200 WORKERS=7 SEED=1201 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## ET A 8 000 NOEUDS, OU LA PARITE PAIRE PERD DE 204 ##########"
echo "# La parite paire change de signe entre 8 000 et 20 000. Le recul fait-il de meme ?"
PM_LABEL="recul d une iteration, 8k" A=$S B=$L BPARITY=lag NODES=8000 PAIRS=200 WORKERS=7 SEED=1181 node parmatch.js 2>/dev/null | tail -2
echo
echo "########## RECUL CONTRE PARITE PAIRE, 20 000 NOEUDS ##########"
echo "# Les deux reculent d'un demi-coup; l'un toujours, l'autre seulement depuis une profondeur"
echo "# impaire. S'ils sont a egalite, ils font la meme chose."
PM_LABEL="recul contre parite paire, 20k" A=$L B=$S APARITY=lag BPARITY=even NODES=20000 PAIRS=150 WORKERS=7 SEED=1221 node parmatch.js 2>/dev/null | tail -2
echo
echo "fini"
