// Deux moteurs, les memes positions: quand ils ne choisissent pas le meme coup, lequel a raison ?
//
// Controle INDEPENDANT des parties. Un match peut etre faux pour mille raisons -- un fichier mal
// charge, un siege mal attribue, un plafond atteint -- et ce dossier en a deja trois exemples en un
// jour. Celui-ci ne joue aucune partie: il prend les positions ou les deux moteurs divergent, joue
// les deux coups, et examine les deux positions filles au MEME budget bien plus eleve. Les deux
// coups recoivent le meme traitement, donc rien ne favorise personne.
//
//   A=path/engine.js B=tools/lab/variants/engine-walls-wide.js NODES=200000 DEEP=600000 N=200 node agree.js
const L = require('./lib.js');
const fs = require('fs');

const FA = process.env.A || 'path/engine.js';
const FB = process.env.B || 'tools/lab/variants/engine-walls-wide.js';
const NODES = Number(process.env.NODES || 200000);
const DEEP = Number(process.env.DEEP || 600000);
const N = Number(process.env.N || 200);
const SRC = process.env.SRC || 'data/pos_14.csv';

const EA = L.loadEngine(FA, { weights: false });
const EB = L.loadEngine(FB, { weights: false });
// Le juge est un troisieme moteur, celui qui est livre: le verdict ne doit pas dependre de la
// variante qu'on examine.
const EJ = L.loadEngine('path/engine.js', { weights: false });
const R = EA.Rules;

const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === 39);

function valueOf(state, action) {
  const next = R.cloneState(state);
  next.hWalls = new Set(state.hWalls);
  next.vWalls = new Set(state.vWalls);
  if (action.type === 'wall') {
    if (!R.canPlaceWall(next, next.turn, action.orient, action.r, action.c)) return null;
    R.applyWall(next, action.orient, action.r, action.c);
  } else R.applyMove(next, action.to);
  if (next.winner !== null) return next.winner === state.turn ? 1e6 : -1e6;
  EJ.Engine.clearTable();
  return -EJ.Engine.analyse(EJ.Engine.fromRules(next), { budgetMs: 1e9, maxNodes: DEEP }).score;
}

let seen = 0, diff = 0, bWins = 0, aWins = 0, tie = 0;
const gains = [];
for (let i = 0; i < N; i++) {
  let s;
  try { s = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  const pa = EA.Engine.fromRules(s), pb = EB.Engine.fromRules(s);
  EA.Engine.clearTable(); EB.Engine.clearTable();
  const ra = EA.Engine.analyse(pa, { budgetMs: 1e9, maxNodes: NODES });
  const rb = EB.Engine.analyse(pb, { budgetMs: 1e9, maxNodes: NODES });
  if (ra.best === EA.Engine.MOVE_NONE || rb.best === EB.Engine.MOVE_NONE) continue;
  seen++;
  const aa = EA.Engine.toAction(pa, ra.best), ab = EB.Engine.toAction(pb, rb.best);
  if (L.actionId(aa) === L.actionId(ab)) continue;
  diff++;
  const va = valueOf(s, aa), vb = valueOf(s, ab);
  if (va === null || vb === null) continue;
  if (vb > va) { bWins++; gains.push(vb - va); }
  else if (va > vb) { aWins++; gains.push(vb - va); }
  else tie++;
  if (diff % 10 === 0) process.stderr.write(`\r${seen} positions, ${diff} desaccords, B gagne ${bWins}`);
}
const g = gains.slice().sort((x, y) => x - y);
console.log(`\n\n${seen} positions, ${diff} desaccords (${(100 * diff / seen).toFixed(0)} %)`);
console.log(`  A = ${FA}`);
console.log(`  B = ${FB}`);
console.log(`  B a raison : ${bWins}   A a raison : ${aWins}   egal : ${tie}`);
if (g.length) console.log(`  ecart B - A : mediane ${g[g.length >> 1]}, moyenne ${Math.round(g.reduce((a, b) => a + b, 0) / g.length)}`);
