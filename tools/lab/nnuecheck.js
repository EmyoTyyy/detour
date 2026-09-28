// L'accumulateur incremental contre la verite, sur trois fronts.
//
// Un accumulateur maintenu par corrections successives est la chose la plus facile a casser en
// silence de tout ce projet. S'il derive d'une colonne, le moteur evalue une position qui n'est
// pas celle du plateau: il joue moins bien, le match le dit, et rien n'indique que la cause est
// une soustraction oubliee dans unmakeMove plutot que le reseau. Trois verifications, et chacune
// attrape une faute que les deux autres laisseraient passer:
//
//   1. DERIVE. Des parties jouees en make/unmake, en comparant a chaque etape l'accumulateur
//      incremental a un accumulateur recalcule depuis la position. Attrape un signe inverse, une
//      main oubliee, une annulation incomplete.
//   2. ENCODAGE. Le meme accumulateur, reconstruit a partir des indices que nnuedata.js a ecrits
//      pour CETTE position pendant l'extraction. Attrape un decalage entre l'encodage qui a servi
//      a entrainer et celui que le moteur applique -- une erreur que la derive ne verrait pas,
//      parce qu'un moteur peut etre parfaitement coherent avec lui-meme et coherent avec rien.
//   3. Les scores sont ecrits dans un fichier pour que nnuecheck.py les compare a ceux du reseau
//      Python. Attrape une tete mal recopiee et le cout de la quantisation.
//
//   node nnuecheck.js
const fs = require('fs');
const path = require('path');
const L = require('./lib.js'), D = require('./duel.js');

const WEIGHTS = process.env.NNUE || 'tools/lab/nnue_weights.js';
const A = L.loadEngine(process.env.ENGINE || 'tools/lab/variants/engine-nnue.js', { weights: WEIGHTS });
const E = A.Engine, R = A.Rules;
if (!E.hasNnue()) { console.error('aucun NNUE charge depuis ' + WEIGHTS); process.exit(1); }

// Les poids, relus ici pour reconstruire un accumulateur a la main.
const vm = require('vm');
const ctx = { self: {}, window: undefined };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(L.ROOT, WEIGHTS), 'utf8'), ctx);
const W = ctx.self.NnueWeights;
const H = W.hidden;

let bad = 0;
const fail = (what, detail) => { bad++; if (bad <= 12) console.log(`  ECART ${what}\n    ${detail}`); };

// ---------- 1. derive ----------
console.log('1. derive: accumulateur incremental contre recalcul complet');
let steps = 0;
{
  const same = (pos) => {
    const inc = E.nnAccCopy();
    E.nnRefresh(pos);                 // recalcule depuis la position
    const fresh = E.nnAccCopy();
    for (let i = 0; i < inc.length; i++) {
      if (inc[i] !== fresh[i]) {
        return `indice ${i} (point de vue ${i < H ? 0 : 1}): incremental ${inc[i]}, recalcul ${fresh[i]}`;
      }
    }
    return null;
  };
  for (let g = 0; g < Number(process.env.DRIFT_GAMES || 30); g++) {
    const rnd = L.rng(60000 + g);
    const s = D.makeOpening(A, L.startState(R), 4 + ((rnd() * 20) | 0), rnd);
    if (s.winner != null) continue;
    const pos = E.fromRules(s);
    // Une descente en profondeur, comme une recherche: on joue, on verifie, on annule, on verifie.
    // C'est l'annulation qui casse en general, et elle ne casse que si on la teste imbriquee.
    const walk = (depth) => {
      if (depth === 0 || pos.winner >= 0) return;
      const buf = E.moveBuf[0];
      const n = E.genMoves(pos, 0, 0, 4);
      const moves = [];
      for (let i = 0; i < n && moves.length < 4; i += 1 + ((n / 5) | 0)) moves.push(buf[i]);
      for (const m of moves) {
        const from = pos.pawn[pos.turn];
        E.makeMove(pos, m);
        steps++;
        const d1 = same(pos);
        if (d1) { fail('apres makeMove', d1); return; }
        walk(depth - 1);
        E.unmakeMove(pos, m, from);
        steps++;
        const d2 = same(pos);
        if (d2) { fail('apres unmakeMove', d2); return; }
      }
    };
    walk(Number(process.env.DRIFT_DEPTH || 3));
  }
}
console.log(`   ${steps} coups joues et annules, ${bad} ecart(s)`);

