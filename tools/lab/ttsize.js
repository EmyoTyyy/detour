// The transposition table's size. It has been 2^20 entries — about a million — while the engine
// visits half a million nodes a move in a game where wall placements commute, so the same
// position is reached an enormous number of ways and the table is where that saving lives.
// Bigger costs memory and this has to run in a phone's browser tab, so the question is what the
// largest defensible size buys at the budget the app actually uses.
const L = require('./lib.js');
const D = require('./duel.js');
const A = L.loadEngine(), B = L.loadEngine();
const nodes = Number(process.env.NODES || 500000);
const o = { budgetMs: 1e9, maxNodes: nodes };
// ABITS is the reference side. Comparing every size against 2^20 wastes games re-measuring a
// gap already known; asking "is 2^23 better than 2^22" directly is the question that decides
// what to ship, and it needs the two sizes actually in question on the board together.
const ABITS = Number(process.env.ABITS || 20);
for (const bits of (process.env.BITS || '22').split(',').map(Number)) {
  A.Engine.setTableBits(ABITS); A.Engine.clearTable();
  B.Engine.setTableBits(bits); B.Engine.clearTable();
  const t = Date.now();
  // The seed picks the openings. A single seed's worth of openings is a sample, not a truth:
  // replicating a large claim on a different seed is how a fluke gets caught before it ships.
  const seed = Number(process.env.SEED || (1900 + bits));
  const r = D.match(A, B, o, o, Number(process.env.PAIRS || 30), seed);
  const mb = ((1 << bits) * 19 / 1048576).toFixed(0);
  console.log(`2^${ABITS} vs 2^${bits} (~${mb}MB) at ${nodes} nodes (seed ${seed}): current scores ${(r.score * 100).toFixed(1)}% +/- ${D.band(r).toFixed(1)} over ${r.games}  ${r.score < 0.45 ? '<< bigger is better' : ''}  (${((Date.now() - t) / 60000).toFixed(1)}m)`);
}
