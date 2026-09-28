// Self-play generation across every core of one machine, with a live heartbeat.
//
//   WORKERS=10 SEED0=4000 PLAY_NODES=120000 LABEL_NODES=240000 OUTDIR=data/deep node genfarm.js
//
// gen.js is one stream of games. This runs N of them side by side on disjoint seeds and
// aggregates their progress into the same queue_status.json that status.js reads, so a night of
// generation is watchable from either machine instead of being a black box until morning.
//
// Seeds must not collide. gen.js picks a game's opening from rng(SEED * 7919 + g), so two
// workers sharing a seed do not produce twice the data -- they produce the same data twice, and
// the duplicate rows are invisible in the CSV. SEED0 is therefore per MACHINE, and the machines
// are given ranges far enough apart that no overlap is possible.
//
// Why deep games. The 1.3 million rows already on disk were generated at 8 000 nodes a move.
// An outcome label says "the side to move here went on to win", which is only evidence about
// the POSITION if the play that followed was good -- otherwise it is evidence about a later
// blunder. Shallow data is cheap and we already have all we can use; what we have never had is
// data from games played near the budget people actually play at.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const N = Number(process.env.WORKERS || Math.max(1, os.cpus().length - 2));
// SEED0=auto picks a range above everything already in OUTDIR. This exists so the farm can be
// restarted UNATTENDED -- at boot, after a crash -- without a human choosing seeds. Reusing a
// seed is the one mistake that does not announce itself: gen.js walks games 0..N from
// rng(SEED*7919+g), so a replayed seed regenerates the identical games and appends them again,
// and the duplicates are invisible in the CSV until the network comes out wrong.
// The two machines start 1 000 apart, which leaves room for ten restarts each before the
// ranges could ever meet.
function autoSeed(dir, fallback) {
  let top = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^pos_(\d+)\.csv$/.exec(f);
      if (m) top = Math.max(top, Number(m[1]));
    }
  } catch (e) { /* first run, nothing there */ }
  return top ? top + 100 : fallback;
}
const RAW_SEED0 = process.env.SEED0 || '3000';
const OUTDIR = path.resolve(HERE, process.env.OUTDIR || 'data/deep');
const STATUS = path.resolve(HERE, process.env.STATUS || 'queue_status.json');
const STOP = path.join(HERE, 'STOP');
const LABEL = process.env.LABEL || ('generation ' + (process.env.PLAY_NODES || 8000) + ' noeuds');

fs.mkdirSync(OUTDIR, { recursive: true });
const SEED0 = RAW_SEED0 === 'auto'
  ? autoSeed(OUTDIR, Number(process.env.SEED_BASE || 3000))
  : Number(RAW_SEED0);
// Une graine deja utilisee ne produit pas deux fois plus de donnees: elle produit deux fois les
// MEMES parties (gen.js tire la partie g de rng(SEED*7919+g) et de rien d'autre) et le doublon est
// invisible dans le CSV. autoSeed ne regarde que le dossier de SORTIE, donc il ne voit pas les
// graines de l'autre machine dont les fichiers ont ete rapatries dans un dossier voisin -- et deux
// machines qui prennent chacune "max+100 chez moi" finissent par tomber sur le meme nombre. On
// refuse donc de demarrer si l'une des graines demandees apparait ou que ce soit sous data/.
function usedSeeds(dir, into) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return into; }
  for (const e of entries) {
    if (e.isDirectory()) usedSeeds(path.join(dir, e.name), into);
    else { const m = /^pos_(\d+)\.csv$/.exec(e.name); if (m) into.add(Number(m[1])); }
  }
  return into;
}
{
  const used = usedSeeds(path.resolve(HERE, 'data'), new Set());
  const clash = [];
  for (let i = 0; i < N; i++) if (used.has(SEED0 + i)) clash.push(SEED0 + i);
  if (clash.length) {
    console.error(`ARRET: graine(s) deja utilisee(s) sous data/ : ${clash.join(', ')}`);
    console.error('Rejouer une graine reecrit les memes parties sans que rien ne le signale.');
    console.error('Choisir un SEED0 explicite hors des plages deja prises, ou un autre OUTDIR.');
    process.exit(1);
  }
}
console.log(`graines ${SEED0}..${SEED0 + N - 1}`);

