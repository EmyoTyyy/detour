// Reading the lab's heartbeat, shared by the terminal view (status.js) and the browser one
// (board.js) so the two cannot drift apart about what "stalled" means.
//
// Remote machines are read over the SSH that already exists rather than by having them listen
// on a port: one less service running on someone else's laptop, one less firewall rule to
// remember to close afterwards.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const HERE = __dirname;
const LOCAL = path.join(HERE, 'queue_status.json');
// A heartbeat is rewritten every three seconds. Two and a half minutes of silence is not a slow
// job, it is a stopped one -- and saying so is the whole reason this exists, because a long
// match and a hung one are otherwise indistinguishable from outside.
const STALE_MS = 150000;

function readLocal() {
  try {
    const s = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
    s.machine = s.machine || os.hostname();
    return s;
  } catch (e) {
    return { machine: os.hostname(), job: null, progress: 'pas de file lancee' };
  }
}

// spec is user@host:path/to/lab -- the path as the REMOTE writes it
function readRemote(spec) {
  const cut = spec.lastIndexOf(':');
  const who = spec.slice(0, cut), dir = spec.slice(cut + 1);
  return new Promise((resolve) => {
    // `type` for a Windows shell, `cat` for a POSIX one: which of the two answers tells us
    // which kind of machine it is, and neither needs to be configured in advance.
    const cmd = `type ${dir.replace(/\//g, '\\')}\\queue_status.json 2>nul || cat ${dir}/queue_status.json`;
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', who, cmd],
      { timeout: 12000 }, (err, stdout) => {
        if (err && !stdout) return resolve({ machine: who, offline: true });
        try { resolve(JSON.parse(String(stdout).replace(/\r/g, ''))); }
        catch (e) { resolve({ machine: who, offline: true }); }
      });
  });
}

function classify(s) {
  if (!s) return 'inconnu';
  if (s.offline) return 'injoignable';
  const age = s.updated ? Date.now() - new Date(s.updated).getTime() : Infinity;
  if (!s.job) return 'repos';
  return age > STALE_MS ? 'bloque' : 'travaille';
}

const ago = (iso) => {
  if (!iso) return '?';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return Math.round(s) + 's';
  if (s < 5400) return Math.round(s / 60) + 'min';
  return (s / 3600).toFixed(1) + 'h';
};

// Every machine at once, local first. Remotes are read in parallel: a machine that has gone off
// should cost one timeout, not delay every machine behind it.
async function readAll(remotes) {
  const rows = [readLocal()];
  const out = await Promise.all((remotes || []).map(readRemote));
  for (const r of out) rows.push(r);
  return rows.map(s => Object.assign({}, s, { state: classify(s), for: ago(s.since), seen: ago(s.updated) }));
}

module.exports = { readLocal, readRemote, readAll, classify, ago, STALE_MS };
