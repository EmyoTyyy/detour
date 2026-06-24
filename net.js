// net.js — WebRTC transport for Detour, via the free PeerJS broker.
// Two topologies share one PeerJS peer:
//   1v1 (friend)      — a single data channel between two peers (lockstep).
//   hub (tournament)  — the host accepts many connections (star); it is the authority.

(function () {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'detour-room-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const CONNECT_TIMEOUT = 20000;

  // STUN finds a direct path for most peers; TURN relays the rest (symmetric NATs,
  // strict mobile/corporate networks) — without it those connections fail silently.
  // Open Relay is a free public TURN; swap in your own keys for production reliability.
  const PEER_OPTS = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    },
  };

  let peer = null, conn = null, cb = null, libPromise = null;
  const conns = new Map(); // hub: peerId -> DataConnection

  // Surface a timeout if a data channel never opens (the usual silent-NAT failure).
  function withTimeout(c, onFail) {
    const t = setTimeout(() => { if (!c.open) onFail(); }, CONNECT_TIMEOUT);
    c.on('open', () => clearTimeout(t));
    c.on('error', () => clearTimeout(t));
    c.on('close', () => clearTimeout(t));
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
    c.on('data', d => cb && cb({ type: 'data', msg: d }));
    c.on('open', () => cb && cb({ type: 'open' }));
    c.on('close', () => cb && cb({ type: 'close' }));
    c.on('error', e => cb && cb({ type: 'error', err: e }));
  }

  async function host(onEvent) {
    await ensureLib();
    cb = onEvent;
    return new Promise((resolve, reject) => {
      let tries = 0;
      const make = () => {
        const code = genCode();
        peer = new Peer(PREFIX + code, PEER_OPTS);
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
    return new Promise((resolve, reject) => {
      peer = new Peer(undefined, PEER_OPTS);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        bind(c);
        withTimeout(c, () => cb && cb({ type: 'error', err: { type: 'timeout' } }));
        resolve();
      });
      peer.on('error', e => { cb && cb({ type: 'error', err: e }); reject(e); });
    });
  }

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  // ---------- hub (tournament) ----------
  async function hostHub(onEvent) {
    await ensureLib();
    cb = onEvent;
    return new Promise((resolve, reject) => {
      let tries = 0;
      const make = () => {
        const code = genCode();
        peer = new Peer(PREFIX + code, PEER_OPTS);
        peer.on('open', () => resolve(code));
        peer.on('connection', c => {
          c.on('open', () => { conns.set(c.peer, c); cb && cb({ type: 'connect', id: c.peer }); });
          c.on('data', d => cb && cb({ type: 'data', id: c.peer, msg: d }));
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
    return new Promise((resolve, reject) => {
      peer = new Peer(undefined, PEER_OPTS);
      peer.on('open', () => {
        conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        conn.on('open', () => cb && cb({ type: 'open' }));
        conn.on('data', d => cb && cb({ type: 'data', msg: d }));
        conn.on('close', () => cb && cb({ type: 'close' }));
        conn.on('error', e => cb && cb({ type: 'error', err: e }));
        withTimeout(conn, () => cb && cb({ type: 'error', err: { type: 'timeout' } }));
        resolve();
      });
      peer.on('error', e => { cb && cb({ type: 'error', err: e }); reject(e); });
    });
  }
  function sendHost(msg) { if (conn && conn.open) conn.send(msg); }

  function close() {
    conns.forEach(c => { try { c.close(); } catch { /* ignore */ } });
    conns.clear();
    try { conn && conn.close(); } catch { /* ignore */ }
    try { peer && peer.destroy(); } catch { /* ignore */ }
    conn = null; peer = null; cb = null;
  }

  window.Net = { ensureLib, host, join, send, hostHub, joinHub, broadcast, sendTo, kick, sendHost, close };
})();
