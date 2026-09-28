// Shared test harness for Path. Lives in the repo rather than a temp directory because two
// machine restarts have now wiped it mid-campaign, taking the training data with it.
//
// Loads the engine's real files into an isolated sandbox, one sandbox per instance — each side
// of a match needs its OWN engine, because one instance means one shared transposition table
// and then the side with the smaller budget reads entries the other side paid for.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');

function loadEngine(engineFile, opts) {
  const o = opts || {};
  const sandbox = { console, performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 }, Math, Date, JSON };
  sandbox.self = sandbox; sandbox.window = undefined;
  vm.createContext(sandbox);
  const files = ['rules.js'];
  if (o.weights !== false) files.push(o.weights || 'path/netweights.js');
  files.push(engineFile || 'path/engine.js', 'path/book.js');
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  return { Rules: sandbox.Rules, Engine: sandbox.Engine, Book: sandbox.OpeningBook };
}

const startState = R => R.createState({ size: 9, walls: 10, players: 2 });

function applyAction(R, s, a) {
  if (a.type === 'move') R.applyMove(s, a.to);
  else R.applyWall(s, a.orient, a.r, a.c);
}

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A position, encoded losslessly into one fixed-width token with no commas, so it drops into a
// CSV field. Storing FEATURES was a mistake: 520,000 positions were generated before it became
// clear that the 14-feature set is the ceiling, and a feature file cannot be re-featurised —
// the position it came from is gone. Storing the position instead costs 39 characters and makes
// every future feature set free to try on data already paid for.
//
// 9x9 means 8x8 wall slots, so each orientation is exactly 64 bits: r*8+c, low word first.
const POS_LEN = 39;

function encodePos(s) {
  if (s.rows !== 9 || s.cols !== 9 || s.players !== 2) throw new Error('encodePos: 9x9 two-player only');
  const bits = (set) => {
    let lo = 0, hi = 0;
    for (const k of set) {
      const i = k.indexOf(','), r = +k.slice(0, i), c = +k.slice(i + 1);
      if (r < 0 || r > 7 || c < 0 || c > 7) throw new Error('encodePos: wall out of range ' + k);
      const b = r * 8 + c;
      if (b < 32) lo |= (1 << b); else hi |= (1 << (b - 32));
    }
    return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
  };
  const p = s.pawns;
  const out = bits(s.hWalls) + bits(s.vWalls)
    + p[0].r.toString(16) + p[0].c.toString(16) + p[1].r.toString(16) + p[1].c.toString(16)
    + s.walls[0].toString(16) + s.walls[1].toString(16) + String(s.turn);
  if (out.length !== POS_LEN) throw new Error('encodePos: width ' + out.length);
  return out;
}

function decodePos(R, t) {
  if (t.length !== POS_LEN) throw new Error('decodePos: width ' + t.length);
  const s = startState(R);
  const unbits = (set, hex) => {
    const hi = parseInt(hex.slice(0, 8), 16) >>> 0, lo = parseInt(hex.slice(8, 16), 16) >>> 0;
    for (let b = 0; b < 64; b++) {
      const on = b < 32 ? (lo >>> b) & 1 : (hi >>> (b - 32)) & 1;
      if (on) set.add(((b / 8) | 0) + ',' + (b % 8));
    }
  };
  s.hWalls = new Set(); s.vWalls = new Set();
  unbits(s.hWalls, t.slice(0, 16));
  unbits(s.vWalls, t.slice(16, 32));
  s.pawns = [{ r: parseInt(t[32], 16), c: parseInt(t[33], 16) },
             { r: parseInt(t[34], 16), c: parseInt(t[35], 16) }];
  s.walls = [parseInt(t[36], 16), parseInt(t[37], 16)];
  s.turn = +t[38];
  s.winner = null;
  return s;
}

// Une action en UN entier, pour qu'un coup tienne dans une colonne de CSV et serve de cible a un
// classifieur. 0..80 = deplacer le pion sur la case r*9+c, 81..144 = mur horizontal au creneau
// r*8+c, 145..208 = mur vertical. Definie ici et nulle part ailleurs: deux encodages du meme coup
// qui divergent d'une unite donneraient un reseau qui apprend a jouer a cote, sans rien signaler.
const ACT_WALL_H = 81, ACT_WALL_V = 145, ACT_N = 209;

function actionId(a) {
  if (!a) return -1;
  if (a.type === 'move') return a.to.r * 9 + a.to.c;
  return (a.orient === 'h' ? ACT_WALL_H : ACT_WALL_V) + a.r * 8 + a.c;
}

function actionFromId(id) {
  if (id < 0 || id >= ACT_N) return null;
  if (id < ACT_WALL_H) return { type: 'move', to: { r: (id / 9) | 0, c: id % 9 } };
  const o = id < ACT_WALL_V ? 'h' : 'v', j = id - (o === 'h' ? ACT_WALL_H : ACT_WALL_V);
  return { type: 'wall', orient: o, r: (j / 8) | 0, c: j % 8 };
}

module.exports = { ROOT, loadEngine, startState, applyAction, rng, encodePos, decodePos, POS_LEN,
                   actionId, actionFromId, ACT_N };
