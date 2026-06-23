// app.js — UI + match controller for Detour.
(function () {
  const R = window.Rules;
  const SIZE = R.SIZE;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const boardEl = $('#board');
  const statusEl = $('#status');
  const STORE = 'detour_stats';

  let M = null;            // current match
  let previewEl = null;    // ghost wall preview on the board grid
  let drag = null;         // active drag-from-inventory gesture, or { locked:true } while input is frozen
  let pendingRole = null;  // 'host' | 'guest' while a room is connecting

  // ---------- screens / overlays / toast ----------
  function showScreen(id) { $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === id)); }
  const openOverlay = id => $('#' + id).classList.add('is-active');
  const closeOverlay = id => $('#' + id).classList.remove('is-active');

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---------- stats ----------
  function loadStats() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function saveStats(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }
  function recordResult(mode, humanWon) {
    if (mode !== 'bot' && mode !== 'hard') return;
    const s = loadStats();
    const rec = s[mode] || { w: 0, l: 0 };
    humanWon ? rec.w++ : rec.l++;
    s[mode] = rec;
    saveStats(s);
  }
  function renderRecords() {
    const s = loadStats();
    $$('[data-record]').forEach(el => {
      const rec = s[el.dataset.record];
      el.textContent = rec ? `${rec.w}W – ${rec.l}L` : 'No games yet';
    });
  }

  // ---------- match lifecycle ----------
  function startMatch(mode) {
    M = {
      state: R.createState(),
      mode,
      difficulty: mode === 'hard' ? 'hard' : 'easy',
      human: mode === 'local' ? [true, true] : [true, false],
      orient: 'h',
      net: null,
    };
    $('[data-name="0"]').textContent = mode === 'local' ? 'Player 1' : 'You';
    $('[data-name="1"]').textContent = mode === 'local' ? 'Player 2' : (mode === 'hard' ? 'Hard AI' : 'Bot');
    drag = null;
    closeOverlay('overlay');
    showScreen('game');
    render();
    maybeBot();
  }

  function startNetMatch(role, myPlayer) {
    M = {
      state: R.createState(),
      mode: 'net',
      difficulty: null,
      human: [false, false],
      orient: 'h',
      net: { role, myPlayer, connected: true },
    };
    $('[data-name="0"]').textContent = myPlayer === 0 ? 'You' : 'Opponent';
    $('[data-name="1"]').textContent = myPlayer === 1 ? 'You' : 'Opponent';
    drag = null;
    closeOverlay('overlay');
    showScreen('game');
    render();
  }

  function setOrient(orient) { M.orient = orient; render(); }

  const interactive = () => {
    if (!M || M.state.winner !== null || drag?.locked) return false;
    if (M.net) return M.net.connected && M.net.myPlayer === M.state.turn;
    return M.human[M.state.turn];
  };

  function applyAction(action, fromRemote) {
    const s = M.state;
    if (action.type === 'wall') R.applyWall(s, action.orient, action.r, action.c);
    else R.applyMove(s, action.to);
    if (M.net && !fromRemote) window.Net.send(action);
    render();
    if (s.winner !== null) return endMatch();
    if (!M.net) maybeBot();
  }

  function maybeBot() {
    const s = M.state;
    if (M.net || s.winner !== null || M.human[s.turn]) return;
    drag = { locked: true };
    statusEl.textContent = (M.difficulty === 'hard' ? 'Hard AI' : 'Bot') + ' thinking…';
    setTimeout(() => {
      const action = window.Bot.chooseAction(s, s.turn, M.difficulty);
      drag = null;
      if (action) applyAction(action, false);
    }, 480);
  }

  function showWin(title, sub) {
    $('#win-title').textContent = title;
    $('#win-sub').textContent = sub;
    statusEl.textContent = title;
    openOverlay('overlay');
  }

  function endMatch() {
    const w = M.state.winner;
    if (M.net) {
      const won = w === M.net.myPlayer;
      return showWin(won ? 'You win' : 'You lose', won ? 'Nice detour.' : 'Out-maneuvered.');
    }
    recordResult(M.mode, w === 0);
    if (M.mode === 'local') showWin(`Player ${w + 1} wins`, 'Reached the other side first.');
    else if (w === 0) showWin('You win', `You beat the ${M.mode === 'hard' ? 'Hard AI' : 'Bot'}.`);
    else showWin('You lose', 'Detoured one turn too many.');
  }

  function requestRematch() {
    if (M.net) { window.Net.send({ type: 'rematch' }); startNetMatch(M.net.role, M.net.myPlayer); }
    else startMatch(M.mode);
  }

  function leaveMatch() {
    if (M && M.mode === 'net') window.Net.close();
    closeOverlay('overlay');
    showScreen('menu');
    renderRecords();
  }

  // ---------- rendering ----------
  function gridPos(el, row, col, rowSpan = 1, colSpan = 1) {
    el.style.gridRow = `${row} / span ${rowSpan}`;
    el.style.gridColumn = `${col} / span ${colSpan}`;
  }

  function render() {
    const s = M.state;
    boardEl.innerHTML = '';
    boardEl.classList.remove('placing');
    const cells = Array.from({ length: SIZE }, () => []);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (r === 0) cell.classList.add('goal0');
        if (r === SIZE - 1) cell.classList.add('goal1');
        gridPos(cell, 2 * r + 1, 2 * c + 1);
        cells[r][c] = cell;
        boardEl.appendChild(cell);
      }
    }

    s.hWalls.forEach(k => addWall(k, 'h'));
    s.vWalls.forEach(k => addWall(k, 'v'));

    s.pawns.forEach((p, i) => {
      const pawn = document.createElement('div');
      pawn.className = 'pawn ' + (i === 0 ? 'p1' : 'p2');
      cells[p.r][p.c].appendChild(pawn);
    });

    for (let r = 0; r < SIZE - 1; r++) {
      for (let c = 0; c < SIZE - 1; c++) {
        const j = document.createElement('div');
        j.className = 'wjunction';
        j.dataset.r = r; j.dataset.c = c;
        gridPos(j, 2 * r + 2, 2 * c + 2);
        boardEl.appendChild(j);
      }
    }

    previewEl = document.createElement('div');
    previewEl.className = 'preview';
    previewEl.style.display = 'none';
    boardEl.appendChild(previewEl);

    if (interactive()) {
      for (const m of R.legalMoves(s, s.turn)) {
        const cell = cells[m.r][m.c];
        cell.classList.add('movable');
        cell.addEventListener('click', () => {
          if (!interactive()) return;
          applyAction({ type: 'move', to: { r: m.r, c: m.c } }, false);
        });
      }
    }

    renderTray();
    renderHud();
  }

  function addWall(k, orient) {
    const [r, c] = k.split(',').map(Number);
    const w = document.createElement('div');
    w.className = 'wall';
    if (orient === 'h') gridPos(w, 2 * r + 2, 2 * c + 1, 1, 3);
    else gridPos(w, 2 * r + 1, 2 * c + 2, 3, 1);
    boardEl.appendChild(w);
  }

  function renderTray() {
    const s = M.state;
    const p = s.turn;
    const inv = $('#inventory');
    inv.innerHTML = '';
    const color = p === 0 ? 'p1' : 'p2';
    for (let i = 0; i < s.walls[p]; i++) {
      const tok = document.createElement('div');
      tok.className = 'wtoken ' + color + (M.orient === 'v' ? ' vert' : '');
      if (interactive()) tok.addEventListener('pointerdown', startDrag);
      inv.appendChild(tok);
    }
    $('#orient-label').textContent = M.orient === 'h' ? 'Horizontal' : 'Vertical';
    $('#tray').classList.toggle('disabled', !interactive() || s.walls[p] === 0);
  }

  function renderHud() {
    const s = M.state;
    $$('[data-walls]').forEach(el => { el.textContent = s.walls[Number(el.dataset.walls)]; });
    $$('.player').forEach(el => el.classList.toggle('active', Number(el.dataset.player) === s.turn));
    if (drag?.locked || s.winner !== null) return;
    if (M.net) statusEl.textContent = M.net.myPlayer === s.turn ? 'Your turn' : "Opponent's turn";
    else if (M.mode === 'local') statusEl.textContent = `Player ${s.turn + 1}'s turn`;
    else statusEl.textContent = M.human[s.turn] ? 'Your turn' : '';
  }

  // ---------- wall preview ----------
  function placePreview(orient, r, c, ok) {
    if (orient === 'h') gridPos(previewEl, 2 * r + 2, 2 * c + 1, 1, 3);
    else gridPos(previewEl, 2 * r + 1, 2 * c + 2, 3, 1);
    previewEl.className = 'preview ' + (ok ? 'ok' : 'bad');
    previewEl.style.display = '';
  }
  const hidePreview = () => { if (previewEl) previewEl.style.display = 'none'; };

  // ---------- drag a wall from the inventory ----------
  function startDrag(e) {
    if (!interactive() || drag) return;
    e.preventDefault();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, target: null };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) beginGhost();
    if (!drag.moved) return;
    moveGhost(e.clientX, e.clientY);
    hitTest(e.clientX, e.clientY);
  }

  function beginGhost() {
    drag.moved = true;
    boardEl.classList.add('placing');
    const cell = boardEl.querySelector('.cell').getBoundingClientRect().width;
    const span = cell * 2.22;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = (M.orient === 'h' ? span : cell * 0.26) + 'px';
    ghost.style.height = (M.orient === 'h' ? cell * 0.26 : span) + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }

  function moveGhost(x, y) { drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px'; }

  function hitTest(x, y) {
    const el = document.elementFromPoint(x, y);
    const j = el && el.closest && el.closest('.wjunction');
    if (!j) { drag.target = null; hidePreview(); return; }
    const r = Number(j.dataset.r), c = Number(j.dataset.c);
    const ok = R.canPlaceWall(M.state, M.state.turn, M.orient, r, c);
    placePreview(M.orient, r, c, ok);
    drag.target = ok ? { r, c } : null;
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (drag.ghost) drag.ghost.remove();
    boardEl.classList.remove('placing');
    hidePreview();
    const target = drag.target, moved = drag.moved;
    drag = null;
    if (moved && target) applyAction({ type: 'wall', orient: M.orient, r: target.r, c: target.c }, false);
  }

  // ---------- online (friend room code) ----------
  function openOnline() {
    pendingRole = null;
    $('#room-display').hidden = true;
    $('#online-status').textContent = '';
    $('#join-code').value = '';
    $('#create-room').disabled = false;
    $('#join-room').disabled = false;
    showScreen('online');
  }
  const setOnlineStatus = msg => { $('#online-status').textContent = msg; };
  const resetOnlineButtons = () => { $('#create-room').disabled = false; $('#join-room').disabled = false; };

  function onNetEvent(ev) {
    switch (ev.type) {
      case 'open':
        startNetMatch(pendingRole, pendingRole === 'host' ? 0 : 1);
        break;
      case 'data':
        handleNetData(ev.msg);
        break;
      case 'close':
        if (M && M.mode === 'net') { M.net.connected = false; closeOverlay('overlay'); showScreen('menu'); toast('Opponent disconnected'); }
        break;
      case 'error':
        handleNetError(ev.err);
        break;
    }
  }

  function handleNetError(err) {
    const t = err && err.type;
    let msg = 'Connection error.';
    if (t === 'peer-unavailable') msg = 'No room with that code.';
    else if (t === 'unavailable-id') msg = 'Room code clash — try again.';
    else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') msg = 'Could not reach the server.';
    if (M && M.mode === 'net') toast(msg);
    else { resetOnlineButtons(); setOnlineStatus(msg); }
  }

  function handleNetData(msg) {
    if (!M || M.mode !== 'net') return;
    const s = M.state;
    if (msg.type === 'rematch') return startNetMatch(M.net.role, M.net.myPlayer);
    if (msg.type !== 'move' && msg.type !== 'wall') return;
    if (s.winner !== null || M.net.myPlayer === s.turn) return; // only the opponent, on their turn
    if (msg.type === 'wall') { if (!R.canPlaceWall(s, s.turn, msg.orient, msg.r, msg.c)) return; }
    else if (!R.legalMoves(s, s.turn).some(m => m.r === msg.to.r && m.c === msg.to.c)) return;
    applyAction(msg, true);
  }

  async function createRoom() {
    pendingRole = 'host';
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus('Creating room…');
    try {
      const code = await window.Net.host(onNetEvent);
      $('#room-code').textContent = code;
      $('#room-display').hidden = false;
      setOnlineStatus('Share this code. Waiting for your opponent…');
    } catch {
      resetOnlineButtons();
      setOnlineStatus('Could not reach the server. Check your connection.');
    }
  }

  async function joinRoom() {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 4) return setOnlineStatus('Enter the 4-character code.');
    pendingRole = 'guest';
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus('Connecting…');
    try { await window.Net.join(code, onNetEvent); }
    catch { resetOnlineButtons(); setOnlineStatus('Could not connect. Check the code and try again.'); }
  }

  function copyCode() {
    const code = $('#room-code').textContent;
    const done = () => toast('Code copied');
    if (navigator.clipboard) { navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done)); }
    else fallbackCopy(code, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch { toast(text); }
  }

  // ---------- share ----------
  async function share() {
    let text;
    if (M.net) text = M.state.winner === M.net.myPlayer ? 'I won a game of Detour.' : 'I lost a game of Detour.';
    else if (M.mode === 'local') text = `Player ${M.state.winner + 1} won a game of Detour.`;
    else {
      const opp = M.mode === 'hard' ? 'Hard AI' : 'Bot';
      text = M.state.winner === 0 ? `I beat the ${opp} at Detour.` : `The ${opp} beat me at Detour.`;
    }
    try { if (navigator.share) { await navigator.share({ title: 'Detour', text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); toast('Result copied'); return; } catch { /* fall through */ }
    fallbackCopy(text, () => toast('Result copied'));
  }

  // ---------- wiring ----------
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === 'friend') openOnline();
    else startMatch(b.dataset.mode);
  }));
  $('#how-btn').addEventListener('click', () => openOverlay('how'));
  $('#how-close').addEventListener('click', () => closeOverlay('how'));

  $('#back-btn').addEventListener('click', leaveMatch);
  $('#menu-btn').addEventListener('click', leaveMatch);
  $('#restart-btn').addEventListener('click', requestRematch);
  $('#rematch-btn').addEventListener('click', requestRematch);
  $('#share-btn').addEventListener('click', share);
  $('#rotate-btn').addEventListener('click', () => setOrient(M.orient === 'h' ? 'v' : 'h'));

  $('#online-back').addEventListener('click', () => { window.Net.close(); showScreen('menu'); });
  $('#create-room').addEventListener('click', createRoom);
  $('#join-room').addEventListener('click', joinRoom);
  $('#copy-code').addEventListener('click', copyCode);
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

  renderRecords();
})();
