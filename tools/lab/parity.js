// La parite de la profondeur coute-t-elle de la VRAIE force, ou change-t-elle seulement le
// classement entre deux variantes ?
//
// Ce que les matchs ont montre: entre le moteur livre et le filtre elargi, le vainqueur change
// avec la parite de la profondeur, de 225 points dans un sens aux profondeurs impaires a 200 dans
// l'autre aux paires. Mais un match ne dit jamais si QUELQU UN joue mal: il dit seulement qui joue
// mieux que l'autre. Un moteur contre lui-meme fait 50 % a toutes les profondeurs, par
// construction, donc la parite pourrait n'etre qu'un effet relationnel sans cout absolu.
//
// Ce controle ne joue aucune partie. Pour chaque position et chaque profondeur, il prend le coup
// choisi, le joue, et fait juger la position fille par une recherche BEAUCOUP plus profonde. La
// reference est le choix de ce meme juge. La perte d'une profondeur est donc "combien de points le
// juge pense que ce coup abandonne", dans la meme unite pour toutes les profondeurs.
//
// Si la perte decroit regulierement avec la profondeur, la parite ne coute rien en absolu et il
// n'y a rien a corriger dans le moteur. Si elle fait des dents de scie -- une profondeur paire pire
// que l'impaire juste en dessous, malgre un demi-coup de plus -- alors chercher jusqu'a une
// profondeur paire choisit vraiment de moins bons coups, et c'est un defaut a corriger.
//
//   NODES=... DEEP=600000 N=60 SRC=data/pos_14.csv node parity.js
const L = require('./lib.js');
const fs = require('fs');

const DEEP = Number(process.env.DEEP || 500000);
const N = Number(process.env.N || 60);
const SRC = process.env.SRC || 'data/pos_14.csv';
const CAP = Number(process.env.CAP || 2000000);          // plafond de securite par recherche fixe
const DEPTHS = (process.env.DEPTHS || '5,6,7,8,9,10,11,12').split(',').map(Number);

const E = L.loadEngine('path/engine.js', { weights: false });
const R = E.Rules;
const Eng = E.Engine;

const toks = fs.readFileSync(SRC, 'utf8').split('\n')
  .map(l => l.slice(0, l.indexOf(','))).filter(t => t.length === L.POS_LEN);
if (!toks.length) { console.error('aucune position lisible dans ' + SRC); process.exit(1); }

// La valeur, pour le camp au trait a la racine, de la position qui suit `action`. Un seul juge et
// un seul budget pour tout le monde: rien ne favorise une profondeur plutot qu'une autre.
function valueAfter(state, action) {
  const next = R.cloneState(state);
  next.hWalls = new Set(state.hWalls);
  next.vWalls = new Set(state.vWalls);
  if (action.type === 'wall') {
    if (!R.canPlaceWall(next, next.turn, action.orient, action.r, action.c)) return null;
    R.applyWall(next, action.orient, action.r, action.c);
  } else {
    if (!R.legalMoves(next, next.turn).some(m => m.r === action.to.r && m.c === action.to.c)) return null;
    R.applyMove(next, action.to);
  }
  // Une position terminale n'a pas de valeur comparable sur cette echelle: la sentinelle a 1e6
  // entrait dans les moyennes et les faisait exploser (2647 de perte moyenne a profondeur 5, et
  // -2610 a profondeur 11, sur 400 positions dont un tiers sont deja resolues). On renvoie null
  // et la position entiere est ecartee, en le comptant.
  if (next.winner !== null) return null;
  Eng.clearTable();
  return -Eng.analyse(Eng.fromRules(next), { budgetMs: 1e9, maxNodes: DEEP }).score;
}

