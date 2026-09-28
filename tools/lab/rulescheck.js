// The engine's move generation against rules.js, position by position.
//
// Everything else in this harness compares the engine to ITSELF: dcinv.js asserts two variants
// reach the same move, postest.js asserts a position survives a round trip, the match control
// asserts an engine ties with its own copy. None of that can catch a rule the engine gets wrong,
// because both sides get it wrong together. rules.js is the independent implementation -- it is
// what the app plays by, it is written from the rules rather than for speed, and it has never
// been compared to the engine's own generator.
//
// Three things are checked, and each one is a place where a mistake is silent:
//
//   1. pawn moves, including the jump rules. The engine reads an adjacency bitmask and trusts it
//      to encode the board's borders; rules.js tests inBounds explicitly. If adj is ever built
//      wrong at an edge, the engine invents a move off the board or misses a sidestep, and
//      nothing in a self-play match would show it.
//   2. wall legality. The engine answers with mayCut() and only falls back to a real search when
//      the wall might disconnect something; rules.js places the wall and runs a BFS per player.
//      The fast path is an optimisation that has to agree with the slow one everywhere.
//   3. make/unmake. A search that does not perfectly restore the position corrupts everything
//      downstream of it, and the corruption looks like a weak engine rather than a broken one.
//
// The jump rules are not left to random play: two pawns are rarely adjacent in a self-play game,
// and almost never adjacent AT A BORDER with a wall behind them, which is exactly the case where
// a sidestep is the only legal reply. Every adjacent pair of cells on the board is enumerated.
const L = require('./lib.js'), D = require('./duel.js');

const A = L.loadEngine(process.env.ENGINE || undefined, { weights: false });
const E = A.Engine, R = A.Rules;

let checked = 0, bad = 0;
const fail = (what, token, detail) => {
  bad++;
  if (bad <= 20) console.log(`  ECART ${what}  pos=${token}\n    ${detail}`);
};

// A state built by hand rather than played, so that a case can be constructed instead of waited
// for. Walls are given as "h r c" / "v r c" strings.
function state(p0, p1, walls, hand0, hand1, turn) {
  const s = L.startState(R);
  s.pawns = [{ r: p0[0], c: p0[1] }, { r: p1[0], c: p1[1] }];
  s.hWalls = new Set(); s.vWalls = new Set();
  for (const w of walls || []) {
    const [o, r, c] = w.split(' ');
    (o === 'h' ? s.hWalls : s.vWalls).add(r + ',' + c);
  }
  s.walls = [hand0 == null ? 10 : hand0, hand1 == null ? 10 : hand1];
  s.turn = turn || 0;
  s.winner = null;
  return s;
}

const cellKey = (r, c) => r * 9 + c;

function comparePawns(s, label) {
  const pos = E.fromRules(s);
  const buf = new Int32Array(32);
  for (let player = 0; player < 2; player++) {
    const n = E.pawnMoves(pos, player, buf);
    const mine = new Set();
    for (let i = 0; i < n; i++) mine.add(buf[i]);
    const theirs = new Set(R.legalMoves(s, player).map(m => cellKey(m.r, m.c)));
    checked++;
    if (mine.size !== theirs.size || [...mine].some(x => !theirs.has(x))) {
      const fmt = set => [...set].sort((x, y) => x - y).map(i => ((i / 9) | 0) + ',' + (i % 9)).join(' ');
      fail('coups de pion (' + label + ', joueur ' + player + ')', L.encodePos(s),
        `moteur: [${fmt(mine)}]\n    rules: [${fmt(theirs)}]`);
    }
  }
}

