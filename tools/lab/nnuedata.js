// Re-encode stored positions as the SPARSE BOARD, for a network that can see where the walls are.
//
// Why this file exists. Every network trained in this project reads 14 numbers, and not one of
// them says where a wall is -- only how many are on the board. The network is handed the two
// shortest-path lengths already computed by the engine and asked to improve on them, from
// information that contains nothing the distances do not already contain. It plateaus at 0.340
// while a 20 000-node search predicts the same labels at 0.285. That gap is not the labels and
// not the amount of data: it is the function class. So the input becomes the board itself.
//
// The encoding is the one an NNUE uses, chosen because it is the only shape that can be
// AFFORDED in a browser: every input is binary, so the first layer is a sum of the columns whose
// input is 1, and a move changes exactly one of them -- a pawn leaves one square and arrives on
// another, a wall appears and never moves again. That makes the first layer incremental, 256
// additions per move instead of eighty thousand multiplications. Quoridor suits it better than
// chess does: no piece is ever captured, so no column is ever subtracted except the moving pawn's.
//
//   312 binary inputs, from the side to move's point of view:
//     0.. 80  my pawn's square                    (81)
//    81..161  the opponent's pawn's square         (81)
//   162..225  a horizontal wall at this slot        (64)
//   226..289  a vertical wall at this slot          (64)
//   290..300  walls left in my hand, 0..10          (11)
//   301..311  walls left in the opponent's hand     (11)
//
//   plus 4 dense inputs that do NOT go through the accumulator, because a shortest path is a
//   graph algorithm and a small network will not rediscover it from wall occupancy -- and the
//   engine has already paid for both distances before it calls the evaluation:
//     my distance / 10, their distance / 10, the difference / 10, walls on the board / 20.
//
// Everything is turned so the side to move is always heading for row 0. Feature 11 of the old
// set was not perspective-invariant -- it read +1 for one player and -1 for the other on the
// START position, which is the same position up to a colour swap -- and the fix changed nothing
// because the network had no board to be invariant about. Here the whole input is canonicalised
// once, at the source, so the question cannot come back.
//
// The row ORDER is the order train.py reads the same files in, deliberately: sorted by path, rows
// in file order. That is what lets the same RandomState(7).permutation(N) cut the same validation
// set, and therefore what makes 0.340 and whatever comes out of the new network comparable
// numbers rather than two numbers about two different held-out sets.
//
//   node nnuedata.js                       # every frozen deep file
//   FILES='data/deep/pos_3408.csv' node nnuedata.js
//
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const HERE = __dirname;
const OUTDIR = path.resolve(HERE, process.env.OUTDIR || 'data/nnue');
// La VARIANTE, sans poids: elle porte le temoin nnWasReached() et, sans reseau charge, son
// evaluate() suit exactement la meme chaine de sorties anticipees que le moteur livre.
const A = L.loadEngine(process.env.ENGINE || 'tools/lab/variants/engine-nnue.js', { weights: false });
const E = A.Engine, R = A.Rules;

// ---------- which files, in which order ----------
// Sorted by full path, exactly as Python's sorted(glob(...)) would: '/' (0x2f) sorts before '_'
// (0x5f), so data/deep/ comes before data/deep_lenovo/, and four-digit seeds sort numerically.
function defaultFiles() {
  const out = [];
  for (const dir of ['data/deep', 'data/deep_lenovo']) {
    const full = path.resolve(HERE, dir);
    let names = [];
    try { names = fs.readdirSync(full); } catch (e) { continue; }
    for (const n of names.sort()) if (/^pos_\d+\.csv$/.test(n)) out.push(dir + '/' + n);
  }
  return out.sort();
}
const FILES = (process.env.FILES ? process.env.FILES.split(/\s+/).filter(Boolean) : defaultFiles());
if (!FILES.length) { console.error('aucun fichier'); process.exit(1); }

