// Pourquoi 31 % des parties contre Ishtar n'ont jamais fini ?
//
// Deux explications, et elles n'appellent pas le meme remede:
//   a) la position est VRAIMENT bloquee -- les deux camps ont mure le plateau et plus personne ne
//      peut passer. Alors 300 coups est juste un plafond mal choisi et il n'y a rien a corriger
//      dans le moteur.
//   b) Path TOURNE EN ROND: il a une route, il pourrait avancer, et il fait l'aller-retour. Le
//      moteur a deja eu exactement ce defaut dans les positions perdues (corrige), et il
//      reapparaitrait ici dans les positions nulles.
//
// On tranche sans toucher au serveur d'Ishtar: Path contre lui-meme, sur LES MEMES ouvertures
// (meme graine, meme nombre de demi-coups), et on regarde les parties qui n'aboutissent pas. Pour
// chacune: les deux camps ont-ils encore un chemin, de quelle longueur, et les vingt derniers
// coups sont-ils une repetition ?
const L = require('./lib.js'), D = require('./duel.js');
const PAIRS = Number(process.env.PAIRS || 32);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const MAXPLY = Number(process.env.MAXPLY || 300);

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;

function jouer(snap) {
  const s = R.deState(snap);
  E.clearTable();
  const vus = [];
  for (let ply = 0; ply < MAXPLY; ply++) {
    if (s.winner != null) return { fini: true, ply, s, vus };
    const pos = E.fromRules(s);
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
    L.applyAction(R, s, E.toAction(pos, r.best));
    vus.push(s.pawns.map(p => p.r + ',' + p.c).join(' ') + '|' + s.hWalls.size + ',' + s.vWalls.size);
  }
  return { fini: false, ply: MAXPLY, s, vus };
}

let finies = 0, bloquees = 0, tournent = 0;
const details = [];
for (let p = 0; p < PAIRS; p++) {
  const rnd = L.rng(SEED * 7919 + p);
  const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
  if (base.winner != null) continue;
  const g = jouer(R.serState(base));
  if (g.fini) { finies++; continue; }
  const s = g.s;
  const d0 = R.pathLength(s, 0), d1 = R.pathLength(s, 1);
  const mursRestants = s.walls.join('/');
  // Les vingt derniers etats: combien de positions DISTINCTES ? Peu = on tourne en rond.
  const fin = g.vus.slice(-20);
  const distinctes = new Set(fin).size;
  // Et le plateau avance-t-il encore ? Si aucun mur n'a ete pose sur les 20 derniers coups et que
  // les pions reviennent sur leurs pas, personne ne tente plus rien.
  const mursBouge = new Set(fin.map(x => x.split('|')[1])).size > 1;
  const enRond = distinctes <= 6 && !mursBouge;
  if (enRond) tournent++; else bloquees++;
  details.push(`  paire ${String(p).padStart(2)}  chemin p0=${d0 === Infinity ? 'AUCUN' : d0} p1=${d1 === Infinity ? 'AUCUN' : d1}` +
    `  murs en main ${mursRestants}  etats distincts sur 20 derniers: ${distinctes}` +
    `  ${enRond ? '<= TOURNE EN ROND' : '<= bloquee'}`);
  process.stderr.write(`\rpaire ${p + 1}/${PAIRS}  finies ${finies}  inachevees ${tournent + bloquees}`);
}
process.stderr.write('\r');
console.log(`${PAIRS} ouvertures, Path contre lui-meme a ${NODES} noeuds, plafond ${MAXPLY} demi-coups`);
console.log(`  terminees            : ${finies}`);
console.log(`  inachevees           : ${tournent + bloquees}`);
console.log(`    dont vraiment bloquees : ${bloquees}`);
console.log(`    dont Path tourne en rond: ${tournent}`);
if (details.length) { console.log(''); console.log('detail des inachevees:'); for (const d of details) console.log(d); }
