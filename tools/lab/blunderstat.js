// Ce que dit le scan: OU et COMMENT l'evaluation de Path se trompe, selon un arbitre exterieur.
//
// On cherche un motif, pas une moyenne. Une erreur systematique ("Path garde ses murs trop
// longtemps", "Path sous-estime les murs de l'adversaire") se corrige; un bruit uniforme ne se
// corrige pas. D'ou les decoupages par type de coup, par phase, et par murs en main.
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(process.argv[2] || 'blunder.json', 'utf8'));
const cas = d.cas.filter(c => c.ishtarScore != null);
const N = cas.length;

const pct = (x) => (100 * x).toFixed(1) + '%';
const moy = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const med = (xs) => { if (!xs.length) return 0; const y = xs.slice().sort((a, b) => a - b); return y[y.length >> 1]; };

console.log(`=== ${N} positions, arbitre Ishtar a ${d.ref} visites, Path a ${d.nodes} noeuds, ${d.parties} parties ===`);
console.log('');

const accord = cas.filter(c => c.memeCoup);
console.log(`Path joue le coup d'Ishtar dans ${accord.length}/${N} positions  (${pct(accord.length / N)})`);

const desac = cas.filter(c => !c.memeCoup && c.concede != null);
const conc = desac.map(c => c.concede);
console.log(`Sur les ${desac.length} desaccords, ce que Path concede (probabilite de gain donnee a l'adversaire):`);
console.log(`   moyenne ${moy(conc).toFixed(3)}   mediane ${med(conc).toFixed(3)}`);
console.log(`   le coup de Path est MOINS BON dans ${desac.filter(c => c.concede > 0.02).length} cas,`);
console.log(`   equivalent dans ${desac.filter(c => Math.abs(c.concede) <= 0.02).length},`);
console.log(`   MEILLEUR que celui d'Ishtar dans ${desac.filter(c => c.concede < -0.02).length}.`);
console.log('');

// --- le motif le plus probable: mur ou pion ?
console.log('--- Path joue-t-il le bon TYPE de coup ? ---');
const t = {};
for (const c of cas) {
  const k = (c.pathKind === 'wall' ? 'Path mur ' : 'Path pion') + ' / ' + (c.ishtarKind === 'wall' ? 'Ishtar mur ' : 'Ishtar pion');
  (t[k] = t[k] || []).push(c.concede || 0);
}
for (const k of Object.keys(t).sort()) {
  console.log('  ' + k.padEnd(26) + String(t[k].length).padStart(4) + ' cas   concede en moyenne ' + moy(t[k]).toFixed(3));
}
console.log('');

// --- Path est-il optimiste ? son score contre celui d'Ishtar
console.log('--- Path est-il trop optimiste sur sa propre position ? ---');
// score de Path: positif = bon pour celui qui joue, en unites internes. Ishtar: 0..1.
const paires = cas.filter(c => c.pathScore != null && Math.abs(c.pathScore) < 100000);
let n1 = 0, n2 = 0;
for (const c of paires) {
  const pathContent = c.pathScore > 0;      // Path se croit mieux
  const ishtarDit = c.ishtarScore > 0.5;    // Ishtar le confirme
  if (pathContent && !ishtarDit) n1++;
  if (!pathContent && ishtarDit) n2++;
}
console.log(`  Path se croit devant alors qu'Ishtar le met derriere : ${n1}/${paires.length}  (${pct(n1 / paires.length)})`);
console.log(`  Path se croit derriere alors qu'Ishtar le met devant : ${n2}/${paires.length}  (${pct(n2 / paires.length)})`);
console.log(`  -> un desequilibre net entre les deux = evaluation biaisee, pas seulement imprecise`);
console.log('');

// --- par phase
console.log('--- par phase de la partie ---');
for (const [lo, hi] of [[0, 10], [10, 25], [25, 45], [45, 999]]) {
  const sl = cas.filter(c => c.ply >= lo && c.ply < hi);
  if (!sl.length) continue;
  const ds = sl.filter(c => !c.memeCoup);
  console.log(`  coups ${lo}-${hi === 999 ? '+' : hi}`.padEnd(16) + String(sl.length).padStart(4) + ' cas   accord ' +
    pct(sl.filter(c => c.memeCoup).length / sl.length).padStart(6) + '   concede ' + moy(ds.map(c => c.concede || 0)).toFixed(3));
}
console.log('');

// --- par murs en main
console.log('--- selon les murs que Path a encore en main ---');
const parMur = {};
for (const c of cas) (parMur[c.mursPath] = parMur[c.mursPath] || []).push(c);
for (const k of Object.keys(parMur).map(Number).sort((a, b) => b - a)) {
  const sl = parMur[k], ds = sl.filter(c => !c.memeCoup);
  console.log(`  ${String(k).padStart(2)} murs`.padEnd(12) + String(sl.length).padStart(4) + ' cas   accord ' +
    pct(sl.filter(c => c.memeCoup).length / sl.length).padStart(6) + '   concede ' + moy(ds.map(c => c.concede || 0)).toFixed(3));
}
console.log('');

console.log('--- les 12 pires coups de Path, juges de l exterieur ---');
const pires = desac.slice().sort((a, b) => b.concede - a.concede).slice(0, 12);
for (const c of pires) {
  console.log(`  partie ${c.partie} coup ${String(c.ply).padStart(2)}  Path ${c.pathMove.padEnd(4)}(${c.pathKind === 'wall' ? 'mur ' : 'pion'})` +
    `  Ishtar voulait ${c.ishtarMove.padEnd(4)}  concede ${c.concede.toFixed(3)}` +
    `   | score Path ${String(c.pathScore).padStart(6)}  Ishtar ${c.ishtarScore.toFixed(3)}` +
    `  dist ${c.distMoi}/${c.distAdv}  murs ${c.mursPath}/${c.mursAdv}`);
}
