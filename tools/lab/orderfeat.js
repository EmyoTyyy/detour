// Extrait les traits de chaque coup candidat, avec l'etiquette "c'est celui que la recherche
// profonde a choisi". Un fichier par passe, une ligne par (position, candidat).
//
// Contrainte qui decide tout: ces traits sont calcules a CHAQUE noeud de la recherche, donc ils
// doivent couter quelques operations entieres. Pas de parcours de graphe, pas de BFS, rien qui
// demande de poser le mur pour voir. Tout ce qui est ici se lit dans pos ou dans les marques que
// genMoves a deja calculees pour ses trois constantes.
//
//   N=60000 OUT=order_feat.csv node orderfeat.js
const L = require('./lib.js');
const fs = require('fs');

const N = Number(process.env.N || 60000);
const DIR = process.env.SRC || 'data/scored';
const OUT = process.env.OUT || 'order_feat.csv';

const E = L.loadEngine('tools/lab/variants/engine-order.js', { weights: false });
const R = E.Rules, Eng = E.Engine;
if (!Eng.scoreBuf || !Eng._wallMark) throw new Error('relancer mkorder.js');

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

const NF = 14;
const out = [];
let used = 0, skipped = 0;
for (const [tok, id] of rows) {
  let s; try { s = L.decodePos(R, tok); } catch (e) { skipped++; continue; }
  if (s.winner !== null) { skipped++; continue; }
  const want = L.actionFromId(id);
  if (!want) { skipped++; continue; }
  const pos = Eng.fromRules(s);
  Eng.clearTable();
  Eng.analyse(pos, { budgetMs: 1e9, maxNodes: 1, maxDepth: 1 });   // vide killers/history
  const n = Eng.genMoves(pos, 0, Eng.MOVE_NONE, 1);
  if (!n) { skipped++; continue; }
  let target = -1;
  try { target = Eng.fromAction(pos, want); } catch (e) { skipped++; continue; }

  const me = pos.turn, opp = 1 - me, cols = pos.cols, JW = pos.JW, JH = pos.JH, JN = pos.JN;
  const myRow = (pos.pawn[me] / cols) | 0, myCol = pos.pawn[me] - myRow * cols;
  const opRow = (pos.pawn[opp] / cols) | 0, opCol = pos.pawn[opp] - opRow * cols;
  const myGoal = pos.goalRow[me], opGoal = pos.goalRow[opp];
  const opDir = opGoal > opRow ? 1 : -1;        // vers ou l'adversaire avance
  const mark = Eng._wallMark;
  const buf = Eng.moveBuf[0];
  const clamp6 = v => (v > 6 ? 6 : v);
  let found = false;
  const bloc = [];
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const f = new Array(NF).fill(0);
    if (Eng.mvKind(m) === 1) {
      const o = Eng.mvOrient(m), j = Eng.mvIndex(m);
      const jr = (j / JW) | 0, jc = j - jr * JW;
      const tag = mark[o * JN + j];
      f[0] = 1;
      f[3] = (tag & 2) ? 1 : 0;
      f[4] = (tag & 1) ? 1 : 0;
      f[5] = (tag & 4) ? 1 : 0;
      f[6] = o;
      f[7] = clamp6(Math.max(Math.abs(jr - opRow), Math.abs(jc - opCol)));
      f[8] = clamp6(Math.max(Math.abs(jr - myRow), Math.abs(jc - myCol)));
      f[9] = (jc === 0 || jc === JW - 1) ? 1 : 0;
      f[10] = (jr === 0 || jr === JH - 1) ? 1 : 0;
      // la frontiere du mur horizontal est entre les rangees jr et jr+1: est-elle devant
      // l'adversaire, c'est-a-dire entre son pion et son but ?
      f[11] = (o === 0 && (opDir > 0 ? (jr >= opRow) : (jr < opRow))) ? 1 : 0;
      f[12] = pos.hand[me] / 10;
      f[13] = pos.hand[opp] / 10;
    } else {
      // Coup de pion: la case d'arrivee est mvIndex(m), car mvPawn(cell) = cell << 2. La premiere
      // version lisait `m & 2047`, qui garde les bits de type et tronque la case: le trait
      // "versBut" sortait entre +7 et -28 alors qu'un pion change d'une rangee, deux en sautant.
      // Les murs etaient bons, mais 58,5 % des etiquettes sont des coups de pion, donc le modele
      // apprenait sur du bruit pour la majorite des exemples.
      const toCell = Eng.mvIndex(m);
      const tr = (toCell / cols) | 0;
      f[1] = (Math.abs(myRow - myGoal) - Math.abs(tr - myGoal));
      f[2] = (tr === myGoal) ? 1 : 0;
      f[12] = pos.hand[me] / 10;
      f[13] = pos.hand[opp] / 10;
    }
    const best = m === target ? 1 : 0;
    if (best) found = true;
    bloc.push(used + ',' + best + ',' + f.join(','));
  }
  if (!found) { skipped++; continue; }    // etiquette hors liste: inutilisable pour l'ordre
  for (const l of bloc) out.push(l);
  used++;
  if (used % 2000 === 0) process.stderr.write(used + ' positions\n');
}
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(used + ' positions, ' + skipped + ' ecartees, ' + out.length + ' lignes -> ' + OUT);
console.log('colonnes: position,best,' + Array.from({ length: NF }, (_, i) => 'f' + i).join(','));
