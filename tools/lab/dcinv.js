// A cache is a memory, not a heuristic: making it bigger must not change what the search
// concludes. Same node budget, same position, same best move, same score -- or the key is wrong
// and the cache is handing positions each other's distances, which is exactly the bug class that
// cost this engine 176 Elo in the transposition table.
const L = require('./lib.js'), D = require('./duel.js');
const A = L.loadEngine(process.env.BASE || 'tools/lab/variants/engine-dc16-check.js', { weights: false });
const B = L.loadEngine(process.env.CAND || 'path/engine.js', { weights: false });
console.log((process.env.BASE || 'engine-dc16-check.js') + '  vs  ' + (process.env.CAND || 'path/engine.js'));
const R = A.Rules;
let n = 0, badMove = 0, badScore = 0, badNodes = 0;
for (let g = 0; g < 25; g++) {
  const rnd = L.rng(3000 + g);
  const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 9) | 0), rnd);
  for (let ply = 0; ply < 14 && s.winner == null; ply++) {
    A.Engine.clearTable(); B.Engine.clearTable();
    const pa = A.Engine.fromRules(s), pb = B.Engine.fromRules(s);
    const ra = A.Engine.analyse(pa, { budgetMs: 1e9, maxNodes: 60000 });
    const rb = B.Engine.analyse(pb, { budgetMs: 1e9, maxNodes: 60000 });
    if (ra.best !== rb.best)   { badMove++;  if (badMove  <= 3) console.log('coup different  ', ra.best, rb.best); }
    if (ra.score !== rb.score) { badScore++; if (badScore <= 3) console.log('score different ', ra.score, rb.score); }
    if (ra.nodes !== rb.nodes) { badNodes++; if (badNodes <= 3) console.log('noeuds differents', ra.nodes, rb.nodes); }
    n++;
    L.applyAction(R, s, A.Engine.toAction(pa, ra.best));
  }
}
console.log(`${n} positions : ${badMove} coups, ${badScore} scores, ${badNodes} comptes de noeuds differents`);
console.log(badMove || badScore || badNodes ? 'FAIL' : 'OK - le cache plus grand ne change rien au resultat, seulement au temps');
