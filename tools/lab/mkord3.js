// Deux variantes minimales, au lieu de remplacer tout l'ordre.
//
// Le modele lineaire complet a perdu: il faut 3,8 % a 14,6 % de noeuds EN PLUS pour la meme
// profondeur, et l'ecart grandit avec la profondeur. La lecon est que l'alpha-beta se decide sur le
// PREMIER coup -- une coupe elague tout le reste -- et que le rang moyen, que le modele ameliorait
// de 21 %, n'y change presque rien.
//
// Mais l'ajustement a dit trois choses precises sur les constantes qui existent deja, et celles-la
// se testent sans toucher a la structure que le reste de la recherche suppose:
//   A) croiser NOTRE chemin vaut +8000 dans le code et -18491 pour l'ajustement: un signe faux.
//   B) toucher un mur vaut +3000 dans le code et +650 pour l'ajustement: presque rien.
//   C) un mur sur la colonne de bord vaut +19370, et le code n'en dit rien. C'est la regle que le
//      projet MIT de Kyutae Lee a ("leftmost or rightmost horizontal walls") et que Path ignore.
//
// VAR=signe  -> seulement A et B, les deux constantes existantes corrigees
// VAR=bord   -> A, B, et le terme de bord ajoute
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const VAR = process.env.VAR || 'signe';
const src = fs.readFileSync(path.join(ROOT, 'path/engine.js'), 'utf8');

const A = `            s = history[me * 2048 + (m & 2047)];
            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s += 8000;     // on ours — usually bad, but must be searched
            if (tag & 4) s += 3000;`;
if (src.split(A).length !== 2) throw new Error('point d insertion introuvable ou multiple');

let repl;
if (VAR === 'signe') {
  repl = `            s = history[me * 2048 + (m & 2047)];
            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s -= 18000;    // sur le NOTRE: l ajustement dit negatif, pas +8000
            if (tag & 4) s += 600;      // colle a un mur: l ajustement dit presque rien`;
} else if (VAR === 'bord') {
  repl = `            s = history[me * 2048 + (m & 2047)];
            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s -= 18000;    // sur le NOTRE: l ajustement dit negatif, pas +8000
            if (tag & 4) s += 600;      // colle a un mur: l ajustement dit presque rien
            const jc3 = j - (((j / JW) | 0) * JW);
            if (jc3 === 0 || jc3 === JW - 1) s += 19000;   // mur de bord, regle venue du projet MIT`;
} else throw new Error('VAR inconnue: ' + VAR);

const out = src.replace(A, repl);
const dest = path.join(ROOT, 'tools/lab/variants/engine-ord-' + VAR + '.js');
fs.writeFileSync(dest, out);
console.log('ecrit ' + dest);
