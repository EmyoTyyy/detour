// Fabrique tools/lab/variants/engine-order.js: le moteur courant, plus scoreBuf expose.
//
// genMoves remplit moveBuf et scoreBuf sans trier: la recherche prend le maximum a chaque tour.
// moveBuf est deja expose, mais sans les scores on lit l'ordre de GENERATION et non l'ordre de
// RECHERCHE, qui est le seul qui compte. Une ligne d'export, rien d'autre.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'path/engine.js'), 'utf8');
const A = `    setTableBits, clearTable, genMoves, moveBuf, pathLen, mayCut, wallLegal,`;
if (src.split(A).length !== 2) throw new Error('point d insertion introuvable ou multiple');
const out = src.replace(A, A + `
    scoreBuf,    // les scores d'ordre, pour mesurer ou tombe le bon coup (orderrank.js)
    _wallMark,   // les marques de mur calculees par genMoves: sur le chemin adverse (2), le
                 // notre (1), colle a un mur ou pres d'un pion (4). Ce sont les entrees des
                 // trois constantes ecrites a la main, donc celles qu'un modele doit relire.`);
const dest = path.join(ROOT, 'tools/lab/variants/engine-order.js');
fs.writeFileSync(dest, out);
console.log('ecrit ' + dest);