// ---------- the layout ----------
const OFF_MY_PAWN = 0, OFF_OP_PAWN = 81, OFF_WALL_H = 162, OFF_WALL_V = 226,
      OFF_MY_HAND = 290, OFF_OP_HAND = 301, N_SPARSE = 312;
const MAX_ACTIVE = 24;          // 2 pawns + 20 walls + 2 hand counts
const N_DENSE = 4;
const SC_ABSENT = -32768;

// A position straight from its 39-character token, without going through rules.js. fromRules()
// does the same work from a Rules state, and building that state allocates two Sets of strings
// per row -- 1.7 million times. The shortcut is only legitimate if it lands on the same position,
// which is checked against the long way round on the first rows of every run.
const shared = E.create({ rows: 9, cols: 9, walls: 10 });
const hex = (t, i) => parseInt(t[i], 16);

function posFromToken(t) {
  E.reset(shared, 10);
  for (let o = 0; o < 2; o++) {
    const hi = parseInt(t.slice(o * 16, o * 16 + 8), 16) >>> 0;
    const lo = parseInt(t.slice(o * 16 + 8, o * 16 + 16), 16) >>> 0;
    for (let b = 0; b < 64; b++) {
      const on = b < 32 ? (lo >>> b) & 1 : (hi >>> (b - 32)) & 1;
      // The token stores bit r*8+c; the engine indexes junctions r*JW+c, and JW is 8 on a 9x9
      // board, so the two agree -- but only on a 9x9 board, which encodePos already enforces.
      if (on) E.addWall(shared, o, b);
    }
  }
  shared.pawn[0] = hex(t, 32) * 9 + hex(t, 33);
  shared.pawn[1] = hex(t, 34) * 9 + hex(t, 35);
  shared.hand[0] = hex(t, 36); shared.hand[1] = hex(t, 37);
  shared.turn = +t[38];
  shared.winner = -1;
  return shared;
}

// The sparse indices, canonicalised so that the side to move always walks towards row 0.
// Player 0 already aims at row 0, player 1 aims at row 8, so player 1's view is the board
// mirrored top to bottom. A cell (r,c) becomes (8-r,c); the boundary between rows r and r+1
// becomes the boundary between 7-r and 8-r, which is slot 7-r -- the same map for both wall
// orientations, and it is worth stating because getting it wrong by one is invisible.
const idxBuf = new Int16Array(MAX_ACTIVE);
function sparseOf(pos) {
  const me = pos.turn, opp = 1 - me, flip = me === 1;
  let n = 0;
  const cell = (c) => { const r = (c / 9) | 0, col = c % 9; return (flip ? (8 - r) : r) * 9 + col; };
  idxBuf[n++] = OFF_MY_PAWN + cell(pos.pawn[me]);
  idxBuf[n++] = OFF_OP_PAWN + cell(pos.pawn[opp]);
  for (let o = 0; o < 2; o++) {
    const w = pos.wall[o], off = o === 0 ? OFF_WALL_H : OFF_WALL_V;
    for (let j = 0; j < 64; j++) {
      if (!w[j]) continue;
      const r = (j / 8) | 0, c = j % 8;
      idxBuf[n++] = off + (flip ? (7 - r) : r) * 8 + c;
    }
  }
  idxBuf[n++] = OFF_MY_HAND + pos.hand[me];
  idxBuf[n++] = OFF_OP_HAND + pos.hand[opp];
  return n;
}

