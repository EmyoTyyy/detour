// Verification directe, sans recherche: sur les cas ou le filtre LIVRE a ecarte le meilleur coup,
// le filtre ELARGI l'aurait-il engendre ?
//
// Un resultat a zero se verifie, il ne s'annonce pas. Les 655 cas enregistres portent chacun la
// position et le coup ecarte; il suffit de demander a chaque moteur sa liste de coups a la racine
// et de regarder si le coup y est. Aucune recherche, donc aucun budget, donc rien a confondre.
const L = require('./lib.js');
const fs = require('fs');

const S = L.loadEngine('path/engine.js', { weights: false });
const W = L.loadEngine('tools/lab/variants/engine-walls-wide.js', { weights: false });
const R = S.Rules;

// La liste des coups que ce moteur considere a la racine, telle que analyse() la construit.
function rootIds(Eng, state, all) {
  const pos = Eng.fromRules(state);
  const r = Eng.analyse(pos, { budgetMs: 1e9, maxNodes: 1, maxDepth: 1, rootAll: !!all });
  return new Set((r.moves || []).map(m => L.actionId(Eng.toAction(pos, m.move))));
}

let n = 0, inNarrow = 0, inWide = 0, inAll = 0, nWin = 0, winFixed = 0;
for (const f of process.argv.slice(2)) {
  let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  for (const line of txt.split('\n')) {
    const c = line.split(',');
    if (c.length < 7) continue;
    let s; try { s = L.decodePos(R, c[0]); } catch (e) { continue; }
    const excluded = Number(c[2]);          // le coup que la racine complete a choisi
    const vW = Number(c[5]);
    n++;
    const nar = rootIds(S.Engine, s, false);
    const wid = rootIds(W.Engine, s, false);
    const all = rootIds(S.Engine, s, true);
    if (nar.has(excluded)) inNarrow++;       // ne devrait jamais arriver: c'est la definition d'un cas
    if (wid.has(excluded)) inWide++;
    if (all.has(excluded)) inAll++;
    if (vW >= 100000) { nWin++; if (wid.has(excluded)) winFixed++; }
  }
}
const pc = x => n ? (100 * x / n).toFixed(1) + '%' : '-';
console.log(`${n} cas ou le filtre livre a ecarte le coup de la racine complete`);
console.log(`  present dans la liste LIVREE   : ${inNarrow} (${pc(inNarrow)})   <- doit etre 0 par construction`);
console.log(`  present dans la liste ELARGIE  : ${inWide} (${pc(inWide)})`);
console.log(`  present dans la liste COMPLETE : ${inAll} (${pc(inAll)})   <- doit etre 100%`);
console.log(`  dont gains forces              : ${nWin}, repares par l'elargissement: ${winFixed}`);
