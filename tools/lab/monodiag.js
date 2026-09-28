// Avancer vers son but ameliore-t-il l'evaluation ?
//
// C'est la propriete la plus elementaire qu'on demande a une evaluation de Quoridor, et aucune des
// mesures faites jusqu'ici ne la teste: on peut se tromper de peu partout, classer correctement les
// coups d'une position, atteindre la bonne profondeur, et ne toujours pas donner a la recherche la
// moindre raison de rentrer chez soi. Le moteur ne gagne pas en ayant raison, il gagne en arrivant.
//
// Indice: le NNUE contre lui-meme produit 4 nulles sur 32 parties -- 300 demi-coups sans vainqueur
// -- la ou tous les autres matchs en produisent zero. Deux moteurs qui n'avancent pas ne finissent
// jamais; contre un adversaire qui avance, on perd.
//
// Test: pour chaque position, tous les coups de pion qui RACCOURCISSENT strictement le plus court
// chemin vers le but. L'evaluation doit monter. On compte combien de fois elle monte.
const L = require('./lib.js'), D = require('./duel.js');

const evals = [
  ['fait main', L.loadEngine(undefined, { weights: false })],
  ['reseau livre (14)', L.loadEngine(undefined, { weights: 'path/netweights.js' })],
  ['NNUE cible issue', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_short.js' })],
  ['NNUE cible recherche', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_score.js' })],
  ['NNUE regression', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_reg.js' })],
];
const R = evals[0][1].Rules;
const N = Number(process.env.N || 120);

const probes = [];
for (let g = 0; probes.length < N && g < N * 4; g++) {
  const rnd = L.rng(160000 + g);
  const s = D.makeOpening(evals[0][1], L.startState(R), 4 + ((rnd() * 24) | 0), rnd);
  if (s.winner == null) probes.push(R.serState(s));
}

const stat = evals.map(() => ({ up: 0, tot: 0, gain: [] }));
for (const snap of probes) {
  const s = R.deState(snap);
  const E0 = evals[0][1].Engine;
  const p0 = E0.fromRules(s);
  const me = p0.turn;
  const avant = E0.pathLen(p0, me);
  // Les coups de pion qui raccourcissent strictement le chemin.
  const buf = new Int32Array(32);
  const n = E0.pawnMoves(p0, me, buf);
  const gagnants = [];
  for (let i = 0; i < n; i++) {
    const s2 = R.deState(snap);
    R.applyMove(s2, { r: (buf[i] / 9) | 0, c: buf[i] % 9 });
    const q = E0.fromRules(s2);
    if (s2.winner != null || E0.pathLen(q, me) < avant) gagnants.push(R.serState(s2));
  }
  if (!gagnants.length) continue;
  evals.forEach(([, A], k) => {
    const E = A.Engine;
    const base = E.evaluate(E.fromRules(R.deState(snap)));
    for (const g2 of gagnants) {
      const s2 = R.deState(g2);
      // Apres le coup c'est l'autre au trait: la valeur pour NOUS est l'oppose.
      const apres = s2.winner != null ? 1e6 : -E.evaluate(E.fromRules(s2));
      stat[k].tot++;
      if (apres > base) stat[k].up++;
      if (Math.abs(apres) < 1e5 && Math.abs(base) < 1e5) stat[k].gain.push(apres - base);
    }
  });
}

const moy = x => x.length ? Math.round(x.reduce((p, c) => p + c, 0) / x.length) : 0;
console.log(`${probes.length} positions, ${stat[0].tot} coups qui rapprochent strictement du but\n`);
console.log('                          l evaluation monte    gain moyen');
evals.forEach(([nom], k) => {
  const s = stat[k];
  console.log(`  ${nom.padEnd(22)}      ${(100 * s.up / (s.tot || 1)).toFixed(0).padStart(4)}%          ${String(moy(s.gain)).padStart(6)}`);
});
