// The lab in a browser, so a night's work can be watched from either machine.
//
//   node board.js --ssh titou@192.168.1.180:detour/tools/lab
//   then open http://192.168.1.56:5595 from any machine on the network
//
// It runs HERE and reads the other machines over SSH, rather than each machine serving its own
// page. That way only one thing listens, on the machine that already has the keys, and the
// laptop being watched needs no extra port open.
//
// Read-only by construction: it opens the heartbeat files and nothing else. Watching a run can
// never disturb it, and this can be started and stopped freely mid-night.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const S = require('./statuslib.js');
const L = require('./lib.js');

// The live position travels as a 39-character token, which the page would need the whole rules
// module to read. Decoding here instead keeps the page to plain HTML: it receives pawns, walls
// and whose turn it is, and draws them.
let R = null;
try { R = L.loadEngine(undefined, { weights: false }).Rules; } catch (e) { R = null; }

// wallBy is keyed by orientation followed by "r,c" -- the same key the rules use internally.
const owner = (by, o, k) => (by && by[o + k] != null) ? by[o + k] : -1;

function unpack(rows) {
  if (!R) return rows;
  for (const row of rows) {
    if (!row || !Array.isArray(row.live)) continue;
    row.games = row.live.map(x => {
      try {
        const st = L.decodePos(R, x.pos);
        return {
          seed: x.seed, ply: x.ply, turn: st.turn, done: x.games,
          pawns: st.pawns.map(p => [p.r, p.c]),
          walls: st.walls.slice(),
          // each wall carries the seat that placed it, so the board can be read as a story
          // rather than a pattern: which side has been doing the walling, and where.
          h: [...st.hWalls].map(k => k.split(',').map(Number).concat([owner(x.by, 'h', k)])),
          v: [...st.vWalls].map(k => k.split(',').map(Number).concat([owner(x.by, 'v', k)])),
        };
      } catch (e) { return null; }
    }).filter(Boolean);
    delete row.live;
  }
  return rows;
}

const PORT = Number(process.env.PORT || 5595);
const HOST = process.env.HOST || '0.0.0.0';
const remotes = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--ssh' && process.argv[i + 1]) remotes.push(process.argv[++i]);
}

const PAGE = path.join(__dirname, 'board.html');
const BEAT_MS = Number(process.env.BEAT_MS || 400);

// ---- live feeds ----
//
// Polling was costing one whole ssh process per machine per refresh, which is why it ran every
// five seconds and no faster. One connection held open instead, with a loop on the far side
// printing the heartbeat, costs nothing per frame -- so the page can be shown the board at the
// rate the moves are actually played rather than a snapshot every few seconds.
const feeds = new Map();          // machine spec -> last parsed status
const watchers = new Set();       // open SSE responses

// Le duel contre Ishtar vit dans son propre fichier et passe devant tout le reste: c'est une
// seule partie qu'on regarde, pas une ferme qu'on surveille, et elle n'a pas la meme forme.
function readDuel() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'qlive.json'), 'utf8'));
    if (!R) return d;
    const st = L.decodePos(R, d.pos);
    d.board = {
      pawns: st.pawns.map(p => [p.r, p.c]),
      h: [...st.hWalls].map(k => k.split(',').map(Number).concat([owner(d.by, 'h', k)])),
      v: [...st.vWalls].map(k => k.split(',').map(Number).concat([owner(d.by, 'v', k)])),
      turn: st.turn,
    };
    delete d.by; delete d.pos;
    return d;
  } catch (e) { return null; }
}

function fanout() {
  const rows = [];
  const local = S.readLocal();
  if (local) rows.push(local);
  for (const v of feeds.values()) if (v) rows.push(v);
  const duel = readDuel();
  const payload = JSON.stringify({ at: new Date().toISOString(), duel, rows: unpack(rows.map(r => Object.assign({}, r, {
    // A machine asked to stop is not a machine that died. Saying "bloque" about a deliberate
    // halt would train the reader to ignore the one word this page exists to say.
    state: r.halting ? 'arrete' : S.classify(r), for: S.ago(r.since), seen: S.ago(r.updated),
  }))) });
  for (const res of watchers) {
    try { res.write('data: ' + payload + '\n\n'); } catch (e) { watchers.delete(res); }
  }
}