// ---------- self-check: the shortcut against the long way round ----------
// Both paths must give the same distances and the same 14 features. If they ever disagree the
// extraction is poisoned in a way no training curve would reveal.
function selfCheck(tokens) {
  const featA = new Float64Array(E.NET_FEATURES), featB = new Float64Array(E.NET_FEATURES);
  let bad = 0;
  for (const t of tokens) {
    const fast = posFromToken(t);
    const dA = [E.pathLen(fast, 0), E.pathLen(fast, 1)];
    E.netFeatures(fast, featA);
    const slow = E.fromRules(L.decodePos(R, t));
    const dB = [E.pathLen(slow, 0), E.pathLen(slow, 1)];
    E.netFeatures(slow, featB);
    let same = dA[0] === dB[0] && dA[1] === dB[1] && slow.turn === fast.turn
      && slow.pawn[0] === fast.pawn[0] && slow.pawn[1] === fast.pawn[1]
      && slow.hand[0] === fast.hand[0] && slow.hand[1] === fast.hand[1];
    for (let i = 0; same && i < featA.length; i++) if (Math.abs(featA[i] - featB[i]) > 1e-12) same = false;
    if (!same && ++bad <= 3) console.error('  ECART sur ' + t);
  }
  return bad;
}

// ---------- extraction ----------
fs.mkdirSync(OUTDIR, { recursive: true });
const fdIdx = fs.openSync(path.join(OUTDIR, 'idx.i16'), 'w');
const fdDns = fs.openSync(path.join(OUTDIR, 'dns.f32'), 'w');
const fdY = fs.openSync(path.join(OUTDIR, 'y.i8'), 'w');
const fdSc = fs.openSync(path.join(OUTDIR, 'sc.i16'), 'w');
// Les 14 anciennes features, recalculees ici. Elles ne servent pas au reseau de plateau: elles
// servent a passer l'ANCIEN jeu d'entrees dans le NOUVEAU code. Comparer 0.2970 (torch, plateau)
// a 0.3403 (numpy, 14 entrees) melange deux changements, et on ne saurait pas lequel a paye.
// Avec ce fichier, la seule difference entre les deux mesures est ce que le reseau voit.
const fdF14 = fs.openSync(path.join(OUTDIR, 'f14.f32'), 'w');
// 1 si evaluate() irait jusqu'au reseau sur cette position, 0 s'il repond avant lui.
const fdRch = fs.openSync(path.join(OUTDIR, 'reach.i8'), 'w');
// La valeur que l'evaluation FAITE MAIN donne a cette position. Elle est deja calculee juste
// au-dessus pour le temoin; l'ecrire coute quatre octets et permet d'entrainer le reseau sur la
// CORRECTION a apporter au fait main plutot que sur la valeur entiere. La difference n'est pas
// cosmetique: en residuel, un reseau qui n'apprend rien rend exactement le moteur actuel, alors
// qu'en remplacement il rend n'importe quoi.
const fdHnd = fs.openSync(path.join(OUTDIR, 'hand.f32'), 'w');
const featBuf = new Float64Array(E.NET_FEATURES);

const BATCH = 8192;
const bIdx = new Int16Array(BATCH * MAX_ACTIVE);
const bDns = new Float32Array(BATCH * N_DENSE);
const bY = new Int8Array(BATCH);
const bSc = new Int16Array(BATCH);
const bF14 = new Float32Array(BATCH * 14);
const bRch = new Int8Array(BATCH);
const bHnd = new Float32Array(BATCH);
let held = 0, total = 0, scored = 0, skipped = 0, reached = 0;
const perFile = [];

function flush() {
  if (!held) return;
  fs.writeSync(fdIdx, Buffer.from(bIdx.buffer, 0, held * MAX_ACTIVE * 2));
  fs.writeSync(fdDns, Buffer.from(bDns.buffer, 0, held * N_DENSE * 4));
  fs.writeSync(fdY, Buffer.from(bY.buffer, 0, held));
  fs.writeSync(fdSc, Buffer.from(bSc.buffer, 0, held * 2));
  fs.writeSync(fdF14, Buffer.from(bF14.buffer, 0, held * 14 * 4));
  fs.writeSync(fdRch, Buffer.from(bRch.buffer, 0, held));
  fs.writeSync(fdHnd, Buffer.from(bHnd.buffer, 0, held * 4));
  held = 0;
}

