// Drive the real page in real Chrome and assert what the browser DREW. Reading `.hidden` would
// only repeat what the code says; the bug being tested is a LAYOUT bug -- the board resized when
// the first move was played -- so the only assertion that means anything is the board's measured
// rectangle before and after that move.
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9333;
const URL = process.env.PAGE || 'http://127.0.0.1:5599/index.html';

const get = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});

(async () => {
  let tabs = null;
  for (let i = 0; i < 40 && !tabs; i++) {
    try { tabs = await get('/json/list'); } catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!tabs) throw new Error('Chrome never answered on port ' + PORT);
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));

  let id = 0; const waiting = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; waiting.set(n, r => r.error ? rej(new Error(method + ': ' + r.error.message)) : res(r.result));
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  // Without this Chrome serves app.js from its own cache and the test quietly grades the
  // previous version of the page -- which looks exactly like a passing test.
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: URL });
  await evalJs(`new Promise(r => { const t = setInterval(() => {
      if (document.readyState === 'complete' && document.querySelector('#menu [data-mode="local"]')) { clearInterval(t); r(1); }
    }, 60); })`);

  const probe = `(() => {
    const g = document.querySelector('#game');
    const b = document.querySelector('#board');
    const bar = document.querySelector('#tb-bar');
    const rb = b ? b.getBoundingClientRect() : null;
    const rn = bar ? bar.getBoundingClientRect() : null;
    const cs = bar ? getComputedStyle(bar) : null;
    return {
      board: rb && { w: Math.round(rb.width), h: Math.round(rb.height), top: Math.round(rb.top), left: Math.round(rb.left) },
      barDrawn: !!(rn && rn.width > 0 && rn.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'),
      barBox: rn && { w: Math.round(rn.width), h: Math.round(rn.height) },
      count: (document.querySelector('#tb-count') || {}).textContent,
      scrubbing: !!(g && g.classList.contains('scrubbing')),
      disabled: ['tb-first','tb-prev','tb-next','tb-last'].map(i => !!(document.getElementById(i)||{}).disabled),
    };
  })()`;

  // start a local game: two humans, so nothing thinks and nothing moves on its own
  await evalJs(`document.querySelector('#menu [data-mode="local"]').click(); 1`);
  await evalJs(`new Promise(r => setTimeout(r, 400))`);
  await evalJs(`document.querySelector('#local-start').click(); 1`);
  await evalJs(`new Promise(r => setTimeout(r, 900))`);

  const before = await evalJs(probe);

  // A local game picks its first player at random, so "the cell in front of player 0" is only
  // the right cell half the time. Any legal step proves the same thing here -- the assertion is
  // about the board's rectangle and the counter, not about which pawn moved.
  const clicked = await evalJs(`(() => {
    // The pawn to move is the draggable one; the forward step is the movable cell on its own
    // file. Picking the first .cell.movable in DOM order instead lands on a SIDEWAYS step when
    // player 1 starts, and a sideways step leaves the race level -- which is exactly the thing
    // this test asserts has changed.
    const p = document.querySelector('#board .pawn.draggable') || document.querySelector('#board .pawn');
    const from = p && p.closest('.cell');
    const cells = [...document.querySelectorAll('#board .cell.movable')];
    const c = (from && cells.find(x => x.dataset.c === from.dataset.c)) || cells[0];
    if (!c) return 'no cell';
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    c.click();
    return 'ok';
  })()`);
  await evalJs(`new Promise(r => setTimeout(r, 900))`);
  const after = await evalJs(probe);

  const j = (o) => JSON.stringify(o);
  console.log('avant le 1er coup :', j(before));
  console.log('apres le 1er coup :', j(after));
  console.log('clic sur (7,4)    :', clicked);

  const fails = [];
  if (!before.barDrawn) fails.push('la barre n est PAS dessinee avant le premier coup');
  if (!after.barDrawn) fails.push('la barre n est pas dessinee apres le premier coup');
  if (before.count !== '0 / 0') fails.push('le compteur affiche ' + before.count + ' au lieu de 0 / 0');
  if (!before.disabled.every(Boolean)) fails.push('des boutons sont actifs alors qu il n y a rien a parcourir: ' + j(before.disabled));
  if (after.count !== '1 / 1') fails.push('le compteur affiche ' + after.count + ' au lieu de 1 / 1 apres un coup');
  for (const k of ['w', 'h', 'top', 'left']) {
    if (before.board[k] !== after.board[k]) fails.push(`le plateau a bouge: ${k} ${before.board[k]} -> ${after.board[k]}`);
  }
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - la barre est la des le depart et le plateau ne bouge pas au premier coup');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
