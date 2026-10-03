// Quand Path est perdant, joue-t-il encore pour gener, ou lache-t-il ?
//
// "Abandonner" n'est pas une option du moteur: il ne demissionne jamais. Ce que l'oeil appelle un
// abandon, c'est une suite de coups qui ne derangent plus personne -- avancer son pion pendant
// qu'un mur aurait coute deux tours a l'adversaire. Cela se mesure sans interpretation: pour
// chaque position perdante, on calcule la distance que CHAQUE coup legal laisse a l'adversaire,
// et on compare celle du coup joue a la meilleure disponible.
//
// Un ecart de 0 veut dire "il a joue le coup le plus genant". Un ecart de 2 veut dire qu'il a
// laisse passer deux tours de retard qu'il pouvait imposer.
const L = require('./lib.js'), D = require('./duel.js');

const strong = L.loadEngine('path/engine.js', { weights: 'path/netweights.js' });
const weak = L.loadEngine(process.env.ENG || 'path/engine.js', { weights: 'path/netweights.js' });
const R = strong.Rules;
const SN = Number(process.env.SN || 120000);
const WN = Number(process.env.WN || 8000);
const GAMES = Number(process.env.GAMES || 6);
const LOSING = Number(process.env.LOSING || 300);

const distOf = (s, who) => {
  const dm = R.distanceMap(s, who);
  const d = dm.get(R.key(s.pawns[who].r, s.pawns[who].c));
  return d === undefined ? -1 : d;
};

function everyAction(s, who) {
  const out = [];
  for (const to of R.legalMoves(s, who)) out.push({ type: 'move', to });
  if (s.walls[who] > 0) {
    for (let r = 0; r < s.rows - 1; r++) for (let c = 0; c < s.cols - 1; c++) for (const o of ['h', 'v']) {
      if (R.canPlaceWall(s, who, o, r, c)) out.push({ type: 'wall', orient: o, r, c });
    }
  }
  return out;
}

let seen = 0, gapSum = 0, slack2 = 0, wallsChosen = 0, wallBest = 0, proven = 0, provenGap = 0;
const examples = [];

for (let g = 0; g < GAMES; g++) {
  const rnd = L.rng(7000 + g);
  const s = D.makeOpening(strong, L.startState(R), 4, rnd);
  // le faible joue en second, donc il subit
  for (let ply = 0; ply < 160 && s.winner == null; ply++) {
    const mine = ply % 2 === 1;
    const E = (mine ? weak : strong).Engine;
    E.clearTable();
    const pos = E.fromRules(s);
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: mine ? WN : SN });
    const act = E.toAction(pos, r.best);
    if (mine && r.score < -LOSING) {
      const me = s.turn, opp = 1 - me;
      let best = -1, bestIsWall = false;
      for (const a of everyAction(s, me)) {
        const c = R.cloneState(s);
        L.applyAction(R, c, a);
        const d = distOf(c, opp);
        if (d > best) { best = d; bestIsWall = a.type === 'wall'; }
      }
      const c = R.cloneState(s);
      L.applyAction(R, c, act);
      const got = distOf(c, opp);
      if (best >= 0 && got >= 0) {
        seen++;
        const gap = best - got;
        gapSum += gap;
        if (gap >= 2) slack2++;
        if (act.type === 'wall') wallsChosen++;
        if (bestIsWall) wallBest++;
        const isProven = Math.abs(r.score) >= E.PROVEN;
        if (isProven) { proven++; provenGap += gap; }
        if (gap >= 2 && examples.length < 6) {
          examples.push(`  partie ${g} coup ${ply}: score ${r.score}, joue ${act.type === 'wall' ? 'mur ' + act.orient + act.r + ',' + act.c : 'pion ' + act.to.r + ',' + act.to.c}`
            + ` -> adversaire a ${got} pas; le meilleur coup l aurait laisse a ${best}` + (isProven ? '  [perte prouvee]' : ''));
        }
      }
    }
    L.applyAction(R, s, act);
  }
}

console.log(`${GAMES} parties, le perdant a ${WN} noeuds contre ${SN}\n`);
console.log(`positions perdantes examinees : ${seen}` + (proven ? `  (dont ${proven} prouvees perdues)` : ''));
if (!seen) { console.log('aucune position perdante atteinte -- baisser WN ou LOSING'); process.exit(0); }
console.log(`retard laisse a l adversaire, ecart au meilleur coup : ${(gapSum / seen).toFixed(2)} pas en moyenne`);
console.log(`positions ou il laisse 2 pas ou plus sur la table    : ${slack2} / ${seen}  (${(100 * slack2 / seen).toFixed(0)} %)`);
if (proven) console.log(`  parmi les pertes prouvees                         : ${(provenGap / proven).toFixed(2)} pas`);
console.log(`il a pose un mur dans ${wallsChosen} / ${seen} ; un mur etait le coup le plus genant dans ${wallBest} / ${seen}`);
if (examples.length) { console.log('\nexemples:'); examples.forEach(e => console.log(e)); }
