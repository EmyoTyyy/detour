// Learned evaluation against the handcrafted one at EQUAL TIME. Comparing at equal nodes would
// hide the network's cost entirely, so the real search-level slowdown is measured first (it is
// much smaller than a microbenchmark suggests, because the table caches evaluations) and the
// network engine is given proportionally fewer nodes.
const fs = require('fs');
const L = require('./lib.js');
const D = require('./duel.js');
const NET = process.env.NET || null;                       // null = the shipped path/netweights.js
const A = L.loadEngine(undefined, { weights: false });     // handcrafted
const B = L.loadEngine(undefined, { weights: NET || 'path/netweights.js' });
if (!B.Engine.hasNet()) { console.log('ERR the network engine has no weights'); process.exit(1); }
if (A.Engine.hasNet()) { console.log('ERR the handcrafted engine picked up weights'); process.exit(1); }

const probe = L.startState(A.Rules);
const timeOne = (E, n) => { E.clearTable(); const t = process.hrtime.bigint(); E.analyse(E.fromRules(probe), { budgetMs: 1e9, maxNodes: n }); return Number(process.hrtime.bigint() - t) / 1e6; };
// The ratio decides the node budget, so a bad ratio makes an unfair match. Summing three A
// timings and then three B timings lets machine load drift between the halves: the same
// architecture measured 1.15x on a quiet machine and 1.42x on a busy one, a 24% swing in the
// budget -- worth more Elo than the match itself can resolve. Take the ratio WITHIN each
// interleaved pair, so a load change hits both halves of a pair, then take the median so one
// bad pair cannot move it.
timeOne(A.Engine, 50000); timeOne(B.Engine, 50000);
const rs = [];
for (let i = 0; i < 9; i++) { const ma = timeOne(A.Engine, 120000); const mb = timeOne(B.Engine, 120000); rs.push(mb / ma); }
rs.sort((x, y) => x - y);
const ratio = rs[4];
console.log(`ratio par paire: min ${rs[0].toFixed(2)} median ${ratio.toFixed(2)} max ${rs[8].toFixed(2)}`);
const base = Number(process.env.NODES || 500000);
const netNodes = Math.max(1000, Math.round(base / ratio));
console.log(`${ratio.toFixed(2)}x slower in a real search; equal time = ${base} vs ${netNodes} nodes`);
const t0 = Date.now();
const r = D.match(A, B, { budgetMs: 1e9, maxNodes: base }, { budgetMs: 1e9, maxNodes: netNodes }, Number(process.env.PAIRS || 40), Number(process.env.SEED || 17));
console.log(`handcrafted ${r.a} - learned ${r.b} - draws ${r.draws} over ${r.games}`);
console.log(`handcrafted scores ${(r.score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)}   ${r.score < 0.5 ? '<<< LEARNED IS BETTER' : r.score > 0.5 ? '(handcrafted better)' : '(even)'}   (${((Date.now() - t0) / 60000).toFixed(1)}m)`);
