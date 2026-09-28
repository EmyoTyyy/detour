// Whose panel is it? Two bugs in one file, both about the analysis panel speaking from the
// wrong chair.
//
//  1. Path was offered where it must not be. setControls decided with supports(), anAfterRender
//     decided without it, and anAfterRender runs on every render -- so it always won. And the
//     switch itself survived a change of game, so a panel left open in one game came up over
//     the next one.
//  2. The sentence under the evaluation was written in the voice of the side to MOVE, while the
//     bar above it was drawn from the seat of the side READING. On the opponent's turn the two
//     said opposite things about the same position.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9346;
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

  const fails = [];
  const boot = async () => {
    await send('Page.navigate', { url: URL });
    await js(`new Promise(r => { const t = setInterval(() => { if (document.readyState === 'complete' && window.Explain && document.querySelector('#menu [data-mode="local"]')) { clearInterval(t); r(1); } }, 60); })`);
  };
  const setMods = async o => js(`(() => { const k = Object.keys(localStorage).find(k => { try { const v = JSON.parse(localStorage[k]); return v && typeof v === 'object' && 'fourP' in v; } catch (e) { return false; } }) || 'detour_settings';
      let v = {}; try { v = JSON.parse(localStorage[k] || '{}'); } catch (e) {}
      Object.assign(v, ${JSON.stringify(o)}); localStorage[k] = JSON.stringify(v); })(); 1`);

  // --- 1. a board the engine cannot analyse must not offer it ---
  await boot();
  await setMods({ fourP: true, inverted: false, race: false });
  await boot();
  await js(`document.querySelector('#menu [data-mode="board"]').click(); 1`);
  await wait(800);
  const p4 = await js(`({ pawns: document.querySelectorAll('#board .pawn').length,
      btn: document.querySelector('#analysis-btn').hidden,
      panel: document.querySelector('#analysis').hidden })`);
  if (p4.pawns !== 4) fails.push(`${p4.pawns} pions, 4 attendus -- le reglage 4 joueurs n a pas pris`);
  if (!p4.btn) fails.push('le bouton Path est offert sur un plateau que le moteur ne sait pas analyser');
  if (!p4.panel) fails.push('le panneau Path s affiche sur un plateau non analysable');

  // --- 2. and it comes back where it belongs ---
  await setMods({ fourP: false });
  await boot();
  await js(`document.querySelector('#menu [data-mode="local"]').click(); 1`);
  await wait(400);
  await js(`document.querySelector('#local-start').click(); 1`);
  await wait(900);
  if (await js(`document.querySelector('#analysis-btn').hidden`)) fails.push('le bouton Path a disparu d une partie locale');
  await js(`document.querySelector('#analysis-btn').click(); 1`);
  await wait(2600);

  // --- 3. the sentence follows the reader, not the side to move ---
  // A local game never flips the board, so meIndex() is 0 throughout: after seat 0 moves it is
  // seat 1's turn and the panel is being read by someone who is NOT moving.
  const read = async () => js(`({ turn: document.querySelector('#board .pawn.draggable').dataset.seat,
      why: (document.querySelector('#eng-why') || {}).textContent || '',
      wp: (document.querySelector('#evalbar-num') || {}).textContent })`);
  const stepForward = async () => {
    await js(`(() => { const p = document.querySelector('#board .pawn.draggable'); const f = p && p.closest('.cell');
        const cs = [...document.querySelectorAll('#board .cell.movable')];
        const c = (f && cs.find(x => x.dataset.c === f.dataset.c)) || cs[0]; if (c) c.click(); })()`);
    await wait(2600);
  };
  const first = await read();
  await stepForward();
  const second = await read();
  await stepForward();
  const third = await read();

  // seat 0 reads the panel the whole time; on seat 1's turn the words must be third person
  for (const [label, r] of [['depart', first], ['tour 2', second], ['tour 3', third]]) {
    if (!r.why) { fails.push(`${label}: aucune explication`); continue; }
    const mover = Number(r.turn);
    const saysYou = /\b(you|your|yours)\b/i.test(r.why);
    const saysThey = /\b(they|their|theirs|them)\b/i.test(r.why);
    // a sentence with no pronoun at all is fine; one with the WRONG one is not
    if (mover !== 0 && saysYou && !saysThey) fails.push(`${label}: au trait du joueur ${mover}, la phrase dit "you" -- "${r.why}"`);
    if (mover === 0 && saysThey && !saysYou) fails.push(`${label}: au trait du joueur 0, la phrase ne parle que d "eux" -- "${r.why}"`);
  }

  // --- 4. the route is not drawn when it is only the recommendation drawn longer ---
  const arrows = await js(`({ best: document.querySelectorAll('#board .board-arrows .arrow.best').length,
      routes: document.querySelectorAll('#board .board-arrows .route').length,
      why: (document.querySelector('#eng-why') || {}).textContent || '' })`);
  if (/^Advances\b/.test(arrows.why) && arrows.routes > 0) {
    fails.push(`la route est encore tracee sous une recommandation "Advances" (${arrows.routes})`);
  }

  console.log('4 joueurs :', JSON.stringify(p4));
  console.log('phrases   :', JSON.stringify([first, second, third], null, 0));
  console.log('fleches   :', JSON.stringify(arrows));
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - Path seulement ou il est offert, et la phrase parle au lecteur');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
