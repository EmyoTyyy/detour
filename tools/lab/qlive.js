// Une partie Path contre Ishtar (quoridor-ai.com), diffusee coup par coup sur le tableau de bord.
//
//   VISITS=3200 NODES=500000 PATH_FIRST=1 node qlive.js
//
// qmatch.js joue des series pour mesurer; celui-ci joue UNE partie pour la regarder. La
// difference n'est pas cosmetique: une serie ne dit que le score final, alors qu'une partie
// qu'on voit dit OU Path se fait battre -- a l'ouverture, sur un mur, dans la course finale.
// C'est la seule facon d'avoir une idee de ce qui manque avant de le mesurer.
//
// Chaque coup d'Ishtar est verifie contre les regles de Detour avant d'etre applique. Les deux
// programmes tiennent des plateaux separes, et une convention qui aurait derive se verrait
// sinon comme "Path perd bizarrement" au lieu du bug que c'est.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const { Ishtar, serialise, parseMove } = require('./qai.js');

const A = L.loadEngine(process.env.ENGINE || undefined,
  process.env.WEIGHTS ? { weights: process.env.WEIGHTS === '0' ? false : process.env.WEIGHTS } : undefined);
const E = A.Engine, R = A.Rules;

const VISITS = Number(process.env.VISITS || 3200);
const NODES = Number(process.env.NODES || 500000);
const PATH_FIRST = process.env.PATH_FIRST !== '0';
const OUT = path.join(__dirname, process.env.QLIVE || 'qlive.json');

const FILES = 'abcdefghi';
const sqName = (r, c) => FILES[c] + (9 - r);
const wallName = (o, r, c) => FILES[c] + (8 - r) + o;
const nameOf = (a) => a.type === 'wall' ? wallName(a.orient, a.r, a.c) : sqName(a.to.r, a.to.c);

const started = new Date().toISOString();
const moves = [];
let thinking = null;

function publish(s, extra) {
  const body = Object.assign({
    kind: 'duel',
    titre: `Path (${NODES.toLocaleString('fr')} noeuds) contre Ishtar (${VISITS} visites)`,
    pathSeat: PATH_FIRST ? 0 : 1,
    visits: VISITS, nodes: NODES,
    started,
    pos: L.encodePos(s),
    by: s.wallBy,
    turn: s.turn,
    hands: s.walls.slice(),
    dist: [safeDist(s, 0), safeDist(s, 1)],
    moves: moves.slice(-40),
    ply: moves.length,
    thinking,
    winner: s.winner,
    updated: new Date().toISOString(),
  }, extra || {});
  try { fs.writeFileSync(OUT, JSON.stringify(body)); } catch (e) { /* le lecteur reessaiera */ }
}

function safeDist(s, p) {
  try { const d = R.pathLength(s, p); return Number.isFinite(d) ? d : null; } catch (e) { return null; }
}

function legalFor(s, a) {
  if (a.type === 'move') return R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c);
  return R.canPlaceWall(s, s.turn, a.orient, a.r, a.c);
}

(async () => {
  const s = L.startState(R);
  const I = new Ishtar(VISITS);
  await I.connect();
  console.log(`Path ${PATH_FIRST ? 'commence' : 'repond'} | ${NODES} noeuds contre ${VISITS} visites`);
  publish(s);

  for (let ply = 0; ply < 300 && s.winner == null; ply++) {
    const pathToMove = (s.turn === 0) === PATH_FIRST;
    thinking = pathToMove ? 'Path' : 'Ishtar';
    publish(s);
    const t = Date.now();
    let a, note = '';
    if (pathToMove) {
      const pos = E.fromRules(s);
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
      a = E.toAction(pos, r.best);
      // L'evaluation de Path a chaque coup: c'est elle qui dira a quel moment il a cru
      // s'en sortir, ce qu'un score final ne raconte pas.
      note = (r.score >= 0 ? '+' : '−') + (Math.abs(r.score) / 100).toFixed(1) + ' p' + r.depth;
    } else {
      const tok = await I.bestMove(s, 180000);
      a = parseMove(tok);
      if (!legalFor(s, a)) throw new Error(`Ishtar a rendu un coup illegal: "${tok}" sur ${serialise(s)}`);
    }
    moves.push({ n: moves.length + 1, who: pathToMove ? 'Path' : 'Ishtar', mv: nameOf(a), ms: Date.now() - t, note });
    L.applyAction(R, s, a);
    thinking = null;
    publish(s);
    console.log(`${String(moves.length).padStart(3)}  ${(pathToMove ? 'Path' : 'Ishtar').padEnd(7)} ${nameOf(a).padEnd(5)} ${note}`);
  }

  const pathWon = s.winner != null && ((s.winner === 0) === PATH_FIRST);
  publish(s, { thinking: null, verdict: s.winner == null ? 'partie non terminee' : (pathWon ? 'Path gagne' : 'Ishtar gagne') });
  console.log(s.winner == null ? 'non terminee' : (pathWon ? 'PATH GAGNE' : 'ISHTAR GAGNE'));
  try { I.close && I.close(); } catch (e) { /* rien */ }
  process.exit(0);
})().catch(e => { console.log('ERREUR ' + e.message); publish(L.startState(R), { erreur: e.message }); process.exit(1); });