const loss = new Map(DEPTHS.map(d => [d, []]));
const reached = new Map(DEPTHS.map(d => [d, []]));
const full = new Map(), prov = new Map();   // profondeur demandee vraiment atteinte / score prouve
const agree = new Map(DEPTHS.map(d => [d, 0]));   // meme coup que le juge: la mesure robuste
let skipped = 0;
// Au-dela de ce seuil le score dit "gagne" ou "perdu" et non "vaut tant": une difference de
// points n'y a pas de sens, donc la position sort de la moyenne.
const PROVEN_LIKE = 100000;
let used = 0;
for (let i = 0; used < N && i < toks.length; i++) {
  let s;
  try { s = L.decodePos(R, toks[(i * 7919) % toks.length]); } catch (e) { continue; }
  if (s.winner !== null) continue;
  // La reference: le juge choisit, et sa valeur est la meilleure qu'on sache atteindre ici.
  Eng.clearTable();
  const ref = Eng.analyse(Eng.fromRules(s), { budgetMs: 1e9, maxNodes: DEEP });
  if (ref.best === Eng.MOVE_NONE) continue;
  const refAction = Eng.toAction(Eng.fromRules(s), ref.best);
  const vRef = valueAfter(s, refAction);
  if (vRef === null) { skipped++; continue; }
  if (Math.abs(vRef) >= PROVEN_LIKE) { skipped++; continue; }

  const cache = new Map();          // un coup juge une seule fois, meme s'il est choisi plusieurs fois
  cache.set(L.actionId(refAction), vRef);
  let ok = true;
  const row = new Map();
  for (const d of DEPTHS) {
    Eng.clearTable();
    const p = Eng.fromRules(s);
    const r = Eng.analyse(p, { budgetMs: 1e9, maxNodes: CAP, maxDepth: d });
    if (r.best === Eng.MOVE_NONE) { ok = false; break; }
    const a = Eng.toAction(p, r.best);
    const id = L.actionId(a);
    if (!cache.has(id)) {
      const v = valueAfter(s, a);
      if (v === null || Math.abs(v) >= PROVEN_LIKE) { ok = false; break; }
      cache.set(id, v);
    }
    if (id === L.actionId(refAction)) agree.set(d, agree.get(d) + 1);
    row.set(d, { l: vRef - cache.get(id), dep: r.depth, prov: !!r.proven });
  }
  if (!ok) { skipped++; continue; }
  used++;
  for (const d of DEPTHS) {
    loss.get(d).push(row.get(d).l);
    reached.get(d).push(row.get(d).dep);
    if (row.get(d).dep >= d) full.set(d, (full.get(d) || 0) + 1);
    if (row.get(d).prov) prov.set(d, (prov.get(d) || 0) + 1);
  }
  if (used % 10 === 0) process.stderr.write(used + '/' + N + '\n');
}

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
console.log(`${used} positions gardees, ${skipped} ecartees (deja gagnees ou perdues), juge a ${DEEP} noeuds`);
console.log('prof  parite  perte moyenne  mediane  MEME COUP QUE LE JUGE  prof. atteinte  demandee atteinte');
for (const d of DEPTHS) {
  const a = loss.get(d);
  const pc = x => (100 * x / (a.length || 1)).toFixed(0) + '%';
  console.log(String(d).padStart(4) + '  ' + (d % 2 ? 'impair' : 'pair  ') + '  ' +
    mean(a).toFixed(1).padStart(13) + '  ' + String(med(a)).padStart(7) + '  ' +
    (agree.get(d) + '/' + a.length + ' (' + pc(agree.get(d)) + ')').padStart(21) + '  ' +
    mean(reached.get(d)).toFixed(2).padStart(14) +
    '  ' + ((full.get(d) || 0) + '/' + a.length).padStart(17));
}
// Le test en une ligne: une profondeur paire fait-elle PIRE que l'impaire juste en dessous ?
console.log('\ndents de scie (une profondeur paire pire que l impaire d en dessous) :');
for (const d of DEPTHS) {
  if (d % 2 === 0 && loss.has(d - 1)) {
    const a = mean(loss.get(d - 1)), b = mean(loss.get(d));
    console.log(`  ${d - 1} -> ${d} : ${a.toFixed(1)} -> ${b.toFixed(1)}  ${b > a ? 'OUI, elle perd plus' : 'non, elle perd moins'}`);
  }
}
