// Avant de laisser une partie s'arreter sur un resultat "prouve", il faut verifier que le
// vainqueur annonce est bien celui qui gagne si on joue jusqu'au bout. Une erreur de signe ici
// inverserait SILENCIEUSEMENT l'etiquette de toutes les positions de ces parties -- exactement
// le genre de faute qui ne se voit qu'au moment ou le reseau sort a l'envers.
const L = require('/home/emyot/detour/tools/lab/lib.js');
const D = require('/home/emyot/detour/tools/lab/duel.js');
const A = L.loadEngine(undefined, { weights: false });
const E = A.Engine;
const PLAY = 120000;
let verifiees = 0, accord = 0, desaccord = 0, jamaisProuve = 0, gainPlys = 0, totalPlys = 0;
for (let g = 0; g < 120; g++) {
  const rnd = L.rng(999 * 7919 + g);
  const s = D.makeOpening(A, L.startState(A.Rules), 2 + ((rnd() * 7) | 0), rnd);
  if (s.winner != null) continue;
  let prouveA = null, plyProuve = -1, ply = 0;
  E.clearTable();
  for (; ply < 200 && s.winner == null; ply++) {
    const pos = E.fromRules(s);
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: PLAY, noise: 60 });
    if (prouveA === null && r.proven) {
      // score du point de vue du joueur au trait
      prouveA = r.score > 0 ? pos.turn : 1 - pos.turn;
      plyProuve = ply;
    }
    L.applyAction(A.Rules, s, E.toAction(pos, r.best));
  }
  totalPlys += ply;
  if (prouveA === null) { jamaisProuve++; console.log(`partie ${g}: jamais prouvee, vainqueur reel ${s.winner}`); continue; }
  verifiees++;
  gainPlys += ply - plyProuve;
  if (s.winner === null) { console.log(`  partie ${g}: prouvee joueur ${prouveA} au coup ${plyProuve}, mais jouee jusqu'au bout SANS vainqueur (etait jetee)`); accord++; }
  else if (s.winner === prouveA) { accord++; console.log(`partie ${g}: prouve ${prouveA} au coup ${plyProuve}/${ply} -> reel ${s.winner}  ACCORD`); }
  else { desaccord++; console.log(`  DESACCORD partie ${g}: prouve ${prouveA} au coup ${plyProuve}, reel ${s.winner}`); }
}
console.log();
console.log(`parties avec un resultat prouve : ${verifiees}  (jamais prouve: ${jamaisProuve})`);
console.log(`  accord avec le resultat joue  : ${accord}`);
console.log(`  desaccord                     : ${desaccord}`);
console.log(`demi-coups joues apres la preuve : ${gainPlys} sur ${totalPlys} (${Math.round(100*gainPlys/totalPlys)}% economisables)`);
