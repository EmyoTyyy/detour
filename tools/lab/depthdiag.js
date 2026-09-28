// La profondeur atteinte a budget de noeuds EGAL.
//
// Un alpha-beta ne doit sa vitesse qu'aux coupures, et une coupure n'est possible que si
// l'evaluation des feuilles est STABLE: deux positions voisines doivent recevoir des valeurs
// voisines, sinon aucune borne ne tient et il faut tout explorer. Une evaluation plus juste mais
// plus bruyante peut donc coûter enormement de profondeur au meme nombre de noeuds -- et une
// recherche moins profonde joue plus mal, quelle que soit la qualite de son evaluation.
//
// C'est la seule explication qui reste compatible avec les mesures: le reseau a cible de recherche
// classe les coups aussi bien que le reseau livre (53 % contre 53 %) et perd quand meme 545 Elo a
// noeuds egaux. Si sa profondeur s'effondre, tout s'explique.
const L = require('./lib.js'), D = require('./duel.js');

const engines = [
  ['moteur livre (reseau 14)', L.loadEngine(undefined, { weights: 'path/netweights.js' })],
  ['fait main (aucun reseau)', L.loadEngine(undefined, { weights: false })],
  ['NNUE cible issue', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_short.js' })],
  ['NNUE cible recherche', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_score.js' })],
];
const R = engines[0][1].Rules;
const NODES = Number(process.env.NODES || 32000);
const POS = Number(process.env.POS || 20);

// Les memes positions pour tout le monde.
const probes = [];
for (let g = 0; g < POS * 3 && probes.length < POS; g++) {
  const rnd = L.rng(130000 + g);
  const s = D.makeOpening(engines[0][1], L.startState(R), 4 + ((rnd() * 22) | 0), rnd);
  if (s.winner == null) probes.push(R.serState(s));
}

console.log(`${probes.length} positions, ${NODES} noeuds chacune\n`);
console.log('                              profondeur moyenne   min   max');
for (const [nom, A] of engines) {
  const E = A.Engine;
  const d = [];
  for (const snap of probes) {
    E.clearTable();
    const r = E.analyse(E.fromRules(R.deState(snap)), { budgetMs: 1e9, maxNodes: NODES });
    d.push(r.depth);
  }
  const moy = d.reduce((a, b) => a + b, 0) / d.length;
  console.log(`  ${nom.padEnd(28)}${moy.toFixed(2).padStart(8)}       ${Math.min(...d)}     ${Math.max(...d)}`);
}
