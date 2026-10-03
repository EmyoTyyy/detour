// Paired match between two engine option sets.
//
// Four things are required together, and the self-play control prints exactly 50.0% only when
// all four hold: paired openings (each played twice with the seats swapped), a node budget
// rather than a clock (so a move is a pure function of the position), one engine instance per
// side (a shared instance is a shared table, which silently hands the cheaper side the dearer
// side's work), and the table cleared at the start of each game.
const L = require('./lib.js');

// `out`, s'il est fourni, recoit la liste des actions jouees. Ka ne sait recevoir une position
// que rejouee depuis le debut, alors que nos ouvertures appariees arrivent sous forme d'etat.
// Le parametre est purement additif: sans lui, pas un tirage aleatoire ne change, donc une
// ouverture de graine donnee reste exactement la meme qu'avant -- et la meme pour Ka et Ishtar.
function makeOpening(A, s, plies, rnd, out) {
  for (let i = 0; i < plies && s.winner == null; i++) {
    const cand = [];
    const dmap = A.Rules.distanceMap(s, s.turn);
    const here = dmap.get(A.Rules.key(s.pawns[s.turn].r, s.pawns[s.turn].c));
    for (const to of A.Rules.legalMoves(s, s.turn)) {
      const d = dmap.get(A.Rules.key(to.r, to.c));
      if (d !== undefined && d < here) cand.push({ type: 'move', to });
    }
    if (s.walls[s.turn] > 0 && rnd() < 0.3) {
      const walls = [];
      for (let r = 0; r < s.rows - 1; r++) for (let c = 0; c < s.cols - 1; c++)
        for (const o of ['h', 'v']) if (A.Rules.canPlaceWall(s, s.turn, o, r, c)) walls.push({ type: 'wall', orient: o, r, c });
      if (walls.length) cand.push(walls[(rnd() * walls.length) | 0]);
    }
    if (!cand.length) break;
    const choisi = cand[(rnd() * cand.length) | 0];
    if (out) out.push(choisi);
    L.applyAction(A.Rules, s, choisi);
  }
  return s;
}

// Un match est normalement une boite noire qui rend un score au bout de vingt minutes. Poser un
// observateur ici le rend REGARDABLE sans rien changer a ce qu'il calcule: la fonction est
// appelee apres chaque coup et ne peut pas influencer la partie.
let watcher = null;
function watch(fn) { watcher = fn; }

function playFrom(A, B, snap, optsFirst, optsSecond, maxPlies) {
  const s = A.Rules.deState(snap);
  const first = s.turn;
  A.Engine.clearTable(); B.Engine.clearTable();
  for (let ply = 0; ply < (maxPlies || 300); ply++) {
    if (s.winner != null) { if (watcher) watcher(s, ply, first, true); return s.winner === first ? 0 : 1; }
    const mine = s.turn === first;
    const E = (mine ? A : B).Engine;
    const pos = E.fromRules(s);
    // Les positions deja vues dans CETTE partie, pour que le moteur sache qu'un troisieme passage
    // fait nulle. Sans cela le camp qui gagne echangerait sa victoire contre un demi-point en
    // repetant, ce qui est precisement ce que les deux faisaient pendant 300 coups.
    const o = mine ? optsFirst : optsSecond;
    const r = E.analyse(pos, s.seen ? Object.assign({}, o, { seen: s.seen }) : o);
    L.applyAction(A.Rules, s, E.toAction(pos, r.best));
    if (watcher) watcher(s, ply, first, false);
  }
  return null;
}

// A range of pairs rather than a count, so a match can be split across processes and still be
// the SAME match: pair p draws its opening from rng(seed0 * 7919 + p), which depends on nothing
// but p, so workers that divide the range up play exactly the games a single process would have
// played, in some other order. That is checkable, and parmatch.js checks it.
function matchRange(A, B, optsA, optsB, from, to, seed0, openPlies) {
  let a = 0, b = 0, draws = 0;
  // Per-PAIR scores, kept because the error bar cannot honestly be computed from the game count.
  // The two games of a pair share an opening, so they are correlated -- an opening that happens
  // to suit one engine tends to give it both games. Treating 120 correlated games as 120
  // independent ones understates the uncertainty, and every band printed before this line
  // existed was too narrow for that reason.
  const pairs = [];
  for (let p = from; p < to; p++) {
    const rnd = L.rng((seed0 || 1) * 7919 + p);
    const base = makeOpening(A, L.startState(A.Rules), openPlies == null ? 4 : openPlies, rnd);
    if (base.winner != null) continue;
    const snap = A.Rules.serState(base);
    const g1 = playFrom(A, B, snap, optsA, optsB);
    const g2 = playFrom(B, A, snap, optsB, optsA);
    let pa = 0;
    if (g1 === 0) { a++; pa += 1; } else if (g1 === 1) b++; else { draws++; pa += 0.5; }
    if (g2 === 0) { b++; } else if (g2 === 1) { a++; pa += 1; } else { draws++; pa += 0.5; }
    pairs.push(pa / 2);
  }
  const games = a + b + draws;
  return { a, b, draws, games, pairs, score: games ? (a + draws / 2) / games : 0 };
}

const match = (A, B, optsA, optsB, pairs, seed0, openPlies) =>
  matchRange(A, B, optsA, optsB, 0, pairs, seed0, openPlies);

// Two sigma, from the spread of the PAIR scores rather than from a binomial on the game count.
// Falls back to the binomial when pair scores are unavailable (an aggregate stitched together
// from several workers), and says so by returning the same number it always did.
function band(r) {
  const ps = r.pairs;
  if (!ps || ps.length < 2) return 2 * Math.sqrt(r.score * (1 - r.score) / Math.max(1, r.games)) * 100;
  const n = ps.length, m = ps.reduce((x, y) => x + y, 0) / n;
  let v = 0;
  for (const x of ps) v += (x - m) * (x - m);
  v /= (n - 1);
  return 2 * Math.sqrt(v / n) * 100;
}
const elo = s => (s <= 0 ? -800 : s >= 1 ? 800 : -400 * Math.log10(1 / s - 1));

module.exports = { watch, match, matchRange, playFrom, makeOpening, band, elo };

if (require.main === module) {
  const A = L.loadEngine(), B = L.loadEngine();
  const nodes = Number(process.env.NODES || 20000);
  const o = { budgetMs: 1e9, maxNodes: nodes };
  const r = match(A, B, o, o, Number(process.env.PAIRS || 8), 1);
  console.log(`control at ${nodes} nodes: ${r.a}-${r.b}-${r.draws} = ${(r.score * 100).toFixed(1)}%  ${r.score === 0.5 ? '(sound)' : '<<< HARNESS IS BIASED, FIX BEFORE READING ANY OTHER NUMBER'}`);
}
