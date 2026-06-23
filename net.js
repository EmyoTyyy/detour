// net.js — WebRTC transport for Detour, via the free PeerJS broker.
// Two topologies share one PeerJS peer:
//   1v1 (friend)      — a single data channel between two peers (lockstep).
//   hub (tournament)  — the host accepts many connections (star); it is the authority.

(function () {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'detour-room-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let peer = null, conn = null, cb = null, libPromise = null;
  const conns = new Map(); // hub: peerId -> DataConnection

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
        peer = new Peer(PREFIX + code);
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
      peer = new Peer();
      peer.on('open', () => { bind(peer.connect(PREFIX + code.toUpperCase(), { reliable: true })); resolve(); });
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
        peer = new Peer(PREFIX + code);
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

  async function joinHub(code, onEvent) {
    await ensureLib();
    cb = onEvent;
    return new Promise((resolve, reject) => {
      peer = new Peer();
      peer.on('open', () => {
        conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        conn.on('open', () => cb && cb({ type: 'open' }));
        conn.on('data', d => cb && cb({ type: 'data', msg: d }));
        conn.on('close', () => cb && cb({ type: 'close' }));
        conn.on('error', e => cb && cb({ type: 'error', err: e }));
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

  window.Net = { ensureLib, host, join, send, hostHub, joinHub, broadcast, sendTo, sendHost, close };
})();
