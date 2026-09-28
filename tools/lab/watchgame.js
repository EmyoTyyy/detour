// Regarder une partie, coup par coup, avec ce que CHAQUE moteur pense de la position.
//
// Trois mesures indirectes disent que ce reseau va bien -- il cherche aussi profond que le moteur
// livre, il classe les coups aussi bien a un demi-coup, son echelle est la bonne -- et il perd
// 116 parties sur 120. Quand les indicateurs et le resultat se contredisent a ce point, c'est
// qu'ils mesurent tous a cote. Une partie lue coup par coup ne peut pas mesurer a cote.
const L = require('./lib.js'), D = require('./duel.js');

const A = L.loadEngine('path/engine.js', { weights: 'path/netweights.js' });
const B = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: process.env.NNUE || 'tools/lab/nnue_w_score.js' });
const R = A.Rules;
const NODES = Number(process.env.NODES || 32000);
const SEED = Number(process.env.SEED || 131);

const rnd = L.rng(SEED * 7919 + Number(process.env.PAIR || 0));
const s = D.makeOpening(A, L.startState(R), 4, rnd);
const nom = ['LIVRE ', 'NNUE  '];
const eng = [A, B];
let mursA = 0, mursB = 0;

console.log(`graine ${SEED}, ${NODES} noeuds, A=livre (joue en premier) B=NNUE\n`);
console.log('coup  qui     action          score du joueur   ce qu en pense l autre');
for (let ply = 0; ply < 160 && s.winner == null; ply++) {
  const who = ply % 2;                       // 0 = A commence
  const E = eng[who].Engine, O = eng[1 - who].Engine;
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  const act = E.toAction(pos, r.best);
  // L'avis de l'adversaire sur la MEME position, avant le coup: deux evaluations de la meme chose.
  const other = O.analyse(O.fromRules(s), { budgetMs: 1e9, maxNodes: 4000 });
  const txt = act.type === 'move'
    ? `pion ${act.to.r},${act.to.c}`
    : `mur ${act.orient}${act.r},${act.c}`;
  if (act.type === 'wall') { if (who === 0) mursA++; else mursB++; }
  if (ply < 60 || ply % 10 === 0) {
    console.log(`${String(ply).padStart(4)}  ${nom[who]}  ${txt.padEnd(14)}  ${String(r.score).padStart(8)} (p${r.depth})`
      + `      ${String(-other.score).padStart(8)}`);
  }
  L.applyAction(R, s, act);
}
console.log(`\nvainqueur: ${s.winner === 0 ? 'LIVRE' : s.winner === 1 ? 'NNUE' : 'aucun'}`);
console.log(`murs poses: livre ${mursA}, NNUE ${mursB}   (10 disponibles chacun)`);
console.log(`murs restants en main: livre ${s.walls[0]}, NNUE ${s.walls[1]}`);
