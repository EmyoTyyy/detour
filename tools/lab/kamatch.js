// Path contre Ka (quoridor-ai.com), ouvertures appariees, les deux camps.
//
// Appariees parce que le premier coup vaut environ +220 Elo dans ce jeu: un resultat non apparie
// mesure surtout qui a commence. Chaque ouverture est jouee deux fois, une fois Path devant, une
// fois Ka, et les deux parties sont comptees ensemble. Les graines sont celles de qmatch.js, donc
// a graine egale Ka et Ishtar jouent EXACTEMENT les memes ouvertures et les deux chiffres se
// comparent.
//
// Chaque coup rendu par Ka est verifie contre les regles de Detour avant d'etre applique. Les deux
// programmes tiennent des plateaux separes, et une convention qui derive se verrait sinon comme
// Path qui perd mysterieusement au lieu du bug que c'est.
//
// Une partie = une connexion: Ka n'a aucune commande qui remette l'etat a zero, et son `makemove`
// ajoute a la partie en cours. L'ouverture est donc rejouee coup par coup dans la connexion neuve.
//
//   VISITS=20000 PAIRS=32 FROM=0 TO=4 SEED=77 NODES=500000 node kamatch.js
const L = require('./lib.js'), D = require('./duel.js');
const { Ka, nameAction, parseMove } = require('./kaai.js');

const VISITS = Number(process.env.VISITS || 20000);
const PAIRS = Number(process.env.PAIRS || 6);
const NODES = Number(process.env.NODES || 500000);
const SEED = Number(process.env.SEED || 77);
const FROM = Number(process.env.FROM || 0);
const TO = process.env.TO ? Number(process.env.TO) : null;
const OPEN = Number(process.env.OPEN || 4);
const MOVEMS = Number(process.env.MOVEMS || 180000);

const A = L.loadEngine(process.env.ENGINE || undefined,
  process.env.WEIGHTS ? { weights: process.env.WEIGHTS === '0' ? false : process.env.WEIGHTS } : undefined);
const E = A.Engine, R = A.Rules;

function legalFor(s, a) {
  if (a.type === 'move') return R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c);
  return R.canPlaceWall(s, s.turn, a.orient, a.r, a.c);
}

async function playOne(snap, ouverture, pathFirst) {
  const s = R.deState(snap);
  const first = s.turn;
  E.clearTable();
  const K = new Ka(VISITS);
  try {
    // Rejouer l'ouverture chez lui: c'est la seule facon de lui donner la position de depart.
    for (const a of ouverture) K.push(a);
    for (let ply = 0; ply < 300; ply++) {
      if (s.winner != null) {
        if (s.winner === 'draw') return { win: 'draw', plies: ply };
        return { win: (s.winner === first) === pathFirst, plies: ply };
      }
      const pathToMove = (s.turn === first) === pathFirst;
      if (pathToMove) {
        const pos = E.fromRules(s);
        const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
        const a = E.toAction(pos, r.best);
        K.push(a);
        L.applyAction(R, s, a);
      } else {
        const tok = await K.bestMove(MOVEMS);
        const a = parseMove(tok);
        if (!legalFor(s, a)) throw new Error(`Ka a rendu un coup illegal: "${tok}" (lu ${JSON.stringify(a)})`);
        K.push(tok);
        L.applyAction(R, s, a);
      }
    }
    return { win: null, plies: 300 };
  } finally { K.close(); }
}

(async () => {
  let pathWins = 0, kaWins = 0, draws = 0, unfinished = 0, plies = 0, games = 0;
  const pairScores = [];
  const t0 = Date.now();
  for (let p = FROM; p < (TO === null ? PAIRS : TO); p++) {
    const rnd = L.rng(SEED * 7919 + p);
    const ouverture = [];
    const base = D.makeOpening(A, L.startState(R), OPEN, rnd, ouverture);
    if (base.winner != null) continue;
    const snap = R.serState(base);
    let sc = 0;
    for (const pathFirst of [true, false]) {
      const g = await playOne(snap, ouverture, pathFirst);
      games++; plies += g.plies;
      if (g.win === true) { pathWins++; sc += 1; }
      else if (g.win === false) kaWins++;
      else if (g.win === 'draw') { draws++; sc += 0.5; }
      else { unfinished++; sc += 0.5; }
      process.stderr.write(`\rpaire ${p + 1}/${PAIRS}  Path ${pathWins} - Ka ${kaWins}`);
    }
    pairScores.push(sc / 2);
  }
  process.stderr.write('\r');
  const terminees = pathWins + kaWins + draws;
  const score = games ? (pathWins + (draws + unfinished) / 2) / games : 0;
  const scoreTerminees = terminees ? (pathWins + draws / 2) / terminees : 0;
  const r = { a: pathWins, b: kaWins, draws: draws + unfinished, games, score, pairs: pairScores };
  console.log(`Path (${NODES} noeuds) contre Ka (${VISITS} visites), ${PAIRS} ouvertures appariees`);
  console.log(`  Path ${pathWins} - Ka ${kaWins}${draws ? ' - nulles ' + draws : ''}${unfinished ? ' - inachevees ' + unfinished : ''} sur ${games}`);
  console.log(`  Path marque ${(score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}   ${D.elo(score).toFixed(0)} Elo   (nulles et inachevees pour une demie)`);
  if (unfinished) console.log(`  sur les ${terminees} parties TERMINEES: ${(scoreTerminees * 100).toFixed(1)}%   ${D.elo(scoreTerminees).toFixed(0)} Elo`);
  console.log(`  ${(plies / Math.max(1, games)).toFixed(0)} coups par partie, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
