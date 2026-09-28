// The Lessons tab, driven in real Chrome: open it, check both lists are populated, run a
// position lesson and answer it, and run an opening lesson far enough to see the lesson answer
// for the other side. Assertions are on what the page DREW, not on what the code believes.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9335;
const URL = process.env.PAGE || 'http://127.0.0.1:5597/index.html';
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
  const js = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 200)); return r.result.value; };
  const wait = ms => js(`new Promise(r => setTimeout(r, ${ms}))`);

  await send('Page.enable'); await send('Runtime.enable');
  // Without this Chrome serves app.js from its own cache and the test quietly grades the
  // previous version of the page -- which looks exactly like a passing test.
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  // The move track only exists in the wide layout, where the rails become tall side cards and
  // leave a gap between them, so the window has to be wide enough for that layout to apply.
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await js(`new Promise(r => { const t = setInterval(() => { if (document.readyState === 'complete' && window.Openings && window.Lessons && document.querySelector('#menu [data-mode="lessons"]')) { clearInterval(t); r(1); } }, 60); })`);

  const fails = [];
  const tileEnabled = await js(`!document.querySelector('#menu [data-mode="lessons"]').disabled`);
  if (!tileEnabled) fails.push('la tuile Lessons est encore desactivee');

  await js(`document.querySelector('#menu [data-mode="lessons"]').click(); 1`);
  await wait(400);
  const list = await js(`(() => { const s = document.querySelector('#lessons');
    return { active: s.classList.contains('is-active'),
             openings: document.querySelectorAll('#lesson-openings .lesson-card').length,
             drills: document.querySelectorAll('#lesson-drills .lesson-card').length,
             firstName: (document.querySelector('#lesson-openings .lesson-card .lesson-card-name')||{}).textContent,
             drillName: (document.querySelector('#lesson-drills .lesson-card .lesson-card-name')||{}).textContent }; })()`);
  if (!list.active) fails.push("l'ecran Lessons ne s'affiche pas");
  if (list.openings !== 8) fails.push(`${list.openings} lecons d'ouverture, 8 attendues`);
  if (list.drills < 1) fails.push('aucune lecon de position');

  // --- a position lesson: open "Keep pace" and play the move the engine found ---
  await js(`[...document.querySelectorAll('#lesson-drills .lesson-card')].find(b => b.textContent.indexOf('Keep pace') >= 0).click(); 1`);
  await wait(700);
  const opened = await js(`(() => { const p = document.querySelector('#lesson-panel');
    const r = p.getBoundingClientRect();
    return { drawn: r.width > 0 && r.height > 0 && getComputedStyle(p).display !== 'none',
             kind: document.querySelector('#lesson-kind').textContent,
             title: document.querySelector('#lesson-title').textContent,
             ask: document.querySelector('#lesson-ask').textContent.slice(0, 50) }; })()`);
  if (!opened.drawn) fails.push('le panneau de lecon n est pas dessine');
  if (opened.title !== 'Keep pace') fails.push(`titre "${opened.title}"`);
  if (await js(`!!document.querySelector('#lesson-hint')`)) fails.push('le bouton "Show me" est encore la');

  // The track, and the seat it names. "Keep pace" is five plies in, so the learner is the SECOND
  // player: the rail, the track's "You" column and the board's rotation all have to agree on
  // that, and before they did not -- the rail said "You" about the opponent's walls.
  const track = await js(`(() => { const t = document.querySelector('#lesson-line');
    const cs = getComputedStyle(t), r = t.getBoundingClientRect();
    return { drawn: cs.display !== 'none' && r.width > 0,
             head: (t.querySelector('.lt-head')||{}).textContent,
             labs: [...t.querySelectorAll('.lt-lab')].map(e => e.textContent).join('|'),
             moves: [...t.querySelectorAll('.lt-mv')].map(e => e.textContent).join(' '),
             near: document.querySelector('#near-name').textContent,
             far: document.querySelector('#far-name').textContent,
             status: document.querySelector('#status').textContent }; })()`);
  if (!track.drawn) fails.push('la piste de coups n est pas dessinee en large');
  if (track.head !== 'How we got here') fails.push(`titre de la piste "${track.head}"`);
  if (track.labs !== '|Them|You') fails.push(`colonnes "${track.labs}", "|Them|You" attendu (le joueur est le second)`);
  if (track.moves !== 'e2 e8 e3 e7 e4') fails.push(`piste "${track.moves}", "e2 e8 e3 e7 e4" attendu`);
  if (track.near !== 'You' || track.far !== 'Opponent') fails.push(`rails "${track.near}" / "${track.far}"`);
  if (track.status !== 'Your turn') fails.push(`statut "${track.status}" au tour du joueur`);

  // a wrong answer first: it must be refused and priced, and must NOT be played
  const before = await js(`document.querySelectorAll('#moves-list .mv-cell').length`);
  await js(`(() => { const c = document.querySelector('#board .cell[data-r="2"][data-c="3"]'); if (c) c.click(); })()`);
  await wait(900);
  const wrong = await js(`({ say: document.querySelector('#lesson-say').textContent,
      hidden: document.querySelector('#lesson-say').hidden,
      moves: document.querySelectorAll('#moves-list .mv-cell').length })`);

  // the right answer: e6 is Detour (3,4)
  await js(`(() => { const c = document.querySelector('#board .cell[data-r="3"][data-c="4"]'); if (c) c.click(); })()`);
  await wait(900);
  const right = await js(`({ say: document.querySelector('#lesson-say').textContent,
      next: !document.querySelector('#lesson-next').hidden,
      moves: document.querySelectorAll('#moves-list .mv-cell').length,
      ask: document.querySelector('#lesson-ask').textContent,
      routes: document.querySelectorAll('#board .board-arrows .route').length })`);
  if (right.routes < 1) fails.push('aucune route dessinee apres la bonne reponse');
  if (!/step|wall|race|route/i.test(right.ask)) fails.push(`l'explication du moteur n'apparait pas: "${right.ask.slice(0,60)}"`);

  if (wrong.hidden || !wrong.say) fails.push('un mauvais coup ne dit rien');
  if (wrong.moves !== before) fails.push('un mauvais coup a ete joue sur le plateau');
  if (!/that is the move/i.test(right.say)) fails.push(`bonne reponse -> "${right.say}"`);
  if (!right.next) fails.push('le bouton Next n apparait pas apres la bonne reponse');

  // --- three wrong tries open the answer, now that there is no button to open it with ---
  await js(`document.querySelector('#lesson-quit').click(); 1`);
  await wait(400);
  await js(`[...document.querySelectorAll('#lesson-drills .lesson-card')].find(b => b.textContent.indexOf('Keep pace') >= 0).click(); 1`);
  await wait(700);
  for (let k = 0; k < 3; k++) {
    await js(`(() => { const c = [...document.querySelectorAll('#board .cell.movable')]
        .find(x => !(x.dataset.r === '3' && x.dataset.c === '4')); if (c) c.click(); })()`);
    await wait(800);
  }
  const gave = await js(`({ say: document.querySelector('#lesson-say').textContent,
      routes: document.querySelectorAll('#board .board-arrows .route').length,
      shown: document.querySelectorAll('#board .board-arrows .arrow.best, #board .ghost-wall, #board .wall.ghost').length,
      next: !document.querySelector('#lesson-next').hidden,
      moves: document.querySelectorAll('#moves-list .mv-cell').length,
      marked: (localStorage.getItem('detour_lessons_done') || '').indexOf('keep-pace') >= 0 })`);
  if (!/the move is/i.test(gave.say)) fails.push(`3 essais rates -> "${gave.say}", la reponse attendue`);
  // The answer to "Keep pace" is an advance, so the route home would only be that same step
  // drawn longer; what the board owes the learner is the move itself, which is still unplayed.
  if (gave.routes + gave.shown < 1) fails.push('rien n est dessine sur le plateau quand la reponse est donnee');
  if (gave.shown < 1) fails.push('la reponse revelee n est pas dessinee comme un coup');
  if (!gave.next) fails.push('pas de bouton Next apres la reponse donnee');
  if (gave.moves !== 0) fails.push('la reponse donnee a ete jouee sur le plateau');

  // --- an opening lesson: play your move, and the lesson must answer for the other side ---
  await js(`document.querySelector('#lesson-quit').click(); 1`);
  await wait(400);
  await js(`[...document.querySelectorAll('#lesson-openings .lesson-card')].find(b => b.textContent.indexOf('Reed Opening') >= 0).click(); 1`);
  await wait(600);
  const reedStart = await js(`({ step: document.querySelector('#lesson-step').textContent,
      ask: document.querySelector('#lesson-ask').textContent })`);
  // Reed opens c3h, which is the horizontal junction (5,2): drag a wall there
  const pts = await js(`(() => { const t = document.querySelector('.wtoken.grab');
      const j = document.querySelector('#board .wjunction[data-r="5"][data-c="2"]');
      if (!t || !j) return null; const a = t.getBoundingClientRect(), b = j.getBoundingClientRect();
      return { ax: a.left + a.width/2, ay: a.top + a.height/2, bx: b.left + b.width/2, by: b.top + b.height/2 }; })()`);
  if (!pts) fails.push('pas de jeton de mur dans la lecon d ouverture');
  else {
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
    await mouse('mousePressed', pts.ax, pts.ay);
    for (let k = 1; k <= 6; k++) await mouse('mouseMoved', pts.ax + (pts.bx - pts.ax) * k / 6, pts.ay + (pts.by - pts.ay) * k / 6);
    await mouse('mouseReleased', pts.bx, pts.by);
    await wait(1600);                       // long enough for the lesson's own reply to land
  }
  const reedAfter = await js(`({ step: document.querySelector('#lesson-step').textContent,
      ask: document.querySelector('#lesson-ask').textContent,
      moves: [...document.querySelectorAll('#moves-list .mv-cell')].map(e => e.textContent.trim()).filter(Boolean).join(' ') })`);
  if (reedStart.step !== '1 / 4') fails.push(`compteur de depart "${reedStart.step}", "1 / 4" attendu`);
  if (reedAfter.moves !== 'c3h a3h') fails.push(`coups joues "${reedAfter.moves}", "c3h a3h" attendus (la lecon doit repondre a3h)`);
  if (reedAfter.step !== '3 / 4') fails.push(`compteur apres "${reedAfter.step}", "3 / 4" attendu`);

  // the opening's own track: the line, with everything past the current step masked
  const oTrack = await js(`(() => { const t = document.querySelector('#lesson-line');
    return { head: (t.querySelector('.lt-head')||{}).textContent,
             labs: [...t.querySelectorAll('.lt-lab')].map(e => e.textContent).join('|'),
             moves: [...t.querySelectorAll('.lt-mv')].map(e => e.textContent).join(' ') }; })()`);
  if (oTrack.head !== 'The line') fails.push(`titre de la piste d ouverture "${oTrack.head}"`);
  if (oTrack.labs !== '|You|Them') fails.push(`colonnes d ouverture "${oTrack.labs}"`);
  if (oTrack.moves !== 'c3h a3h f3h \u00b7') fails.push(`piste d ouverture "${oTrack.moves}", les coups joues puis le coup courant puis un point attendus`);

  console.log('piste   :', JSON.stringify(track), JSON.stringify(oTrack));
  console.log('donne   :', JSON.stringify(gave));
  console.log('reed    :', JSON.stringify(reedStart), '->', JSON.stringify(reedAfter));
  console.log('liste   :', JSON.stringify(list));
  console.log('ouvert  :', JSON.stringify(opened));
  console.log('faux    :', JSON.stringify(wrong));
  console.log('juste   :', JSON.stringify(right));
  console.log(fails.length ? 'FAIL\n  - ' + fails.join('\n  - ') : 'OK - les deux listes, le panneau, le refus chiffre et la bonne reponse');
  ws.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(2); });
