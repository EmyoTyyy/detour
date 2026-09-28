// Plays a named opening in real Chrome, with real drags, and asserts what the page DREW.
//
// The Reed Opening is the one to use: four horizontal walls and no pawn moves, so it needs no
// orientation toggle and it completes in four plies. Its line is c3h a3h f3h h3h, which on
// Detour's board is the horizontal junctions (5,2) (5,0) (5,5) (5,7) -- Wikipedia names a wall
// after the square nearest a1, so the junction row is 8-row and not 9-row.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9334;
const URL = process.env.PAGE || 'http://127.0.0.1:5598/index.html';

const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
  r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

(async () => {
  let tabs = null;
  for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await get('/json/list'); } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  if (!tabs) throw new Error('Chrome ne repond pas sur ' + PORT);
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));
  let id = 0; const waiting = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (x.id && waiting.has(x.id)) { waiting.get(x.id)(x); waiting.delete(x.id); } });
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; waiting.set(n, r => r.error ? rej(new Error(method + ': ' + r.error.message)) : res(r.result));
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 200));
    return r.result.value;
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });

  await send('Page.enable'); await send('Runtime.enable');
  // Without this Chrome serves app.js from its own cache and the test quietly grades the
  // previous version of the page -- which looks exactly like a passing test.
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: URL });
  await js(`new Promise(r => { const t = setInterval(() => {
    if (document.readyState === 'complete' && document.querySelector('#menu [data-mode="local"]') && window.Openings) { clearInterval(t); r(1); } }, 60); })`);

  const nOpenings = await js('window.Openings.list.length');
  await js(`document.querySelector('#menu [data-mode="local"]').click(); 1`);
  await js(`new Promise(r => setTimeout(r, 400))`);
  await js(`document.querySelector('#local-start').click(); 1`);
  await js(`new Promise(r => setTimeout(r, 800))`);

  const shown = () => js(`(() => { const b = document.querySelector('#opening');
    const r = b ? b.getBoundingClientRect() : null; const cs = b ? getComputedStyle(b) : null;
    const bd = document.querySelector('#board').getBoundingClientRect();
    return { drawn: !!(r && r.width > 0 && r.height > 0 && cs.display !== 'none'),
             name: (document.querySelector('#opening-name')||{}).textContent,
             note: ((document.querySelector('#opening-note')||{}).textContent||'').slice(0, 40),
             src: (document.querySelector('#opening-src')||{}).textContent,
             board: { w: Math.round(bd.width), top: Math.round(bd.top) } }; })()`);

  const before = await shown();

  // c3h a3h f3h h3h
  for (const [r, c] of [[5, 2], [5, 0], [5, 5], [5, 7]]) {
    const pts = await js(`(() => {
      const tok = document.querySelector('.wtoken.grab');
      const j = document.querySelector('#board .wjunction[data-r="${r}"][data-c="${c}"]');
      if (!tok || !j) return null;
      const a = tok.getBoundingClientRect(), b = j.getBoundingClientRect();
      return { ax: a.left + a.width / 2, ay: a.top + a.height / 2, bx: b.left + b.width / 2, by: b.top + b.height / 2 };
    })()`);
    if (!pts) throw new Error(`pas de jeton ou de jonction pour (${r},${c})`);
    await mouse('mousePressed', pts.ax, pts.ay);
    for (let k = 1; k <= 6; k++) await mouse('mouseMoved', pts.ax + (pts.bx - pts.ax) * k / 6, pts.ay + (pts.by - pts.ay) * k / 6);
    await mouse('mouseReleased', pts.bx, pts.by);
    await js(`new Promise(r => setTimeout(r, 350))`);
  }
  const after = await shown();

  const fails = [];
  if (nOpenings !== 13) fails.push(`window.Openings.list a ${nOpenings} entrees, 13 attendues`);
  if (before.drawn) fails.push('le bandeau est dessine avant le moindre coup');
  if (!after.drawn) fails.push('le bandeau n est PAS dessine apres la ligne');
  if (after.name !== 'Reed Opening') fails.push(`nom affiche "${after.name}", "Reed Opening" attendu`);
  if (after.src !== 'Wikipedia') fails.push(`source affichee "${after.src}"`);
  if (!after.note) fails.push('pas de description affichee');
  if (before.board.w !== after.board.w || before.board.top !== after.board.top)
    fails.push(`le plateau a bouge: ${JSON.stringify(before.board)} -> ${JSON.stringify(after.board)}`);

  console.log('avant :', JSON.stringify(before));
  console.log('apres :', JSON.stringify(after));
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - l ouverture est jouee, nommee et dessinee, et le plateau n a pas bouge');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
