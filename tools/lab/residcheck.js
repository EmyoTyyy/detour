// Le reseau residuel doit CORRIGER l'evaluation faite main, pas la remplacer.
//
// C'est la propriete qui distingue ce reseau de tous les precedents, et c'est aussi la seule
// qu'une erreur de cablage peut faire disparaitre sans rien casser de visible: si le drapeau
// `residual` n'arrive pas jusqu'au moteur, `evaluate()` retourne le reseau seul et on retombe
// exactement sur le montage qui a perdu 545 Elo, sans qu'aucun test ne s'en plaigne.
//
// Deux verifications, et la seconde compte autant que la premiere:
//   * la ou evaluate() atteint le reseau, l'ecart doit etre une correction bornee;
//   * la ou il ne l'atteint pas (course prouvee, mains vides), l'ecart doit etre exactement nul.
const L = require('./lib.js'), D = require('./duel.js');

const hand = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: false });
const res = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: process.env.W || 'tools/lab/nnue_w_resid.js' });
const ship = L.loadEngine(undefined, { weights: 'path/netweights.js' });
const R = hand.Rules;
const N = Number(process.env.POS || 200);

let reached = 0, off = 0, zero = 0, nonzero = 0, offBad = 0;
const diffs = [];
let sameAsShipped = 0;

for (let g = 0, tot = 0; g < N * 3 && tot < N; g++) {
  const rnd = L.rng(31000 + g);
  const s = D.makeOpening(ship, L.startState(R), 4 + ((rnd() * 26) | 0), rnd);
  if (s.winner != null) continue;
  tot++;
  const ph = hand.Engine.fromRules(s), pr = res.Engine.fromRules(s);
  const vh = hand.Engine.evaluate(ph);
  const hit = hand.Engine.nnWasReached();
  const vr = res.Engine.evaluate(pr);
  const d = vr - vh;
  if (hit) {
    reached++;
    diffs.push(d);
    if (d === 0) zero++; else nonzero++;
  } else {
    off++;
    if (d !== 0) offBad++;
  }
  const vs = ship.Engine.evaluate(ship.Engine.fromRules(s));
  if (vs === vh) sameAsShipped++;
}

const abs = diffs.map(Math.abs);
const moy = x => (x.reduce((a, b) => a + b, 0) / (x.length || 1));
diffs.sort((a, b) => a - b);
console.log(`${reached + off} positions: ${reached} soumises au reseau, ${off} tranchees avant`);
console.log('');
console.log('La ou le reseau est atteint:');
console.log(`  correction non nulle       : ${nonzero}/${reached}` + (zero ? `  (${zero} nulles)` : ''));
console.log(`  correction moyenne         : ${moy(diffs).toFixed(0)} points`);
console.log(`  correction absolue moyenne : ${moy(abs).toFixed(0)} points`);
console.log(`  etendue                    : ${diffs[0]} a ${diffs[diffs.length - 1]}`);
console.log('');
console.log('La ou il ne l est pas (course prouvee, mains vides):');
console.log(`  ecart non nul              : ${offBad}   <- doit etre 0`);
console.log('');
console.log(`Temoin -- le moteur livre et le fait main donnent la meme valeur: ${sameAsShipped}/${reached + off}`);
console.log(`         (doit etre bas: sinon "fait main" charge encore un reseau)`);
const ok = offBad === 0 && nonzero > reached * 0.8 && Math.abs(moy(abs)) > 1;
console.log('');
console.log(ok ? 'VERDICT: le moteur ADDITIONNE une correction bornee.' : 'VERDICT: cablage suspect.');
process.exit(ok ? 0 : 1);
