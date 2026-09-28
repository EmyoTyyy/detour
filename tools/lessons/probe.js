// Candidate drill positions. Each is reached by a real sequence, so it is legal and reachable by
// construction; Path then says what the best move is and by how much. A drill is only worth
// shipping if the best move is CLEARLY best -- otherwise the learner is being marked wrong for
// choosing between two good moves.
const fs = require('fs'), path = require('path');
global.window = {}; global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
const root = path.join(__dirname, '../..');
eval(fs.readFileSync(path.join(root, 'rules.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'path/engine.js'), 'utf8'));
const R = window.Rules, E = window.Engine;
const B = require('../openings/build.js');

const NODES = Number(process.env.NODES || 800000);

function build(seq) {
  const s = R.createState({ size: 9, walls: 10, players: 2 });
  for (const t of seq.split(' ').filter(Boolean)) {
    const a = B.fromGlendenning(t);
    if (a.type === 'move') R.applyMove(s, a.to); else R.applyWall(s, a.orient, a.r, a.c);
  }
  return s;
}
const toGlen = (pos, mv) => {
  const a = E.toAction(pos, mv);
  return a.type === 'move'
    ? String.fromCharCode(97 + a.to.c) + (9 - a.to.r)
    : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;
};

const CANDIDATES = require('./candidates.js');
for (const c of CANDIDATES) {
  const s = build(c.seq);
  const pos = E.fromRules(s);
  const res = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES, maxDepth: 30, exactRoot: true });
  const ranked = (res.moves || []).slice().sort((a, b) => b.score - a.score);
  const best = ranked[0], second = ranked[1];
  const gapWp = second ? (E.evalToWinProb(best.score) - E.evalToWinProb(second.score)) * 100 : 100;
  const a = E.toAction(pos, best.move);
  console.log(
    c.id.padEnd(18),
    'trait ' + s.turn,
    '| meilleur ' + toGlen(pos, best.move).padEnd(5),
    (a.type === 'wall' ? 'mur ' : 'pion'),
    '| 2e ' + (second ? toGlen(pos, second.move) : '—').padEnd(5),
    '| ecart ' + gapWp.toFixed(1) + '%',
    '| profondeur ' + res.depth,
    '| ' + ranked.length + ' coups');
}
