// La seule mesure qui tranche: combien de NOEUDS faut-il pour atteindre une profondeur donnee ?
//
// C'est a cela que sert l'ordre des coups. Mettre le bon coup devant fait couper l'alpha-beta tout
// de suite; le mettre vingtieme fait payer dix-neuf sous-arbres. Donc un meilleur ordre se voit
// comme MOINS de noeuds pour la meme profondeur -- et, a budget egal, comme plus de profondeur.
//
// Aucune partie n'est jouee. Les proportions mesurees ici ne peuvent pas etre intransitives.
//
//   N=200 DEPTHS=6,8,10 node ordcost.js
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 200);
const SRC = process.env.SRC || 'data/pos_12.csv';
const DEPTHS = (process.env.DEPTHS || '6,8,10').split(',').map(Number);
const CAP = Number(process.env.CAP || 4000000);

const A = L.loadEngine('path/engine.js', { weights: false });                       // ordre a la main
const BF = process.env.B || 'tools/lab/variants/engine-ordw.js';
const B = L.loadEngine(BF, { weights: false });                                     // ordre a tester
const R = A.Rules;
const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === L.POS_LEN);

const acc = new Map();
for (const d of DEPTHS) acc.set(d, { a: [], b: [], same: 0, n: 0, capA: 0, capB: 0 });
let used = 0;
for (let i = 0; used < N && i < toks.length; i++) {
  let s; try { s = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  if (s.winner !== null) continue;
  used++;
  for (const d of DEPTHS) {
    const o = acc.get(d);
    A.Engine.clearTable(); B.Engine.clearTable();
    const pa = A.Engine.fromRules(s), pb = B.Engine.fromRules(s);
    const ra = A.Engine.analyse(pa, { budgetMs: 1e9, maxNodes: CAP, maxDepth: d });
    const rb = B.Engine.analyse(pb, { budgetMs: 1e9, maxNodes: CAP, maxDepth: d });
    if (ra.best === A.Engine.MOVE_NONE || rb.best === B.Engine.MOVE_NONE) continue;
    // Une position qui n'atteint pas la profondeur demandee ne compare rien: on la compte a part.
    if (ra.depth < d) o.capA++;
    if (rb.depth < d) o.capB++;
    if (ra.depth < d || rb.depth < d) continue;
    o.n++;
    o.a.push(ra.nodes); o.b.push(rb.nodes);
    if (L.actionId(A.Engine.toAction(pa, ra.best)) === L.actionId(B.Engine.toAction(pb, rb.best))) o.same++;
  }
  if (used % 25 === 0) process.stderr.write(used + '/' + N + '\n');
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
console.log(used + ' positions, source ' + SRC + ', plafond ' + CAP);
console.log('A = path/engine.js (a la main)   B = ' + BF);
console.log('prof   n   noeuds a la main   noeuds appris   rapport   mediane rapport   meme coup');
for (const d of DEPTHS) {
  const o = acc.get(d);
  if (!o.n) { console.log(String(d).padStart(4) + '   0   (profondeur jamais atteinte)'); continue; }
  const ma = mean(o.a), mb = mean(o.b);
  // rapport par position, pour que quelques positions enormes ne decident pas de tout
  const rs = o.a.map((x, k) => o.b[k] / Math.max(1, x));
  console.log(String(d).padStart(4) + '  ' + String(o.n).padStart(3) + '  ' +
    Math.round(ma).toString().padStart(16) + '  ' + Math.round(mb).toString().padStart(14) + '  ' +
    (mb / Math.max(1, ma)).toFixed(3).padStart(8) + '  ' + med(rs).toFixed(3).padStart(15) + '  ' +
    (o.same + '/' + o.n).padStart(10));
}
console.log('');
console.log('rapport < 1 = l ordre appris cherche MOINS de noeuds pour la meme profondeur.');
