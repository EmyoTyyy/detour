// Fabrique tools/lab/variants/engine-ordw.js: le moteur courant, avec l'ORDRE DES COUPS appris.
//
// Les trois constantes ecrites a la main (+60000 chemin adverse, +8000 notre chemin, +3000 colle a
// un mur) sont remplacees par un score lineaire de douze traits, ajuste par classement sur 29 944
// positions dont on connait le coup qu'une recherche a 60 000 noeuds a choisi.
//
// L'ajustement a trouve deux erreurs dans le reglage a la main: croiser NOTRE chemin valait +8000
// alors que c'est negatif, et toucher un mur valait +3000 alors que cela ne vaut rien. Il a aussi
// retrouve seul la constante du chemin adverse, 62012 contre 60000 -- ce qui dit que l'echelle est
// la bonne et que l'ajustement n'est pas parti ailleurs.
//
// Ce qui ne change PAS: le coup de la table, les killers, et "ce coup gagne sur place" gardent
// leurs priorites absolues. On ne remplace que le depart a froid.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'path/engine.js'), 'utf8');

// Poids entiers = poids ajuste / ecart-type du trait * 20000. Ordre: estMur, versBut, atteintBut,
// croiseChemAdv, croiseNotre, colleMur, vertical, distAdv, distNous, bordColonne, bordRangee,
// devantAdv, nosMurs, sesMurs.
const OW = [-70796, 16759, 374756, 62012, -18491, 650, 2759, -8131, -2130, 19370, 5712, 789, 0, 0];

let out = src;
const once = (needle, repl, quoi) => {
  if (out.split(needle).length !== 2) throw new Error('point d insertion ' + quoi + ' introuvable ou multiple');
  out = out.replace(needle, repl);
};

// 1. le tableau de poids, a cote de HIST_MAX
once(`  const HIST_MAX = 12000;`,
`  const HIST_MAX = 12000;
  // Poids de l'ORDRE des coups, ajustes par classement (tools/lab/fitorder.py). Echelle choisie
  // pour que le terme dominant tombe sur l'ancienne constante: 62012 contre 60000 ecrit a la main.
  const OW = [${OW.join(', ')}];`, '1 (poids)');

// 2. le score d'un coup de pion
once(`      let s = 100000;
      if (tr === goal) s = 2000000;                                  // wins on the spot
      else s += (Math.abs(myRow - goal) - Math.abs(tr - goal)) * 400; // toward the goal`,
`      let s = 100000 + OW[1] * (Math.abs(myRow - goal) - Math.abs(tr - goal));
      if (tr === goal) s = 2000000;                                  // wins on the spot`, '2 (pion)');

// 3. les coordonnees dont le score de mur a besoin, calculees une fois
once(`      for (let o = 0; o < 2; o++) {
        for (let j = 0; j < JN; j++) {
          const tag = onPath[o * JN + j];`,
`      // Ce que le score appris lit, calcule une fois pour toute la liste.
      const myCol = pos.pawn[me] - myRow * cols;
      const opRow = (pos.pawn[opp] / cols) | 0, opCol = pos.pawn[opp] - opRow * cols;
      const opDown = pos.goalRow[opp] > opRow ? 1 : 0;
      for (let o = 0; o < 2; o++) {
        for (let j = 0; j < JN; j++) {
          const tag = onPath[o * JN + j];`, '3 (coordonnees)');

// 4. le score d'un coup de mur
once(`          else {
            s = history[me * 2048 + (m & 2047)];
            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s += 8000;     // on ours — usually bad, but must be searched
            if (tag & 4) s += 3000;
          }`,
`          else {
            const jr = (j / JW) | 0, jc = j - jr * JW;
            let da = jr - opRow; if (da < 0) da = -da;
            let dac = jc - opCol; if (dac < 0) dac = -dac;
            if (dac > da) da = dac; if (da > 6) da = 6;
            let dm = jr - myRow; if (dm < 0) dm = -dm;
            let dmc = jc - myCol; if (dmc < 0) dmc = -dmc;
            if (dmc > dm) dm = dmc; if (dm > 6) dm = 6;
            s = history[me * 2048 + (m & 2047)] + 100000 + OW[0]
              + ((tag & 2) ? OW[3] : 0)
              + ((tag & 1) ? OW[4] : 0)
              + ((tag & 4) ? OW[5] : 0)
              + (o ? OW[6] : 0)
              + OW[7] * da + OW[8] * dm
              + ((jc === 0 || jc === JW - 1) ? OW[9] : 0)
              + ((jr === 0 || jr === JH - 1) ? OW[10] : 0)
              + ((o === 0 && (opDown ? jr >= opRow : jr < opRow)) ? OW[11] : 0);
          }`, '4 (mur)');

// 5. scoreBuf expose, pour que orderrank.js puisse verifier que ce JS reproduit bien
//    l'ajustement fait en Python. Une variante de laboratoire, pas ce qui serait livre.
once(`    setTableBits, clearTable, genMoves, moveBuf, pathLen, mayCut, wallLegal,`,
`    setTableBits, clearTable, genMoves, moveBuf, pathLen, mayCut, wallLegal,
    scoreBuf, _wallMark,`, '5 (export)');

const dest = path.join(ROOT, 'tools/lab/variants/engine-ordw.js');
fs.writeFileSync(dest, out);
console.log('ecrit ' + dest);
