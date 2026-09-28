// Outcome-labelled self-play, the training data that has no depth ceiling.
//
// A position's label is who actually won the game it came from. That differs from labelling with
// a search score in two ways that both matter: it is free (no deep search per position, so a
// position costs one shallow move rather than a 20,000-node search), and it cannot be outrun —
// a network trained to predict a 20,000-node search is worth nothing once the search exceeds
// 20,000 nodes, which is exactly what made the first network useless at the worker's budget.
//
// A deep score is also recorded every SCORE_EVERY positions, because training on a blend of
// outcome and evaluation beats either alone: the outcome is unbiased but very noisy, the
// evaluation is biased but precise.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const D = require('./duel.js');
const A = L.loadEngine(undefined, { weights: process.env.WEIGHTS || false });
const E = A.Engine;

const SEED = Number(process.env.SEED || 1);
const PLAY_NODES = Number(process.env.PLAY_NODES || 8000);
const NOISE = Number(process.env.NOISE || 60);
const GAMES = Number(process.env.GAMES || 2000);
const SCORE_EVERY = Number(process.env.SCORE_EVERY || 12);
const LABEL_NODES = Number(process.env.LABEL_NODES || 20000);
const OUT = process.env.OUT || ('out_' + SEED + '.csv');
// Le fichier de POLITIQUE, a cote des etiquettes de valeur. La recherche profonde de 240 000
// noeuds trouve un meilleur coup en meme temps qu'un score, et jusqu'ici seul le score etait
// garde: le coup, qui a coute exactement le meme calcul, etait jete. Or l'ordre des coups est ce
// qui decide du rendement d'un alpha-beta -- un coup essaye en premier au bon moment vaut plus
// qu'une evaluation plus fine -- et c'est aussi ce qui permettrait de remplacer le filtre de murs
// candidats, qui ecarte la moitie des murs legaux dans le generateur, la seule place ou une
// erreur ne se rattrape a aucune profondeur. Fichier separe pour ne pas toucher au format que
// train.py sait lire: une colonne de plus dans le CSV principal et le parseur relit les
// etiquettes a cote.
const POL = process.env.POL || (OUT.replace(/(\.csv)?$/, '') + '_pol.csv');
// Every FLUSH rows go to disk. It was 3 000, which at 8 000 nodes a move was a couple of
// minutes; at 120 000 it is half an hour, and for that half hour the run writes no file at all
// and looks from outside exactly like a run that never started. Smaller blocks cost a few more
// appends an hour and buy a file that exists.
const FLUSH = Number(process.env.FLUSH || 600);
// A live file beside the data: the position on the board right now, and the counts so far.
// The CSV cannot answer "is this working" until its first flush; this can, every few seconds,
// and it is also what lets the games be watched rather than only counted.
const LIVE = process.env.LIVE || (OUT.replace(/[^/\\]+$/, '') + 'live_' + SEED + '.json');
let liveAt = 0;
function live(s, ply) {
  const now = Date.now();
  if (now - liveAt < 350) return;
  liveAt = now;
  try {
    fs.writeFileSync(LIVE, JSON.stringify({
      seed: SEED, games, positions, ply,
      pos: L.encodePos(s), turn: s.turn, winner: s.winner,
      by: s.wallBy,

      updated: new Date().toISOString(),
    }));
  } catch (e) { /* the watcher can miss a frame */ }
}

// STOP is checked HERE and not only in genfarm, because a stream outlives its parent. When the
// farm process dies -- killed, crashed, or replaced by the watchdog -- its children keep running
// with no one able to stop them: they ignore the STOP file, they compete for the cores with
// whatever replaced them, and the only way out is hunting PIDs. One file test per game fixes it.
const STOP_FILE = path.join(__dirname, 'STOP');
const stopped = () => { try { return fs.existsSync(STOP_FILE); } catch (e) { return false; } };

