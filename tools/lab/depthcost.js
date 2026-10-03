// Ce que l'elargissement COUTE: de la profondeur, a budget egal.
//
// L'elargissement repare 94 % des coups que le filtre livre ecarte, et 38 des 39 gains forces
// caches. Il a un prix: plus de coups a la racine, donc moins de noeuds par demi-coup. Ce prix se
// mesure directement -- la profondeur achevee a budget donne -- et surtout pas par des matchs, qui
// dans ce projet sont intransitifs entre variantes voisines.
//
//   N=400 BUDGETS=20000,60000,200000 node depthcost.js
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 400);
const SRC = process.env.SRC || 'data/pos_12.csv';
const BUDGETS = (process.env.BUDGETS || '20000,60000,200000').split(',').map(Number);

const S = L.loadEngine('path/engine.js', { weights: false });
const W = L.loadEngine('tools/lab/variants/engine-walls-wide.js', { weights: false });
const R = S.Rules;
const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === L.POS_LEN);

const acc = new Map();
for (const b of BUDGETS) acc.set(b, { s: [], w: [], a: [], agree: 0, n: 0 });
let used = 0;
for (let i = 0; used < N && i < toks.length; i++) {
  let st; try { st = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  if (st.winner !== null) continue;
  used++;
  for (const b of BUDGETS) {
    const o = acc.get(b);
    S.Engine.clearTable(); W.Engine.clearTable();
    const ps = S.Engine.fromRules(st), pw = W.Engine.fromRules(st);
    const rs = S.Engine.analyse(ps, { budgetMs: 1e9, maxNodes: b });
    const rw = W.Engine.analyse(pw, { budgetMs: 1e9, maxNodes: b });
    // La troisieme option: elargir la racine SEULE (rootAll), le filtre restant etroit a
    // l'interieur. Le commentaire de engine.js l'annonce a un demi-coup entier; a verifier.
    S.Engine.clearTable();
    const ra = S.Engine.analyse(S.Engine.fromRules(st), { budgetMs: 1e9, maxNodes: b, rootAll: true });
    if (rs.best === S.Engine.MOVE_NONE || rw.best === W.Engine.MOVE_NONE) continue;
    o.n++;
    o.s.push(rs.depth); o.w.push(rw.depth);
    if (ra.best !== S.Engine.MOVE_NONE) o.a.push(ra.depth);
    if (L.actionId(S.Engine.toAction(ps, rs.best)) === L.actionId(W.Engine.toAction(pw, rw.best))) o.agree++;
  }
  if (used % 50 === 0) process.stderr.write(used + '/' + N + '\n');
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log(used + ' positions, source ' + SRC);
console.log('budget   livree  elargie  perdu  racine seule  perdu  memes coups (livre/elargi)');
for (const b of BUDGETS) {
  const o = acc.get(b);
  const ds = mean(o.s), dw = mean(o.w), da = mean(o.a);
  console.log(String(b).padStart(6) + '  ' + ds.toFixed(2).padStart(6) + '  ' + dw.toFixed(2).padStart(7) +
    '  ' + (ds - dw).toFixed(2).padStart(5) + '  ' + da.toFixed(2).padStart(12) + '  ' +
    (ds - da).toFixed(2).padStart(5) + '  ' +
    (o.agree + '/' + o.n + ' (' + (100 * o.agree / (o.n || 1)).toFixed(0) + '%)').padStart(24));
}