// ---------- 2. encodage: contre les indices ecrits pendant l'extraction ----------
console.log('2. encodage: accumulateur du moteur contre les indices d entrainement');
const encBefore = bad;
let encChecked = 0;
{
  const dir = path.join(__dirname, 'data/nnue');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const first = meta.files[0];        // les lignes de ce fichier sont les premieres du binaire
  const MA = meta.maxActive, PAD = meta.sparse;
  const N = Math.min(Number(process.env.ENC_ROWS || 3000), first.rows);
  const idx = new Int16Array(fs.readFileSync(path.join(dir, 'idx.i16'), { start: 0, end: N * MA * 2 }).buffer);
  const dnsBuf = fs.readFileSync(path.join(dir, 'dns.f32'), { start: 0, end: N * meta.dense * 4 });
  const dns = new Float32Array(dnsBuf.buffer, dnsBuf.byteOffset, N * meta.dense);
  const lines = fs.readFileSync(path.join(__dirname, first.file), 'utf8').split('\n');

  for (let r = 0; r < N; r++) {
    const token = lines[r].slice(0, 39);
    const s = L.decodePos(R, token);
    const pos = E.fromRules(s);                    // fromRules -> rehash -> nnRefresh
    const acc = E.nnAccCopy();
    // Reconstruit a la main depuis les indices stockes, pour le point de vue du joueur au trait
    // (le seul que l'extraction ait ecrit, et le seul que l'evaluation lise).
    const want = new Int32Array(H);
    for (let i = 0; i < H; i++) want[i] = W.accb[i];
    let active = 0;
    for (let k = 0; k < MA; k++) {
      const ii = idx[r * MA + k];
      if (ii === PAD || ii < 0) continue;
      active++;
      for (let i = 0; i < H; i++) want[i] += W.acc[ii * H + i];
    }
    const base = pos.turn * H;
    let diff = -1;
    for (let i = 0; i < H; i++) if (acc[base + i] !== want[i]) { diff = i; break; }
    encChecked++;
    if (diff >= 0) {
      fail('encodage', `ligne ${r} (${token}), ${active} entrees actives: ` +
        `moteur ${acc[base + diff]}, entrainement ${want[diff]} a l indice ${diff}`);
      if (bad - encBefore > 4) break;
    }
    // Et les entrees denses, qui ne passent pas par l'accumulateur.
    const dme = E.pathLen(pos, pos.turn), dopp = E.pathLen(pos, 1 - pos.turn);
    const mine = [dme / 10, dopp / 10, (dopp - dme) / 10, (20 - pos.hand[0] - pos.hand[1]) / 20];
    for (let k = 0; k < 4; k++) {
      if (Math.abs(mine[k] - dns[r * meta.dense + k]) > 1e-6) {
        fail('entree dense', `ligne ${r}, dense ${k}: moteur ${mine[k]}, entrainement ${dns[r * meta.dense + k]}`);
        break;
      }
    }
  }
}
console.log(`   ${encChecked} positions, ${bad - encBefore} ecart(s)`);

// ---------- 3. de quoi comparer a Python ----------
// Les MEMES lignes que la verification 2, designees par leur numero: comme le point 2 vient de
// prouver que l accumulateur du moteur est identique aux indices d entrainement, Python peut
// partir de ces indices sans savoir decoder une position. Ce qui reste teste ici est donc
// exactement ce qui restait non teste: l arithmetique de la tete et le prix de la quantisation.
console.log('3. ecriture des scores pour la comparaison avec le reseau Python');
{
  const dir = path.join(__dirname, 'data/nnue');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const first = meta.files[0];
  const N = Math.min(Number(process.env.CMP_ROWS || 2000), first.rows);
  const lines = fs.readFileSync(path.join(__dirname, first.file), 'utf8').split('\n');
  const out = [];
  for (let r = 0; r < N; r++) {
    const s = L.decodePos(R, lines[r].slice(0, 39));
    const pos = E.fromRules(s);
    const dme = E.pathLen(pos, pos.turn), dopp = E.pathLen(pos, 1 - pos.turn);
    out.push(r + ',' + E.nnueEval(pos, dme, dopp));
  }
  fs.writeFileSync(path.join(__dirname, 'nnue_js_scores.csv'), out.join('\n') + '\n');
  console.log(`   ${out.length} lignes -> nnue_js_scores.csv (numero de ligne, score du moteur)`);
}

console.log(bad === 0
  ? `\nOK - ${steps + encChecked} verifications, l accumulateur ne derive pas et encode ce qui a ete entraine`
  : `\n${bad} ECART(S)`);
process.exit(bad === 0 ? 0 : 1);
