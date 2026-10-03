// Agrege les tranches de wallverify.js.
//
// Colonnes: token, coup du filtre, coup exclu, ecart des scores de racine, valeur du coup filtre,
// valeur du coup exclu, difference.
//
// Le piege a ne pas refaire: valueOf() rend +/-100000 pour une position terminale. Ces lignes sont
// des GAINS FORCES caches, pas des valeurs sur l'echelle des points -- elles se comptent a part et
// n'entrent dans aucune moyenne. C'est exactement la sentinelle qui avait fait exploser une
// moyenne a 2647 et m'avait fait publier une conclusion fausse.
const fs = require('fs');
const files = process.argv.slice(2);
const SENT = 100000;
let n = 0, better = 0, worse = 0, same = 0, wins = 0, losses = 0;
const gains = [];
for (const f of files) {
  let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  for (const line of txt.split('\n')) {
    const c = line.split(',');
    if (c.length < 7) continue;
    const vN = Number(c[4]), vW = Number(c[5]);
    if (!Number.isFinite(vN) || !Number.isFinite(vW)) continue;
    n++;
    if (Math.abs(vN) >= SENT || Math.abs(vW) >= SENT) {
      if (vW >= SENT) wins++;            // le coup exclu gagne de force
      else if (vN >= SENT) losses++;     // le coup du filtre gagnait de force: le filtre a eu raison
      continue;                          // jamais dans une moyenne
    }
    const d = vW - vN;
    gains.push(d);
    if (d > 0) better++; else if (d < 0) worse++; else same++;
  }
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const pc = x => n ? (100 * x / n).toFixed(1) + '%' : '-';
console.log(`${n} cas ou le filtre a ecarte le coup que la racine complete choisit`);
console.log(`  le coup ecarte est MEILLEUR      : ${better} (${pc(better)})`);
console.log(`  le coup du filtre est meilleur   : ${worse} (${pc(worse)})`);
console.log(`  egalite                          : ${same} (${pc(same)})`);
console.log(`  gains forces caches par le filtre: ${wins}`);
console.log(`  cas ou le filtre voyait le gain  : ${losses}`);
if (gains.length) {
  console.log(`  ecart moyen (points)             : ${mean(gains).toFixed(1)}`);
  console.log(`  mediane                          : ${med(gains)}`);
  console.log(`  au-dessus de 100 points          : ${gains.filter(x => x > 100).length}`);
  console.log(`  au-dessus de 300 points          : ${gains.filter(x => x > 300).length}`);
}
