// net.js — WebRTC room-code transport for Detour, via the free PeerJS broker.
// The host's room code is its PeerJS id; the guest connects to it. One data channel,
// reliable+ordered. App layer exchanges deterministic game actions over it.

(function () {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'detour-room-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let peer = null, conn = null, cb = null, libPromise = null;

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
  function close() {
    try { conn && conn.close(); } catch { /* ignore */ }
    try { peer && peer.destroy(); } catch { /* ignore */ }
    conn = null; peer = null; cb = null;
  }

  window.Net = { ensureLib, host, join, send, close };
})();
