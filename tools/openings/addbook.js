// Adds the named openings to Path's book — all of them, whatever the engine thinks of them.
//
// The first version of this filtered by the engine's own judgement and threw most of the
// characteristic wall moves out: Standard's e3v came back 15% below the move Path prefers,
// Shatranj's d1v 7%, and the Reed Opening's four walls are not even generated, because they sit
// far from both pawns and off both shortest paths.
//
// That was the wrong test. The book is not consulted to CHOOSE Path's moves — the only reader
// is anBook() in app.js, which uses it to label a move "Book move" instead of grading it. And
// an opening move is rarely the strongest move available: it is played to reach a structure
// that pays off later, which is the whole reason a book exists. Grading published theory as a
// blunder because a 1.5-million-node search prefers something else is exactly the mistake the
// book is there to prevent.
//
// The engine's opinion is still printed, because it is worth knowing — it just does not decide.
//
//   node tools/openings/addbook.js [msPerPosition]   (0 = skip the opinion, just add)
const fs = require('fs'), path = require('path');
global.window = {};
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
const root = path.join(__dirname, '../..');
eval(fs.readFileSync(path.join(root, 'rules.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'path/engine.js'), 'utf8'));
const R = window.Rules, E = window.Engine;
const D = require('./data.js');
const B = require('./build.js');
const MS = Number(process.argv[2] || 0);

const book = {};
const report = [];
for (const o of D.lines) {
  const toks = o.line.split(' ').map(B.fromGlendenning);
  const names = o.line.split(' ');
  const s = R.createState({ size: 9, walls: 10, players: 2 });
  const opinions = [];
  for (let i = 0; i < toks.length; i++) {
    const pos = E.fromRules(s);
    const mv = E.fromAction(pos, toks[i]);       // the same encoder app.js looks the move up with
    const key = pos.hashLo + ':' + pos.hashHi;   // and the same key
    const arr = book[key] || (book[key] = []);
    if (!arr.includes(mv)) arr.push(mv);
    if (MS > 0) {
      const res = E.analyse(pos, { budgetMs: MS, maxDepth: 24, exactRoot: true });
      const rm = (res.moves || []).find(x => x.move === mv);
      const gap = rm ? (E.evalToWinProb(res.score) - E.evalToWinProb(rm.score)) * 100 : null;
      if (gap == null) opinions.push(names[i] + ' (hors candidats)');
      else if (gap > 2) opinions.push(names[i] + ' (-' + gap.toFixed(1) + '%)');
    }
    if (toks[i].type === 'move') R.applyMove(s, toks[i].to);
    else R.applyWall(s, toks[i].orient, toks[i].r, toks[i].c);
  }
  report.push({ name: o.name, n: toks.length, opinions });
}

const existing = fs.readFileSync(path.join(root, 'path/book.js'), 'utf8');
const m = /=\s*(\{[\s\S]*?\});\s*$/.exec(existing.trim());
if (!m) throw new Error('impossible de relire path/book.js');
const old = JSON.parse(m[1]);
let added = 0, extended = 0;
for (const k of Object.keys(book)) {
  if (!old[k]) { old[k] = book[k]; added++; }
  else for (const mv of book[k]) if (!old[k].includes(mv)) { old[k].push(mv); extended++; }
}
const head = existing.slice(0, existing.indexOf('(typeof window'));
fs.writeFileSync(path.join(root, 'path/book.js'),
  head.replace(/\n*$/, '\n') +
  "// The named openings from tools/openings/data.js are merged in by tools/openings/addbook.js.\n" +
  "// They are here unconditionally: an opening move is a book move by definition, and several of\n" +
  "// them are moves this engine would not choose. That is the point — they are played for what\n" +
  "// they set up later, and the book exists so they are labelled rather than graded.\n" +
  "(typeof window !== 'undefined' ? window : self).OpeningBook = " + JSON.stringify(old) + ";\n");

console.log('ouverture             coups   ce que Path en pense');
for (const r of report)
  console.log(r.name.padEnd(21) + String(r.n).padStart(5) + '   ' + (r.opinions.length ? r.opinions.join(', ') : (MS > 0 ? 'rien a redire' : '(non evalue)')));
console.log(`\n${added} positions ajoutees, ${extended} coups ajoutes a des positions connues; livre = ${Object.keys(old).length} positions`);
