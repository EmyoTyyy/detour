// Les coups que le filtre de murs ecarte sont-ils VRAIMENT meilleurs ?
//
// Premiere mesure: la racine elargie a tous les murs legaux choisit un coup que le filtre
// ecartait dans 1,1 % des positions a 60 000 noeuds, avec 96 points d'ecart en moyenne. On ne peut
// pas en conclure que le filtre coute des points, et la raison est precise: la racine elargie a
// deux fois plus de coups a la racine, cherche donc environ un demi-coup moins profond, et une
// recherche moins profonde SURESTIME. Le "+96" peut n'etre que cet optimisme.
//
// La verification ne compare donc pas deux scores de recherches inegales. Elle joue les deux
// coups et examine les deux positions FILLES au meme budget, bien plus eleve. La valeur d'un coup
// pour nous est l'oppose du score de la position qu'il laisse a l'adversaire. Les deux coups
// recoivent exactement le meme traitement, donc l'optimisme, s'il reste, s'applique aux deux.
//
//   NODES=60000 DEEP=600000 N=2000 SHARD=0 NSHARD=11 node wallverify.js
const L = require('./lib.js');
const fs = require('fs');

const NODES = Number(process.env.NODES || 60000);
const DEEP = Number(process.env.DEEP || 600000);
const N = Number(process.env.N || 2000);
const SHARD = Number(process.env.SHARD || 0);
const NSHARD = Number(process.env.NSHARD || 1);
const SRC = process.env.SRC || 'data/pos_12.csv';
const OUT = process.env.OUT || `wv_${SHARD}.csv`;

// Quel moteur fournit la liste FILTREE a comparer. Par defaut celui qui est livre; en passant la
// variante elargie on mesure si l'elargissement repare le defaut -- meme instrument, meme juge,
// donc les deux chiffres sont comparables terme a terme. Le juge reste ce moteur-ci: `rootAll`
// n'est pas un moteur different, c'est la meme recherche sans le filtre a la racine.
const BASE = process.env.BASE || 'path/engine.js';
const A = L.loadEngine(BASE, { weights: false });
const E = A.Engine, R = A.Rules;

const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === 39);

// La valeur d'un coup, vue de celui qui le joue: on l'applique, on examine profondement la
// position laissee a l'adversaire, et on prend l'oppose de son score.
function valueOf(state, action) {
  const next = R.cloneState(state);
  next.hWalls = new Set(state.hWalls);
  next.vWalls = new Set(state.vWalls);
  if (action.type === 'wall') {
    if (!R.canPlaceWall(next, next.turn, action.orient, action.r, action.c)) return null;
    R.applyWall(next, action.orient, action.r, action.c);
  } else {
    R.applyMove(next, action.to);
  }
  if (next.winner !== null) return next.winner === state.turn ? 100000 : -100000;
  const child = E.fromRules(next);
  E.clearTable();
  const r = E.analyse(child, { budgetMs: 1e9, maxNodes: DEEP });
  return -r.score;
}

console.error('base: ' + BASE + ', NODES=' + NODES + ', DEEP=' + DEEP + ', SRC=' + SRC);
const rows = [];
let seen = 0, cases = 0, handEmpty = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  if (i % NSHARD !== SHARD) continue;
  let s;
  try { s = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  const pos = E.fromRules(s);
  if (pos.hand[pos.turn] === 0) { handEmpty++; continue; }

  E.clearTable();
  const narrow = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  E.clearTable();
  const wide = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, rootAll: true });
  if (narrow.best === E.MOVE_NONE || wide.best === E.MOVE_NONE) continue;
  seen++;
  if (wide.best === narrow.best) continue;
  const inNarrow = new Set((narrow.moves || []).map(m => m.move));
  if (inNarrow.has(wide.best)) continue;      // les deux listes l'avaient: la recherche a change d'avis, pas le filtre

  const aN = E.toAction(pos, narrow.best), aW = E.toAction(pos, wide.best);
  const vN = valueOf(s, aN), vW = valueOf(s, aW);
  if (vN === null || vW === null) continue;
  cases++;
  rows.push([toks[(i * 7919) % toks.length], L.actionId(aN), L.actionId(aW),
             wide.score - narrow.score, vN, vW, vW - vN].join(','));
  if (rows.length % 5 === 0) fs.writeFileSync(OUT, rows.join('\n') + '\n');
  process.stderr.write(`\r[${SHARD}] ${seen} positions, ${cases} cas verifies ` +
    `(${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}
fs.writeFileSync(OUT, rows.length ? rows.join('\n') + '\n' : '');
console.log(`\n[${SHARD}] ${seen} positions, ${handEmpty} sans mur en main, ${cases} cas ecrits dans ${OUT}`);
