// The transposition table is not allowed to change the VALUE of the tree.
//
// This is the invariant that caught the eval-cache theft worth 176 Elo, and it is the only
// honest test of a replacement-policy change: a bucketed table legitimately keeps different
// entries than a direct-mapped one, so "same node count, same move" is the wrong question --
// searches will differ. What may not differ is the score, at a fixed depth with every
// reduction and every forward pruning rule switched off, because then alpha-beta plus the
// table is an exact algorithm and so is alpha-beta alone.
const L = require('./lib.js'), D = require('./duel.js');
const ENG = process.env.ENG || 'path/engine.js';
const DEPTH = Number(process.env.DEPTH || 5);
const CAP = Number(process.env.CAP || 4000000);
const A = L.loadEngine(ENG, { weights: false });
const E = A.Engine, R = A.Rules;
console.log(`${ENG}, depth ${DEPTH}, reductions and pruning off`);

let n = 0, bad = 0, skipped = 0;
for (let g = 0; g < Number(process.env.GAMES || 12); g++) {
  const rnd = L.rng(4000 + g);
  const s = D.makeOpening(A, L.startState(R), 2 + ((rnd() * 9) | 0), rnd);
  for (let ply = 0; ply < 10 && s.winner == null; ply++) {
    const pos = E.fromRules(s);
    const opts = { budgetMs: 1e9, maxNodes: CAP, maxDepth: DEPTH };

    E.setSearchFlags({ tt: false, lmr: false, prune: false });
    E.clearTable();
    const off = E.analyse(pos, opts);

    E.setSearchFlags({ tt: true, lmr: false, prune: false });
    E.clearTable();
    const on = E.analyse(pos, opts);

    E.setSearchFlags({ tt: true, lmr: true, prune: true });   // restore

    // Only compare when BOTH reached the target depth: a node cap that stops one side early
    // makes them answer different questions, and that used to report false violations.
    if (off.depth !== DEPTH || on.depth !== DEPTH) { skipped++; }
    else {
      n++;
      if (off.score !== on.score) {
        bad++;
        if (bad <= 4) console.log(`  score ${off.score} sans table, ${on.score} avec, profondeur ${DEPTH}`);
      }
    }
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: 3000, noise: 60 });
    L.applyAction(R, s, E.toAction(pos, r.best));
  }
}
console.log(`${n} positions comparees (${skipped} ignorees, profondeur non atteinte) : ${bad} violations`);
console.log(bad ? 'FAIL - la table change la valeur de l arbre' : 'OK - la table ne change pas la valeur de l arbre');
