// Path against Ishtar (quoridor-ai.com), paired openings, both seats.
//
// Paired because the first move is worth about +220 Elo in this game: an unpaired result mostly
// measures who started. Each opening is played twice, once with Path moving first and once with
// Ishtar, and the two games are scored together.
//
// Every move Ishtar sends is checked against Detour's own rules before being applied. The two
// programs keep separate boards, and a convention that drifted would otherwise show up as Path
// mysteriously losing rather than as the bug it is.
//
//   VISITS=3200 PAIRS=6 SEED=5 NODES=500000 node qmatch.js
const L = require('./lib.js'), D = require('./duel.js');
const { Ishtar, serialise, parseMove } = require('./qai.js');

const VISITS = Number(process.env.VISITS || 3200);
const PAIRS = Number(process.env.PAIRS || 6);
const NODES = Number(process.env.NODES || 500000);
const SEED = Number(process.env.SEED || 5);
const OPEN = Number(process.env.OPEN || 4);

const A = L.loadEngine(process.env.ENGINE || undefined,
  process.env.WEIGHTS ? { weights: process.env.WEIGHTS === '0' ? false : process.env.WEIGHTS } : undefined);
const E = A.Engine, R = A.Rules;

function legalFor(s, a) {
  if (a.type === 'move') return R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c);
  return R.canPlaceWall(s, s.turn, a.orient, a.r, a.c);
}

async function playOne(I, snap, pathFirst) {
  const s = R.deState(snap);
  const first = s.turn;
  E.clearTable();
  for (let ply = 0; ply < 300; ply++) {
    if (s.winner != null) {
      const pathWon = (s.winner === first) === pathFirst;
      return { win: pathWon, plies: ply };
    }
    const pathToMove = (s.turn === first) === pathFirst;
    if (pathToMove) {
      const pos = E.fromRules(s);
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
      L.applyAction(R, s, E.toAction(pos, r.best));
    } else {
      const tok = await I.bestMove(s, 180000);
      const a = parseMove(tok);
      if (!legalFor(s, a)) throw new Error(`Ishtar a rendu un coup illegal: "${tok}" sur ${serialise(s)}`);
      L.applyAction(R, s, a);
    }
  }
  return { win: null, plies: 300 };
}

(async () => {
  const I = new Ishtar(VISITS);
  let pathWins = 0, ishtarWins = 0, unfinished = 0, plies = 0, games = 0;
  const pairScores = [];
  const t0 = Date.now();
  for (let p = 0; p < PAIRS; p++) {
    const rnd = L.rng(SEED * 7919 + p);
    const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
    if (base.winner != null) continue;
    const snap = R.serState(base);
    let sc = 0;
    for (const pathFirst of [true, false]) {
      const g = await playOne(I, snap, pathFirst);
      games++; plies += g.plies;
      if (g.win === true) { pathWins++; sc += 1; }
      else if (g.win === false) ishtarWins++;
      else { unfinished++; sc += 0.5; }
      process.stderr.write(`\rpaire ${p + 1}/${PAIRS}  Path ${pathWins} - Ishtar ${ishtarWins}`);
    }
    pairScores.push(sc / 2);
  }
  process.stderr.write('\r');
  const score = games ? pathWins / games : 0;
  const r = { a: pathWins, b: ishtarWins, draws: unfinished, games, score, pairs: pairScores };
  console.log(`Path (${NODES} noeuds) contre Ishtar (${VISITS} visites), ${PAIRS} ouvertures appariees`);
  console.log(`  Path ${pathWins} - Ishtar ${ishtarWins}${unfinished ? ' - inachevees ' + unfinished : ''} sur ${games}`);
  console.log(`  Path marque ${(score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}   ${D.elo(score).toFixed(0)} Elo`);
  console.log(`  ${(plies / Math.max(1, games)).toFixed(0)} coups par partie, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  I.close();
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
