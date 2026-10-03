// Ou l'ordre des coups place-t-il le coup qu'une recherche profonde a choisi ?
//
// C'est la seule question qui compte pour l'ordre. Un ordre parfait met ce coup en premier: la
// recherche le refute ou le confirme tout de suite et coupe tout le reste. Un ordre mediocre le
// met vingtieme et la recherche paie dix-neuf sous-arbres pour rien.
//
// Les etiquettes viennent de data/scored: position, score, et le MEILLEUR COUP de la recherche a
// 60 000 noeuds, ecrit a cote sans rien couter de plus. 392 656 lignes dorment la.
//
// On mesure a noeud FROID: reset() avant chaque position, pas de coup de table, pas de killers,
// pas d'historique. C'est l'ordre que decident les constantes ecrites a la main -- celles que l'on
// veut remplacer par des poids appris.
//
//   N=20000 node orderrank.js
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 20000);
const GLOB = process.env.SRC || 'data/scored';

const ENGINE = process.env.ENGINE || 'tools/lab/variants/engine-order.js';
const E = L.loadEngine(ENGINE, { weights: false });
console.log('moteur: ' + ENGINE);
const R = E.Rules, Eng = E.Engine;
if (!Eng.scoreBuf) throw new Error('scoreBuf non expose: relancer mkorder.js');

// Charge les etiquettes: index, token, score, id du meilleur coup.
const rows = [];
for (const f of fs.readdirSync(GLOB)) {
  if (!f.endsWith('.csv')) continue;
  for (const line of fs.readFileSync(GLOB + '/' + f, 'utf8').split('\n')) {
    const c = line.split(',');
    if (c.length < 4) continue;
    const tok = c[1], id = Number(c[3]);
    if (!tok || tok.length !== L.POS_LEN || !Number.isFinite(id) || id < 0) continue;
    rows.push([tok, id]);
    if (rows.length >= N) break;
  }
  if (rows.length >= N) break;
}
console.log(rows.length + ' positions etiquetees');

let used = 0, top1 = 0, top3 = 0, top5 = 0, absent = 0;
let rangTotal = 0, candTotal = 0;
const hist = new Map();
for (const [tok, id] of rows) {
  let s; try { s = L.decodePos(R, tok); } catch (e) { continue; }
  if (s.winner !== null) continue;
  const want = L.actionFromId(id);
  if (!want) continue;
  const pos = Eng.fromRules(s);
  // analyse() vide killers et history a son demarrage (freshHistory par defaut), donc une
  // recherche minuscule suffit a obtenir un noeud froid; on regenere ensuite l'ordre nous-memes.
  Eng.clearTable();
  Eng.analyse(pos, { budgetMs: 1e9, maxNodes: 1, maxDepth: 1 });
  const n = Eng.genMoves(pos, 0, Eng.MOVE_NONE, 1);
  if (!n) continue;
  const buf = Eng.moveBuf[0], sc = Eng.scoreBuf[0];
  // le coup cherche, dans la representation du moteur
  let target = -1;
  try { target = Eng.fromAction(pos, want); } catch (e) { continue; }
  const paires = [];
  for (let i = 0; i < n; i++) paires.push([buf[i], sc[i]]);
  paires.sort((a, b) => b[1] - a[1]);
  let rang = -1;
  for (let i = 0; i < paires.length; i++) if (paires[i][0] === target) { rang = i; break; }
  used++;
  candTotal += n;
  if (rang < 0) { absent++; continue; }   // pas engendre du tout: le filtre l'a ecarte
  rangTotal += rang;
  if (rang === 0) top1++;
  if (rang < 3) top3++;
  if (rang < 5) top5++;
  hist.set(Math.min(rang, 20), (hist.get(Math.min(rang, 20)) || 0) + 1);
}
const pc = x => (100 * x / (used || 1)).toFixed(1) + '%';
console.log('');
console.log(used + ' positions mesurees, ' + (candTotal / (used || 1)).toFixed(1) + ' coups candidats en moyenne');
console.log('  le coup de la recherche profonde est PREMIER   : ' + top1 + ' (' + pc(top1) + ')');
console.log('  dans les 3 premiers                            : ' + top3 + ' (' + pc(top3) + ')');
console.log('  dans les 5 premiers                            : ' + top5 + ' (' + pc(top5) + ')');
console.log('  jamais engendre (ecarte par le filtre)         : ' + absent + ' (' + pc(absent) + ')');
console.log('  rang moyen quand il est engendre               : ' + (rangTotal / Math.max(1, used - absent)).toFixed(2));
