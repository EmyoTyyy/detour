// net.js — WebRTC transport for Detour, via the free PeerJS broker.
// Two topologies share one PeerJS peer:
//   1v1 (friend)      — a single data channel between two peers (lockstep).
//   hub (tournament)  — the host accepts many connections (star); it is the authority.

(function () {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'detour-room-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const CONNECT_TIMEOUT = 30000;   // phones on slow mobile data can take a while to gather ICE

  // ---- TURN / ICE configuration -------------------------------------------------
  // STUN finds a direct path for most peers; TURN relays the rest (symmetric NATs,
  // strict mobile/corporate networks — i.e. most phones on cellular). Without a working
  // TURN those connections fail silently, which is the usual "can't join" problem.
  //
  // FREE, no-backend fix: make an account at https://www.metered.ca/ (free tier ≈ 50 GB/mo),
  // open the dashboard, and paste your app subdomain + API key below. The browser then
  // fetches fresh (ephemeral) TURN credentials at connect time. Leave blank to fall back to
  // the public Open Relay servers (free but often rate-limited / down).
  const METERED_SUBDOMAIN = 'detour.metered.live';   // your metered app host
  const METERED_API_KEY = 'b4seMq63OieFoRqFK352_N9jYd4M9BDNmK-Jxy3_32iWnA9r';

  const STUN = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ];
  const FALLBACK_TURN = [
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  let iceCache = null;
  async function iceServers() {
    if (iceCache) return iceCache;
    let metered = [];
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);   // don't let a slow metered hang the join
      const r = await fetch(`https://${METERED_SUBDOMAIN}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`, { signal: ctrl.signal });
      clearTimeout(to);
      const list = await r.json();
      if (Array.isArray(list)) metered = list;   // fresh creds from metered
    } catch { /* metered slow/unreachable → use STUN + fallback relay */ }
    // Offer STUN + BOTH relays at once. ICE gathers candidates from all of them and
    // connects via whichever pair actually works, so a dead/missing relay is skipped
    // automatically — no manual retry needed.
    iceCache = [...STUN, ...metered, ...FALLBACK_TURN];
    return iceCache;
  }
  const peerOpts = async () => ({ config: { iceServers: await iceServers() } });

  let peer = null, conn = null, cb = null, libPromise = null;
  const conns = new Map(); // hub: peerId -> DataConnection

  // ---------- heartbeat ----------
  // Data channels can die silently (a phone changing network, sleep, signal loss) without
  // ever firing 'close'. We ping each peer and, if nothing is heard back for a while, raise
  // the same disconnect/close event a clean teardown would — so the app can react.
  const PING_MS = 5000, STALE_MS = 20000;
  let hbTimer = null;
  const touch = c => { c._seen = Date.now(); };
  // returns true if the message was a heartbeat frame (and should not reach the app)
  function handleHB(d, c) {
    touch(c);
    if (d && d.__hb === 'ping') { try { if (c.open) c.send({ __hb: 'pong' }); } catch { /* ignore */ } return true; }
    if (d && d.__hb === 'pong') return true;
    return false;
  }
  function startHeartbeat() {
    if (hbTimer) return;
    hbTimer = setInterval(() => {
      const now = Date.now();
      const list = conns.size ? [...conns.values()] : (conn ? [conn] : []);
      for (const c of list) {
        if (!c.open) continue;
        if (c._seen && now - c._seen > STALE_MS) {      // peer went silent → treat as gone
          try { c.close(); } catch { /* ignore */ }
          if (conns.size) { if (conns.delete(c.peer)) cb && cb({ type: 'disconnect', id: c.peer }); }
          else cb && cb({ type: 'close' });
        } else { try { c.send({ __hb: 'ping' }); } catch { /* ignore */ } }
      }
    }, PING_MS);
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  // Surface a timeout if a data channel never opens (the usual silent-NAT failure).
  function withTimeout(c, onFail, ms) {
    const t = setTimeout(() => { if (!c.open) onFail(); }, ms || CONNECT_TIMEOUT);
    c.on('open', () => clearTimeout(t));
    c.on('error', () => clearTimeout(t));
    c.on('close', () => clearTimeout(t));
  }

  // ---- join auto-retry ----
  // A join can fail transiently (a relay hiccup, broker blip, ICE giving up on a bad path).
  // We quietly tear down and try the whole connection again a couple of times before telling
  // the app it failed. We don't retry a genuinely-missing room (wrong code) or a fatal error.
  const MAX_TRIES = 3, RETRY_DELAY = 800, RETRY_TIMEOUT = 15000;
  function retryable(err) {
    const t = err && err.type;
    return t === 'timeout' || t === 'network' || t === 'server-error'
      || t === 'socket-error' || t === 'socket-closed' || !t;
  }

  function ensureLib() {
    if (window.Peer) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = res;
      s.onerror = () => rej(new Error('offline'));
      document.head.appendChild(s);
    });
    return libPromise;
  }

  const genCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

  // ---------- 1v1 (friend) ----------
  function bind(c) {
    conn = c;
    c.on('data', d => { if (handleHB(d, c)) return; cb && cb({ type: 'data', msg: d }); });
    c.on('open', () => { touch(c); startHeartbeat(); cb && cb({ type: 'open' }); });
    c.on('close', () => cb && cb({ type: 'close' }));
    c.on('error', e => cb && cb({ type: 'error', err: e }));
  }

  async function host(onEvent) {
    await ensureLib();
    cb = onEvent;
    const opts = await peerOpts();
    return new Promise((resolve, reject) => {
      let tries = 0;
      const make = () => {
        const code = genCode();
        peer = new Peer(PREFIX + code, opts);
        peer.on('open', () => resolve(code));
        peer.on('connection', c => { if (conn) { c.close(); return; } bind(c); });
        peer.on('error', e => {
          if (e.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); make(); }
          else { cb && cb({ type: 'error', err: e }); reject(e); }
        });
      };
      make();
    });
  }

  async function join(code, onEvent) {
    await ensureLib();
    cb = onEvent;
    const opts = await peerOpts();
    const target = PREFIX + code.toUpperCase();
    let attempt = 0, done = false;
    const run = () => {
      const mine = ++attempt;
      const stale = () => done || mine !== attempt;
      const fail = err => {
        if (stale()) return;
        if (attempt < MAX_TRIES && retryable(err)) setTimeout(run, RETRY_DELAY);   // try again
        else { done = true; cb && cb({ type: 'error', err }); }
      };
      try { peer && peer.destroy(); } catch { /* ignore */ }
      peer = new Peer(undefined, opts);
      peer.on('open', () => {
        if (stale()) return;
        const c = peer.connect(target, { reliable: true });
        conn = c;
        c.on('data', d => { if (handleHB(d, c)) return; cb && cb({ type: 'data', msg: d }); });
        c.on('open', () => { if (stale()) return; done = true; touch(c); startHeartbeat(); cb && cb({ type: 'open' }); });
        c.on('close', () => { if (done && mine === attempt) cb && cb({ type: 'close' }); });
        c.on('error', e => fail(e));
        withTimeout(c, () => fail({ type: 'timeout' }), mine === 1 ? CONNECT_TIMEOUT : RETRY_TIMEOUT);
      });
      peer.on('error', e => fail(e));
    };
    run();
  }

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  // ---------- hub (tournament) ----------
  async function hostHub(onEvent) {
    await ensureLib();
    cb = onEvent;
    const opts = await peerOpts();
    return new Promise((resolve, reject) => {
      let tries = 0;
      const make = () => {
        const code = genCode();
        peer = new Peer(PREFIX + code, opts);
        peer.on('open', () => resolve(code));
        peer.on('connection', c => {
          c.on('open', () => { touch(c); conns.set(c.peer, c); startHeartbeat(); cb && cb({ type: 'connect', id: c.peer }); });
          c.on('data', d => { if (handleHB(d, c)) return; cb && cb({ type: 'data', id: c.peer, msg: d }); });
          c.on('close', () => { if (conns.delete(c.peer)) cb && cb({ type: 'disconnect', id: c.peer }); });
          c.on('error', () => { /* a single client error shouldn't sink the host */ });
        });
        peer.on('error', e => {
          if (e.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); make(); }
          else { cb && cb({ type: 'error', err: e }); reject(e); }
        });
      };
      make();
    });
  }
  function broadcast(msg) { conns.forEach(c => { if (c.open) c.send(msg); }); }
  function sendTo(id, msg) { const c = conns.get(id); if (c && c.open) c.send(msg); }
  // Host drops a single client. Stop tracking it immediately (so its close event
  // won't re-fire a disconnect callback), then close shortly after to let any
  // final "you were kicked" message flush first.
  function kick(id) {
    const c = conns.get(id);
    if (!c) return;
    conns.delete(id);
    setTimeout(() => { try { c.close(); } catch { /* ignore */ } }, 200);
  }

  async function joinHub(code, onEvent) {
    await ensureLib();
    cb = onEvent;
    const opts = await peerOpts();
    const target = PREFIX + code.toUpperCase();
    let attempt = 0, done = false;
    const run = () => {
      const mine = ++attempt;
      const stale = () => done || mine !== attempt;
      const fail = err => {
        if (stale()) return;
        if (attempt < MAX_TRIES && retryable(err)) setTimeout(run, RETRY_DELAY);   // try again
        else { done = true; cb && cb({ type: 'error', err }); }
      };
      try { peer && peer.destroy(); } catch { /* ignore */ }
      peer = new Peer(undefined, opts);
      peer.on('open', () => {
        if (stale()) return;
        conn = peer.connect(target, { reliable: true });
        conn.on('open', () => { if (stale()) return; done = true; touch(conn); startHeartbeat(); cb && cb({ type: 'open' }); });
        conn.on('data', d => { if (handleHB(d, conn)) return; cb && cb({ type: 'data', msg: d }); });
        conn.on('close', () => { if (done && mine === attempt) cb && cb({ type: 'close' }); });
        conn.on('error', e => fail(e));
        withTimeout(conn, () => fail({ type: 'timeout' }), mine === 1 ? CONNECT_TIMEOUT : RETRY_TIMEOUT);
      });
      peer.on('error', e => fail(e));
    };
    run();
  }
  function sendHost(msg) { if (conn && conn.open) conn.send(msg); }

  function close() {
    stopHeartbeat();
    conns.forEach(c => { try { c.close(); } catch { /* ignore */ } });
    conns.clear();
    try { conn && conn.close(); } catch { /* ignore */ }
    try { peer && peer.destroy(); } catch { /* ignore */ }
    conn = null; peer = null; cb = null;
  }

  window.Net = { ensureLib, host, join, send, hostHub, joinHub, broadcast, sendTo, kick, sendHost, close };
})();
