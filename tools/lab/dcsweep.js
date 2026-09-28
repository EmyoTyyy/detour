// Distance-cache size, measured as speed. A speedup needs no match to confirm: nodes per second
// at a fixed node budget IS the result, and the search is deterministic so the node counts are
// identical across variants. Timings are interleaved between variants so machine load, which is
// heavy right now, drifts across all of them equally instead of favouring whoever ran first.
const L = require('./lib.js');
const D = require('./duel.js');
const VARIANTS = (process.env.VARIANTS || 'path/engine.js,tools/lab/variants/engine-dc18.js,tools/lab/variants/engine-dc20.js,tools/lab/variants/engine-dc22.js').split(',');
const NODES = Number(process.env.NODES || 200000);
const POSN = Number(process.env.POSN || 12);

// Weights per variant, comma-separated and matching VARIANTS ('0' = none, '' = the default
// file). Without this the sweep loaded every variant WITHOUT a network, so a feature-set change
// measured only its bookkeeping and none of the evaluation it feeds -- which is most of its cost.
const WS = (process.env.WEIGHTS || '').split(',');
const eng = VARIANTS.map((v, i) => {
  const w = WS[i] == null || WS[i] === '' ? (WS.length > 1 || process.env.WEIGHTS ? undefined : false) : (WS[i] === '0' ? false : WS[i]);
  return L.loadEngine(v, { weights: w });
});
eng.forEach((e, i) => console.log(`  ${VARIANTS[i]}: ${e.Engine.NET_FEATURES} features, network ${e.Engine.hasNet() ? 'on' : 'off'}`));
const R = eng[0].Rules;

// one shared list of real positions, so every variant answers exactly the same questions
const probes = [];
{
  const A = eng[0];
  for (let g = 0; probes.length < POSN; g++) {
    const rnd = L.rng(900 + g);
    const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 7) | 0), rnd);
    for (let ply = 0; ply < 6 && s.winner == null && probes.length < POSN; ply++) {
      probes.push(JSON.parse(JSON.stringify({ h: [...s.hWalls], v: [...s.vWalls], p: s.pawns, w: s.walls, t: s.turn })));
      const pos = A.Engine.fromRules(s);
      const r = A.Engine.analyse(pos, { budgetMs: 1e9, maxNodes: 4000, noise: 60 });
      L.applyAction(R, s, A.Engine.toAction(pos, r.best));
    }
  }
}
const mk = (p) => { const s = L.startState(R); s.hWalls = new Set(p.h); s.vWalls = new Set(p.v);
  s.pawns = p.p.map(x => ({ ...x })); s.walls = p.w.slice(); s.turn = p.t; s.winner = null; return s; };

const ms = VARIANTS.map(() => 0), nd = VARIANTS.map(() => 0);
for (let rep = 0; rep < Number(process.env.REPS || 3); rep++) {
  for (const p of probes) {
    for (let i = 0; i < eng.length; i++) {
      const E = eng[i].Engine;
      E.clearTable();
      const pos = E.fromRules(mk(p));
      // CPU time, not wall clock. Wall clock counts the seconds this process spent descheduled
      // while other jobs ran, so on a busy machine the same comparison came back anywhere from
      // 0.90x to 2.37x. CPU time only advances while the process is actually on a core, so the
      // measurement survives a loaded box -- cache contention still leaks in, but that is a
      // real cost and it hits every variant alike.
      const c0 = process.cpuUsage();
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
      const c = process.cpuUsage(c0);
      ms[i] += (c.user + c.system) / 1000;
      nd[i] += r.nodes;
    }
  }
}
console.log('variante                    noeuds/s   vs base   succes cache   BFS/noeud   noeuds');
const base = nd[0] / ms[0];
for (let i = 0; i < eng.length; i++) {
  const st = eng[i].Engine.pathStats();
  const nps = nd[i] / ms[i];
  const mh = st.mapHit == null ? '' : `   cartes ${(100 * st.mapHit / (st.mapHit + st.mapMiss)).toFixed(1)}%`;
  console.log(VARIANTS[i].replace('path/', '').replace('tools/lab/variants/', '').padEnd(24)
    + (nps * 1000 / 1000).toFixed(0).padStart(9) + 'k'
    + ((nps / base - 1) * 100).toFixed(1).padStart(9) + '%'
    + (100 * st.hit / (st.hit + st.miss)).toFixed(1).padStart(13) + '%'
    + (st.miss / nd[i]).toFixed(2).padStart(12)
    + String(nd[i]).padStart(11) + mh);
}
