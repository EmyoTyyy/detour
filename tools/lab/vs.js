// One matchup between two option blobs, with a 2-sigma band. A match result without an error
// bar has decided nothing.
const L = require('./lib.js');
const D = require('./duel.js');
const A = L.loadEngine(), B = L.loadEngine();
const nodes = Number(process.env.NODES || 150000);
const base = { budgetMs: 1e9, maxNodes: nodes };
const a = Object.assign({}, base, JSON.parse(process.argv[2] || '{}'));
const b = Object.assign({}, base, JSON.parse(process.argv[3] || '{}'));
const t = Date.now();
const r = D.match(A, B, a, b, Number(process.env.PAIRS || 40), Number(process.env.SEED || 1));
console.log(`${process.argv[2]} vs ${process.argv[3]} at ${nodes} nodes`);
console.log(`  ${r.a}-${r.b}-${r.draws} over ${r.games} = ${(r.score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}  (${((Date.now() - t) / 60000).toFixed(1)}m)`);
