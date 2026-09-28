// A paired match between two ENGINE FILES at the same node budget. Same-budget rather than
// same-time on purpose: this compares what a search concludes, not how fast it runs, and the
// speed of a variant is measured separately by dcsweep.js where it needs no games at all.
//
//   A=path/engine.js B=tools/lab/variants/engine-tt4way.js NODES=500000 PAIRS=40 node engmatch.js
const L = require('./lib.js'), D = require('./duel.js');
const AF = process.env.A || 'path/engine.js';
const BF = process.env.B || 'path/engine.js';
const ABITS = process.env.ABITS ? Number(process.env.ABITS) : null;
const BBITS = process.env.BBITS ? Number(process.env.BBITS) : null;
// Weights are per side, because a feature-set change makes the two engines need DIFFERENT
// weight files: a network trained on 14 features fed 20 is not a weaker network, it is a
// different function, and the mismatch would be silent.
const w = (v) => v === '0' ? false : (v || undefined);
const A = L.loadEngine(AF, { weights: w(process.env.AW || process.env.WEIGHTS) });
const B = L.loadEngine(BF, { weights: w(process.env.BW || process.env.WEIGHTS) });
for (const [nm, e, f] of [['A', A, AF], ['B', B, BF]]) {
  if (e.Engine.hasNet() && e.Engine.NET_FEATURES !== 14 && !(nm === 'A' ? process.env.AW : process.env.BW))
    { console.log(`ERR ${nm} (${f}) has ${e.Engine.NET_FEATURES} features but loaded the default 14-feature weights`); process.exit(1); }
}
if (ABITS) { A.Engine.setTableBits(ABITS); }
if (BBITS) { B.Engine.setTableBits(BBITS); }
A.Engine.clearTable(); B.Engine.clearTable();
const nodes = Number(process.env.NODES || 500000);
const o = { budgetMs: 1e9, maxNodes: nodes };
const t = Date.now();
const r = D.match(A, B, o, o, Number(process.env.PAIRS || 40), Number(process.env.SEED || 1));
console.log(`A ${AF}${ABITS ? ' @2^' + ABITS : ''}`);
console.log(`B ${BF}${BBITS ? ' @2^' + BBITS : ''}`);
console.log(`${nodes} nodes, seed ${process.env.SEED || 1}: A ${r.a} - B ${r.b} - draws ${r.draws} over ${r.games}`);
console.log(`A scores ${(r.score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}  (${D.elo(r.score).toFixed(0)} Elo)  (${((Date.now() - t) / 60000).toFixed(1)}m)`);
