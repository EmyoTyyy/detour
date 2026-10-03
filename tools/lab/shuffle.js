// Reproduit UNE partie qui tourne en rond et regarde ce que Path choisit, coup par coup.
//
// Le diagnostic dit: chemin p0=8, p1=15, p0 n'a plus de mur, et la partie fait du surplace pendant
// 300 coups. Autrement dit le camp qui mene de SEPT pas, avec une route libre de huit, ne rentre
// pas. Avant d'appeler cela un defaut, il faut voir les coups et les scores: Path croit-il gagner ?
// Et si oui, pourquoi n'avance-t-il pas ?
const L = require('./lib.js'), D = require('./duel.js');
const PAIR = Number(process.env.PAIR || 0);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const SHOW = Number(process.env.SHOW || 24);
const MAXPLY = Number(process.env.MAXPLY || 300);

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;
const nom = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

const rnd = L.rng(SEED * 7919 + PAIR);
const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
const s = R.deState(R.serState(base));
E.clearTable();
const trace = [];
for (let ply = 0; ply < MAXPLY; ply++) {
  if (s.winner != null) break;
  const tour = s.turn;
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  const act = E.toAction(pos, r.best);
  const d0 = R.pathLength(s, 0), d1 = R.pathLength(s, 1);
  trace.push({ ply, tour, coup: nom(act), score: r.score, prof: r.depth, prouve: !!r.proven,
               d0, d1, main: s.walls.slice().join('/'),
               pions: s.pawns.map(p => nom({ type: 'move', to: p })).join(' ') });
  L.applyAction(R, s, act);
}
console.log(`paire ${PAIR}, ouverture de ${OPEN} demi-coups, ${NODES} noeuds par coup`);
console.log(`ouverture jouee: ${[...base.hWalls].length} murs h, ${[...base.vWalls].length} murs v, pions ${base.pawns.map(p => nom({type:'move',to:p})).join(' ')}`);
console.log(`fin: ${s.winner === null ? 'INACHEVEE au plafond' : 'gagnee par p' + s.winner} apres ${trace.length} demi-coups`);
console.log('');
console.log('ply  camp  coup   score     prof  prouve  chemin p0  chemin p1  murs  pions');
for (const t of trace.slice(-SHOW)) {
  console.log(String(t.ply).padStart(3) + '   p' + t.tour + '   ' + t.coup.padEnd(5) + '  ' +
    String(t.score).padStart(8) + '  ' + String(t.prof).padStart(4) + '  ' +
    (t.prouve ? 'OUI' : '   ').padStart(6) + '  ' + String(t.d0).padStart(9) + '  ' +
    String(t.d1).padStart(9) + '  ' + t.main.padEnd(5) + ' ' + t.pions);
}
