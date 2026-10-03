// La position ou les deux camps croient la course decidee: que dit le moteur, exactement ?
//
// La trace montre p0 a huit pas du but contre quinze pour p1, et pourtant p0 recoit un score de
// defaite PROUVEE, et p1 un score de victoire prouvee qu'il ne joue jamais. Les deux chiffres ne
// peuvent pas etre vrais ensemble. On rejoue donc jusqu'a cette position et on demande au moteur
// tout ce qu'il sait: son evaluation, ce que son solveur de course repond, et le score de CHAQUE
// coup a la racine. Un desaccord entre pathLength et le solveur se verra la.
const L = require('./lib.js'), D = require('./duel.js');
const PAIR = Number(process.env.PAIR || 0);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const STOP = Number(process.env.STOP || 276);

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;
const nom = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

const rnd = L.rng(SEED * 7919 + PAIR);
const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
const s = R.deState(R.serState(base));
E.clearTable();
for (let ply = 0; ply < STOP && s.winner == null; ply++) {
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  L.applyAction(R, s, E.toAction(pos, r.best));
}

console.log('position au demi-coup ' + STOP);
console.log('  au trait          : p' + s.turn);
console.log('  pions             : ' + s.pawns.map(p => nom({ type: 'move', to: p })).join(' '));
console.log('  murs en main      : ' + s.walls.join(' / '));
console.log('  murs poses        : ' + s.hWalls.size + ' h, ' + s.vWalls.size + ' v');
console.log('  rules.js pathLength: p0=' + R.pathLength(s, 0) + '  p1=' + R.pathLength(s, 1));
console.log('  chemin possible   : p0=' + R.hasPath(s, 0) + '  p1=' + R.hasPath(s, 1));
console.log('');
const pos = E.fromRules(s);
console.log('  engine distTo      : p0=' + E.distTo(pos, 0) + '  p1=' + E.distTo(pos, 1));
console.log('  engine evaluate    : ' + E.evaluate(pos) + '   (du point de vue de p' + s.turn + ')');
console.log('  WIN=' + E.WIN + '  PROVEN=' + E.PROVEN);
if (E.probeRace) {
  try { console.log('  probeRace          : ' + JSON.stringify(E.probeRace(pos))); }
  catch (e) { console.log('  probeRace          : (' + e.message + ')'); }
}
console.log('');
E.clearTable();
const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, exactRoot: true });
console.log('  recherche: score ' + r.score + '  profondeur ' + r.depth + '  prouve ' + !!r.proven +
            '  coup choisi ' + nom(E.toAction(pos, r.best)));
console.log('');
console.log('  tous les coups a la racine, par score:');
const mv = (r.moves || []).slice().sort((a, b) => b.score - a.score);
for (const m of mv.slice(0, 14)) {
  const a = E.toAction(pos, m.move);
  console.log('    ' + nom(a).padEnd(5) + ' ' + String(m.score).padStart(9) +
    (m.score === r.score ? '   <= a egalite avec le meilleur' : ''));
}
console.log('    ... ' + mv.length + ' coups au total, ' + mv.filter(m => m.score === r.score).length +
            ' a egalite avec le meilleur');
