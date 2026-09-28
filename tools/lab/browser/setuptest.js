// The analysis board's setup mode, driven in real Chrome. The point of the mode is that a
// position does NOT have to be reached by legal play, so every assertion here is about placing
// something where a game would refuse to put it -- a pawn six squares away, a wall for the side
// that is not to move -- and about the three rules that do survive.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9344;
const URL = process.env.PAGE || 'http://127.0.0.1:5594/index.html';
const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
  r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

(async () => {
  let tabs = null;
  for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await get('/json/list'); } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));
  let id = 0; const w = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (x.id && w.has(x.id)) { w.get(x.id)(x); w.delete(x.id); } });
  const send = (m, p) => new Promise((res, rej) => { const n = ++id; w.set(n, r => r.error ? rej(new Error(m + ': ' + r.error.message)) : res(r.result)); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
  const js = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 250)); return r.result.value; };
  const wait = ms => js(`new Promise(r => setTimeout(r, ${ms}))`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await js(`new Promise(r => { const t = setInterval(() => { if (document.readyState === 'complete' && document.querySelector('#menu [data-mode="board"]')) { clearInterval(t); r(1); } }, 60); })`);

  const fails = [];
  const pawns = () => js(`[...document.querySelectorAll('#board .pawn')].map(p => { const c = p.closest('.cell'); return p.dataset.seat + '@' + c.dataset.r + ',' + c.dataset.c; }).join(' ')`);
  const walls = () => js(`document.querySelectorAll('#board .wall').length`);
  const hands = () => js(`[...document.querySelectorAll('#setup-hands .setup-num')].map(e => e.textContent).join('/')`);

  await js(`document.querySelector('#menu [data-mode="board"]').click(); 1`);
  await wait(700);
  const before = await pawns();

  // the button is there, and only on this board
  if (await js(`document.querySelector('#setup-btn').hidden`)) fails.push('pas de bouton Set up sur le plateau d analyse');
  await js(`document.querySelector('#setup-btn').click(); 1`);
  await wait(500);
  const on = await js(`({ panel: !document.querySelector('#setup-panel').hidden,
      board: document.querySelector('#board').classList.contains('setup'),
      analysis: document.querySelector('#analysis').hidden,
      grabbable: document.querySelectorAll('#board .pawn.draggable').length,
      targets: document.querySelectorAll('#board .cell.movable').length,
      junctions: getComputedStyle(document.querySelector('#board .wjunction')).pointerEvents })`);
  if (!on.panel) fails.push('le panneau Set up ne s affiche pas');
  if (!on.board) fails.push('le plateau ne passe pas en mode setup');
  if (!on.analysis) fails.push('Path tourne encore pendant la mise en place');
  if (on.grabbable !== 2) fails.push(`${on.grabbable} pions attrapables, 2 attendus`);
  if (on.targets !== 79) fails.push(`${on.targets} cases cibles, 79 attendues (81 moins les 2 pions)`);
  if (on.junctions !== 'auto') fails.push('les jonctions ne sont pas cliquables');

  // --- a pawn straight to the middle of the board: six squares, no legal move would do it ---
  await js(`document.querySelector('#board .pawn[data-seat="0"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
            document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); 1`);
  await wait(200);
  const picked = await js(`document.querySelectorAll('#board .pawn.picked').length`);
  await js(`document.querySelector('#board .cell[data-r="4"][data-c="4"]').click(); 1`);
  await wait(400);
  const jumped = await pawns();
  if (picked !== 1) fails.push('taper un pion ne le prend pas en main');
  if (!/0@4,4/.test(jumped)) fails.push(`le pion n a pas saute au centre: "${jumped}" (avant "${before}")`);

  // --- a wall for the side that is NOT to move, from the far rail ---
  const w0 = await walls();
  const turnBefore = await js(`[...document.querySelectorAll('#setup-turn .setup-pill')].findIndex(b => b.classList.contains('on'))`);
  await js(`(() => { const j = document.querySelector('#board .wjunction[data-r="2"][data-c="2"]'); j.click(); })()`);
  await wait(400);
  const w1 = await walls(), h1 = await hands();
  if (w1 !== w0 + 1) fails.push('un clic sur une jonction ne pose pas de mur');
  if (h1 !== '9/10' && h1 !== '10/9') fails.push(`les murs en main ne bougent pas: "${h1}"`);

  // --- and off again ---
  await js(`document.querySelector('#board .wall.liftable').click(); 1`);
  await wait(400);
  if (await walls() !== w0) fails.push('un clic sur un mur ne l enleve pas');
  if (await hands() !== '10/10') fails.push(`le mur n est pas rendu: "${await hands()}"`);

  // --- whose turn is a choice ---
  await js(`document.querySelectorAll('#setup-turn .setup-pill')[1].click(); 1`);
  await wait(300);
  const turnAfter = await js(`[...document.querySelectorAll('#setup-turn .setup-pill')].findIndex(b => b.classList.contains('on'))`);
  if (turnBefore !== 0 || turnAfter !== 1) fails.push(`le trait ne change pas: ${turnBefore} -> ${turnAfter}`);

  // --- the counts are a choice too, and they stop at the ends ---
  await js(`document.querySelectorAll('#setup-hands .setup-step')[0].click(); 1`);   // minus, seat 0
  await wait(250);
  if (await hands() !== '9/10') fails.push(`le bouton moins ne marche pas: "${await hands()}"`);
  for (let k = 0; k < 12; k++) { await js(`document.querySelectorAll('#setup-hands .setup-step')[0].click(); 1`); }
  await wait(400);
  if (await hands() !== '0/10') fails.push(`le compte passe sous zero: "${await hands()}"`);

  // --- the rules that survive: no pawn on top of a pawn, and nobody walled out ---
  await js(`document.querySelectorAll('#setup-hands .setup-step')[1].click(); 1`);   // plus, back to 1
  await wait(250);
  const stacked = await js(`(() => { const p = document.querySelector('#board .pawn[data-seat="1"]');
      const c = p.closest('.cell'); return document.querySelector('#board .cell[data-r="4"][data-c="4"]').classList.contains('movable'); })()`);
  if (stacked) fails.push('la case occupee par un pion est proposee comme cible');

  // --- the one rule setup cannot relax: a pawn may not be put somewhere it is walled in ---
  // Two walls seal the pocket {(0,0),(0,1)}: a horizontal one under it and a vertical one
  // beside it. Both are legal while the pawns are elsewhere -- it is walking INTO the pocket
  // that has no way out, and that is the placement that has to be refused.
  await js(`document.querySelector('#board .wjunction[data-r="0"][data-c="0"]').click(); 1`);
  await wait(350);
  await js(`document.querySelector('#rotate-btn').click(); 1`);
  await wait(250);
  await js(`document.querySelector('#board .wjunction[data-r="0"][data-c="1"]').click(); 1`);
  await wait(350);
  const sealed = await walls();
  await js(`document.querySelector('#board .pawn[data-seat="1"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
            document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 })); 1`);
  await wait(250);
  await js(`(() => { const c = document.querySelector('#board .cell[data-r="0"][data-c="0"]'); if (c) c.click(); })()`);
  await wait(400);
  const trapped = await pawns();
  if (sealed !== 2) fails.push(`${sealed} murs pour fermer la poche, 2 attendus`);
  if (/1@0,0/.test(trapped)) fails.push(`un pion a ete pose dans une poche sans sortie: "${trapped}"`);

  // --- leaving setup gives Path back ---
  await js(`document.querySelector('#setup-done').click(); 1`);
  await wait(2000);
  const off = await js(`({ panel: document.querySelector('#setup-panel').hidden,
      board: document.querySelector('#board').classList.contains('setup'),
      analysis: !document.querySelector('#analysis').hidden,
      moves: document.querySelectorAll('#moves-list .mv-cell').length })`);
  if (!off.panel) fails.push('le panneau Set up reste affiche apres Done');
  if (off.board) fails.push('le plateau reste en mode setup apres Done');
  if (!off.analysis) fails.push('Path ne revient pas apres Done');
  if (off.moves !== 0) fails.push(`${off.moves} coups dans la liste apres une mise en place`);

  const report = { on, jumped, trapped, off, hands: await hands() };
  console.log('setup   :', JSON.stringify(report));
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - pions poses n importe ou, murs poses et retires des deux cotes, trait et comptes choisis');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
