// The terminal view of the lab. The browser view is board.js; both read statuslib.js, so they
// cannot disagree about whether a machine is working or stuck.
//
//   node status.js
//   node status.js --ssh titou@192.168.1.180:detour/tools/lab
const S = require('./statuslib.js');

const EVERY = Number(process.env.EVERY || 4000);
const remotes = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--ssh' && process.argv[i + 1]) remotes.push(process.argv[++i]);
}

const LABEL = { travaille: '', repos: 'au repos', bloque: 'BLOQUE', injoignable: 'injoignable', inconnu: '?' };

function line(r) {
  const name = (r.machine || '?').slice(0, 22).padEnd(22);
  if (r.state === 'injoignable') return `  ${name} injoignable`;
  if (r.state === 'repos') return `  ${name} au repos \u2014 ${r.progress || ''}`.trimEnd();
  const head = `  ${name} ${r.job}  (depuis ${r.for})`;
  const tail = r.state === 'bloque' ? `   << rien depuis ${r.seen}, probablement arrete` : '';
  return head + '\n      ' + (r.progress || '') + tail;
}

async function draw() {
  const rows = await S.readAll(remotes);
  const out = [`\u2500\u2500 ${new Date().toLocaleTimeString()} \u2500\u2500`, ...rows.map(line)].join('\n');
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
  console.log(out);
}

draw();
setInterval(draw, EVERY);
