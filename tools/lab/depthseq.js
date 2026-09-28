// How deep does each table configuration get, on the SAME positions, with the table accumulating
// exactly as it does in a real game?
//
// The first version of this let each configuration play its own game, so they searched different
// positions and the depths were not comparable -- one of them wandered into a decided race and
// reported depth 28. Here one reference game is recorded once, and every configuration replays
// the identical sequence, never clearing, which is what the app does: nothing ever sends the
// worker a clear.
const L = require('./lib.js'), D = require('./duel.js');
const cfg = [
  ['direct 2^20', 'path/engine.js', null],
  ['direct 2^21', 'path/engine.js', 21],
  ['direct 2^22', 'path/engine.js', 22],
  ['godets 2^20', 'tools/lab/variants/engine-tt4way.js', null],
];
const ref = L.loadEngine('path/engine.js');
const R = ref.Rules;

// one reference game, played at a modest budget, recorded as states
const seq = [];
{
  const rnd = L.rng(Number(process.env.SEED || 4242));
  const s = D.makeOpening(ref, L.startState(R), 4, rnd);
  for (let ply = 0; ply < Number(process.env.PLIES || 40) && s.winner == null; ply++) {
    seq.push({ h: [...s.hWalls], v: [...s.vWalls], p: s.pawns.map(x => ({ ...x })), w: s.walls.slice(), t: s.turn });
    const pos = ref.Engine.fromRules(s);
    const r = ref.Engine.analyse(pos, { budgetMs: 1e9, maxNodes: 8000, noise: 40 });
    L.applyAction(R, s, ref.Engine.toAction(pos, r.best));
  }
}
const mk = p => { const s = L.startState(R); s.hWalls = new Set(p.h); s.vWalls = new Set(p.v);
  s.pawns = p.p.map(x => ({ ...x })); s.walls = p.w.slice(); s.turn = p.t; s.winner = null; return s; };

const N = Number(process.env.NODES || 500000);
console.log(`${seq.length} positions identiques, ${N} noeuds, table jamais videe`);
const out = [];
for (const [name, file, bits] of cfg) {
  const e = L.loadEngine(file);
  if (bits) e.Engine.setTableBits(bits);
  e.Engine.clearTable();                       // once, as at the start of a game
  const d = [];
  for (const p of seq) d.push(e.Engine.analyse(e.Engine.fromRules(mk(p)), { budgetMs: 1e9, maxNodes: N }).depth);
  out.push([name, d]);
}
const cols = out.map(o => o[0].padStart(13)).join('');
console.log('coup         ' + cols);
for (let i = 0; i < seq.length; i += 5)
  console.log(String(i).padStart(4) + '         ' + out.map(o => String(o[1][i]).padStart(13)).join(''));
console.log('moyenne      ' + out.map(o => (o[1].reduce((a, b) => a + b, 0) / o[1].length).toFixed(2).padStart(13)).join(''));
console.log('2e moitie    ' + out.map(o => { const h = o[1].slice(o[1].length >> 1);
  return (h.reduce((a, b) => a + b, 0) / h.length).toFixed(2).padStart(13); }).join(''));
