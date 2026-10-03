// A quel budget la recherche s'arrete-t-elle sur quelle profondeur ?
//
// Le reglage `parity: 'even'` ne change le coup QUE si la derniere profondeur achevee est impaire.
// Donc tout budget ou la mesure donne exactement zero peut n'etre qu'un budget ou la recherche
// finit d'ordinaire sur une profondeur PAIRE: le drapeau ne se declenche jamais, et le match
// compare le moteur a lui-meme. C'est une prediction nette, et elle ne demande aucune partie.
//
// On prend des positions, on cherche a chaque budget, et on releve la profondeur achevee, sa
// parite, et si le score etait prouve (auquel cas le drapeau ne se declenche pas non plus).
//
//   N=300 SRC=data/pos_14.csv node depthmix.js
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 300);
const SRC = process.env.SRC || 'data/pos_14.csv';
const BUDGETS = (process.env.BUDGETS || '1500,5000,8000,15000,20000,60000,200000').split(',').map(Number);

const E = L.loadEngine('path/engine.js', { weights: false });
const R = E.Rules, Eng = E.Engine;
const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === L.POS_LEN);

const st = new Map(BUDGETS.map(b => [b, { odd: 0, even: 0, proven: 0, deps: [], n: 0 }]));
let used = 0;
for (let i = 0; used < N && i < toks.length; i++) {
  let s;
  try { s = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  if (s.winner !== null) continue;
  used++;
  for (const b of BUDGETS) {
    Eng.clearTable();
    const r = Eng.analyse(Eng.fromRules(s), { budgetMs: 1e9, maxNodes: b });
    const o = st.get(b);
    o.n++;
    o.deps.push(r.depth);
    if (r.proven) o.proven++;
    else if (r.depth & 1) o.odd++;
    else o.even++;
  }
  if (used % 50 === 0) process.stderr.write(used + '/' + N + '\n');
}

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
console.log(used + ' positions, source ' + SRC);
console.log('budget    prof. moyenne  IMPAIRE (le drapeau agit)  paire  prouve  mesure du match');
const SEEN = { 1500: '+203', 5000: '+179', 8000: '-204', 15000: '0', 20000: '+163/+207', 60000: '0', 200000: '0' };
for (const b of BUDGETS) {
  const o = st.get(b);
  const pc = x => (100 * x / o.n).toFixed(0) + '%';
  console.log(String(b).padStart(7) + '  ' + mean(o.deps).toFixed(2).padStart(13) + '  ' +
    (o.odd + ' (' + pc(o.odd) + ')').padStart(25) + '  ' +
    (o.even + ' (' + pc(o.even) + ')').padStart(10) + '  ' +
    (o.proven + ' (' + pc(o.proven) + ')').padStart(10) + '  ' + (SEEN[b] || '?').padStart(10));
}
console.log('\nLa prediction: les budgets mesures a zero doivent etre ceux ou la part IMPAIRE est faible.');
