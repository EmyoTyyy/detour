// A loaded network must actually evaluate. This exists because every network trained in one
// session was silently dead: setNet reads `w.b2[0]`, train.py wrote b2 as a scalar, `undefined`
// seeded the accumulator, every add produced NaN, and `(scale * NaN) | 0` is 0 -- so the engine
// evaluated every position on the board as exactly equal and played blind. It lost 120-0 and
// looked like a weak network rather than a broken one.
const L = require('./lib.js'), D = require('./duel.js');
const W = process.argv[2] || 'path/netweights.js';
const E_ = process.argv[3] || 'path/engine.js';
const A = L.loadEngine(E_, { weights: W });
const E = A.Engine, R = A.Rules;
if (!E.hasNet()) { console.log('FAIL: no network loaded from ' + W); process.exit(1); }
const vals = new Set();
let nan = 0, n = 0;
for (let g = 0; g < 6; g++) {
  const rnd = L.rng(11000 + g);
  const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 9) | 0), rnd);
  for (let ply = 0; ply < 25 && s.winner == null; ply++) {
    const pos = E.fromRules(s);
    const v = E.netEval(pos);
    if (!Number.isFinite(v)) nan++;
    vals.add(v); n++;
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: 2000, noise: 60 });
    L.applyAction(R, s, E.toAction(pos, r.best));
  }
}
const arr = [...vals];
console.log(`${W} with ${E_}: ${E.NET_FEATURES} features, ${n} positions, ${vals.size} distinct values`
  + `, range ${Math.min(...arr)}..${Math.max(...arr)}${nan ? ', ' + nan + ' non-finite' : ''}`);
const dead = vals.size <= 2 || nan > 0;
console.log(dead ? 'FAIL - the network is not evaluating' : 'OK - the network evaluates');
process.exit(dead ? 1 : 0);