const t0 = Date.now();
let checkedOnce = false;
for (const rel of FILES) {
  const full = path.resolve(HERE, rel);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.length && text[text.length - 1] === '\n' ? text.slice(0, -1).split('\n') : text.split('\n');
  if (!checkedOnce) {
    const sample = [];
    for (let i = 0; i < lines.length && sample.length < 400; i += 37) sample.push(lines[i].slice(0, 39));
    const bad = selfCheck(sample);
    console.log(`auto-controle sur ${sample.length} positions: ${bad} ecart(s) entre le chemin direct et rules.js`);
    if (bad) process.exit(1);
    checkedOnce = true;
  }
  let rows = 0;
  for (const line of lines) {
    if (!line) { skipped++; continue; }
    // The token is the first field and the two labels are the LAST two, read from the end: the
    // number of feature columns between them has already changed once in this project's life,
    // and reading the labels by a counted offset is what turned "walls ahead of me" into the
    // game's outcome for a whole afternoon.
    const first = line.indexOf(',');
    const token = line.slice(0, first);
    if (token.length !== 39) { skipped++; continue; }
    const c2 = line.lastIndexOf(',');
    const c1 = line.lastIndexOf(',', c2 - 1);
    const outcome = line.charCodeAt(c1 + 1) - 48;           // '0' or '1', single character
    const scoreTxt = line.slice(c2 + 1);
    if (outcome !== 0 && outcome !== 1) { skipped++; continue; }

    const pos = posFromToken(token);
    const me = pos.turn, opp = 1 - me;
    const dme = E.pathLen(pos, me), dopp = E.pathLen(pos, opp);
    const n = sparseOf(pos);

    const oi = held * MAX_ACTIVE;
    for (let i = 0; i < MAX_ACTIVE; i++) bIdx[oi + i] = i < n ? idxBuf[i] : -1;
    const od = held * N_DENSE;
    bDns[od] = dme / 10; bDns[od + 1] = dopp / 10; bDns[od + 2] = (dopp - dme) / 10;
    bDns[od + 3] = (20 - pos.hand[0] - pos.hand[1]) / 20;
    bHnd[held] = E.evaluate(pos);
    bRch[held] = E.nnWasReached() ? 1 : 0;
    E.netFeatures(pos, featBuf);
    const of = held * 14;
    for (let i = 0; i < 14; i++) bF14[of + i] = featBuf[i];
    bY[held] = outcome;
    bSc[held] = scoreTxt === '' ? SC_ABSENT : Math.max(-3000, Math.min(3000, Math.round(Number(scoreTxt))));
    if (scoreTxt !== '') scored++;
    if (bRch[held]) reached++;
    held++; total++; rows++;
    if (held === BATCH) flush();
  }
  perFile.push({ file: rel, rows });
  if (perFile.length % 10 === 0 || rel === FILES[FILES.length - 1]) {
    process.stderr.write(`\r${perFile.length}/${FILES.length} fichiers, ${total} lignes`);
  }
}
flush();
process.stderr.write('\r');
for (const fd of [fdIdx, fdDns, fdY, fdSc, fdF14, fdRch, fdHnd]) fs.closeSync(fd);

const meta = {
  rows: total, scored, skipped, reached,
  sparse: N_SPARSE, maxActive: MAX_ACTIVE, dense: N_DENSE, scAbsent: SC_ABSENT,
  layout: { myPawn: OFF_MY_PAWN, opPawn: OFF_OP_PAWN, wallH: OFF_WALL_H, wallV: OFF_WALL_V,
            myHand: OFF_MY_HAND, opHand: OFF_OP_HAND },
  dense_names: ['dme/10', 'dopp/10', '(dopp-dme)/10', 'murs poses/20'],
  files: perFile,
  built: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUTDIR, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`${total} lignes ecrites (${scored} avec un score profond, ${skipped} ignorees) en ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log(`-> ${OUTDIR}`);
