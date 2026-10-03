// Fabrique tools/lab/variants/engine-lag.js depuis le moteur courant.
//
// `parity: 'even'` recule d'exactement un demi-coup, et SEULEMENT quand la derniere profondeur
// achevee est impaire. A 20 000 noeuds il gagne 163 points. Deux lectures possibles:
//
//   a) c'est la PARITE: terminer sur son propre coup fausse le jugement, et revenir a une
//      profondeur paire le repare.
//   b) c'est le RECUL: a budget serre la derniere iteration achevee est peu fiable (fenetre
//      d'aspiration etroite, tri des coups a peine refait), et celle d'avant vaut mieux --
//      la parite n'y est pour rien, elle se trouve juste etre impaire la plupart du temps.
//
// Ce fichier produit `parity: 'lag'`: reculer d'une iteration TOUJOURS, quelle que soit la
// parite. Si 'lag' vaut aussi +163, c'est (b) et la parite n'explique rien. S'il ne vaut rien,
// c'est (a). Sans le drapeau, la variante doit etre identique au moteur livre -- c'est verifie
// par un match avant toute mesure.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'path/engine.js'), 'utf8');

// 1. les variables de memoire, a cote de celles de la parite
const A1 = `    let evenMove = MOVE_NONE, evenScore = 0, evenDepth = 0, evenPv = [];`;
if (src.split(A1).length !== 2) throw new Error('point d insertion 1 introuvable ou multiple');
let out = src.replace(A1, A1 + `
    let lagMove = MOVE_NONE, lagScore = 0, lagDepth = 0, lagPv = [];`);

// 2. garder la reponse PRECEDENTE avant de l ecraser par celle de l iteration qui vient
const A2 = `      best = iterMove; bestScore = iterBest; completed = depth; prev = iterBest; pv = iterPv;`;
if (out.split(A2).length !== 2) throw new Error('point d insertion 2 introuvable ou multiple');
out = out.replace(A2, `      if (completed > 0) { lagMove = best; lagScore = bestScore; lagDepth = completed; lagPv = pv; }
` + A2);

// 3. l application du drapeau, juste avant celle de la parite
const A3 = `    if (o.parity === 'even' && evenMove !== MOVE_NONE && (completed & 1) === 1 && Math.abs(bestScore) < PROVEN) {`;
if (out.split(A3).length !== 2) throw new Error('point d insertion 3 introuvable ou multiple');
out = out.replace(A3, `    if (o.parity === 'lag' && lagMove !== MOVE_NONE && Math.abs(bestScore) < PROVEN) {
      best = lagMove; bestScore = lagScore; completed = lagDepth; pv = lagPv;
    }
` + A3);

const dest = path.join(ROOT, 'tools/lab/variants/engine-lag.js');
fs.writeFileSync(dest, out);
console.log('ecrit ' + dest + ' (' + out.length + ' octets, source ' + src.length + ')');
