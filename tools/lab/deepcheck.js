// La table mentait-elle, ou se souvenait-elle d'une verite qu'une recherche courte ne revoit pas ?
//
// A profondeur 8 et table vide, la position vaut +360 pour p0. Avec la table, elle vaut une defaite
// PROUVEE. Deux lectures possibles, et elles n'ont pas le meme remede:
//   A) la table se trompe, p0 n'est pas perdu, et tout ce qui suit est du bruit.
//   B) la table a raison -- une recherche profonde, plus tot dans la partie, a VRAIMENT prouve la
//      defaite de p0 -- et le defaut est ailleurs: le camp qui gagne de facon prouvee ne rentre
//      jamais, il fait l'aller-retour, et la partie ne finit pas.
//
// On tranche en cherchant la meme position TABLE VIDE mais profondement. Si le verdict prouve
// reapparait, la table disait vrai.
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
console.log('position au demi-coup ' + STOP + ', au trait p' + s.turn +
            ', chemins p0=' + R.pathLength(s, 0) + ' p1=' + R.pathLength(s, 1) +
            ', murs en main ' + s.walls.join('/'));
console.log('');
console.log('A) la meme position, TABLE VIDE, de plus en plus profond:');
for (const d of [8, 12, 16, 20, 24]) {
  E.clearTable();
  const p = E.fromRules(s);
  const r = E.analyse(p, { budgetMs: 1e9, maxNodes: 20000000, maxDepth: d });
  console.log('   profondeur demandee ' + String(d).padStart(2) + '  atteinte ' + String(r.depth).padStart(2) +
    '  score ' + String(r.score).padStart(9) + (r.proven ? '  PROUVE' : '        ') +
    '  coup ' + nom(E.toAction(p, r.best)));
}
console.log('');
console.log('B) et le camp qui GAGNE: que joue-t-il, et sa distance baisse-t-elle ?');
// On donne le trait a p1 en jouant le coup de p0, puis on regarde dix coups de p1.
const t = R.deState(R.serState(s));
E.clearTable();
for (let k = 0; k < 10 && t.winner == null; k++) {
  const p = E.fromRules(t);
  const r = E.analyse(p, { budgetMs: 1e9, maxNodes: NODES });
  const a = E.toAction(p, r.best);
  const avant = R.pathLength(t, t.turn);
  L.applyAction(R, t, a);
  const apres = R.pathLength(t, 1 - t.turn);
  console.log('   p' + (1 - t.turn) + ' joue ' + nom(a).padEnd(5) + ' score ' + String(r.score).padStart(9) +
    (r.proven ? ' PROUVE' : '       ') + '  sa distance ' + avant + ' -> ' + apres +
    (apres < avant ? '  (avance)' : apres > avant ? '  (RECULE)' : '  (sur place)'));
}