// ---------- 1. the jump rules, exhaustively over adjacent pawn pairs ----------
//
// The wall sets are chosen to sit BEHIND and BESIDE the jumped pawn, because that is what turns
// a jump into a sidestep and a sidestep into a single legal square. Placing them at random would
// mostly place them somewhere irrelevant.
console.log('1. regles de saut: toutes les paires de cases adjacentes');
{
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      // Walls that can plausibly matter around the pair: every slot touching either cell.
      const near = [];
      for (const [br, bc] of [[r, c], [nr, nc], [nr + dr, nc + dc]]) {
        for (let wr = br - 1; wr <= br; wr++) for (let wc = bc - 1; wc <= bc; wc++) {
          if (wr < 0 || wr > 7 || wc < 0 || wc > 7) continue;
          near.push('h ' + wr + ' ' + wc); near.push('v ' + wr + ' ' + wc);
        }
      }
      comparePawns(state([r, c], [nr, nc], [], 10, 10, 0), 'nu');
      // One wall at a time: a single wall is enough to change the answer, and every one of them
      // is a case rules.js and the engine have to agree on.
      for (const w of near) comparePawns(state([r, c], [nr, nc], [w], 10, 10, 0), w);
      // And pairs of walls drawn from the same neighbourhood, which is where "jump blocked, one
      // sidestep also blocked" lives.
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j += 3) {
          const s = state([r, c], [nr, nc], [near[i], near[j]], 10, 10, 0);
          // Skip wall sets rules.js would never have allowed (crossing or overlapping).
          if (s.hWalls.size + s.vWalls.size !== 2) continue;
          comparePawns(s, near[i] + ' + ' + near[j]);
        }
      }
    }
  }
}
console.log(`   ${checked} comparaisons, ${bad} ecart(s)`);

// ---------- 2. wall legality over every slot, on played positions ----------
//
// Played positions rather than constructed ones: the interesting wall is the one that nearly
// disconnects a pawn, and that only happens in a position where walls are already doing work.
console.log('2. legalite des murs: tous les emplacements, sur des positions jouees');
const wallsBefore = bad;
let wallChecks = 0, filtered = 0, legalTotal = 0;
{
  for (let g = 0; g < Number(process.env.WALL_GAMES || 60); g++) {
    const rnd = L.rng(20000 + g);
    const s = D.makeOpening(A, L.startState(R), 6 + ((rnd() * 24) | 0), rnd);
    if (s.winner != null) continue;
    const token = L.encodePos(s);
    const pos = E.fromRules(s);
    const me = s.turn;
    for (let orient = 0; orient < 2; orient++) {
      for (let j = 0; j < pos.JN; j++) {
        const r = (j / pos.JW) | 0, c = j % pos.JW;
        const mineOk = pos.hand[me] > 0 && E.wallFits(pos, orient, j) && E.wallLegal(pos, orient, j);
        const theirsOk = R.canPlaceWall(s, me, orient === 0 ? 'h' : 'v', r, c);
        wallChecks++;
        if (mineOk !== theirsOk) {
          fail('legalite mur', token,
            `${orient === 0 ? 'h' : 'v'} ${r},${c}: moteur=${mineOk} rules=${theirsOk}`);
        }
        if (theirsOk) legalTotal++;
      }
    }
    // How many legal walls the SEARCH actually considers. Not a bug -- it is the candidate
    // filter, deliberately -- but it is the number that says how much the filter throws away,
    // and it belongs next to the legality check rather than in a comment.
    const buf = E.moveBuf[0];
    const n = E.genMoves(pos, 0, 0, 4);
    let genWalls = 0;
    for (let i = 0; i < n; i++) if (E.mvKind(buf[i]) !== 0) genWalls++;
    filtered += genWalls;
  }
}
console.log(`   ${wallChecks} emplacements testes, ${bad - wallsBefore} ecart(s)`);
console.log(`   murs legaux: ${legalTotal}, retenus par genMoves: ${filtered}` +
  (legalTotal ? `  (le filtre en ecarte ${(100 * (1 - filtered / legalTotal)).toFixed(0)}%)` : ''));

