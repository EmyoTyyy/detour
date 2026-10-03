// Le vrai prix de l'elargissement: en TEMPS, pas en noeuds.
//
// A budget en noeuds, elargir la racine ne coute presque rien (0,08 a 0,19 demi-coup sur cinq
// budgets). Mais l'application ne joue pas au noeud, elle joue a la milliseconde -- et un budget
// en noeuds cache precisement ce qu'une racine doublee coute: l'engendrer et la trier. Le
// commentaire de scoreMove annonce "un demi-coup entier, 8,83 vers 7,75" et il a ete mesure au
// budget de la revue, qui est un temps. Les deux peuvent donc etre vrais a la fois.
//
// Ce projet s'est deja fait prendre par la: l'evaluation seule etait 2,23x plus lente avec le
// reseau alors que le moteur ne l'etait que de 1,065x. Le rapport qu'on croit mesurer n'est pas
// celui qu'on mesure.
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 120);
const SRC = process.env.SRC || 'data/pos_12.csv';
const MS = (process.env.MS || '400,700,2500').split(',').map(Number);

const S = L.loadEngine('path/engine.js', { weights: false });
const W = L.loadEngine('tools/lab/variants/engine-walls-wide.js', { weights: false });
const R = S.Rules;
const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === L.POS_LEN);

const acc = new Map();
for (const ms of MS) acc.set(ms, { s: [], w: [], a: [], ns: [], na: [], n: 0 });
let used = 0;
for (let i = 0; used < N && i < toks.length; i++) {
  let st; try { st = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  if (st.winner !== null) continue;
  used++;
  for (const ms of MS) {
    const o = acc.get(ms);
    S.Engine.clearTable(); W.Engine.clearTable();
    const rs = S.Engine.analyse(S.Engine.fromRules(st), { budgetMs: ms, maxDepth: 40 });
    S.Engine.clearTable();
    const ra = S.Engine.analyse(S.Engine.fromRules(st), { budgetMs: ms, maxDepth: 40, rootAll: true });
    const rw = W.Engine.analyse(W.Engine.fromRules(st), { budgetMs: ms, maxDepth: 40 });
    if (rs.best === S.Engine.MOVE_NONE) continue;
    o.n++;
    o.s.push(rs.depth); o.a.push(ra.depth); o.w.push(rw.depth);
    o.ns.push(rs.nodes); o.na.push(ra.nodes);
  }
  if (used % 20 === 0) process.stderr.write(used + '/' + N + '\n');
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log(used + ' positions, budget en TEMPS, source ' + SRC);
console.log('  ms   livree  racine seule  perdu  elargie  perdu   noeuds livree  noeuds racine  rapport');
for (const ms of MS) {
  const o = acc.get(ms);
  const ds = mean(o.s), da = mean(o.a), dw = mean(o.w), ns = mean(o.ns), na = mean(o.na);
  console.log(String(ms).padStart(4) + '  ' + ds.toFixed(2).padStart(7) + '  ' + da.toFixed(2).padStart(12) +
    '  ' + (ds - da).toFixed(2).padStart(5) + '  ' + dw.toFixed(2).padStart(7) + '  ' + (ds - dw).toFixed(2).padStart(5) +
    '  ' + Math.round(ns).toString().padStart(14) + '  ' + Math.round(na).toString().padStart(13) +
    '  ' + (na / (ns || 1)).toFixed(2).padStart(7));
}
