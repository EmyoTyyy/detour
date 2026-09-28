// Une evaluation peut etre meilleure a predire l'issue d'une partie et pire a jouer.
//
// Predire, c'est repondre "qui gagne" sur une position tiree d'une vraie partie. Jouer, c'est
// SEPARER les coups d'une meme position -- et ces deux qualites n'ont pas de raison d'aller
// ensemble. Une evaluation entrainee sur des issues avec une entropie croisee sature: elle dit
// "gagnant" avec confiance et ne distingue plus deux positions gagnantes, alors que la recherche
// ne lui demande que ca. Une evaluation faite main avec un terme de distance, elle, ordonne les
// coups meme quand elle se trompe sur l'issue.
//
// Trois mesures par position: l'ecart-type des evaluations sur les coups legaux (de quoi la
// recherche dispose pour choisir), le coup que choisirait chaque evaluation a un demi-coup, et
// s'il coincide avec celui d'une recherche profonde.
const L = require('./lib.js'), D = require('./duel.js');

const base = L.loadEngine(undefined, { weights: 'path/netweights.js' });
const nn = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_short.js' });
// L'evaluation faite main, sans aucun reseau: il faut savoir ou est la barre avant de dire qu'on
// est dessous. Le reseau livre a ete distille d'une recherche, donc il est cense imiter ce qu'une
// recherche prefere; l'evaluation faite main n'a jamais eu cet objectif. Si elle fait aussi bien,
// alors 56 % n'est pas une performance du reseau mais le plafond de l'exercice a un demi-coup.
const hand = L.loadEngine(undefined, { weights: false });
// Le meme reseau de plateau, mais entraine sur le SCORE d'une recherche au lieu de l'issue de la
// partie. C'est le test direct de l'hypothese: une recherche demande a son evaluation de feuille
// d'approximer ce qu'une recherche plus profonde repondrait, pas de deviner qui gagnera. Entraine
// sur douze fois moins de lignes, donc il predira moins bien -- ce qu'on regarde ici n'est pas sa
// perte, c'est s'il CLASSE mieux les coups.
const sc = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_score.js' });
// Et le meme, entraine en REGRESSION sur le score au lieu d'une entropie croisee sur une
// probabilite. La difference n'est pas la cible mais l'amplitude: une cible en probabilite sature,
// donc le reseau n'apprend jamais a dire "gagne", seulement "un peu mieux".
const rg = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_reg.js' });
// Et le residuel: le reseau n'est plus l'evaluation, il en est la CORRECTION. La formule garde la
// distance, le tempo et l'echelle sur laquelle les marges d'elagage ont ete reglees; le reseau ne
// peut plus que les deplacer. Un reseau qui n'apprend rien redonne exactement la ligne "fait main".
const rs = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: 'tools/lab/nnue_w_resid.js' });
const R = base.Rules;
const DEEP = Number(process.env.DEEP || 150000);
const N = Number(process.env.POS || 30);

function greedy(eng, s) {
  const E = eng.Engine, pos = E.fromRules(s);
  const buf = E.moveBuf[0], n = E.genMoves(pos, 0, 0, 4);
  const moves = Array.from(buf.slice(0, n));
  let best = null, bestV = -Infinity;
  const vals = [];
  for (const m of moves) {
    const from = pos.pawn[pos.turn];
    E.makeMove(pos, m);
    const v = pos.winner >= 0 ? 1e9 : -E.evaluate(pos);   // apres le coup, c'est l'autre au trait
    E.unmakeMove(pos, m, from);
    vals.push(v);
    if (v > bestV) { bestV = v; best = m; }
  }
  const fin = vals.filter(v => Math.abs(v) < 1e8);
  const moy = fin.reduce((a, b) => a + b, 0) / (fin.length || 1);
  const sd = Math.sqrt(fin.reduce((a, b) => a + (b - moy) * (b - moy), 0) / (fin.length || 1));
  return { best: E.toAction(pos, best), sd, n: moves.length, amp: fin.length ? Math.max(...fin) - Math.min(...fin) : 0 };
}

const same = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);
let okBase = 0, okNn = 0, okHand = 0, okSc = 0, okRg = 0, okRs = 0, tot = 0;
const sdB = [], sdN = [], sdH = [], sdS = [], sdR = [], sdX = [];
const ampB = [], ampN = [], ampH = [], ampS = [], ampR = [], ampX = [];
for (let g = 0; g < N * 3 && tot < N; g++) {
  const rnd = L.rng(95000 + g);
  const s = D.makeOpening(base, L.startState(R), 6 + ((rnd() * 22) | 0), rnd);
  if (s.winner != null) continue;
  const pb = base.Engine.fromRules(s);
  const deep = base.Engine.analyse(pb, { budgetMs: 1e9, maxNodes: DEEP });
  const truth = base.Engine.toAction(pb, deep.best);
  const gb = greedy(base, s), gn = greedy(nn, s), gh = greedy(hand, s), gs = greedy(sc, s);
  if (same(gs.best, truth)) okSc++;
  sdS.push(gs.sd); ampS.push(gs.amp);
  const gr = greedy(rg, s);
  if (same(gr.best, truth)) okRg++;
  sdR.push(gr.sd); ampR.push(gr.amp);
  const gx = greedy(rs, s);
  if (same(gx.best, truth)) okRs++;
  sdX.push(gx.sd); ampX.push(gx.amp);
  if (same(gb.best, truth)) okBase++;
  if (same(gn.best, truth)) okNn++;
  if (same(gh.best, truth)) okHand++;
  sdB.push(gb.sd); sdN.push(gn.sd); sdH.push(gh.sd);
  ampB.push(gb.amp); ampN.push(gn.amp); ampH.push(gh.amp);
  tot++;
}
const moy = x => (x.reduce((a, b) => a + b, 0) / x.length).toFixed(0);
console.log(`${tot} positions, coup de reference = recherche a ${DEEP} noeuds\n`);
console.log('                        accord avec la recherche   ecart-type sur les coups   amplitude');
console.log(`  reseau livre (14)            ${(100 * okBase / tot).toFixed(0)}%                       ${moy(sdB)}                  ${moy(ampB)}`);
console.log(`  NNUE (plateau)               ${(100 * okNn / tot).toFixed(0)}%                       ${moy(sdN)}                  ${moy(ampN)}`);
console.log(`  fait main (aucun reseau)     ${(100 * okHand / tot).toFixed(0)}%                       ${moy(sdH)}                  ${moy(ampH)}`);
console.log(`  NNUE cible RECHERCHE         ${(100 * okSc / tot).toFixed(0)}%                       ${moy(sdS)}                  ${moy(ampS)}`);
console.log(`  NNUE REGRESSION              ${(100 * okRg / tot).toFixed(0)}%                       ${moy(sdR)}                  ${moy(ampR)}`);
console.log(`  NNUE RESIDUEL (fait main +)  ${(100 * okRs / tot).toFixed(0)}%                       ${moy(sdX)}                  ${moy(ampX)}`);
