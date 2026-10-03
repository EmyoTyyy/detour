// Les memes positions pour tout le monde.
//
// giveupdiag.js laissait chaque variante jouer sa propre partie, donc chacune etait notee sur un
// jeu de positions different: une variante qui joue mieux atteint d'autres positions perdantes, et
// la moyenne compare alors deux choses qui n'ont rien a voir. Ici le jeu de positions est produit
// UNE fois par le moteur de reference, puis chaque variante repond aux memes.
const L = require('./lib.js'), D = require('./duel.js');

const ref = L.loadEngine('tools/lab/variants/engine-base.js', { weights: 'path/netweights.js' });
const strong = L.loadEngine('path/engine.js', { weights: 'path/netweights.js' });
const R = ref.Rules;
const SN = Number(process.env.SN || 120000);
const WN = Number(process.env.WN || 6000);
const GAMES = Number(process.env.GAMES || 4);
const LOSING = Number(process.env.LOSING || 300);
const ELO = process.env.ELO ? Number(process.env.ELO) : null;
const lvlOpt = o => (ELO == null ? o : Object.assign({ elo: ELO }, o));

const distOf = (s, who) => {
  const dm = R.distanceMap(s, who);
  const d = dm.get(R.key(s.pawns[who].r, s.pawns[who].c));
  return d === undefined ? -1 : d;
};
function everyAction(s, who) {
  const out = [];
  for (const to of R.legalMoves(s, who)) out.push({ type: 'move', to });
  if (s.walls[who] > 0) for (let r = 0; r < s.rows - 1; r++) for (let c = 0; c < s.cols - 1; c++)
    for (const o of ['h', 'v']) if (R.canPlaceWall(s, who, o, r, c)) out.push({ type: 'wall', orient: o, r, c });
  return out;
}

// ---- 1. le jeu de positions, produit une seule fois ----
const probes = [];
for (let g = 0; g < GAMES; g++) {
  const rnd = L.rng(7000 + g);
  const s = D.makeOpening(strong, L.startState(R), 4, rnd);
  for (let ply = 0; ply < 160 && s.winner == null; ply++) {
    const mine = ply % 2 === 1;
    const E = (mine ? ref : strong).Engine;
    E.clearTable();
    const pos = E.fromRules(s);
    const r = E.analyse(pos, mine ? lvlOpt({ budgetMs: 1e9, maxNodes: WN }) : { budgetMs: 1e9, maxNodes: SN });
    if (mine && r.score < -LOSING) {
      let best = -1;
      for (const a of everyAction(s, s.turn)) {
        const c = R.cloneState(s); L.applyAction(R, c, a);
        const d = distOf(c, 1 - s.turn);
        if (d > best) best = d;
      }
      if (best >= 0) probes.push({ snap: R.serState(s), best, proven: Math.abs(r.score) >= E.PROVEN });
    }
    L.applyAction(R, s, E.toAction(pos, r.best));
  }
}
console.log((ELO == null ? 'pleine force' : 'niveau Elo ' + ELO) + ` -- ${probes.length} positions perdantes, identiques pour toutes les variantes `
  + `(dont ${probes.filter(p => p.proven).length} prouvees)\n`);

// ---- 2. chaque variante repond aux memes ----
const variants = (process.env.VARIANTS ||
  'variants/engine-base.js,variants/engine-giveup.js').split(',');
// Le defaut ne touche QUE les positions decidees, ou le niveau rejoue un coup a egalite de
// score. Noyees dans la moyenne generale elles ne se voient pas: il faut les compter a part.
// On regarde aussi si le pion RECULE, puisque c'est ce qui se voit a l'oeil.
const backward = (before, after, who) => after > before;
console.log('                            PROUVEES PERDUES              toutes positions');
console.log('                            retard  >=2 pas  recule       retard  >=2 pas');
for (const v of variants) {
  const A = L.loadEngine('tools/lab/' + v.trim(), { weights: 'path/netweights.js' });
  const E = A.Engine;
  let sum = 0, slack2 = 0, pSum = 0, pSlack2 = 0, pN = 0, back = 0;
  for (const p of probes) {
    const s = R.deState(p.snap);
    E.clearTable();
    const pos = E.fromRules(s);
    const r = E.analyse(pos, lvlOpt({ budgetMs: 1e9, maxNodes: WN }));
    const act = E.toAction(pos, r.best);
    const me = s.turn;
    const dmeBefore = distOf(s, me);
    const c = R.cloneState(s); L.applyAction(R, c, act);
    const got = distOf(c, 1 - me);
    const gap = Math.max(0, p.best - got);
    sum += gap;
    if (gap >= 2) slack2++;
    if (p.proven) {
      pN++; pSum += gap;
      if (gap >= 2) pSlack2++;
      if (act.type === 'move' && backward(dmeBefore, distOf(c, me), me)) back++;
    }
  }
  const n = probes.length || 1, m = pN || 1;
  console.log(`  ${v.replace('variants/engine-', '').replace('.js', '').padEnd(24)}`
    + `${(pSum / m).toFixed(2).padStart(6)}  ${String(pSlack2).padStart(3)} (${(100 * pSlack2 / m).toFixed(0).padStart(2)}%)  ${String(back).padStart(3)} (${(100 * back / m).toFixed(0).padStart(2)}%)`
    + `      ${(sum / n).toFixed(2).padStart(5)}  ${String(slack2).padStart(3)} (${(100 * slack2 / n).toFixed(0).padStart(2)}%)`);
}
