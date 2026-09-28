// Le moteur se ment-il a lui-meme ?
//
// Une recherche maximise son evaluation. Si celle-ci se trompe quelque part en sa faveur, la
// recherche trouvera cet endroit -- non pas par hasard, mais parce que c'est exactement ce qu'elle
// cherche. L'erreur moyenne sur des positions tirees au hasard ne verra jamais rien: il faut
// comparer ce que le moteur ANNONCE au terme de sa recherche avec ce qu'un arbitre plus profond
// dit de la meme position. Un moteur sain est a peu pres sans biais. Un moteur qui exploite les
// trous de son evaluation annonce systematiquement mieux que la verite.
const L = require('./lib.js'), D = require('./duel.js');

const arb = L.loadEngine(undefined, { weights: 'path/netweights.js' });   // arbitre, profond
const cands = [
  ['moteur livre', L.loadEngine(undefined, { weights: 'path/netweights.js' })],
  ['NNUE cible recherche', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_score.js' })],
  ['NNUE regression', L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_reg.js' })],
];
const R = arb.Rules;
const NODES = Number(process.env.NODES || 32000);
const REF = Number(process.env.REF || 300000);
const N = Number(process.env.N || 24);

const probes = [];
for (let g = 0; probes.length < N && g < N * 4; g++) {
  const rnd = L.rng(150000 + g);
  const s = D.makeOpening(arb, L.startState(R), 6 + ((rnd() * 20) | 0), rnd);
  if (s.winner == null) probes.push(R.serState(s));
}

const biais = cands.map(() => []);
for (const snap of probes) {
  const s0 = R.deState(snap);
  arb.Engine.clearTable();
  const verite = arb.Engine.analyse(arb.Engine.fromRules(s0), { budgetMs: 1e9, maxNodes: REF }).score;
  if (Math.abs(verite) > 900000) continue;
  cands.forEach(([, A], i) => {
    const E = A.Engine;
    E.clearTable();
    const mien = E.analyse(E.fromRules(R.deState(snap)), { budgetMs: 1e9, maxNodes: NODES }).score;
    if (Math.abs(mien) < 900000) biais[i].push(mien - verite);
  });
}
const moy = x => x.length ? Math.round(x.reduce((p, c) => p + c, 0) / x.length) : 0;
const absmoy = x => x.length ? Math.round(x.reduce((p, c) => p + Math.abs(c), 0) / x.length) : 0;
console.log(`${probes.length} positions. Le moteur cherche a ${NODES} noeuds, l arbitre a ${REF}.\n`);
console.log('                          biais (annonce - verite)   erreur absolue   trop optimiste');
cands.forEach(([nom], i) => {
  const b = biais[i];
  const opt = b.filter(x => x > 0).length;
  console.log(`  ${nom.padEnd(22)}  ${String(moy(b)).padStart(9)}` +
    `              ${String(absmoy(b)).padStart(6)}          ${(100 * opt / (b.length || 1)).toFixed(0)}%`);
});