// The one thing this page can change. It writes a file called STOP, which every runner checks:
// nothing is killed from here, the run notices and winds itself down. Resuming is deliberately
// NOT a button -- restarting needs fresh seeds, because a runner replayed on the same seed
// regenerates the identical games and appends them again.
function halt(machine) {
  const local = S.readLocal();
  if (local && local.machine === machine) {
    fs.writeFileSync(path.join(__dirname, 'STOP'), 'arrete depuis le tableau de bord\n');
    return Promise.resolve({ ok: true, where: 'locale' });
  }
  for (const [spec, v] of feeds) {
    if (!v || v.machine !== machine) continue;
    const cut = spec.lastIndexOf(':');
    const who = spec.slice(0, cut), dir = spec.slice(cut + 1).replace(/\//g, '\\');
    return new Promise((resolve) => {
      const kid = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', who,
        `cmd /c echo arrete depuis le tableau de bord > ${dir}\\STOP`], { stdio: 'ignore' });
      kid.on('exit', code => resolve({ ok: code === 0, where: who }));
    });
  }
  return Promise.resolve({ ok: false, error: 'machine inconnue' });
}

function startRemote(spec) {
  const cut = spec.lastIndexOf(':');
  const who = spec.slice(0, cut), dir = spec.slice(cut + 1);
  const win = dir.replace(/\//g, '\\');
  // One command, run once, that keeps printing. `---` closes a frame, so a half-written file is
  // never parsed as a whole one.
  // [Console]::OutputEncoding is not decoration: a Windows console hands SSH its text in the
  // local code page, so the middle dot in "5/5 flux . 12 parties" arrived as a mojibake box.
  const loop = `pwsh -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; while($true){ if (Test-Path '${win}\\STOP') { 'STOP' }; try { (Get-Content '${win}\\queue_status.json' -Raw -Encoding utf8 -EA Stop) -replace '\\r|\\n','' } catch {}; '---'; Start-Sleep -Milliseconds ${BEAT_MS} }"`;
  const kid = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=20', who, loop], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  kid.stdout.on('data', d => {
    buf += String(d).replace(/\r/g, '');
    let i;
    while ((i = buf.indexOf('\n---')) >= 0) {
      const frame = buf.slice(0, i).trim();
      buf = buf.slice(i + 4);
      if (frame) {
        const halting = frame.startsWith('STOP');
        const json = halting ? frame.slice(4).trim() : frame;
        try { feeds.set(spec, Object.assign(JSON.parse(json), { spec, halting })); } catch (e) { /* mid-write */ } }
      fanout();
    }
    if (buf.length > 1e6) buf = '';        // a machine shouting nonsense must not grow forever
  });
  // A dropped connection is a machine that went away, not a reason to stop: mark it offline and
  // keep trying, so a laptop that sleeps and wakes reappears on its own.
  kid.on('exit', () => {
    feeds.set(spec, { machine: who, offline: true });
    fanout();
    setTimeout(() => startRemote(spec), 5000);
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/stop')) {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    return req.on('end', async () => {
      let out = { ok: false, error: 'requete illisible' };
      try { out = await halt(JSON.parse(body).machine); } catch (e) { /* keep the default */ }
      res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  }
  if (req.url.startsWith('/api/stream')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    watchers.add(res);
    req.on('close', () => watchers.delete(res));
    return fanout();
  }
  if (req.url.startsWith('/api/status')) {
    let rows = [];
    try { rows = unpack(await S.readAll(remotes)); } catch (e) { rows = []; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ at: new Date().toISOString(), duel: readDuel(), rows }));
  }
  fs.readFile(PAGE, (err, buf) => {
    if (err) { res.writeHead(500); return res.end('board.html introuvable'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => {
  console.log(`tableau de bord sur http://${HOST}:${PORT}  (${remotes.length + 1} machine(s))`);
  for (const r of remotes) startRemote(r);
  // The local heartbeat is a file on this disk, so it is simply re-read on the same beat.
  setInterval(fanout, BEAT_MS);
});
