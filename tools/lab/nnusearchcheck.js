// L'accumulateur pendant une VRAIE recherche.
//
// nnuecheck.js joue et annule des coups a la main, en descente ordonnee. Une recherche ne fait pas
// que ca: elle coupe des branches, relit la table de transposition, reduit, etend, abandonne en
// plein milieu d'une liste de coups. Si une seule de ces sorties saute un unmakeMove -- ou si un
// chemin change la position sans passer par makeMove -- l'accumulateur decrit une position qui
// n'est plus sur le plateau, et le moteur evalue cette autre position. Vu de l'exterieur cela
// ressemble exactement a un reseau faible.
const L = require('./lib.js'), D = require('./duel.js');
const A = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: process.env.NNUE || 'tools/lab/nnue_w_short.js' });
const E = A.Engine, R = A.Rules;
if (!E.hasNnue()) { console.error('aucun NNUE charge'); process.exit(1); }

let bad = 0, evals = 0, first = null;
E.setNnVerify((i, inc, fresh) => {
  bad++;
  if (!first) first = `indice ${i}: incremental ${inc}, recalcul ${fresh} (ecart ${inc - fresh})`;
});
const wrapped = E.nnueEval;

const NODES = Number(process.env.NODES || 20000);
const POS = Number(process.env.POS || 12);
let done = 0;
for (let g = 0; g < POS * 3 && done < POS; g++) {
  const rnd = L.rng(120000 + g);
  const s = D.makeOpening(A, L.startState(R), 4 + ((rnd() * 22) | 0), rnd);
  if (s.winner != null) continue;
  E.clearTable();
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  evals += r.nodes;
  done++;
  process.stderr.write(`\r${done}/${POS} positions`);
}
process.stderr.write('\r');
console.log(`${done} recherches a ${NODES} noeuds (${evals} noeuds au total)`);
console.log(`ecarts detectes pendant la recherche : ${bad}`);
if (first) console.log('  premier : ' + first);
console.log(bad === 0
  ? 'OK - l accumulateur reste synchronise dans une vraie recherche'
  : 'ECHEC - l accumulateur derive pendant la recherche, le reseau evalue une autre position');
process.exit(bad === 0 ? 0 : 1);
