// Le JS reproduit-il l'ajustement fait en Python ?
//
// Dans le moteur, le score d'ordre d'un MUR porte en plus le terme `history`, que l'ajustement n'a
// jamais vu: il est appris pendant la recherche, pas sur les donnees. Les coups de PION n'en ont
// pas. Ce desequilibre peut suffire a faire changer le premier de la liste.
//
// Ici on calcule le score du modele SEUL, sans history, exactement comme en Python. Si le premier
// tombe sur les 40,3 % annonces, l'implementation est bonne et l'ecart vient de history. Sinon
// c'est mon JS qui est faux, et la mesure dans le moteur mesurerait un bug.
const L = require('./lib.js');
const fs = require('fs');
const N = Number(process.env.N || 20000);
const DIR = process.env.SRC || 'data/scored';
const OW = [-70796, 16759, 374756, 62012, -18491, 650, 2759, -8131, -2130, 19370, 5712, 789, 0, 0];

const E = L.loadEngine('tools/lab/variants/engine-order.js', { weights: false });
const R = E.Rules, Eng = E.Engine;

const rows = [];
for (const f of fs.readdirSync(DIR).sort()) {
  if (!f.endsWith('.csv')) continue;
  for (const line of fs.readFileSync(DIR + '/' + f, 'utf8').split('\n')) {
    const c = line.split(',');
    if (c.length < 4) continue;
    const tok = c[1], id = Number(c[3]);
    if (!tok || tok.length !== L.POS_LEN || !Number.isFinite(id) || id < 0) continue;
    rows.push([tok, id]);
    if (rows.length >= N) break;
  }
  if (rows.length >= N) break;
}

let used = 0, t1 = 0, t3 = 0, t5 = 0, rangTot = 0;
for (const [tok, id] of rows) {
  let s; try { s = L.decodePos(R, tok); } catch (e) { continue; }
  if (s.winner !== null) continue;
  const want = L.actionFromId(id);
  if (!want) continue;
  const pos = Eng.fromRules(s);
  Eng.clearTable();
  Eng.analyse(pos, { budgetMs: 1e9, maxNodes: 1, maxDepth: 1 });
  const n = Eng.genMoves(pos, 0, Eng.MOVE_NONE, 1);
  if (!n) continue;
  let target = -1;
  try { target = Eng.fromAction(pos, want); } catch (e) { continue; }
  const me = pos.turn, opp = 1 - me, cols = pos.cols, JW = pos.JW, JH = pos.JH, JN = pos.JN;
  const myRow = (pos.pawn[me] / cols) | 0, myCol = pos.pawn[me] - myRow * cols;
  const opRow = (pos.pawn[opp] / cols) | 0, opCol = pos.pawn[opp] - opRow * cols;
  const goal = pos.goalRow[me];
  const opDown = pos.goalRow[opp] > opRow ? 1 : 0;
  const mark = Eng._wallMark, buf = Eng.moveBuf[0];
  const cl6 = v => (v > 6 ? 6 : v);
  const paires = [];
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    let sc = 0;
    if (Eng.mvKind(m) === 1) {
      const o = Eng.mvOrient(m), j = Eng.mvIndex(m);
      const jr = (j / JW) | 0, jc = j - jr * JW;
      const tag = mark[o * JN + j];
      sc = OW[0]
         + ((tag & 2) ? OW[3] : 0) + ((tag & 1) ? OW[4] : 0) + ((tag & 4) ? OW[5] : 0)
         + (o ? OW[6] : 0)
         + OW[7] * cl6(Math.max(Math.abs(jr - opRow), Math.abs(jc - opCol)))
         + OW[8] * cl6(Math.max(Math.abs(jr - myRow), Math.abs(jc - myCol)))
         + ((jc === 0 || jc === JW - 1) ? OW[9] : 0)
         + ((jr === 0 || jr === JH - 1) ? OW[10] : 0)
         + ((o === 0 && (opDown ? jr >= opRow : jr < opRow)) ? OW[11] : 0);
    } else {
      const tr = (Eng.mvIndex(m) / cols) | 0;
      sc = OW[1] * (Math.abs(myRow - goal) - Math.abs(tr - goal)) + (tr === goal ? OW[2] : 0);
    }
    paires.push([m, sc]);
  }
  paires.sort((a, b) => b[1] - a[1]);
  let rang = -1;
  for (let i = 0; i < paires.length; i++) if (paires[i][0] === target) { rang = i; break; }
  if (rang < 0) continue;
  used++; rangTot += rang;
  if (rang === 0) t1++;
  if (rang < 3) t3++;
  if (rang < 5) t5++;
}
const pc = x => (100 * x / (used || 1)).toFixed(1) + '%';
console.log(used + ' positions, modele SEUL (sans history)');
console.log('  premier    : ' + pc(t1) + '   (Python annonce 40.3% sur son jeu de test)');
console.log('  dans les 3 : ' + pc(t3) + '   (Python 60.6%)');
console.log('  dans les 5 : ' + pc(t5) + '   (Python 73.1%)');
console.log('  rang moyen : ' + (rangTot / (used || 1)).toFixed(2) + '   (Python 4.52)');
