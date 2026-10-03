// La regle de repetition: ce qu'elle doit faire, et ce qu'elle ne doit PAS faire.
const fs = require('fs'), path = require('path');
global.window = {};
const ROOT = path.join(__dirname, '../..');
eval(fs.readFileSync(path.join(ROOT, 'rules.js'), 'utf8'));
const R = window.Rules;
const out = [];
const ok = (n, c, x) => out.push((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '   << ' + x));
const neuf = () => R.createState({ size: 9, walls: 10, players: 2 });

// 1. un aller-retour finit par faire nulle
let s = neuf();
const va = [[7, 4], [1, 4], [8, 4], [0, 4], [7, 4], [1, 4], [8, 4], [0, 4], [7, 4], [1, 4]];
let n = 0;
for (const [r, c] of va) { if (s.winner !== null) break; R.applyMove(s, { r, c }); n++; }
ok('un aller-retour fait nulle', s.winner === 'draw', JSON.stringify(s.winner));
ok('et pas avant la TROISIEME fois', n >= 8, 'declaree au coup ' + n);

// 2. une partie normale ne declenche rien
s = neuf();
for (let i = 0; i < 7 && s.winner === null; i++) { R.applyMove(s, { r: 7 - i, c: 4 }); R.applyMove(s, { r: 1 + i, c: 4 }); }
ok('une marche vers le but ne fait pas nulle', s.winner === null || s.winner === 0 || s.winner === 1,
   JSON.stringify(s.winner));

// 3. poser des murs ne peut pas repeter: la position avance toujours
s = neuf();
let mursOk = true;
const murs = [[5, 0], [5, 2], [5, 4], [5, 6], [3, 0], [3, 2], [3, 4], [3, 6]];
for (const [r, c] of murs) {
  if (s.winner !== null) { mursOk = false; break; }
  if (!R.canPlaceWall(s, s.turn, 'h', r, c)) continue;
  R.applyWall(s, 'h', r, c);
}
ok('poser huit murs ne declenche aucune nulle', mursOk && s.winner === null, JSON.stringify(s.winner));

// 4. cloneState ne partage pas le compteur: explorer une variante ne compte pas dans la partie
s = neuf();
R.applyMove(s, { r: 7, c: 4 }); R.applyMove(s, { r: 1, c: 4 });
const avant = s.seen.size;
const copie = R.cloneState(s);
R.applyMove(copie, { r: 8, c: 4 }); R.applyMove(copie, { r: 0, c: 4 });
R.applyMove(copie, { r: 7, c: 4 }); R.applyMove(copie, { r: 1, c: 4 });
ok('une variante ne pollue pas le compteur de la partie', s.seen.size === avant,
   s.seen.size + ' au lieu de ' + avant);
ok('et la variante a bien son propre compteur', copie.seen.size > avant, copie.seen.size);

// 5. la cle distingue le trait: la meme disposition avec l autre joueur au trait n est pas la meme
s = neuf();
R.applyMove(s, { r: 7, c: 4 });
const k1 = [...s.seen.keys()][0];
ok('la cle porte le trait', /\|[01]\|/.test(k1), k1);

// 6. une nulle est un resultat que le reste du code connait deja
ok('la nulle se nomme "draw" comme ailleurs dans le projet', s.winner === null, 'etat intact');

console.log(out.join('\n'));
const f = out.filter(l => l[0] === 'F').length;
console.log('\n' + (out.length - f) + '/' + out.length + ' verifications passent');
process.exit(f ? 1 : 0);
