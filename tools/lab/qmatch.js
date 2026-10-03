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
// Une plage de paires, pour repartir un match sur plusieurs processus. La graine d'une paire est
// SEED*7919+p et ne depend que de p, donc des tranches qui se partagent la plage jouent exactement
// les parties qu'un seul processus aurait jouees -- chacune avec sa propre connexion a leur serveur.
const FROM = Number(process.env.FROM || 0);
const TO = process.env.TO ? Number(process.env.TO) : null;
const OPEN = Number(process.env.OPEN || 4);
// Attente maximale pour UN coup d'Ishtar. 180 s suffit a 3200 visites; a 200000 il lui faut
// davantage, et un timeout serait compte comme une partie perdue alors que c'est nous qui abandonnons.
const MOVEMS = Number(process.env.MOVEMS || 180000);
// PATHMS: donner a Path un budget en TEMPS au lieu d'un budget en noeuds. Les "noeuds" d'une
// recherche alpha-beta et les "visites" d'Ishtar ne sont pas la meme unite et ne se comparent pas;
// la seconde, si. A 500 000 noeuds Path joue en 1,75 s, et Ishtar a 200 000 visites en prend une
// vingtaine: sans ce reglage, une defaite melange "plus faible" et "seize fois moins de temps".
const PATHMS = process.env.PATHMS ? Number(process.env.PATHMS) : null;

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
      // La regle de repetition peut terminer sur 'draw'. Sans ce test, (s.winner === first) vaut
      // false pour une nulle et la partie etait comptee comme une victoire du second joueur.
      if (s.winner === 'draw') return { win: 'draw', plies: ply };
      const pathWon = (s.winner === first) === pathFirst;
      return { win: pathWon, plies: ply };
    }
    const pathToMove = (s.turn === first) === pathFirst;
    if (pathToMove) {
      const pos = E.fromRules(s);
      const r = E.analyse(pos, PATHMS ? { budgetMs: PATHMS, maxDepth: 40 } : { budgetMs: 1e9, maxNodes: NODES });
      L.applyAction(R, s, E.toAction(pos, r.best));
    } else {
      const tok = await I.bestMove(s, MOVEMS);
      const a = parseMove(tok);
      if (!legalFor(s, a)) throw new Error(`Ishtar a rendu un coup illegal: "${tok}" sur ${serialise(s)}`);
      L.applyAction(R, s, a);
    }
  }
  return { win: null, plies: 300 };
}

(async () => {
  const I = new Ishtar(VISITS);
  let pathWins = 0, ishtarWins = 0, draws = 0, unfinished = 0, plies = 0, games = 0;
  const pairScores = [];
  const t0 = Date.now();
  for (let p = FROM; p < (TO === null ? PAIRS : TO); p++) {
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
      else if (g.win === 'draw') { draws++; sc += 0.5; }
      else { unfinished++; sc += 0.5; }
      process.stderr.write(`\rpaire ${p + 1}/${PAIRS}  Path ${pathWins} - Ishtar ${ishtarWins}`);
    }
    pairScores.push(sc / 2);
  }
  process.stderr.write('\r');
  // Une partie inachevee n'est pas une defaite. `pathWins / games` la comptait comme telle, et avec
  // 31 % d'inachevees au plafond de 300 coups il imprimait 53,1 % la ou les parties DECIDEES
  // donnaient 77,3 %. On compte donc une inachevee pour une demie, comme une nulle -- et on affiche
  // aussi le score sur les seules parties decidees, parce que les deux lectures sont legitimes et
  // qu'une seule risque de tromper.
  const terminees = pathWins + ishtarWins + draws;
  const score = games ? (pathWins + (draws + unfinished) / 2) / games : 0;
  const scoreTerminees = terminees ? (pathWins + draws / 2) / terminees : 0;
  const r = { a: pathWins, b: ishtarWins, draws: draws + unfinished, games, score, pairs: pairScores };
  console.log(`Path (${PATHMS ? PATHMS + " ms" : NODES + " noeuds"}) contre Ishtar (${VISITS} visites), ${PAIRS} ouvertures appariees`);
  console.log(`  Path ${pathWins} - Ishtar ${ishtarWins}${draws ? ' - nulles ' + draws : ''}${unfinished ? ' - inachevees ' + unfinished : ''} sur ${games}`);
  console.log(`  Path marque ${(score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}   ${D.elo(score).toFixed(0)} Elo   (nulles et inachevees pour une demie)`);
  if (unfinished) console.log(`  sur les ${terminees} parties TERMINEES: ${(scoreTerminees * 100).toFixed(1)}%   ${D.elo(scoreTerminees).toFixed(0)} Elo`);
  console.log(`  ${(plies / Math.max(1, games)).toFixed(0)} coups par partie, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  I.close();
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
