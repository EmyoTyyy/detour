// A client for quoridor-ai.com's Ishtar engine, rebuilt from the site's own bundle.
//
//   wss://quoridor-ai.com/ishtar-v3
//   on open:  {"token":"rbt_token_*","version":"0.0.0"}
//   ->        setoption name visits value N
//   ->        setposition <hWalls> / <vWalls> / <pawns> / <wallsLeft> / <toMove>
//   ->        go
//   <-        info depth N ... visits N pv <moves>
//   <-        bestmove <move>
//
// Coordinates are Glendenning: column is 'a'+c, row is 9-r, so Detour's (8,4) -- the bottom
// player's start -- is "e1". Walls carry the same conversion and are then shifted one row Up,
// which is what the site's `vd(u, [Up])` does, and are written with no separator between them,
// so each wall token is exactly two characters.
//
// The wall convention is the one thing the bundle does not state plainly, so it is VERIFIED
// rather than assumed: verifyWalls() builds a position whose legal moves Detour can enumerate
// and checks that what Ishtar answers is a move Detour agrees exists.
const WebSocket = require('ws');

const URI = process.env.QAI_URI || 'wss://quoridor-ai.com/ishtar-v3';
const sq = (r, c) => String.fromCharCode(97 + c) + (9 - r);
// Anchored at the corner nearest a9, NOT the standard Glendenning corner nearest a1 that
// Wikipedia documents and tools/openings/build.js uses. The two differ by exactly one row, so a
// wall converted with the wrong one is still on the board and still legal almost everywhere --
// it just is not where you meant. This one is right because the server echoes the board back.
//
// No Up shift. The bundle applies one because ITS wall coordinate is anchored differently;
// converting from Detour's junction index already lands on the right square, and adding the
// shift put every wall one row too high -- confirmed against the board the server echoes back,
// which drew a wall meant for the boundary between rows 5 and 4 between rows 6 and 5 instead.
const wallSq = (r, c) => String.fromCharCode(97 + c) + (9 - r);

// "e3" / "e3h" -> what Detour calls it
function parseMove(tok) {
  const c = tok.charCodeAt(0) - 97;
  const row = Number(tok[1]);
  if (tok.length > 2) {
    const orient = tok[2] === 'h' ? 'h' : 'v';
    return { type: 'wall', orient, r: 9 - row, c };
  }
  return { type: 'move', to: { r: 9 - row, c } };
}

function serialise(s) {
  const h = [], v = [];
  for (const k of s.hWalls) { const i = k.indexOf(','); h.push(wallSq(+k.slice(0, i), +k.slice(i + 1))); }
  for (const k of s.vWalls) { const i = k.indexOf(','); v.push(wallSq(+k.slice(0, i), +k.slice(i + 1))); }
  const pawns = s.pawns.map(p => sq(p.r, p.c)).join(' ');
  const left = s.walls.join(' ');
  // Their playerToMove is ONE-based over the pawn list: sending 1 makes the first pawn move,
  // sending 0 or 2 makes the second. Verified by asking the same start position three times.
  return `${h.join('')} / ${v.join('')} / ${pawns} / ${left} / ${s.turn + 1}`;
}

// La probabilite de gain de celui qui joue, prise sur la premiere ligne info qui la porte.
// `root_score` est la valeur de la racine; a defaut on prend le `score` de la variante principale,
// qui vaut la meme chose quand les deux sont presents.
function lireScore(infos) {
  for (const l of (infos || [])) { const m = /root_score ([-\d.]+)/.exec(l); if (m) return Number(m[1]); }
  for (const l of (infos || [])) { const m = /\bscore ([-\d.]+)/.exec(l); if (m) return Number(m[1]); }
  return null;
}

class Ishtar {
  constructor(visits) {
    this.visits = visits || 3200;
    this.ws = null; this.queue = []; this.pending = null; this.lastInfo = null;
    // Toutes les lignes `info` de la recherche en cours, pas seulement la derniere. Elles ne
    // portent pas les memes champs: `root_score` n'apparait que sur une ligne intermediaire, et
    // `lastInfo` seul retenait la ligne `multipv` finale, qui ne l'a pas.
    this.infos = [];
  }
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((res, rej) => {
      const ws = new WebSocket(URI);
      this.ws = ws;
      const fail = (e) => rej(new Error('quoridor-ai: ' + (e && e.message || 'connection failed')));
      ws.on('error', fail);
      ws.on('open', () => {
        ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
        ws.send(`setoption name visits value ${this.visits}`);
        res(true);
      });
      ws.on('message', (d) => this.onMessage(String(d)));
      ws.on('close', () => { if (this.pending) { this.pending.rej(new Error('connection closed')); this.pending = null; } });
    });
    return this.ready;
  }
  onMessage(line) {
    for (const part of line.split('\n')) {
      const inf = /^info (.*)$/.exec(part);
      if (inf) { this.lastInfo = inf[1]; this.infos.push(inf[1]); continue; }
      const bm = /^bestmove (.*)$/.exec(part);
      if (bm && this.pending) { const p = this.pending; this.pending = null; p.res(bm[1].trim()); }
    }
  }
  // Ask about a position given as their own string. Used to pin down the conventions the
  // bundle does not state: which index means whose turn, and how a wall's square is named.
  async ask(pos, timeoutMs) {
    await this.connect();
    if (this.pending) throw new Error('a search is already running');
    return new Promise((res, rej) => {
      this.pending = { res, rej };
      const t = setTimeout(() => { if (this.pending) { this.pending = null; rej(new Error('timeout waiting for bestmove')); } }, timeoutMs || 120000);
      this.pending.res = (v) => { clearTimeout(t); res(v); };
      // Vider les lignes info, comme demande() le fait. Sans ca lireScore() rendait le PREMIER
      // root_score de la connexion pour toutes les questions suivantes: huit positions
      // differentes rendaient toutes le meme score, alors que le coup, lui, changeait bien.
      this.infos = [];
      this.ws.send(`setposition ${pos}`);
      this.ws.send('go');
    });
  }
  // Une tentative. La reprise est au-dessus, dans bestMove.
  demande(pos, timeoutMs) {
    return new Promise((res, rej) => {
      if (this.pending) return rej(new Error('a search is already running'));
      this.pending = { res, rej };
      const t = setTimeout(() => { if (this.pending) { this.pending = null; rej(new Error('timeout waiting for bestmove')); } }, timeoutMs || 120000);
      this.pending.res = (v) => { clearTimeout(t); res(v); };
      this.pending.rej = (e) => { clearTimeout(t); rej(e); };
      this.infos = [];
      this.ws.send(`setposition ${pos}`);
      this.ws.send('go');
    });
  }
  // Leur serveur ferme des connexions pendant un long match: deux tranches sur huit ont ete
  // perdues sur "connection closed" apres plus d'une heure de jeu chacune. Reprendre est trivial
  // ici, et c'est la difference avec Ka: `setposition` porte la position entiere, donc une
  // connexion neuve repart exactement ou on en etait, sans rien rejouer.
  async bestMove(state, timeoutMs, essais) {
    const pos = serialise(state);
    const max = essais == null ? 3 : essais;
    for (let n = 0; ; n++) {
      try {
        await this.connect();
        return await this.demande(pos, timeoutMs);
      } catch (e) {
        if (n >= max) throw e;
        try { if (this.ws) this.ws.close(); } catch (x) {}
        this.ws = null; this.ready = null; this.pending = null;
      }
    }
  }
  close() { if (this.ws) this.ws.close(); }
}

module.exports = { Ishtar, serialise, parseMove, sq, wallSq, lireScore };
