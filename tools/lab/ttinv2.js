// The table must not change the value of the tree -- tested with the table ACCUMULATED.
//
// ttinv.js cleared before every position, so it could only catch a bug that shows up in a fresh
// table. The bucketed variant behaves strangely in matches, where the table is cleared once per
// game and then carries fifty moves of half a million nodes, and that regime was never tested.
// Here one engine keeps its table across the whole sequence while a second, with no table at
// all, answers the same positions at the same fixed depth with every reduction and every
// forward pruning rule off. Under those conditions alpha-beta is exact, so the two must agree.
const L = require('./lib.js'), D = require('./duel.js');
const ENG = process.env.ENG || 'path/engine.js';
const DEPTH = Number(process.env.DEPTH || 4);
const X = L.loadEngine(ENG, { weights: false });     // table on, never cleared after the start
const Y = L.loadEngine(ENG, { weights: false });     // table off, the reference
const R = X.Rules;
X.Engine.setSearchFlags({ tt: true, lmr: false, prune: false });
Y.Engine.setSearchFlags({ tt: false, lmr: false, prune: false });
if (process.env.BITS) { X.Engine.setTableBits(Number(process.env.BITS)); }
X.Engine.clearTable();

const ref = L.loadEngine('path/engine.js');
let n = 0, bad = 0, skipped = 0;
const opts = { budgetMs: 1e9, maxNodes: 4000000, maxDepth: DEPTH };
for (let g = 0; g < Number(process.env.GAMES || 8); g++) {
  const rnd = L.rng(8800 + g);
  const s = D.makeOpening(ref, L.startState(R), 4, rnd);
  for (let ply = 0; ply < 22 && s.winner == null; ply++) {
    const px = X.Engine.fromRules(s), py = Y.Engine.fromRules(s);
    const rx = X.Engine.analyse(px, opts);           // table kept from every position before
    Y.Engine.clearTable();
    const ry = Y.Engine.analyse(py, opts);
    if (rx.depth !== DEPTH || ry.depth !== DEPTH) skipped++;
    else {
      n++;
      if (rx.score !== ry.score) { bad++; if (bad <= 4) console.log(`  ply ${ply}: table ${rx.score}, sans table ${ry.score}`); }
    }
    const rr = ref.Engine.analyse(ref.Engine.fromRules(s), { budgetMs: 1e9, maxNodes: 4000, noise: 60 });
    L.applyAction(R, s, ref.Engine.toAction(ref.Engine.fromRules(s), rr.best));
  }
}
console.log(`${ENG}${process.env.BITS ? ' @2^' + process.env.BITS : ''}, profondeur ${DEPTH}, table accumulee : ${n} comparees (${skipped} ignorees), ${bad} violations`);
console.log(bad ? 'FAIL' : 'OK');