// ---------- 3. make / unmake restores the position exactly ----------
console.log('3. make/unmake: la position revient a l identique');
const mkBefore = bad;
let mkChecks = 0;
{
  const snap = (pos) => JSON.stringify({
    adj: Array.from(pos.adj), w0: Array.from(pos.wall[0]), w1: Array.from(pos.wall[1]),
    touch: Array.from(pos.touch), pawn: Array.from(pos.pawn), hand: Array.from(pos.hand),
    hashLo: pos.hashLo, hashHi: pos.hashHi, wLo: pos.wLo, wHi: pos.wHi,
    turn: pos.turn, winner: pos.winner,
  });
  for (let g = 0; g < Number(process.env.MK_GAMES || 40); g++) {
    const rnd = L.rng(30000 + g);
    const s = D.makeOpening(A, L.startState(R), 4 + ((rnd() * 30) | 0), rnd);
    if (s.winner != null) continue;
    const token = L.encodePos(s);
    const pos = E.fromRules(s);
    const buf = E.moveBuf[0];
    const n = E.genMoves(pos, 0, 0, 4);
    const moves = Array.from(buf.slice(0, n));
    for (const m of moves) {
      const before = snap(pos);
      const from = pos.pawn[pos.turn];
      E.makeMove(pos, m);
      E.unmakeMove(pos, m, from);
      mkChecks++;
      if (snap(pos) !== before) {
        fail('make/unmake', token, 'coup ' + JSON.stringify(E.toAction(pos, m)) + ' ne restaure pas la position');
        break;
      }
    }
  }
}
console.log(`   ${mkChecks} coups joues et annules, ${bad - mkBefore} ecart(s)`);

// ---------- 4. une recherche est-elle une fonction pure de la position ? ----------
//
// Tout le banc de mesure repose sur cette phrase, ecrite dans duel.js: un budget en noeuds plutot
// qu'en secondes "pour qu'un coup soit une fonction pure de la position". Si c'etait faux, deux
// ouvriers qui se partagent un match ne joueraient pas les memes parties qu'un seul processus, et
// le controle a 50,0% pourrait passer en cachant le probleme (les deux cotes deviant ensemble).
// L'etat qui survit entre deux recherches: les killers et l'historique (remis a zero par analyse),
// la table (remise a zero ici) et le compteur de generation (jamais remis a zero, volontairement).
// On intercale d'AUTRES recherches entre les deux mesures: c'est ce qui ferait remonter une fuite.
console.log('4. reproductibilite: meme position, meme budget, table videe');
const detBefore = bad;
let detChecks = 0;
{
  const opts = { budgetMs: 1e9, maxNodes: 40000 };
  for (let g = 0; g < Number(process.env.DET_GAMES || 12); g++) {
    const rnd = L.rng(40000 + g);
    const s = D.makeOpening(A, L.startState(R), 4 + ((rnd() * 20) | 0), rnd);
    if (s.winner != null) continue;
    const token = L.encodePos(s);
    E.clearTable();
    const first = E.analyse(E.fromRules(s), opts);
    // Du bruit entre les deux: d'autres positions, cherchees avec la meme instance.
    for (let k = 0; k < 4; k++) {
      const r2 = L.rng(50000 + g * 10 + k);
      const other = D.makeOpening(A, L.startState(R), 3 + ((r2() * 12) | 0), r2);
      if (other.winner == null) E.analyse(E.fromRules(other), opts);
    }
    E.clearTable();
    const again = E.analyse(E.fromRules(s), opts);
    detChecks++;
    if (first.best !== again.best || first.score !== again.score || first.nodes !== again.nodes) {
      fail('reproductibilite', token,
        `1re: coup=${first.best} score=${first.score} noeuds=${first.nodes}\n    2e : coup=${again.best} score=${again.score} noeuds=${again.nodes}`);
    }
  }
}
console.log(`   ${detChecks} positions rejouees, ${bad - detBefore} ecart(s)`);

console.log(bad === 0
  ? `\nOK - ${checked + wallChecks + mkChecks + detChecks} verifications, aucun ecart avec rules.js`
  : `\n${bad} ECART(S) - le moteur et les regles ne disent pas la meme chose`);
process.exit(bad === 0 ? 0 : 1);
