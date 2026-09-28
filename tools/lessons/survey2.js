// A wider pool. Each named opening is continued for a few more plies by the engine itself, with
// noise so the continuations differ, and every position along the way is measured. Opening lines
// alone gave only three positions with a wide enough margin -- and those are all "keep pace",
// which is one lesson, not a set. The interesting positions are a little further in, where the
// walls are down and there is something to decide.
const fs = require('fs'), path = require('path');
global.window = {}; global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
const root = path.join(__dirname, '../..');
eval(fs.readFileSync(path.join(root, 'rules.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'path/engine.js'), 'utf8'));
const R = window.Rules, E = window.Engine;
const B = require('../openings/build.js');
const D = require('../openings/data.js');

const NODES = Number(process.env.NODES || 900000);
const EXTRA = Number(process.env.EXTRA || 10);      // plies to continue past the book line
const RUNS = Number(process.env.RUNS || 3);         // continuations per opening
const tokOf = a => a.type === 'move' ? 'm' + a.to.r + a.to.c : a.orient + a.r + a.c;
const glen = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function look(s) {
  E.clearTable();
  const pos = E.fromRules(s);
  const res = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, maxDepth: 30, exactRoot: true });
  const ranked = (res.moves || []).slice().sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const bestA = E.toAction(pos, ranked[0].move);
  const gap = ranked[1] ? (E.evalToWinProb(ranked[0].score) - E.evalToWinProb(ranked[1].score)) * 100 : 100;
  return { tok: tokOf(bestA), glen: glen(bestA), kind: bestA.type, gap,
           wp: E.evalToWinProb(ranked[0].score) * 100, depth: res.depth };
}

const rows = [];
for (const o of D.lines) {
  for (let run = 0; run < RUNS; run++) {
    const s = R.createState({ size: 9, walls: 10, players: 2 });
    const setup = [];
    for (const t of o.line.split(' ')) {
      const a = B.fromGlendenning(t);
      setup.push(tokOf(a));
      if (a.type === 'move') R.applyMove(s, a.to); else R.applyWall(s, a.orient, a.r, a.c);
    }
    const rnd = rng(1000 + run * 97 + o.name.length);
    for (let k = 0; k < EXTRA && s.winner == null; k++) {
      const snap = R.serState(s);
      const a1 = look(R.deState(snap)), a2 = look(R.deState(snap));
      if (a1 && a2 && a1.tok === a2.tok && Math.abs(a1.gap - a2.gap) < 2.5)
        rows.push({ from: o.name, setup: setup.join(' '), turn: s.turn, ...a1, gap: Math.min(a1.gap, a2.gap) });
      // continue with a noisy engine move so the three runs diverge
      const pos = E.fromRules(s);
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: 40000, noise: 90 + ((rnd() * 60) | 0) });
      const act = E.toAction(pos, r.best);
      setup.push(tokOf(act));
      if (act.type === 'move') R.applyMove(s, act.to); else R.applyWall(s, act.orient, act.r, act.c);
    }
  }
  process.stderr.write('\r' + o.name + ' fait, ' + rows.length + ' positions');
}
process.stderr.write('\n');
rows.sort((x, y) => y.gap - x.gap);
fs.writeFileSync(path.join(__dirname, 'survey2.json'), JSON.stringify(rows, null, 1));
console.log('ecart  coup   type  trait  murs poses  venu de');
for (const r of rows.slice(0, 25))
  console.log(String(r.gap.toFixed(1) + '%').padStart(6), r.glen.padEnd(6),
    (r.kind === 'wall' ? 'mur ' : 'pion'), '   ' + r.turn + '   ',
    String(r.setup.split(' ').filter(t => t[0] !== 'm').length).padStart(6) + '     ', r.from);
console.log(`\n${rows.length} positions stables -> survey2.json`);
