// Recompute the feature vector for stored positions, with whatever feature set the given engine
// defines. This is the tool the first 520,000 rows could not have: they stored features, so the
// only way to try a different feature set was to play every game again. A position file is
// re-featurised in seconds.
//
//   ENGINE=path/engine.js IN='data/pos_*.csv' OUT=data/feat_v1.csv node refeat.js
const fs = require('fs'), path = require('path'), glob = require('path');
const L = require('./lib.js');
const ENGINE = process.env.ENGINE || 'path/engine.js';
const OUT = process.env.OUT || 'data/refeat.csv';
const IN = (process.env.IN || 'data/pos_*.csv');

const A = L.loadEngine(ENGINE, { weights: false });   // no weights: features must not depend on them
const E = A.Engine, R = A.Rules;
const NF = E.NET_FEATURES;
const feat = new Float64Array(NF);

// resolve the glob by hand, so the script needs no dependency
const dir = path.dirname(IN), base = path.basename(IN);
const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const files = fs.readdirSync(dir).filter(f => rx.test(f)).sort().map(f => path.join(dir, f));
if (!files.length) { console.log('no input matching ' + IN); process.exit(1); }
console.log(`${ENGINE}: ${NF} features; ${files.length} input file(s)`);

fs.writeFileSync(OUT, '');
let n = 0, bad = 0, out = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split(',');
    // pos, 14 old features, outcome, score  -> the old features are discarded, the position is not
    if (c[0].length !== L.POS_LEN) { bad++; continue; }
    const outcome = c[c.length - 2], score = c[c.length - 1];
    let s;
    try { s = L.decodePos(R, c[0]); } catch (e) { bad++; continue; }
    E.netFeatures(E.fromRules(s), feat);
    out.push(Array.from(feat, v => v.toFixed(4)).join(',') + ',' + outcome + ',' + score);
    n++;
    if (out.length >= 20000) { fs.appendFileSync(OUT, out.join('\n') + '\n'); out = []; process.stdout.write(`\r${n} positions`); }
  }
}
if (out.length) fs.appendFileSync(OUT, out.join('\n') + '\n');
console.log(`\n${n} positions re-featurised -> ${OUT}${bad ? '  (' + bad + ' unusable rows skipped)' : ''}`);
