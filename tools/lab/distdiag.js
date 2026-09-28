// Le reseau est-il fiable AILLEURS que sur les positions dont il a appris ?
//
// Une evaluation faite main est une formule: elle vaut ce qu'elle vaut, mais elle vaut la meme
// chose partout. Un reseau n'est fiable que la ou il a vu des donnees. Or il est entraine sur des
// positions de PARTIES -- des positions qu'un joueur de 120 000 noeuds a vraiment jouees -- et il
// est interroge sur des positions de RECHERCHE, a neuf demi-coups de la racine, atteintes par des
// coups que personne ne jouerait et que la recherche n'explore que pour les refuter.
//
// Si l'erreur explose sur ces positions-la, tout s'explique: la recherche maximise l'evaluation,
// donc elle trouve exactement les endroits ou le reseau se trompe en sa faveur, et elle y va.
// C'est ce qu'on a vu dans la partie -- le reseau annonce +600 la ou la verite est +50.
const L = require('./lib.js'), D = require('./duel.js');
const fs = require('fs');

const ref = L.loadEngine(undefined, { weights: false });          // l'arbitre: recherche profonde
const nets = [
  ['NNUE cible recherche', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_score.js' })],
  ['NNUE regression', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_reg.js' })],
  ['reseau livre (14)', L.loadEngine(undefined, { weights: 'path/netweights.js' })],
  ['fait main', L.loadEngine(undefined, { weights: false })],
];
const R = ref.Rules;
const DEEP = Number(process.env.DEEP || 60000);
const N = Number(process.env.N || 60);

// (a) des positions de partie: exactement la distribution d'entrainement.
const jeu = [];
{
  const lines = fs.readFileSync('data/deep_lenovo/pos_4000.csv', 'utf8').split('\n');
  for (let i = 0; jeu.length < N && i < lines.length; i += 37) {
    const t = lines[i].slice(0, 39);
    if (t.length === 39) jeu.push(t);
  }
}
// (b) des positions de recherche: depuis une position de partie, une marche ALEATOIRE de quelques
// demi-coups parmi les coups legaux. C'est ce que fait un arbre: il joue des coups que personne ne
// jouerait, pour voir.
const arbre = [];
{
  let g = 0;
  while (arbre.length < N && g < N * 6) {
    const rnd = L.rng(140000 + g++);
    const s = D.makeOpening(ref, L.startState(R), 6 + ((rnd() * 16) | 0), rnd);
    if (s.winner != null) continue;
    const E = ref.Engine;
    let ok = true;
    for (let k = 0; k < 4 + ((rnd() * 6) | 0); k++) {
      const pos = E.fromRules(s);
      const buf = E.moveBuf[0], n = E.genMoves(pos, 0, 0, 4);
      if (!n) { ok = false; break; }
      L.applyAction(R, s, E.toAction(pos, buf[(rnd() * n) | 0]));
      if (s.winner != null) { ok = false; break; }
    }
    if (ok) arbre.push(L.encodePos(s));
  }
}

function mesure(tokens) {
  const out = nets.map(() => []);
  for (const t of tokens) {
    const s = L.decodePos(R, t);
    const pr = ref.Engine.fromRules(s);
    ref.Engine.clearTable();
    const verite = ref.Engine.analyse(pr, { budgetMs: 1e9, maxNodes: DEEP }).score;
    if (Math.abs(verite) > 900000) continue;          // position prouvee: le reseau n'y est pas appele
    nets.forEach(([, A], i) => {
      const E = A.Engine, p = E.fromRules(s);
      out[i].push(Math.abs(E.evaluate(p) - verite));
    });
  }
  return out;
}

const a = mesure(jeu), b = mesure(arbre);
const moy = x => x.length ? Math.round(x.reduce((p, c) => p + c, 0) / x.length) : 0;
const med = x => { const y = [...x].sort((p, c) => p - c); return y.length ? Math.round(y[y.length >> 1]) : 0; };
console.log(`arbitre: recherche a ${DEEP} noeuds. Erreur absolue en points de score.\n`);
console.log('                            positions de PARTIE      positions d ARBRE      rapport');
nets.forEach(([nom], i) => {
  const ma = moy(a[i]), mb = moy(b[i]);
  console.log(`  ${nom.padEnd(24)}  ${String(ma).padStart(6)} (med ${String(med(a[i])).padStart(4)})` +
    `      ${String(mb).padStart(6)} (med ${String(med(b[i])).padStart(4)})      ${(mb / (ma || 1)).toFixed(2)}x`);
});
console.log(`\n(${a[0].length} positions de partie, ${b[0].length} positions d arbre)`);