const feat = new Float64Array(E.NET_FEATURES);
let rows = [], polRows = [], games = 0, positions = 0;
// Positions enregistrees depuis le debut du flux, y compris celles des parties jetees ensuite.
// `positions` ne peut PAS tenir ce role: il n'avance qu'a la fin d'une partie, quand ses lignes
// sont ecrites -- donc pendant une partie il ne bouge pas, et `positions % SCORE_EVERY` restait
// CONSTANT d'un bout a l'autre de la partie. Resultat: toutes les positions d'une partie sur
// douze recevaient un score profond et aucune des onze autres, au lieu d'une position sur douze
// partout. Mesure sur les 1 675 810 lignes produites: 137 721 scores ranges en 3 289 blocs
// contigus de ~42 lignes, c'est-a-dire des parties entieres. Le signal de score couvrait 6% des
// parties au lieu de toutes -- et c'est pourquoi le melanger a la cible n'a rien change trois
// fois de suite. Le cout total est identique dans les deux cas, seule la repartition changeait.
let sampled = 0;
for (let g = 0; g < GAMES; g++) {
  if (stopped()) { console.log('\nSTOP present, arret du flux ' + SEED); break; }
  const rnd = L.rng(SEED * 7919 + g);
  const s = D.makeOpening(A, L.startState(A.Rules), 2 + ((rnd() * 7) | 0), rnd);
  if (s.winner != null) continue;
  const seen = [];
  E.clearTable();
  for (let ply = 0; ply < 200 && s.winner == null; ply++) {
    const pos = E.fromRules(s);
    E.netFeatures(pos, feat);
    let score = '', bestId = -1;
    if (SCORE_EVERY && sampled % SCORE_EVERY === 0) {
      const deep = E.analyse(pos, { budgetMs: 1e9, maxNodes: LABEL_NODES });
      let y = deep.score;
      if (y > E.PROVEN) y = 3000; else if (y < -E.PROVEN) y = -3000;
      score = String(Math.max(-3000, Math.min(3000, y)));
      bestId = L.actionId(E.toAction(pos, deep.best));
    }
    // The POSITION is stored, not only the features. A features-only file cannot be
    // re-featurised, and the feature set is the suspected ceiling — so the 520,000 rows
    // generated before this line existed are spent, and any richer feature set would have
    // had to pay for its data again. The token is 39 characters and lossless: same features,
    // same Zobrist hash, same evaluation after a round trip (postest.js).
    seen.push({ pos: L.encodePos(s), f: Array.from(feat, v => v.toFixed(4)).join(','), turn: s.turn, score, bestId });
    sampled++;
    const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: PLAY_NODES, noise: NOISE });
    // Un resultat PROUVE est deja le resultat: rien a gagner a le jouer. Ce qui suivait la
    // preuve, c'etait 71% des demi-coups -- et quand le perdant n'a plus un seul coup qui
    // change quelque chose, tous ses coups se valent, le bruit en choisit un au hasard, les
    // deux pions font des allers-retours jusqu'au plafond de 200 et la partie ENTIERE etait
    // jetee. Un quart des parties finissaient comme ca, sans apparaitre dans aucun compteur.
    //
    // Le signe a ete verifie avant d'etre pose ici: sur 14 parties, le vainqueur annonce par
    // la preuve et le vainqueur obtenu en jouant jusqu'au bout se sont accordes 14 fois. Une
    // erreur de signe aurait inverse en silence l'etiquette de toutes ces positions.
    if (r.proven) { s.winner = r.score > 0 ? s.turn : 1 - s.turn; break; }
    L.applyAction(A.Rules, s, E.toAction(pos, r.best));
    live(s, ply);
  }
  if (s.winner == null) continue;
  games++;
  for (const p of seen) {
    rows.push(p.pos + ',' + p.f + ',' + (s.winner === p.turn ? 1 : 0) + ',' + p.score); positions++;
    // La meme position sert de cible de valeur et de cible de politique, et le resultat de la
    // partie est deja connu ici: une ligne de politique porte donc aussi son issue, ce qui evite
    // d'avoir a recoller deux fichiers par la suite.
    if (p.bestId >= 0) polRows.push(p.pos + ',' + p.score + ',' + p.bestId + ',' + (s.winner === p.turn ? 1 : 0));
  }
  live(s, -1);
  if (rows.length >= FLUSH) {
    fs.appendFileSync(OUT, rows.join('\n') + '\n'); rows = [];
    if (polRows.length) { fs.appendFileSync(POL, polRows.join('\n') + '\n'); polRows = []; }
    process.stdout.write(`\r${games} games, ${positions} positions`);
  }
}
if (rows.length) fs.appendFileSync(OUT, rows.join('\n') + '\n');
if (polRows.length) fs.appendFileSync(POL, polRows.join('\n') + '\n');
console.log(`\n${positions} positions from ${games} decided games -> ${OUT}`);
