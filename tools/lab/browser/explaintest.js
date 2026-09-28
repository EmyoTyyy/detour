// Path's explanation, in a real browser: turn the analysis on in a local game, and check that
// the sentence appears AND that the route it is about is drawn on the board in the right colour.
const http = require('http'), WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9336;
const URL = process.env.PAGE || 'http://127.0.0.1:5596/index.html';
const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
  r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
(async () => {
  let tabs = null;
  for (let i = 0; i < 60 && !tabs; i++) { try { tabs = await get('/json/list'); } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));
  let id = 0; const w = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (x.id && w.has(x.id)) { w.get(x.id)(x); w.delete(x.id); } });
  const send = (m, p) => new Promise((res, rej) => { const n = ++id; w.set(n, r => r.error ? rej(new Error(m + ': ' + r.error.message)) : res(r.result)); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
  const js = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 300)); return r.result.value; };
  const wait = ms => js(`new Promise(r => setTimeout(r, ${ms}))`);

  await send('Page.enable'); await send('Runtime.enable');
  // Without this Chrome serves app.js from its own cache and the test quietly grades the
  // previous version of the page -- which looks exactly like a passing test.
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: URL });
  await js(`new Promise(r => { const t = setInterval(() => { if (document.readyState === 'complete' && window.Explain && document.querySelector('#menu [data-mode="local"]')) { clearInterval(t); r(1); } }, 60); })`);

  await js(`document.querySelector('#menu [data-mode="local"]').click(); 1`);
  await wait(400);
  await js(`document.querySelector('#local-start').click(); 1`);
  await wait(700);
  await js(`document.querySelector('#analysis-btn').click(); 1`);
  await wait(2500);                                   // let the engine think

  const read = () => js(`(() => { const w = document.querySelector('#eng-why');
      const routes = [...document.querySelectorAll('#board .board-arrows .route')];
      const r = routes[0];
      const best = document.querySelectorAll('#board .board-arrows .arrow.best, #board .ghost-wall, #board .wall.ghost');
      return { hidden: w.hidden, text: (w.textContent||'').slice(0, 90),
               drawnWidth: w.getBoundingClientRect().width,
               routes: routes.length, best: best.length,
               cls: r ? r.getAttribute('class') : null,
               stroke: r ? getComputedStyle(r.querySelector('polyline')).stroke : null,
               pts: r ? (r.querySelector('polyline').getAttribute('points')||'').split(' ').length : 0 }; })()`);

  const start = await read();
  // play a couple of moves so the position (and the explanation) changes
  // A local game's first player is random, so a fixed cell is empty half the time.
  await js(`(() => {
    // The pawn to move is the draggable one; the forward step is the movable cell on its own
    // file. Picking the first .cell.movable in DOM order instead lands on a SIDEWAYS step when
    // player 1 starts, and a sideways step leaves the race level -- which is exactly the thing
    // this test asserts has changed.
    const p = document.querySelector('#board .pawn.draggable') || document.querySelector('#board .pawn');
    const from = p && p.closest('.cell');
    const cells = [...document.querySelectorAll('#board .cell.movable')];
    const c = (from && cells.find(x => x.dataset.c === from.dataset.c)) || cells[0];
    if (c) c.click(); })()`);
  await wait(2200);
  const after = await read();

  const fails = [];
  for (const [label, r] of [['depart', start], ['apres', after]]) {
    if (r.hidden || !r.text) { fails.push(`${label}: aucune explication`); continue; }
    if (r.drawnWidth <= 0) fails.push(`${label}: la ligne d'explication n'est pas dessinee`);
    // The board has to illustrate the sentence -- but the route is drawn only when it is about
    // somewhere the recommendation is not. "Advances" IS the first step of your own way home,
    // so drawing both put a second arrowhead six squares on, pointing at nothing you were asked
    // to do. In that case the recommendation alone is the illustration.
    if (r.routes + r.best < 1) fails.push(`${label}: le plateau n illustre rien ("${r.text}")`);
    if (r.routes > 0) {
      if (r.pts < 3) fails.push(`${label}: la route n'a que ${r.pts} points`);
      if (!r.stroke || r.stroke === 'none') fails.push(`${label}: la route n a pas de couleur`);
      if (/^Advances\b/.test(r.text)) fails.push(`${label}: route tracee sous une recommandation "Advances"`);
    }
  }
  if (after.text === start.text && after.cls === start.cls) fails.push("l'explication n'a pas change apres un coup");

  console.log('depart :', JSON.stringify(start));
  console.log('apres  :', JSON.stringify(after));
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - la phrase est affichee et le plateau l illustre');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
