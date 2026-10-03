// A quel coup la table de transposition commence-t-elle a mentir ?
//
// engine.js pose son invariant lui-meme, a la ligne 850: "Alpha-beta and the transposition table
// must not change the value of the tree at all." Or dans cette partie elle le change de +390 a
// -1047563, et un score prouve arrete la recherche a la profondeur 1 -- apres quoi le moteur joue
// le depart d'une position perdue et fait l'aller-retour jusqu'au plafond.
//
// On rejoue la partie et, a chaque demi-coup, on cherche DEUX fois: une fois avec la table telle
// qu'elle s'est remplie, une fois apres l'avoir videe. Les deux doivent donner la meme valeur. Le
// premier demi-coup ou elles divergent est l'endroit ou l'entree fausse apparait.
const L = require('./lib.js'), D = require('./duel.js');
const PAIR = Number(process.env.PAIR || 0);
const SEED = Number(process.env.SEED || 77);
const OPEN = Number(process.env.OPEN || 4);
const NODES = Number(process.env.NODES || 500000);
const MAXPLY = Number(process.env.MAXPLY || 300);
const TOL = Number(process.env.TOL || 60);     // de quoi ignorer le bruit d'un ordre different

const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules, E = A.Engine;
const nom = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

const rnd = L.rng(SEED * 7919 + PAIR);
const base = D.makeOpening(A, L.startState(R), OPEN, rnd);
const s = R.deState(R.serState(base));
E.clearTable();
let divergences = 0;
for (let ply = 0; ply < MAXPLY && s.winner == null; ply++) {
  const pos = E.fromRules(s);
  const avec = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });       // table accumulee
  const sAvec = avec.score, pAvec = avec.depth, prAvec = !!avec.proven;
  const coupJoue = E.toAction(pos, avec.best);

  E.clearTable();                                                        // puis la meme, a froid
  const pos2 = E.fromRules(s);
  const sans = E.analyse(pos2, { budgetMs: 1e9, maxNodes: NODES });
  const ecart = Math.abs(sAvec - sans.score);
  if (ecart > TOL) {
    divergences++;
    if (divergences <= 6) {
      console.log(`demi-coup ${ply}  p${s.turn}`);
      console.log(`   avec la table : score ${sAvec}  profondeur ${pAvec}  prouve ${prAvec}  coup ${nom(coupJoue)}`);
      console.log(`   table videe   : score ${sans.score}  profondeur ${sans.depth}  prouve ${!!sans.proven}  coup ${nom(E.toAction(pos2, sans.best))}`);
      console.log(`   ecart ${ecart}${prAvec !== !!sans.proven ? '   <== une des deux annonce PROUVE et pas l autre' : ''}`);
    }
    if (divergences === 1) console.log('');
  }
  // On rejoue le coup que la vraie partie aurait joue, pour suivre la meme ligne.
  L.applyAction(R, s, coupJoue);
  if (ply % 40 === 0) process.stderr.write('\rdemi-coup ' + ply + '  divergences ' + divergences);
}
process.stderr.write('\r');
console.log('');
console.log(`${divergences} divergences sur ${MAXPLY} demi-coups (tolerance ${TOL} points)`);
console.log(divergences ? 'La table change la valeur de l arbre: son propre invariant est viole.'
                        : 'Aucune divergence: la table est honnete sur cette partie.');
