// Two feature implementations must agree exactly. The cheap one keeps running totals updated in
// addWall/delWall, so it is also a test that those totals survive make/unmake inside a search
// and that fromRules builds them -- a counter that drifts would be invisible until the network
// started answering nonsense.
const L = require('./lib.js'), D = require('./duel.js');
const A = L.loadEngine(process.env.A || 'tools/lab/variants/engine-feat4.js', { weights: false });
const B = L.loadEngine(process.env.B || 'tools/lab/variants/engine-feat5.js', { weights: false });
const R = A.Rules;
if (A.Engine.NET_FEATURES !== B.Engine.NET_FEATURES) { console.log('FAIL: feature counts differ'); process.exit(1); }
const n = A.Engine.NET_FEATURES;
const fa = new Float64Array(n), fb = new Float64Array(n);
let seen = 0, bad = 0;
for (let g = 0; g < 60; g++) {
  const rnd = L.rng(6000 + g);
  const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 9) | 0), rnd);
  for (let ply = 0; ply < 40 && s.winner == null; ply++) {
    const pa = A.Engine.fromRules(s), pb = B.Engine.fromRules(s);
    A.Engine.netFeatures(pa, fa); B.Engine.netFeatures(pb, fb);
    for (let i = 0; i < n; i++) if (fa[i] !== fb[i]) {
      bad++;
      if (bad <= 5) console.log(`ecart feature ${i}: ${fa[i]} vs ${fb[i]}`);
      break;
    }
    seen++;
    // search with B so its running totals go through make/unmake thousands of times
    const r = B.Engine.analyse(pb, { budgetMs: 1e9, maxNodes: 4000, noise: 60 });
    L.applyAction(R, s, B.Engine.toAction(pb, r.best));
  }
}
console.log(`${seen} positions : ${bad} ecarts`);
console.log(bad ? 'FAIL' : 'OK - la version economique donne exactement les memes valeurs');
