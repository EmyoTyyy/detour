// Le filtre de murs candidats ecarte-t-il des coups qui gagnent ?
//
// genMoves ne propose qu'environ 25 a 45 des ~128 murs: ceux qui sont sur un des deux plus courts
// chemins, qui touchent un mur deja pose, ou qui sont a cote d'un pion. Le commentaire du moteur
// dit que "les autres sont presque toujours sans interet" et que "la force de jeu ne les manque
// jamais". C'est une affirmation testable, et c'est la seule place du moteur ou une erreur ne se
// rattrape A AUCUNE PROFONDEUR: un coup jamais engendre ne peut pas etre trouve plus tard.
//
// Les etiquettes de la nuit ne peuvent pas servir a ce test -- elles viennent de recherches qui ne
// voyaient que les candidats, donc leur meilleur coup EST un candidat par construction. Il faut
// comparer deux recherches sur la meme position: racine normale contre racine complete (rootAll),
// qui ajoute tous les murs legaux. Si la racine complete trouve regulierement mieux, le filtre
// coute des points.
//
//   NODES=60000 N=2000 node wallfilter.js
const L = require('./lib.js');
const fs = require('fs');

const NODES = Number(process.env.NODES || 60000);
const N = Number(process.env.N || 2000);
const SRC = process.env.SRC || 'data/pos_12.csv';

const A = L.loadEngine('path/engine.js', { weights: false });
const E = A.Engine, R = A.Rules;

const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === 39);

let done = 0, differ = 0, nonCand = 0, handEmpty = 0;
const gains = [];
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const tok = toks[(i * 7919) % toks.length];
  let s;
  try { s = L.decodePos(R, tok); } catch (e) { continue; }
  const pos = E.fromRules(s);
  if (pos.hand[pos.turn] === 0) { handEmpty++; continue; }   // sans mur en main, le filtre ne joue pas

  E.clearTable();
  const narrow = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  E.clearTable();
  const wide = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, rootAll: true });
  if (narrow.best === E.MOVE_NONE || wide.best === E.MOVE_NONE) continue;

  done++;
  const inNarrow = new Set((narrow.moves || []).map(m => m.move));
  if (wide.best !== narrow.best) {
    differ++;
    // La seule difference qui compte: le coup gagnant n'etait PAS dans la liste etroite.
    // Si les deux listes le contenaient, c'est la recherche qui a change d'avis, pas le filtre.
    if (!inNarrow.has(wide.best)) {
      nonCand++;
      gains.push(wide.score - narrow.score);
    }
  }
  if (done % 100 === 0) {
    const mn = (Date.now() - t0) / 60000;
    process.stderr.write(`\r${done} positions, ${nonCand} ou le filtre ecartait le meilleur coup` +
      `  (${mn.toFixed(1)} min)`);
  }
}

gains.sort((a, b) => b - a);
const med = gains.length ? gains[gains.length >> 1] : 0;
const mean = gains.length ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length) : 0;
console.log(`\n\n${done} positions examinees a ${NODES} noeuds (${handEmpty} ignorees: plus de mur en main)`);
console.log(`  la racine complete a change d'avis          : ${differ} (${(100 * differ / done).toFixed(1)} %)`);
console.log(`  dont le coup n'etait PAS un candidat        : ${nonCand} (${(100 * nonCand / done).toFixed(1)} %)`);
if (gains.length) {
  console.log(`  gain quand c'est le cas: moyenne ${mean} points, mediane ${med}, meilleur ${gains[0]}`);
  console.log(`  dont au-dessus de 50 points: ${gains.filter(g => g > 50).length}`);
  console.log(`  dont au-dessus de 200 points: ${gains.filter(g => g > 200).length}`);
}
