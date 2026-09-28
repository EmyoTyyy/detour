// Noter des positions deja stockees, sans rejouer une seule partie.
//
// Le reseau entraine sur l'ISSUE des parties predit tres bien qui gagne et classe tres mal les
// coups: 25 % d'accord avec une recherche profonde, contre 50 % pour l'evaluation faite main. Le
// meme reseau entraine sur le SCORE d'une recherche remonte a 53 % avec douze fois moins de
// lignes. La cible etait le probleme, et il ne reste qu'un manque: seules 8,2 % des positions
// stockees portent un score, parce que gen.js n'en note qu'une sur douze pendant qu'il joue.
//
// Or les parties, elles, sont deja payees. 1 675 810 positions dorment sur le disque avec leur
// token de 39 caracteres, et refaire une recherche dessus ne demande pas de rejouer la partie qui
// les a produites. C'est la difference entre quelques heures et plusieurs jours.
//
// Deux economies s'ajoutent:
//   * on ne note QUE les positions que evaluate() soumettrait au reseau. Les 30,6 % restantes
//     sont des courses prouvees ou des fins sans mur: le moteur y repond exactement, le reseau
//     n'y est jamais appele, et les noter reviendrait a payer un tiers du calcul pour rien.
//   * le meilleur coup est ecrit a cote du score. Il sort de la meme recherche, il ne coute rien
//     de plus, et c'est le jeu de donnees d'un reseau de politique.
//
//   WORKERS=7 NODES=60000 LIMIT=400000 node scorepass.js
//
// Reprise: chaque ouvrier ecrit son propre fichier et compte ses lignes au demarrage pour
// reprendre ou il s'etait arrete. Couper la passe et la relancer ne perd rien et ne double rien.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const L = require('./lib.js');

const HERE = __dirname;
const OUTDIR = path.resolve(HERE, process.env.OUTDIR || 'data/scored');
const NODES = Number(process.env.NODES || 60000);
const WORKERS = Number(process.env.WORKERS || Math.max(1, os.cpus().length - 1));
const LIMIT = Number(process.env.LIMIT || 0);          // 0 = tout
const STOP = path.join(HERE, 'STOP');

// Les sources, dans un ordre fixe: la reprise designe les lignes par leur rang global, donc cet
// ordre fait partie du contrat. Ajouter un dossier en tete decalerait tout.
function sources() {
  const out = [];
  for (const dir of ['data/deep', 'data/deep_lenovo', 'data/new_lenovo']) {
    let names = [];
    try { names = fs.readdirSync(path.resolve(HERE, dir)); } catch (e) { continue; }
    for (const n of names.sort()) if (/^pos_\d+\.csv$/.test(n)) out.push(dir + '/' + n);
  }
  return out;
}

// Les tokens d'une tranche de rangs globaux, lus fichier par fichier sans tout charger.
function* tokensIn(from, to) {
  let at = 0;
  for (const rel of sources()) {
    const full = path.resolve(HERE, rel);
    let size = 0;
    try { size = fs.statSync(full).size; } catch (e) { continue; }
    // 39 caracteres de token + le reste: on ne peut pas deviner le nombre de lignes sans lire,
    // donc on lit, mais on ne garde que les tokens de la tranche demandee.
    const text = fs.readFileSync(full, 'utf8');
    let i = 0;
    while (i < text.length) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      if (j > i) {
        if (at >= to) return;
        if (at >= from) {
          const c = text.indexOf(',', i);
          if (c - i === 39) yield text.slice(i, c);
          else yield null;                    // ligne inattendue: comptee, pas notee
        }
        at++;
      }
      i = j + 1;
    }
    void size;
  }
}

