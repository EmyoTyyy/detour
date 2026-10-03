// Quand un score prouve sort de la TABLE, la racine est-elle encore notee ?
//
// Hypothese a verifier, apres trois lectures fausses de ma part: la table dit vrai (profondeur 12
// confirme la defaite de p0), et faire durer une position perdue est voulu. Ce qui ne va pas, c'est
// que la partie ne finit pas -- le camp qui gagne de facon prouvee cesse d'avancer.
//
// Mecanisme suppose: un score prouve trouve des la premiere iteration fait sortir la boucle
// ("proven result, no point going deeper"). A la profondeur 1, la plupart des coups de la racine
// n'ont pas encore de score reel. breakProvenTie ne garde que les coups dont le score EGALE le
// meilleur; s'il n'y en a qu'un, il n'a rien a departager et rend le coup de la table -- celui-la
// meme qui a ete range pendant le surplace. La boucle s'entretient.
//
// On mesure donc, pour la meme position: combien de coups a la racine portent un vrai score, avec
// la table accumulee puis a froid.
const L = require('./lib.js'), D = require('./duel.js');
const PAIR = Number(process.env.PAIR || 0);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const STOP = Number(process.env.STOP || 276);

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;
const nom = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

const rnd = L.rng(SEED * 7919 + PAIR);
const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
const s = R.deState(R.serState(base));
E.clearTable();
for (let ply = 0; ply < STOP && s.winner == null; ply++) {
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  L.applyAction(R, s, E.toAction(pos, r.best));
}

function examiner(titre, vider) {
  if (vider) E.clearTable();
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  const mv = r.moves || [];
  const reels = mv.filter(m => m.score > -1e9 && m.score < 1e9 || Math.abs(m.score) >= E.PROVEN);
  const egaux = mv.filter(m => m.score === r.score);
  console.log(titre);
  console.log('   score ' + r.score + '  profondeur ' + r.depth + '  prouve ' + !!r.proven +
              '  coup ' + nom(E.toAction(pos, r.best)));
  console.log('   coups a la racine: ' + mv.length +
              ',  notes d un vrai score: ' + reels.length +
              ',  a egalite avec le meilleur: ' + egaux.length);
  const dist = mv.slice().sort((a, b) => b.score - a.score).slice(0, 5)
    .map(m => nom(E.toAction(pos, m.move)) + '=' + m.score);
  console.log('   cinq premiers: ' + dist.join('  '));
  return r;
}

console.log('demi-coup ' + STOP + ', au trait p' + s.turn + ', chemins p0=' + R.pathLength(s, 0) +
            ' p1=' + R.pathLength(s, 1) + ', murs ' + s.walls.join('/'));
console.log('');
examiner('AVEC la table telle que la partie l a remplie:', false);
console.log('');
examiner('A FROID, meme position:', true);
