// One paired match, split across cores.
//
// This is the tool the 32-core box exists for. A match's error bar is 2*sqrt(p(1-p)/n): 120
// games resolves nothing finer than +/- 63 Elo, which is wider than most changes worth making,
// and three results have already reversed on me inside that band. 2 000 games gives +/- 16 Elo
// and costs about 67 core-hours at 500 000 nodes -- eleven hours on this machine, two on 32
// cores. Splitting is only legitimate because pair p's opening comes from rng(seed*7919 + p)
// and nothing else, so workers dividing the range play exactly the games one process would.
//
//   A=path/engine.js B=tools/lab/variants/engine-tt4way.js NODES=500000 PAIRS=1000 WORKERS=30 \
//     node parmatch.js
//
// VERIFY=1 runs the same match serially as well and refuses to report unless they agree.
const path = require('path');
const { fork } = require('child_process');
const L = require('./lib.js'), D = require('./duel.js');

const CFG = {
  A: process.env.A || 'path/engine.js',
  B: process.env.B || 'path/engine.js',
  AW: process.env.AW || '', BW: process.env.BW || '',
  ABITS: process.env.ABITS || '', BBITS: process.env.BBITS || '',
  NODES: Number(process.env.NODES || 500000),
  APARITY: process.env.APARITY || null,
  BPARITY: process.env.BPARITY || null,
  // BNODES lets the two sides have DIFFERENT budgets, which is what an equal-TIME comparison
  // is: a variant that evaluates better but runs 27.8% slower has to play 361 000 nodes against
  // 500 000 to be judged on what a player would actually experience.
  BNODES: process.env.BNODES ? Number(process.env.BNODES) : null,
  // A budget in NODES asks "which engine is stronger for the same work". A budget in DEPTH asks
  // a different and narrower question: "which EVALUATION is better", with the search held level.
  // The two come apart whenever an evaluation changes how well the tree prunes -- which is
  // exactly the case under investigation, so the second question needs its own knob.
  DEPTH: process.env.DEPTH ? Number(process.env.DEPTH) : null,
  SEED: Number(process.env.SEED || 1),
  OPEN: process.env.OPEN === '' || process.env.OPEN == null ? null : Number(process.env.OPEN),
};
const wOf = v => v === '0' ? false : (v || undefined);
// Les poids REELLEMENT charges, defaut compris. La ligne de resultat n'affichait AW que s'il
// avait ete passe explicitement -- or loadEngine charge path/netweights.js quand on ne lui dit
// rien. Un match imprime "A path/engine.js" pendant que A portait le reseau livre, et le
// "fait main contre appris" qu'on croyait lire etait en fait "reseau livre contre candidat".
// Un libelle qui omet le defaut est un libelle faux, et celui-la a deja trompe une lecture.
const wName = v => (wOf(v) === false ? 'sans reseau' : (wOf(v) || 'path/netweights.js (defaut)'));

function build() {
  const A = L.loadEngine(CFG.A, { weights: wOf(CFG.AW) });
  const B = L.loadEngine(CFG.B, { weights: wOf(CFG.BW) });
  if (CFG.ABITS) A.Engine.setTableBits(Number(CFG.ABITS));
  if (CFG.BBITS) B.Engine.setTableBits(Number(CFG.BBITS));
  A.Engine.clearTable(); B.Engine.clearTable();
  const o = { budgetMs: 1e9, maxNodes: CFG.NODES };
  const ob = { budgetMs: 1e9, maxNodes: CFG.BNODES || CFG.NODES };
  // engine.js porte un reglage `parity: 'even'`: repondre depuis la derniere iteration PAIRE au
  // lieu de l'impaire, qui finit sur notre propre coup et voit donc notre avance sans la reponse.
  // Il etait dans le moteur, documente, et rien ne s'en servait -- donc rien ne l'avait mesure.
  if (CFG.APARITY) o.parity = CFG.APARITY;
  if (CFG.BPARITY) ob.parity = CFG.BPARITY;
  if (CFG.DEPTH) {
    // The node cap stays as a safety net so one pathological position cannot hang the match.
    o.maxDepth = ob.maxDepth = CFG.DEPTH;
    o.maxNodes = ob.maxNodes = CFG.NODES;
  }
  return { A, B, o, ob };
}

