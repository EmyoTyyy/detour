// Le budget est-il vraiment depense, et pour quelle profondeur ?
//
// Un cycle intransitif de 275 Elo entre trois moteurs n'est pas une question de style: c'est le
// signe qu'une des trois mesures ne mesure pas la force. La premiere chose a verifier est que les
// trois moteurs recoivent VRAIMENT le meme budget -- un moteur qui s'arrete a 12 000 noeuds quand
// on lui en donne 32 000 joue un autre match que celui qu'on croit arbitrer.
const L = require('./lib.js'), D = require('./duel.js');

const engines = [
  ['fait main (aucun reseau)', L.loadEngine('path/engine.js', { weights: false })],
  ['moteur livre (reseau 14)', L.loadEngine('path/engine.js', { weights: 'path/netweights.js' })],
  ['NNUE RESIDUEL', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_resid.js' })],
];
const R = engines[0][1].Rules;
const NODES = Number(process.env.NODES || 32000);
const POS = Number(process.env.POS || 25);

const probes = [];
for (let g = 0; g < POS * 3 && probes.length < POS; g++) {
  const rnd = L.rng(130000 + g);
  const s = D.makeOpening(engines[0][1], L.startState(R), 4 + ((rnd() * 22) | 0), rnd);
  if (s.winner == null) probes.push(R.serState(s));
}

const moy = x => x.reduce((a, b) => a + b, 0) / (x.length || 1);
console.log(`${probes.length} positions, budget ${NODES} noeuds\n`);
console.log('                              profondeur   noeuds reellement explores   ms');
for (const [nom, A] of engines) {
  const E = A.Engine;
  const d = [], n = [], ms = [];
  for (const snap of probes) {
    E.clearTable();
    const t0 = Date.now();
    const r = E.analyse(E.fromRules(R.deState(snap)), { budgetMs: 1e9, maxNodes: NODES });
    ms.push(Date.now() - t0);
    d.push(r.depth);
    n.push(r.nodes != null ? r.nodes : NaN);
  }
  const nn = n.filter(x => !Number.isNaN(x));
  console.log(`  ${nom.padEnd(26)}   ${moy(d).toFixed(2).padStart(6)}      ` +
    `${(nn.length ? moy(nn).toFixed(0) : 'non rapporte').padStart(12)}   ${moy(ms).toFixed(0)}`);
}
