// Une variante par valeur de constante, pour balayer l'ordre contre la BONNE mesure.
//
// Ajuster sur des etiquettes "voici le meilleur coup" a echoue: les trois variantes qui en sortent
// coutent toutes plus de noeuds. L'objectif etait faux. Ici on change une constante a la fois et on
// mesure ce qu'on veut vraiment: les noeuds pour atteindre la meme profondeur.
//
//   P2=60000 P1=8000 P4=3000 node mkordc.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const P2 = process.env.P2 || '60000', P1 = process.env.P1 || '8000', P4 = process.env.P4 || '3000';
const src = fs.readFileSync(path.join(ROOT, 'path/engine.js'), 'utf8');
const A = `            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s += 8000;     // on ours — usually bad, but must be searched
            if (tag & 4) s += 3000;`;
if (src.split(A).length !== 2) throw new Error('point d insertion introuvable');
const sgn = v => (Number(v) < 0 ? 's -= ' + (-Number(v)) : 's += ' + Number(v));
const out = src.replace(A, `            if (tag & 2) ${sgn(P2)};
            if (tag & 1) ${sgn(P1)};
            if (tag & 4) ${sgn(P4)};`);
const tag = 'p' + P2 + '_' + P1 + '_' + P4;
const dest = path.join(ROOT, 'tools/lab/variants/engine-ordc-' + tag + '.js');
fs.writeFileSync(dest, out);
console.log(dest);
