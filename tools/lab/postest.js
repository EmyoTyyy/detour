// Round-trip test for the position encoding. What must hold is not that the objects look alike
// but that the ENGINE cannot tell them apart: same features, same hash, same evaluation. If any
// of those three differ, the encoding drops something a feature set might one day need.
const L = require('./lib.js');
const D = require('./duel.js');
const A = L.loadEngine(undefined, { weights: false });
const E = A.Engine, R = A.Rules;

const fa = new Float64Array(E.NET_FEATURES), fb = new Float64Array(E.NET_FEATURES);
let n = 0, bad = 0, badHash = 0, badEval = 0;
for (let g = 0; g < 40; g++) {
  const rnd = L.rng(1000 + g);
  const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 7) | 0), rnd);
  for (let ply = 0; ply < 60 && s.winner == null; ply++) {
    const tok = L.encodePos(s);
    const back = L.decodePos(R, tok);
    if (L.encodePos(back) !== tok) { bad++; console.log('re-encode differs at', tok); }
    const pa = E.fromRules(s), pb = E.fromRules(back);
    E.netFeatures(pa, fa); E.netFeatures(pb, fb);
    for (let i = 0; i < fa.length; i++) if (fa[i] !== fb[i]) { bad++; console.log('feature', i, fa[i], fb[i], tok); break; }
    if (pa.hashHi !== pb.hashHi || pa.hashLo !== pb.hashLo) { badHash++; if (badHash < 3) console.log('hash differs', tok); }
    // Clear BEFORE each, not between: a table carried in from the previous iteration is not the
    // same table for both sides, and a fixed node count on two different tables gives two
    // different scores. Getting this backwards reported 219 false mismatches.
    E.clearTable();
    const ea = E.analyse(pa, { budgetMs: 1e9, maxNodes: 3000 });
    E.clearTable();
    const eb = E.analyse(pb, { budgetMs: 1e9, maxNodes: 3000 });
    if (ea.score !== eb.score) { badEval++; if (badEval < 3) console.log('eval differs', ea.score, eb.score, tok); }
    n++;
    const r = E.analyse(pa, { budgetMs: 1e9, maxNodes: 2000, noise: 60 });
    L.applyAction(R, s, E.toAction(pa, r.best));
  }
}
console.log(`${n} positions: ${bad} feature/encoding mismatches, ${badHash} hash mismatches, ${badEval} eval mismatches`);
console.log(bad || badHash || badEval ? 'FAIL' : 'OK - the encoding is lossless as far as the engine can tell');
