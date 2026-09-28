// Every position along every named opening, measured twice, so a drill can be picked from a
// pool of positions that are reachable, thematically tied to published theory, and -- most
// importantly -- have a move that is CLEARLY best.
//
// Measured twice because the engine is not bit-reproducible across searches in one process: the
// shortest-path cache carries between them and its 32-bit key collides about once in eighty
// games, which is enough to move a margin by a couple of points. A position whose two readings
// disagree is not a position to build a lesson on.
const fs = require('fs'), path = require('path');
global.window = {}; global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
const root = path.join(__dirname, '../..');
eval(fs.readFileSync(path.join(root, 'rules.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'path/engine.js'), 'utf8'));
const R = window.Rules, E = window.Engine;
const B = require('../openings/build.js');
const D = require('../openings/data.js');

const NODES = Number(process.env.NODES || 1200000);
const glen = a => a.type === 'move'
  ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

function look(s) {
  E.clearTable();
  const pos = E.fromRules(s);
  const res = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, maxDepth: 30, exactRoot: true });
  const ranked = (res.moves || []).slice().sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const gap = ranked[1] ? (E.evalToWinProb(ranked[0].score) - E.evalToWinProb(ranked[1].score)) * 100 : 100;
  return { best: glen(E.toAction(pos, ranked[0].move)), kind: E.toAction(pos, ranked[0].move).type,
           gap, depth: res.depth, n: ranked.length };
}

const rows = [];
for (const o of D.lines) {
  const toks = o.line.split(' ');
  const s = R.createState({ size: 9, walls: 10, players: 2 });
  for (let i = 0; i <= toks.length; i++) {
    if (i > 0) {
      const a = B.fromGlendenning(toks[i - 1]);
      if (a.type === 'move') R.applyMove(s, a.to); else R.applyWall(s, a.orient, a.r, a.c);
    }
    if (i < 2) continue;                       // the first plies are too open to have one answer
    const snap = R.serState(s);
    const a1 = look(R.deState(snap)), a2 = look(R.deState(snap));
    if (!a1 || !a2) continue;
    rows.push({ line: o.name, prefix: toks.slice(0, i).join(' '), turn: s.turn,
                best: a1.best, kind: a1.kind, gap: Math.min(a1.gap, a2.gap),
                stable: a1.best === a2.best && Math.abs(a1.gap - a2.gap) < 2.5, depth: a1.depth });
  }
}
rows.sort((x, y) => y.gap - x.gap);
console.log('ecart  stable coup   type  trait  ligne                 prefixe');
for (const r of rows.slice(0, 22))
  console.log(String(r.gap.toFixed(1) + '%').padStart(6), (r.stable ? '  oui ' : '  NON '),
    r.best.padEnd(6), (r.kind === 'wall' ? 'mur ' : 'pion'), '   ' + r.turn + '   ',
    r.line.padEnd(20), r.prefix);
fs.writeFileSync(path.join(__dirname, 'survey.json'), JSON.stringify(rows, null, 1));
console.log(`\n${rows.length} positions mesurees -> survey.json`);
