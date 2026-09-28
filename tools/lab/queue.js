// A resumable queue of lab runs, in Node so it runs on Windows too.
//
// nightq.sh and watch.sh do this on Linux, in bash. The second machine is Windows 11, and
// rewriting them there would leave two copies of the same logic to keep in step, so this
// replaces both: it is the only queue runner, and it works on either box.
//
//   node queue.js                       # runs queue.jobs.json, resumable
//   JOBS=gen.jobs.json WORKERS=10 node queue.js
//
// Resumable means: every job carries a name, and a name already ANSWERED in the log is skipped.
// So it can be started as many times as necessary -- after a crash, after a reboot, behind a
// queue that was already running -- and it costs at most the job that was in flight.
//
// "Answered" is the part bash got wrong once. The original test was `grep -A6` for the result
// line, and before that `-A3`, which never reached it: the test was always false and the queue
// re-ran every question it had already answered, six hours of cores producing numbers it
// already had. Here the log is parsed into blocks properly, so the distance from the header to
// the result cannot silently break it again.
//
// TO STOP: create a file called STOP beside this one. It is checked before every job and while
// one runs, so no process hunting is needed. Delete it to start again.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const JOBS = path.resolve(HERE, process.env.JOBS || 'queue.jobs.json');
const LOG = path.resolve(HERE, process.env.LOG || 'queue_results.log');
const STOP = path.join(HERE, 'STOP');
// A machine-readable heartbeat, rewritten while a job runs. Without it a 45-minute match shows
// nothing at all until it ends: parmatch reports its progress on stderr, which this used to
// throw away, so from the outside a long run and a hung one looked exactly alike.
const STATUS = path.resolve(HERE, process.env.STATUS || 'queue_status.json');

// What counts as a finished job, per tool. A block with the header but no marker is a job that
// was interrupted, and it gets run again -- which is the whole point of the file.
const DONE_MARK = {
  parmatch: /A scores/,
  gen: /positions from \d+ decided games/,
  ttsize: /current scores/,
  netmatch: /A scores/,
  engmatch: /A scores/,
};

const stamp = () => new Date().toTimeString().slice(0, 5);

// The log, split into blocks by their headers. Everything between one header and the next
// belongs to that job, so "did this job finish" is a question about its own block and nothing
// else -- no counting of lines, no guessing how far below the header the answer sits.
function answered(log) {
  const done = new Set();
  let name = null, body = [];
  const close = () => {
    if (name && body.some(l => Object.values(DONE_MARK).some(re => re.test(l)))) done.add(name);
    name = null; body = [];
  };
  for (const line of log.split('\n')) {
    const m = /^=== (.*?) {2}\(\d\d:\d\d\) ===$/.exec(line.trim());
    if (m) { close(); name = m[1]; continue; }
    if (name) body.push(line);
  }
  close();
  return done;
}

function stopped() {
  if (!fs.existsSync(STOP)) return false;
  return true;
}

let STATE = { machine: os.hostname(), job: null, at: 0, total: 0, since: null, progress: '', done: [], updated: null };
function publish(extra) {
  Object.assign(STATE, extra || {}, { updated: new Date().toISOString() });
  try { fs.writeFileSync(STATUS, JSON.stringify(STATE, null, 1)); } catch (e) { /* a busy reader, next tick */ }
}

function run(job) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, job.env || {});
    if (process.env.WORKERS && !(job.env && job.env.WORKERS)) env.WORKERS = process.env.WORKERS;
    const tool = (job.tool || 'parmatch') + '.js';
    // spawn with an explicit interpreter and no shell: a job's env values are data, and on
    // Windows a shell would also have to be quoted differently from a POSIX one.
    const kid = spawn(process.execPath, [path.join(HERE, tool)], { cwd: HERE, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    kid.stdout.on('data', d => { out += d; });
    // parmatch's "12/60 pairs" counter comes down stderr, gen.js's "N games" down stdout. Both
    // are progress rather than answer, and both are what makes a live view possible.
    let beat = 0;
    const tick = (d) => {
      const line = String(d).split(/[\r\n]+/).filter(x => x.trim()).pop();
      if (!line) return;
      STATE.progress = line.trim();
      const now = Date.now();
      if (now - beat > 3000) { beat = now; publish(); }      // the file, not every packet
    };
    kid.stderr.on('data', tick);
    kid.stdout.on('data', tick);
    // A STOP file has to reach a job already running, or stopping means waiting out a match.
    const watch = setInterval(() => { if (stopped()) { try { kid.kill(); } catch (e) { /* gone */ } } }, 20000);
    kid.on('exit', (code) => {
      clearInterval(watch);
      // parmatch writes its progress without newlines ("2/60 pairs4/60 pairs..."); the answer
      // is the tail, so keep the last few real lines and drop the counter.
      const lines = out.split('\n').map(l => l.replace(/^.*pairs(?=[A-Za-z])/, '').trimEnd()).filter(l => l.trim());
      resolve({ code, text: lines.slice(-6).join('\n') });
    });
  });
}

(async () => {
  if (!fs.existsSync(JOBS)) {
    console.log('pas de fichier de travaux: ' + JOBS);
    process.exit(1);
  }
  // Read once, up front. bash reads a script incrementally while running it, so editing a
  // running queue corrupted it mid-flight; loading the list here means the file on disk can be
  // edited freely while this one keeps going.
  const jobs = JSON.parse(fs.readFileSync(JOBS, 'utf8'));
  fs.appendFileSync(LOG, '');
  const done = answered(fs.readFileSync(LOG, 'utf8'));
  console.log(`${jobs.length} travaux, ${done.size} deja repondus, journal ${path.basename(LOG)}`);

  publish({ total: jobs.length, at: [...done].length, done: [...done] });
  let at = 0;
  for (const job of jobs) {
    at++;
    if (stopped()) { console.log('STOP present, arret'); publish({ job: null, progress: 'STOP' }); break; }
    if (done.has(job.name)) { console.log(`[deja fait] ${job.name}`); continue; }
    const head = `=== ${job.name}  (${stamp()}) ===`;
    console.log(head);
    fs.appendFileSync(LOG, head + '\n');
    const t = Date.now();
    publish({ job: job.name, at, since: new Date().toISOString(), progress: 'demarrage' });
    const r = await run(job);
    const mins = ((Date.now() - t) / 60000).toFixed(1);
    const body = (r.text || `(rien: code de sortie ${r.code})`) + `\n(${mins} min)\n\n`;
    fs.appendFileSync(LOG, body);
    process.stdout.write(body);
    STATE.done.push(job.name);
    publish({ job: null, progress: `${job.name}: ${(r.text || '').split('\n').pop()}` });
  }
  console.log('file terminee ' + stamp());
  publish({ job: null, progress: 'file terminee' });
})();
