// The night watch: keeps both machines generating, and keeps a record of what happened.
//
//   nohup node watchnight.js --ssh titou@192.168.1.180:detour/tools/lab > watchnight.out 2>&1 &
//
// Two jobs, and the second matters as much as the first.
//
// It RESTARTS a farm whose heartbeat has died. A machine can stop for reasons nobody is awake
// to see -- a reboot for staged updates, a crash, a stream that wedged -- and the cost is not
// the incident, it is the hours afterwards during which nothing runs and nobody knows.
// Restarts use SEED0=auto, so a farm that comes back never replays the seeds of the one that
// died; a repeated seed regenerates identical games and appends them again, invisibly.
//
// It also WRITES DOWN the state every few minutes. Without that, "how did the night go" can
// only be answered by the size of the files at the end, which cannot tell a steady night from
// one that stopped at 2am and was restarted at 6. night.log can.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const S = require('./statuslib.js');

const HERE = __dirname;
const LOG = path.join(HERE, 'night.log');
const STOP = path.join(HERE, 'STOP');
const EVERY = Number(process.env.EVERY || 120000);     // check every two minutes
const DEAD_MS = Number(process.env.DEAD_MS || 300000); // five minutes of silence is dead
const remotes = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--ssh' && process.argv[i + 1]) remotes.push(process.argv[++i]);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const say = (line) => {
  const s = stamp() + '  ' + line;
  console.log(s);
  try { fs.appendFileSync(LOG, s + '\n'); } catch (e) { /* keep going */ }
};

const LOCAL_ENV = {
  WORKERS: process.env.LOCAL_WORKERS || '5', SEED0: 'auto', SEED_BASE: '3000',
  PLAY_NODES: '120000', LABEL_NODES: '240000', GAMES: '4000', NOISE: '60',
  OUTDIR: 'data/deep', LABEL: 'generation profonde 120k',
};

function reviveLocal() {
  const env = Object.assign({}, process.env, LOCAL_ENV);
  const out = fs.openSync(path.join(HERE, 'genfarm.out'), 'a');
  const kid = spawn(process.execPath, [path.join(HERE, 'genfarm.js')],
    { cwd: HERE, env, detached: true, stdio: ['ignore', out, out] });
  kid.unref();
  say('RELANCE locale (genfarm, graines auto)');
}

function reviveRemote(spec) {
  const cut = spec.lastIndexOf(':');
  const who = spec.slice(0, cut);
  // The scheduled task already carries the right environment and SEED0=auto, and runs as
  // SYSTEM -- so reviving is just asking Windows to run the same thing a reboot would.
  execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', who,
    'schtasks /run /tn DetourGen'], { timeout: 30000 }, (err, stdout, stderr) => {
    say('RELANCE ' + who + (err ? ' ECHEC: ' + String(stderr || err).trim().slice(0, 80) : ' (tache DetourGen)'));
  });
}

// Un match et une generation ecrivent le MEME queue_status.json, donc un battement perime ne dit
// pas laquelle des deux s'est arretee -- ni meme qu'il s'en est arrete une. Avant toute relance on
// regarde les processus, seule source qui ne peut pas etre confondue. Sans ce garde-fou, un match
// lance a la main (sweep_budgets.sh, par exemple, qui n'ecrit aucun battement) se faisait doubler
// d'une ferme de cinq ouvriers: le resultat du match restait bon, il compte des noeuds et pas des
// secondes, mais toute mesure de TEMPS devenait fausse et le match prenait trois fois plus long.
function localBusy() {
  try {
    const out = require('child_process').execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (/\bnode\b/.test(line) && /(genfarm|gen|parmatch)\.js/.test(line)) return line.trim();
    }
    return null;
  } catch (e) {
    return 'ps illisible';   // dans le doute on ne relance pas: doubler est pire qu'attendre
  }
}

let last = new Map();

async function tick() {
  if (fs.existsSync(STOP)) { say('STOP present, la veille s arrete'); process.exit(0); }
  let rows = [];
  try { rows = await S.readAll(remotes); } catch (e) { say('lecture impossible: ' + e.message); return; }

  const parts = [];
  for (const r of rows) {
    const m = r.machine || '?';
    const nums = /(\d+) parties finies, (\d+) positions/.exec(r.progress || '');
    const games = nums ? Number(nums[1]) : null;
    const prev = last.get(m);
    // Games finished SINCE the last check is the honest rate: a cumulative counter cannot tell
    // a machine that stopped an hour ago from one that is still going.
    const rate = (prev && games != null && games >= prev.games)
      ? Math.round((games - prev.games) / (EVERY / 3600000)) : null;
    parts.push(`${m}=${r.state}${games != null ? ' ' + games + 'p' : ''}${rate != null ? ' (' + rate + '/h)' : ''}`);
    last.set(m, { games, at: Date.now() });

    const age = r.updated ? Date.now() - new Date(r.updated).getTime() : Infinity;
    if (r.offline) { say('MUET ' + m + ' (injoignable)'); continue; }
    const isLocal = rows.indexOf(r) === 0;
    const revive = (raison) => {
      if (!isLocal) return reviveRemote(remotes[rows.indexOf(r) - 1]);
      const busy = localBusy();
      if (busy) return say(`${raison} ${m}, mais un travail tourne ici: pas de relance (${busy.slice(0, 60)})`);
      reviveLocal();
    };
    if (r.job && age > DEAD_MS) {
      say(`MORT ${m}: aucun battement depuis ${Math.round(age / 60000)} min`);
      revive('MORT');
    } else if (!r.job) {
      say(`ARRETEE ${m}: plus de tache en cours`);
      revive('ARRETEE');
    }
  }
  say(parts.join('  |  '));
}

say('veille de nuit demarree, ' + (remotes.length + 1) + ' machine(s), controle toutes les ' + (EVERY / 60000) + ' min');
tick();
setInterval(tick, EVERY);
