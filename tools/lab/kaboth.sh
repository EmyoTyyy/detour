#!/usr/bin/env bash
# Path contre Ka a son PLANCHER (1 visite) et a son MAXIMUM (20000 visites), memes 16 ouvertures.
#
# Les deux ensemble, parce que la question n'est pas seulement le score: c'est de savoir si Ka
# devient plus fort quand on lui donne plus de visites. S'il marque pareil a 1 et a 20000, le
# reglage ne mord pas et aucun des deux chiffres ne veut rien dire. S'il y a une pente, l'echelle
# est saine et les deux chiffres se lisent.
#
# Budget en NOEUDS pour Path, donc insensible a la charge de la machine: deux processus qui se
# disputent un coeur jouent exactement la meme partie, seulement moins vite.
cd "$(dirname "$0")"
for i in 0 1 2 3; do
  F=$((i * 4)); T=$(((i + 1) * 4))
  VISITS=1 PAIRS=16 FROM=$F TO=$T SEED=77 NODES=500000 MOVEMS=120000 \
    nohup node kamatch.js > kaf_$i.log 2> kaf_$i.err &
done
for i in 0 1 2 3; do
  F=$((i * 4)); T=$(((i + 1) * 4))
  VISITS=20000 PAIRS=16 FROM=$F TO=$T SEED=77 NODES=500000 MOVEMS=300000 \
    nohup node kamatch.js > kam_$i.log 2> kam_$i.err &
done
wait
echo "########## Ka a 1 visite ##########"; cat kaf_*.log
echo "########## Ka a 20000 visites ##########"; cat kam_*.log