function totalRows() {
  let n = 0;
  for (const rel of sources()) {
    const text = fs.readFileSync(path.resolve(HERE, rel), 'utf8');
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

// ---------- ouvrier ----------
if (process.env.SP_WORKER) {
  const from = Number(process.env.SP_FROM), to = Number(process.env.SP_TO);
  const out = process.env.SP_OUT;
  // La variante porte le temoin nnWasReached(); sans poids, son evaluate() suit exactement la
  // meme chaine de sorties anticipees que le moteur livre.
  const A = L.loadEngine('tools/lab/variants/engine-nnue.js', { weights: false });
  const E = A.Engine, R = A.Rules;
  let done = 0;
  try { done = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length; } catch (e) { /* premiere fois */ }
  // `done` compte les lignes ECRITES, pas les positions LUES: les positions ignorees ne laissent
  // pas de trace, donc la reprise se fait sur le rang, qui est ecrit dans chaque ligne.
  let resumeAt = from;
  if (done) {
    try {
      const last = fs.readFileSync(out, 'utf8').trimEnd().split('\n').pop();
      resumeAt = Number(last.split(',')[0]) + 1;
    } catch (e) { /* on repart du debut de la tranche */ }
  }
  let rank = from, written = 0, skipped = 0;
  const buf = [];
  for (const token of tokensIn(from, to)) {
    const at = rank++;
    if (at < resumeAt) continue;
    if (!token) { skipped++; continue; }
    if (written % 32 === 0 && fs.existsSync(STOP)) break;
    const s = L.decodePos(R, token);
    const pos = E.fromRules(s);
    E.evaluate(pos);
    if (!E.nnWasReached()) { skipped++; continue; }   // le moteur n'y appellerait jamais le reseau
    E.clearTable();
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
    let y = r.score;
    if (y > E.PROVEN) y = 3000; else if (y < -E.PROVEN) y = -3000;
    y = Math.max(-3000, Math.min(3000, y));
    buf.push(at + ',' + token + ',' + y + ',' + L.actionId(E.toAction(pos, r.best)));
    written++;
    if (buf.length >= 200) {
      fs.appendFileSync(out, buf.join('\n') + '\n'); buf.length = 0;
      process.send && process.send({ written, skipped, at });
    }
  }
  if (buf.length) fs.appendFileSync(out, buf.join('\n') + '\n');
  process.send && process.send({ written, skipped, at: rank, done: true });
  process.exit(0);
}

// ---------- maitre ----------
fs.mkdirSync(OUTDIR, { recursive: true });
const TOTAL = LIMIT || totalRows();
console.log(`${TOTAL.toLocaleString('fr')} positions a parcourir, ${NODES} noeuds chacune, ${WORKERS} ouvriers`);
console.log('(les positions ou evaluate() repond avant le reseau sont ignorees: ~30 % du total)');

const per = Math.ceil(TOTAL / WORKERS);
const kids = [];
const stat = new Array(WORKERS).fill(0).map(() => ({ written: 0, skipped: 0, at: 0, done: false }));
const t0 = Date.now();

for (let i = 0; i < WORKERS; i++) {
  const from = i * per, to = Math.min(TOTAL, (i + 1) * per);
  if (from >= to) { stat[i].done = true; continue; }
  const env = Object.assign({}, process.env, {
    SP_WORKER: '1', SP_FROM: String(from), SP_TO: String(to),
    SP_OUT: path.join(OUTDIR, `score_${from}_${to}.csv`),
  });
  const k = fork(__filename, [], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  k.on('message', (m) => { stat[i] = Object.assign(stat[i], m); });
  k.on('exit', () => { stat[i].done = true; if (stat.every(s => s.done)) finish(); });
  kids.push(k);
}

const beat = setInterval(() => {
  const w = stat.reduce((a, s) => a + s.written, 0);
  const sk = stat.reduce((a, s) => a + s.skipped, 0);
  const h = (Date.now() - t0) / 3600000;
  process.stderr.write(`\r${w.toLocaleString('fr')} notees, ${sk.toLocaleString('fr')} ignorees` +
    (h > 0.01 ? `  (${Math.round(w / h).toLocaleString('fr')}/h)` : ''));
}, 2000);

function finish() {
  clearInterval(beat);
  const w = stat.reduce((a, s) => a + s.written, 0);
  const sk = stat.reduce((a, s) => a + s.skipped, 0);
  process.stderr.write('\r');
  console.log(`${w.toLocaleString('fr')} positions notees, ${sk.toLocaleString('fr')} ignorees, ` +
    `en ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${path.relative(HERE, OUTDIR)}`);
  process.exit(0);
}