const kids = [];
const seen = new Array(N).fill(0).map(() => ({ games: 0, positions: 0, alive: true }));
const t0 = Date.now();

// gen.js only prints its counter when it flushes 3 000 rows, which with deep games is once
// every quarter of an hour per stream -- so the parsed figure sits at zero for a long time and a
// working run looks like a dead one. The bytes on disk are immediate and cannot be wrong, so
// they lead and the game count follows.
function onDisk() {
  let bytes = 0;
  for (let i = 0; i < N; i++) {
    try { bytes += fs.statSync(path.join(OUTDIR, 'pos_' + (SEED0 + i) + '.csv')).size; } catch (e) { /* not yet */ }
  }
  return bytes;
}

// Each stream's live file, which exists within seconds of it starting rather than after its
// first flush. This is what makes the counts honest from the first minute.
function live() {
  const out = [];
  for (let i = 0; i < N; i++) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(OUTDIR, 'live_' + (SEED0 + i) + '.json'), 'utf8'))); }
    catch (e) { /* not started, or being rewritten this instant */ }
  }
  return out;
}

function publish() {
  const L = live();
  // The live files lead; the parsed stdout counter is only a fallback for a stream whose live
  // file has not appeared yet.
  const games = L.length ? L.reduce((a, x) => a + (x.games || 0), 0) : seen.reduce((a, s) => a + s.games, 0);
  const positions = L.length ? L.reduce((a, x) => a + (x.positions || 0), 0) : seen.reduce((a, s) => a + s.positions, 0);
  const alive = seen.filter(s => s.alive).length;
  const hrs = (Date.now() - t0) / 3600000;
  const mb = onDisk() / 1048576;
  const state = {
    machine: os.hostname(),
    job: LABEL,
    at: 1, total: 1,
    since: new Date(t0).toISOString(),
    progress: `${alive}/${N} flux · ${games} parties finies, ${positions} positions` +
      (mb >= 0.05 ? ` · ${mb.toFixed(1)} Mo` : '') +
      (hrs > 0.05 && games ? ` · ${Math.round(games / hrs)} parties/h` : ''),
    live: L.map(x => ({ seed: x.seed, pos: x.pos, turn: x.turn, ply: x.ply, games: x.games, by: x.by })),
    done: [],
    updated: new Date().toISOString(),
  };
  try { fs.writeFileSync(STATUS, JSON.stringify(state, null, 1)); } catch (e) { /* next tick */ }
}

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const env = Object.assign({}, process.env, {
    SEED: String(seed),
    OUT: path.join(OUTDIR, 'pos_' + seed + '.csv'),
  });
  const kid = spawn(process.execPath, [path.join(HERE, 'gen.js')], { cwd: HERE, env, stdio: ['ignore', 'pipe', 'ignore'] });
  // gen.js reports "\r123 games, 4567 positions" as it appends. Parsed rather than summed from
  // the files, because the files are appended in blocks of 3 000 rows and would lag behind.
  kid.stdout.on('data', d => {
    const m = /(\d+) games, (\d+) positions/.exec(String(d).split('\r').pop());
    if (m) { seen[i].games = Number(m[1]); seen[i].positions = Number(m[2]); }
  });
  kid.on('exit', () => { seen[i].alive = false; publish(); });
  kids.push(kid);
}

// The heartbeat carries the live boards, so its interval is what the watcher sees as frame
// rate. A move takes about a third of a second to search, so publishing faster than this would
// redraw identical positions.
const beat = setInterval(publish, Number(process.env.BEAT_MS || 400));
publish();

// The same STOP file the rest of the harness uses: one way to halt everything, checked here
// every ten seconds so a night can be ended without hunting processes across two machines.
const guard = setInterval(() => {
  if (!fs.existsSync(STOP)) return;
  clearInterval(guard); clearInterval(beat);
  for (const k of kids) { try { k.kill(); } catch (e) { /* already gone */ } }
  publish();
  console.log('STOP present, arret');
  setTimeout(() => process.exit(0), 1500);
}, 10000);

process.on('exit', () => { clearInterval(beat); });
