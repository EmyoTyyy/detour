// Adds the moves the LESSONS teach to Path's book.
//
// A learner who is told "the answer here is e6", plays it in a real game, and then sees the
// review grade it as an inaccuracy has been taught two different things by the same program.
// The book is the place that settles it: anBook() in app.js reads it to label a move "Book
// move" INSTEAD of grading it, and nothing else reads it -- adding to it cannot change how
// Path plays, only what the review says about a move a human played.
//
// Each drill carries the position as a move sequence (`setup`) and the taught move (`answer`),
// so the key is simply the position reached by replaying the setup. Merged into path/book.js
// the same way tools/openings/addbook.js merges the named openings, and idempotent for the
// same reason: it re-reads the book and only adds what is missing.
//
//   node tools/lessons/addbook.js
const fs = require('fs'), path = require('path');
global.window = {};
global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
const root = path.join(__dirname, '../..');
for (const f of ['rules.js', 'path/engine.js', 'path/openings.js', 'path/lessons.js'])
  eval(fs.readFileSync(path.join(root, f), 'utf8'));
const R = window.Rules, E = window.Engine, O = window.Openings, L = window.Lessons;

const apply = (s, a) => (a.type === 'move' ? R.applyMove(s, a.to) : R.applyWall(s, a.orient, a.r, a.c));

const book = {};
const report = [];
for (const d of (L && L.drills) || []) {
  if (!d.answer) continue;
  const s = R.createState({ size: 9, walls: 10, players: 2 });
  let bad = null;
  for (const t of String(d.setup || '').split(' ').filter(Boolean)) {
    const a = O.actionOf(t);
    if (!a) { bad = t; break; }
    // The setup is published theory replayed on this board; if it ever stops being legal the
    // lesson is broken and silently writing a wrong key would hide that.
    const ok = a.type === 'wall'
      ? R.canPlaceWall(s, s.turn, a.orient, a.r, a.c)
      : R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c);
    if (!ok) { bad = t; break; }
    apply(s, a);
  }
  if (bad) { report.push({ id: d.id, err: 'setup illegal a ' + bad }); continue; }
  const ans = O.actionOf(d.answer);
  const legal = ans && (ans.type === 'wall'
    ? R.canPlaceWall(s, s.turn, ans.orient, ans.r, ans.c)
    : R.legalMoves(s, s.turn).some(m => m.r === ans.to.r && m.c === ans.to.c));
  if (!legal) { report.push({ id: d.id, err: 'reponse illegale: ' + d.answer }); continue; }
  const pos = E.fromRules(s);
  const mv = E.fromAction(pos, ans);
  const key = pos.hashLo + ':' + pos.hashHi;
  (book[key] || (book[key] = [])).push(mv);
  report.push({ id: d.id, move: d.answerText || d.answer });
}

const existing = fs.readFileSync(path.join(root, 'path/book.js'), 'utf8');
// Couper a l'affectation elle-meme, quelle que soit sa forme. Elle s'ecrit "window.OpeningBook ="
// quand genbook.js vient de passer et "(typeof window !== 'undefined' ? window : self)" quand c'est
// ce script: chercher la seconde forme avec indexOf rendait -1 sur un livre frais, slice(0, -1)
// gardait alors TOUT le fichier, et une deuxieme affectation etait ajoutee a la suite. Le livre
// restait juste -- la derniere affectation gagne -- mais la page chargeait 40 Ko de copie morte,
// et un second passage n'aurait plus su relire le fichier du tout.
const asg = existing.search(/^[^\n]*\bOpeningBook\s*=/m);
if (asg < 0) throw new Error('affectation OpeningBook introuvable dans path/book.js');
const m = /=\s*(\{[\s\S]*\});\s*$/.exec(existing.slice(asg).trim());
if (!m) throw new Error('impossible de relire path/book.js');
const old = JSON.parse(m[1]);
let added = 0, extended = 0, already = 0;
for (const k of Object.keys(book)) {
  for (const mv of book[k]) {
    if (!old[k]) { old[k] = [mv]; added++; }
    else if (!old[k].includes(mv)) { old[k].push(mv); extended++; }
    else already++;
  }
}
const head = existing.slice(0, asg);
fs.writeFileSync(path.join(root, 'path/book.js'),
  head.replace(/\n*$/, '\n') +
  "// The moves the lessons teach are merged in by tools/lessons/addbook.js, so a move a learner\n" +
  "// was taught is labelled rather than graded when they play it in a game.\n" +
  "(typeof window !== 'undefined' ? window : self).OpeningBook = " + JSON.stringify(old) + ";\n");

console.log('lecon                     coup enseigne');
for (const r of report) console.log('  ' + String(r.id).padEnd(24) + (r.err ? 'ERREUR: ' + r.err : r.move));
console.log(`\n${added} positions ajoutees, ${extended} coups ajoutes, ${already} deja presents; `
  + `livre = ${Object.keys(old).length} positions`);
