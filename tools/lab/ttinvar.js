// La table de transposition change-t-elle la valeur de l'arbre ? Le test propre.
//
// Mon diagnostic precedent etait faux: je vidais la table a chaque demi-coup pour prendre la mesure
// de controle, ce qui detruisait l'accumulation que je cherchais justement. Et comparer a budget en
// NOEUDS ne prouve rien non plus, parce que la table achete de la profondeur avec les memes noeuds.
//
// Ici on fixe la PROFONDEUR et on enleve le plafond de noeuds, puis on cherche deux fois: table
// active, table desactivee (setSearchFlags, le commutateur que le moteur expose pour ca). A
// profondeur egale les deux valeurs doivent etre IDENTIQUES -- c'est l'invariant que engine.js
// enonce lui-meme ligne 850, et le seul qui tienne le reste du fichier honnete.
//
// On joue la partie avec la table qui s'accumule vraiment (jamais videe), et on teste la position
// atteinte a chaque jalon.
const L = require('./lib.js'), D = require('./duel.js');
const PAIR = Number(process.env.PAIR || 0);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const DEPTH = Number(process.env.DEPTH || 8);
const JALONS = (process.env.JALONS || '40,120,200,260,276,290').split(',').map(Number);

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;
const nom = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

const rnd = L.rng(SEED * 7919 + PAIR);
const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
const s = R.deState(R.serState(base));
E.clearTable();                      // une seule fois, comme une vraie partie
const max = Math.max(...JALONS);
const resultats = [];
for (let ply = 0; ply <= max && s.winner == null; ply++) {
  if (JALONS.includes(ply)) {
    // La table est telle que la partie l'a remplie. On ne la touche PAS.
    const p1 = E.fromRules(s);
    E.setSearchFlags({ tt: true });
    const avec = E.analyse(p1, { budgetMs: 1e9, maxNodes: 1e9, maxDepth: DEPTH });
    // Puis la meme profondeur sans consulter la table du tout. La table reste en place: on coupe
    // seulement son usage, donc la difference ne vient que d'elle.
    const p2 = E.fromRules(s);
    E.setSearchFlags({ tt: false });
    const sans = E.analyse(p2, { budgetMs: 1e9, maxNodes: 1e9, maxDepth: DEPTH });
    E.setSearchFlags({ tt: true });
    resultats.push({ ply, tour: s.turn,
      sa: avec.score, pa: avec.depth, pra: !!avec.proven, ca: nom(E.toAction(p1, avec.best)),
      ss: sans.score, ps: sans.depth, prs: !!sans.proven, cs: nom(E.toAction(p2, sans.best)) });
    process.stderr.write('\rjalon ' + ply + ' fait');
  }
  const pos = E.fromRules(s);
  const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
  L.applyAction(R, s, E.toAction(pos, r.best));
}
process.stderr.write('\r');
console.log(`paire ${PAIR}, profondeur fixe ${DEPTH}, sans plafond de noeuds`);
console.log('La table ne doit RIEN changer a cette profondeur.');
console.log('');
console.log('ply  camp  avec la table            sans la table            verdict');
let fautes = 0;
for (const r of resultats) {
  const egal = r.sa === r.ss;
  if (!egal) fautes++;
  console.log(String(r.ply).padStart(3) + '   p' + r.tour + '   ' +
    (String(r.sa) + (r.pra ? ' PROUVE' : '') + ' p' + r.pa + ' ' + r.ca).padEnd(24) + ' ' +
    (String(r.ss) + (r.prs ? ' PROUVE' : '') + ' p' + r.ps + ' ' + r.cs).padEnd(24) + ' ' +
    (egal ? 'identique' : 'DIFFERENT de ' + Math.abs(r.sa - r.ss)));
}
console.log('');
console.log(fautes ? fautes + ' jalon(s) ou la table CHANGE la valeur: son invariant est viole.'
                   : 'Aucune difference: la table est honnete a profondeur egale.');