// ---------- worker ----------
if (process.env.PM_WORKER) {
  const { A, B, o, ob } = build();
  // Chaque ouvrier publie la position qu'il joue, dans le meme format que la generation, pour
  // que le tableau de bord les affiche sans rien connaitre des matchs. Ecrit au plus une fois
  // par seconde: un match qui passe son temps a ecrire des fichiers n'est plus un match.
  if (process.env.PM_LIVE) {
    const fs = require('fs'), os = require('os');
    const id = process.env.PM_ID || '0';
    const file = path.join(__dirname, (process.env.LIVEDIR || 'live'), 'live_' + id + '.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let at = 0, games = 0;
    D.watch((s, ply, first, done) => {
      if (done) games++;
      const now = Date.now();
      if (!done && now - at < 900) return;
      at = now;
      try {
        fs.writeFileSync(file, JSON.stringify({
          seed: Number(id), games, positions: 0, ply,
          pos: L.encodePos(s), by: s.wallBy, turn: s.turn,
          updated: new Date().toISOString(),
        }));
      } catch (e) { /* le lecteur reessaiera */ }
    });
  }
  process.on('message', (m) => {
    if (m === 'stop') return process.exit(0);
    const r = D.matchRange(A, B, o, ob, m.from, m.to, CFG.SEED, CFG.OPEN);
    // The pair scores travel back too: the error bar is computed from their spread, and a
    // master that only received totals would have to fall back to the binomial on games, which
    // understates the uncertainty because the two games of a pair share an opening.
    process.send({ a: r.a, b: r.b, draws: r.draws, pairs: r.pairs, from: m.from, to: m.to });
  });
  process.send('ready');
  return;
}

// ---------- master ----------
const PAIRS = Number(process.env.PAIRS || 100);
const WORKERS = Math.max(1, Math.min(Number(process.env.WORKERS || require('os').cpus().length - 1), PAIRS));
// More chunks than workers, handed out on demand: games differ in length by a factor of three,
// so a static split leaves cores idle waiting for whoever drew the long games.
const CHUNK = Math.max(1, Math.floor(PAIRS / (WORKERS * 4)) || 1);

const t0 = Date.now();
let cursor = 0, done = 0, a = 0, b = 0, draws = 0, live = 0;
const allPairs = [];
const kids = [];
const env = Object.assign({}, process.env, { PM_WORKER: '1' });

function feed(k) {
  if (cursor >= PAIRS) { k.send('stop'); return; }
  const from = cursor, to = Math.min(PAIRS, cursor + CHUNK);
  cursor = to;
  k.send({ from, to });
}

// Le maitre agrege les fichiers des ouvriers dans queue_status.json: c'est exactement ce que
// genfarm publie, donc le tableau de bord n'a pas une ligne a apprendre.
const LIVE = process.env.PM_LIVE ? path.join(__dirname, process.env.LIVEDIR || 'live') : null;
if (LIVE) {
  const fs = require('fs'), os = require('os');
  const beat = setInterval(() => {
    const live = [];
    for (let i = 0; i < WORKERS; i++) {
      try { live.push(JSON.parse(fs.readFileSync(path.join(LIVE, 'live_' + i + '.json'), 'utf8'))); } catch (e) { /* pas encore */ }
    }
    try {
      fs.writeFileSync(path.join(__dirname, 'queue_status.json'), JSON.stringify({
        machine: os.hostname(),
        job: process.env.PM_LABEL || 'match',
        at: done, total: PAIRS,
        since: new Date(t0).toISOString(),
        progress: `${done}/${PAIRS} paires \u00b7 A ${a} - B ${b} - nulles ${draws}`,
        done: [], live,
        updated: new Date().toISOString(),
      }, null, 1));
    } catch (e) { /* prochain tour */ }
  }, 700);
  // unref: ce minuteur ne doit pas garder le processus en vie. Sans lui, le maitre imprime son
  // resultat puis ne rend jamais la main -- et tout ce qui attend la fin du match attend pour
  // toujours. Observe: un match termine depuis quarante minutes bloquait la file suivante.
  if (beat.unref) beat.unref();
}

for (let i = 0; i < WORKERS; i++) {
  // PM_ID distingue les fichiers live des ouvriers; sans lui ils s'ecraseraient l'un l'autre.
  const k = fork(__filename, [], { env: Object.assign({}, env, { PM_ID: String(i) }), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  live++;
  kids.push(k);
  k.on('message', (m) => {
    if (m === 'ready') return feed(k);
    a += m.a; b += m.b; draws += m.draws; done += (m.to - m.from);
    if (m.pairs) for (const x of m.pairs) allPairs.push(x);
    process.stderr.write(`\r${done}/${PAIRS} pairs`);
    feed(k);
  });
  k.on('exit', () => { if (--live === 0) finish(); });
}

function finish() {
  const games = a + b + draws;
  const score = games ? (a + draws / 2) / games : 0;
  const r = { a, b, draws, games, score, pairs: allPairs };
  process.stderr.write('\r');
  console.log(`A ${CFG.A} + ${wName(CFG.AW)}${CFG.ABITS ? ' @2^' + CFG.ABITS : ''}`);
  console.log(`B ${CFG.B} + ${wName(CFG.BW)}${CFG.BBITS ? ' @2^' + CFG.BBITS : ''}`);
  console.log(`${CFG.DEPTH ? 'depth ' + CFG.DEPTH + ', cap ' : ''}${CFG.NODES}${CFG.BNODES ? ' vs ' + CFG.BNODES : ''} nodes, seed ${CFG.SEED}, ${WORKERS} workers: A ${a} - B ${b} - draws ${draws} over ${games}`);
  console.log(`A scores ${(score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}   ${D.elo(score).toFixed(0)} Elo   (${((Date.now() - t0) / 60000).toFixed(1)}m)`);
  if (process.env.VERIFY) {
    const { A, B, o, ob } = build();
    const s = D.match(A, B, o, ob, PAIRS, CFG.SEED, CFG.OPEN);
    const same = s.a === a && s.b === b && s.draws === draws;
    console.log(`serial check: ${s.a}-${s.b}-${s.draws}  ${same ? 'IDENTICAL - splitting is sound' : '<<< SPLIT CHANGED THE MATCH'}`);
    if (!same) process.exit(1);
  }
}
