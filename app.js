// app.js — UI + match controller for Detour.
(function () {
  const R = window.Rules;
  const SIZE = R.SIZE;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const boardEl = $('#board');
  const statusEl = $('#status');
  const STORE = 'detour_stats';

  const HOST_ID = '__host__';
  let M = null;            // current match
  let T = null;            // active local tournament: { players, schedule, current }
  let OT = null;           // active online tournament (host or client context)
  let previewEl = null;    // ghost wall preview on the board grid
  let drag = null;         // active drag-from-inventory gesture, or { locked:true } while input is frozen
  let pendingRole = null;  // 'host' | 'guest' while a room is connecting
  let drawCtx = null;      // 'net' | 'local' — who the draw prompt is for
  let tourneyPlayers = []; // names being added on the local setup screen

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
  function recordResult(humanWon) {
    if (M.mode !== 'bot') return;
    const s = loadStats();
    const rec = s[M.difficulty] || { w: 0, l: 0 };
    humanWon ? rec.w++ : rec.l++;
    s[M.difficulty] = rec;
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
  function setControls() {
    const net = !!M.net;
    const otour = M.mode === 'otour';
    $('#restart-btn').hidden = net || otour;                 // restart only in local / bot / tournament
    $('#forfeit-btn').hidden = !(net || (otour && M.playing)); // forfeit online, or as a playing entrant
    $('#draw-btn').hidden = M.mode === 'bot' || otour;        // no draws online-tournament (v1)
  }

  function startMatch(mode, difficulty) {
    M = {
      state: R.createState(),
      mode,
      difficulty: mode === 'bot' ? difficulty : null,
      human: mode === 'local' ? [true, true] : [true, false],
      orient: 'h',
      net: null,
    };
    setControls();
    drag = null;
    closeOverlay('overlay');
    closeOverlay('difficulty');
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
    setControls();
    drag = null;
    closeOverlay('overlay');
    showScreen('game');
    render();
  }

  function setOrient(orient) { M.orient = orient; render(); }

  const hotseat = () => M.mode === 'local' || M.mode === 'tournament';

  // Index of the "near" player: shown at the bottom in teal, opponent at the top in amber.
  // Hotseat games flip each turn so the player to move is always at the bottom.
  const meIndex = () => {
    if (M.mode === 'otour') return M.seat;
    if (M.net) return M.net.myPlayer;
    return hotseat() ? M.state.turn : 0;
  };

  function nameOf(idx) {
    if (M.names) return M.names[idx];
    if (M.net) return idx === M.net.myPlayer ? 'You' : 'Opponent';
    if (M.mode === 'local') return `Player ${idx + 1}`;
    return idx === 0 ? 'You' : 'Bot · ' + M.difficulty[0].toUpperCase() + M.difficulty.slice(1);
  }

  const interactive = () => {
    if (!M || M.state.winner !== null || drag?.locked) return false;
    if (M.mode === 'otour') return M.playing && M.seat === M.state.turn;
    if (M.net) return M.net.connected && M.net.myPlayer === M.state.turn;
    return M.human[M.state.turn];
  };

  // All board input flows through here so online-tournament moves can be routed to the host.
  function submitAction(action) {
    if (M.mode === 'otour') {
      if (!M.playing) return;
      if (M.otour.host) hostApplyAction(action, HOST_ID);
      else window.Net.sendHost({ t: 'action', action });
      return;
    }
    applyAction(action, false);
  }

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
    statusEl.textContent = 'Bot thinking…';
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
    const tourney = M.mode === 'tournament' || M.mode === 'otour';
    $('#continue-btn').hidden = !tourney;
    $('#rematch-btn').hidden = tourney;
    $('#menu-btn').hidden = tourney;
    $('#share-btn').hidden = tourney;
    openOverlay('overlay');
  }

  function endMatch() {
    const w = M.state.winner;
    if (M.mode === 'tournament') return endTournamentMatch(w);
    if (M.net) {
      if (w === 'draw') return showWin('Draw', 'Neither side broke through.');
      const won = w === M.net.myPlayer;
      return showWin(won ? 'You win' : 'You lose', won ? 'Nice detour.' : 'Out-maneuvered.');
    }
    if (w === 'draw') return showWin('Draw', 'A stalemate of detours.');
    recordResult(w === 0);
    if (M.mode === 'local') showWin(`Player ${w + 1} wins`, 'Reached the other side first.');
    else if (w === 0) showWin('You win', `You beat the bot on ${M.difficulty}.`);
    else showWin('You lose', 'Detoured one turn too many.');
  }

  function requestRematch() {
    if (M.net) { window.Net.send({ type: 'rematch' }); startNetMatch(M.net.role, M.net.myPlayer); }
    else if (M.mode === 'tournament') startTournamentMatch();
    else startMatch(M.mode, M.difficulty);
  }

  function forfeit() {
    if (!M || M.state.winner !== null) return;
    if (M.mode === 'otour') {
      if (!M.playing) return;
      if (M.otour.host) hostForfeit(HOST_ID);
      else window.Net.sendHost({ t: 'forfeit' });
      return;
    }
    if (!M.net) return;
    window.Net.send({ type: 'forfeit' });
    M.state.winner = 1 - M.net.myPlayer;
    showWin('You forfeited', 'You bailed on the race.');
  }

  function leaveMatch() {
    if (M && M.mode === 'otour') return leaveOtour();
    if (M && M.mode === 'net') window.Net.close();
    closeOverlay('overlay');
    if (M && M.mode === 'tournament') return showTournamentStandings();
    showScreen('menu');
    renderRecords();
  }

  function onContinue() {
    closeOverlay('overlay');
    if (M.mode === 'otour') return M.otour.host ? showHostStandings() : showClientStandings();
    showTournamentStandings();
  }

  // ---------- draw ----------
  function offerDraw() {
    if (!M || M.state.winner !== null) return;
    if (M.net) { window.Net.send({ type: 'draw-offer' }); toast('Draw offer sent'); }
    else openDrawPrompt('local');
  }
  function endAsDraw() {
    if (M.state.winner !== null) return;
    M.state.winner = 'draw';
    endMatch();
  }
  function openDrawPrompt(ctx) {
    drawCtx = ctx;
    if (ctx === 'net') {
      $('#draw-title').textContent = 'Draw offered';
      $('#draw-text').textContent = 'Your opponent offers a draw.';
      $('#draw-accept').textContent = 'Accept';
      $('#draw-decline').textContent = 'Decline';
    } else {
      $('#draw-title').textContent = 'Agree to a draw?';
      $('#draw-text').textContent = 'End this game with no winner.';
      $('#draw-accept').textContent = 'End in draw';
      $('#draw-decline').textContent = 'Keep playing';
    }
    openOverlay('draw-prompt');
  }
  function drawAccept() {
    closeOverlay('draw-prompt');
    if (drawCtx === 'net') { window.Net.send({ type: 'draw-accept' }); endAsDraw(); }
    else endAsDraw();
  }
  function drawDecline() {
    closeOverlay('draw-prompt');
    if (drawCtx === 'net') window.Net.send({ type: 'draw-decline' });
  }

  // ---------- tournament ----------
  function openTournamentSetup() {
    tourneyPlayers = [];
    $('#tp-name').value = '';
    renderSetupList();
    showScreen('tournament-setup');
  }
  function addPlayer() {
    const name = $('#tp-name').value.trim();
    if (!name) return;
    if (tourneyPlayers.length >= 8) return toast('Up to 8 players');
    if (tourneyPlayers.some(n => n.toLowerCase() === name.toLowerCase())) return toast('Name already added');
    tourneyPlayers.push(name);
    $('#tp-name').value = '';
    $('#tp-name').focus();
    renderSetupList();
  }
  function renderSetupList() {
    const list = $('#tp-list');
    list.innerHTML = '';
    tourneyPlayers.forEach((n, i) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      const span = document.createElement('span');
      span.textContent = n;
      const x = document.createElement('button');
      x.className = 'chip-x';
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Remove ' + n);
      x.addEventListener('click', () => { tourneyPlayers.splice(i, 1); renderSetupList(); });
      chip.append(span, x);
      list.appendChild(chip);
    });
    const n = tourneyPlayers.length;
    $('#tp-count').textContent = n < 2 ? 'Add at least 2 players' : `${n} players · ${n * (n - 1) / 2} matches`;
    $('#tp-start').disabled = n < 2;
  }
  function startTournament() {
    if (tourneyPlayers.length < 2) return;
    const players = tourneyPlayers.map(name => ({ name, w: 0, d: 0, l: 0, pts: 0 }));
    const schedule = [];
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++) schedule.push([i, j]);
    for (let i = schedule.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [schedule[i], schedule[k]] = [schedule[k], schedule[i]];
    }
    T = { players, schedule, current: 0 };
    showTournamentStandings();
  }
  function showTournamentStandings() {
    renderStandings();
    showScreen('tournament-standings');
  }
  const sortRows = list => [...list].sort((a, b) => b.pts - a.pts || b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));

  // Shared leaderboard renderer for local + online tournaments.
  function fillLeaderboard(rows, headline, btnText, crown) {
    const body = $('#standings-body');
    body.innerHTML = '';
    rows.forEach((p, rank) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (crown && rank === 0 ? ' lb-winner' : '');
      for (const val of [rank + 1, p.name, p.w, p.d, p.l, p.pts]) {
        const span = document.createElement('span');
        span.textContent = val;
        row.appendChild(span);
      }
      row.children[0].className = 'lb-rank';
      row.children[1].className = 'lb-name';
      row.children[5].className = 'lb-pts';
      body.appendChild(row);
    });
    $('#next-match').textContent = headline;
    const btn = $('#play-next');
    btn.hidden = !btnText;
    btn.textContent = btnText || '';
  }

  function renderStandings() {
    const done = T.current >= T.schedule.length;
    const headline = done ? `${sortRows(T.players)[0].name} takes the crown`
      : `Match ${T.current + 1} of ${T.schedule.length} — ${T.players[T.schedule[T.current][0]].name} vs ${T.players[T.schedule[T.current][1]].name}`;
    fillLeaderboard(sortRows(T.players), headline, done ? 'New tournament' : 'Play match', done);
  }
  function playNext() {
    if (T.current >= T.schedule.length) openTournamentSetup();
    else startTournamentMatch();
  }
  function startTournamentMatch() {
    const [a, b] = T.schedule[T.current];
    M = {
      state: R.createState(),
      mode: 'tournament',
      difficulty: null,
      human: [true, true],
      orient: 'h',
      net: null,
      names: [T.players[a].name, T.players[b].name],
      pair: [a, b],
    };
    setControls();
    drag = null;
    closeOverlay('overlay');
    showScreen('game');
    render();
  }
  function endTournamentMatch(w) {
    const [a, b] = M.pair, pa = T.players[a], pb = T.players[b];
    if (w === 'draw') { pa.d++; pb.d++; pa.pts++; pb.pts++; }
    else {
      const win = w === 0 ? pa : pb, lose = w === 0 ? pb : pa;
      win.w++; win.pts += 3; lose.l++;
    }
    T.current++;
    const last = T.current >= T.schedule.length;
    const title = w === 'draw' ? 'Draw' : `${(w === 0 ? pa : pb).name} wins`;
    showWin(title, last ? 'Final match done — see the standings.' : 'On to the next match.');
  }

  // ---------- player name ----------
  const NAME_KEY = 'detour_name';
  function randToken(n) {
    const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const buf = (window.crypto || {}).getRandomValues ? crypto.getRandomValues(new Uint8Array(n)) : Array.from({ length: n }, () => Math.floor(Math.random() * 256));
    let s = ''; for (let i = 0; i < n; i++) s += a[buf[i] % a.length];
    return s;
  }
  function loadName() {
    let n; try { n = localStorage.getItem(NAME_KEY); } catch { /* ignore */ }
    if (!n) { n = 'Player-' + randToken(4); try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }
    return n;
  }
  const saveName = n => { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } };
  const myName = () => ($('#player-name').value.trim() || loadName()).slice(0, 16);

  // ---------- state (de)serialisation for snapshots ----------
  function serState(s) {
    return { t: s.turn, p: s.pawns.map(x => [x.r, x.c]), w: s.walls.slice(), h: [...s.hWalls], v: [...s.vWalls], win: s.winner };
  }
  function deState(o) {
    const s = R.createState();
    s.turn = o.t;
    s.pawns = o.p.map(([r, c]) => ({ r, c }));
    s.walls = o.w.slice();
    s.hWalls = new Set(o.h);
    s.vWalls = new Set(o.v);
    s.winner = o.win;
    return s;
  }

  // ---------- online tournament: entry + lobby ----------
  function openOtourEntry() {
    OT = null;
    $('#ote-status').textContent = '';
    $('#ote-code').value = '';
    $('#ote-create').disabled = false;
    $('#ote-join').disabled = false;
    showScreen('otour-entry');
  }

  async function otourCreate() {
    OT = { host: true, roster: [{ id: HOST_ID, name: myName() }], started: false };
    $('#ote-create').disabled = true; $('#ote-join').disabled = true;
    $('#ote-status').textContent = 'Creating room…';
    try {
      const code = await window.Net.hostHub(onHubEvent);
      OT.code = code;
      showLobby();
    } catch {
      OT = null;
      $('#ote-create').disabled = false; $('#ote-join').disabled = false;
      $('#ote-status').textContent = 'Could not reach the server. Check your connection.';
    }
  }

  async function otourJoin() {
    const code = $('#ote-code').value.trim().toUpperCase();
    if (code.length < 4) { $('#ote-status').textContent = 'Enter the 4-character code.'; return; }
    OT = { host: false, names: [] };
    $('#ote-create').disabled = true; $('#ote-join').disabled = true;
    $('#ote-status').textContent = 'Connecting…';
    try { await window.Net.joinHub(code, onClientEvent); }
    catch { OT = null; $('#ote-create').disabled = false; $('#ote-join').disabled = false; $('#ote-status').textContent = 'Could not connect. Check the code.'; }
  }

  function showLobby() {
    showScreen('otour-lobby');
    renderLobby();
  }
  function renderLobby() {
    const host = OT && OT.host;
    $('#otl-code-wrap').hidden = !host;
    if (host) $('#otl-code').textContent = OT.code || '----';
    $('#otl-start').hidden = !host;

    const names = host ? OT.roster.map(p => p.name) : (OT.names || []);
    const list = $('#otl-roster');
    list.innerHTML = '';
    names.forEach(n => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      const span = document.createElement('span');
      span.textContent = n;
      chip.appendChild(span);
      list.appendChild(chip);
    });
    if (host) {
      $('#otl-start').disabled = names.length < 2;
      $('#otl-status').textContent = names.length < 2 ? 'Waiting for players to join…' : `${names.length} players ready`;
    } else {
      $('#otl-status').textContent = 'Waiting for the host to start…';
    }
  }
  function leaveOtour() {
    window.Net.close();
    OT = null; M = null;
    closeOverlay('overlay'); closeOverlay('draw-prompt');
    showScreen('menu');
  }

  // ---------- online tournament: host (authority) ----------
  function onHubEvent(ev) {
    if (ev.type === 'data') hostOnData(ev.id, ev.msg);
    else if (ev.type === 'connect') { /* wait for hello */ }
    else if (ev.type === 'disconnect') hostOnDisconnect(ev.id);
    else if (ev.type === 'error') toast('Network error');
  }
  function hostOnData(id, msg) {
    if (!OT || !OT.host) return;
    if (msg.t === 'hello') {
      if (OT.started) { window.Net.sendTo(id, { t: 'too-late' }); return; }
      if (!OT.roster.some(p => p.id === id)) OT.roster.push({ id, name: String(msg.name || 'Player').slice(0, 16) });
      broadcastLobby();
      renderLobby();
    } else if (msg.t === 'action') hostApplyAction(msg.action, id);
    else if (msg.t === 'forfeit') hostForfeit(id);
  }
  function broadcastLobby() { window.Net.broadcast({ t: 'lobby', names: OT.roster.map(p => p.name) }); }

  function hostOnDisconnect(id) {
    if (!OT || !OT.host) return;
    if (!OT.started) {
      OT.roster = OT.roster.filter(p => p.id !== id);
      broadcastLobby();
      renderLobby();
      return;
    }
    const p = OT.players.find(x => x.id === id);
    if (p) p.left = true;
    if (OT.G && OT.G.winner === null && OT.pair) {
      const [ai, bi] = OT.pair;
      if (OT.players[ai].id === id) return hostEndMatch(1);
      if (OT.players[bi].id === id) return hostEndMatch(0);
    }
  }

  function hostStartTournament() {
    if (!OT || !OT.host || OT.roster.length < 2) return;
    OT.players = OT.roster.map(p => ({ id: p.id, name: p.name, w: 0, d: 0, l: 0, pts: 0, left: false }));
    OT.schedule = [];
    for (let i = 0; i < OT.players.length; i++)
      for (let j = i + 1; j < OT.players.length; j++) OT.schedule.push([i, j]);
    for (let i = OT.schedule.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [OT.schedule[i], OT.schedule[k]] = [OT.schedule[k], OT.schedule[i]];
    }
    OT.current = 0; OT.started = true;
    hostNextMatch();
  }

  function hostNextMatch() {
    while (OT.current < OT.schedule.length) {
      const [ai, bi] = OT.schedule[OT.current];
      const pa = OT.players[ai], pb = OT.players[bi];
      if (pa.left && pb.left) { OT.current++; continue; }
      if (pa.left || pb.left) { awardMatch(ai, bi, pa.left ? 1 : 0); OT.current++; continue; }
      return hostBeginMatch(ai, bi);
    }
    hostFinish();
  }
  function awardMatch(ai, bi, winSlot) {
    const win = OT.players[winSlot === 0 ? ai : bi], lose = OT.players[winSlot === 0 ? bi : ai];
    win.w++; win.pts += 3; lose.l++;
  }

  function hostBeginMatch(ai, bi) {
    OT.G = R.createState();
    OT.pair = [ai, bi];
    const pa = OT.players[ai], pb = OT.players[bi];
    OT.players.forEach(p => {
      if (p.id === HOST_ID) return;
      const role = p.id === pa.id ? 'a' : p.id === pb.id ? 'b' : 'spec';
      window.Net.sendTo(p.id, { t: 'start', a: pa.name, b: pb.name, role, matchNo: OT.current + 1, total: OT.schedule.length });
    });
    const hostRole = pa.id === HOST_ID ? 'a' : pb.id === HOST_ID ? 'b' : 'spec';
    setupOtourMatch(hostRole, pa.name, pb.name, true);
    M.state = OT.G;
    window.Net.broadcast({ t: 'state', s: serState(OT.G) });
    render();
  }

  function hostApplyAction(action, fromId) {
    if (!OT || !OT.host || !OT.G || OT.G.winner !== null) return;
    const s = OT.G, [ai, bi] = OT.pair;
    const expect = s.turn === 0 ? OT.players[ai].id : OT.players[bi].id;
    if (fromId !== expect) return;
    if (action.type === 'wall') { if (!R.canPlaceWall(s, s.turn, action.orient, action.r, action.c)) return; R.applyWall(s, action.orient, action.r, action.c); }
    else { if (!R.legalMoves(s, s.turn).some(m => m.r === action.to.r && m.c === action.to.c)) return; R.applyMove(s, action.to); }
    window.Net.broadcast({ t: 'state', s: serState(s) });
    if (M && M.mode === 'otour' && M.otour.host) render();
    if (s.winner !== null) hostEndMatch(s.winner);
  }
  function hostForfeit(fromId) {
    if (!OT || !OT.host || !OT.G || OT.G.winner !== null) return;
    const [ai, bi] = OT.pair;
    const slot = fromId === OT.players[ai].id ? 0 : fromId === OT.players[bi].id ? 1 : -1;
    if (slot < 0) return;
    hostEndMatch(1 - slot);
  }
  function hostEndMatch(winSlot) {
    const [ai, bi] = OT.pair;
    awardMatch(ai, bi, winSlot);
    OT.current++;
    OT.G = null;
    const winner = OT.players[winSlot === 0 ? ai : bi].name;
    const done = OT.current >= OT.schedule.length;
    const rows = sortRows(OT.players);
    window.Net.broadcast({ t: 'result', winner, rows, done });
    showWin(`${winner} wins`, done ? 'Final match done.' : 'On to the next match.');
  }
  function hostFinish() {
    const rows = sortRows(OT.players);
    window.Net.broadcast({ t: 'result', winner: rows[0].name, rows, done: true, crown: true });
    showHostStandings();
  }
  function showHostStandings() {
    const done = OT.current >= OT.schedule.length;
    const headline = done ? `${sortRows(OT.players)[0].name} takes the crown`
      : `Match ${OT.current + 1} of ${OT.schedule.length} — ${OT.players[OT.schedule[OT.current][0]].name} vs ${OT.players[OT.schedule[OT.current][1]].name}`;
    fillLeaderboard(sortRows(OT.players), headline, done ? 'Back to menu' : 'Play next match', done);
    showScreen('tournament-standings');
  }
  function hostPlayNext() {
    if (OT.current >= OT.schedule.length) return leaveOtour();
    hostNextMatch();
  }

  // ---------- online tournament: client ----------
  function onClientEvent(ev) {
    if (ev.type === 'open') { window.Net.sendHost({ t: 'hello', name: myName() }); showLobby(); }
    else if (ev.type === 'data') clientOnData(ev.msg);
    else if (ev.type === 'close') { toast('Disconnected from host'); leaveOtour(); }
    else if (ev.type === 'error') { $('#ote-status').textContent = 'Could not connect. Check the code.'; OT = null; $('#ote-create').disabled = false; $('#ote-join').disabled = false; }
  }
  function clientOnData(msg) {
    if (!OT || OT.host) return;
    if (msg.t === 'lobby') { OT.names = msg.names; if ($('#otour-lobby').classList.contains('is-active')) renderLobby(); }
    else if (msg.t === 'too-late') { toast('Tournament already started'); leaveOtour(); }
    else if (msg.t === 'start') {
      setupOtourMatch(msg.role, msg.a, msg.b, false);
      render();
    } else if (msg.t === 'state') {
      if (M && M.mode === 'otour') { M.state = deState(msg.s); render(); }
    } else if (msg.t === 'result') {
      OT.lastRows = msg.rows; OT.done = msg.done;
      showWin(msg.done ? `${msg.winner} takes the crown` : `${msg.winner} wins`, msg.done ? 'Tournament over.' : 'Updating standings…');
    }
  }
  function showClientStandings() {
    const rows = (OT && OT.lastRows) || [];
    const headline = OT && OT.done ? `${rows[0] ? rows[0].name : ''} takes the crown` : 'Waiting for the host…';
    fillLeaderboard(rows, headline, OT && OT.done ? 'Back to menu' : '', OT && OT.done);
    showScreen('tournament-standings');
  }

  function setupOtourMatch(role, aName, bName, host) {
    M = {
      state: R.createState(),
      mode: 'otour',
      orient: 'h',
      net: null,
      otour: { host: !!host, role },
      seat: role === 'b' ? 1 : 0,
      playing: role === 'a' || role === 'b',
      names: [aName, bName],
    };
    setControls();
    drag = null;
    closeOverlay('overlay'); closeOverlay('draw-prompt');
    showScreen('game');
  }

  // ---------- rendering ----------
  function gridPos(el, row, col, rowSpan = 1, colSpan = 1) {
    el.style.gridRow = `${row} / span ${rowSpan}`;
    el.style.gridColumn = `${col} / span ${colSpan}`;
  }

  function render() {
    const s = M.state;
    const me = meIndex();
    boardEl.innerHTML = '';
    boardEl.classList.remove('placing');
    boardEl.classList.toggle('flip', me === 1);
    const cells = Array.from({ length: SIZE }, () => []);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        // row 0 is player 0's goal, row SIZE-1 is player 1's goal; colour by perspective
        if (r === 0) cell.classList.add('goal-top', me === 0 ? 'mine' : 'opp');
        if (r === SIZE - 1) cell.classList.add('goal-bottom', me === 1 ? 'mine' : 'opp');
        gridPos(cell, 2 * r + 1, 2 * c + 1);
        cells[r][c] = cell;
        boardEl.appendChild(cell);
      }
    }

    s.hWalls.forEach(k => addWall(k, 'h'));
    s.vWalls.forEach(k => addWall(k, 'v'));

    s.pawns.forEach((p, i) => {
      const pawn = document.createElement('div');
      pawn.className = 'pawn ' + (i === me ? 'mine' : 'opp');
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
          submitAction({ type: 'move', to: { r: m.r, c: m.c } });
        });
      }
    }

    renderRails();
    updateStatus();
  }

  function addWall(k, orient) {
    const [r, c] = k.split(',').map(Number);
    const w = document.createElement('div');
    w.className = 'wall';
    if (orient === 'h') gridPos(w, 2 * r + 2, 2 * c + 1, 1, 3);
    else gridPos(w, 2 * r + 1, 2 * c + 2, 3, 1);
    boardEl.appendChild(w);
  }

  function renderRails() {
    const s = M.state, near = meIndex(), far = 1 - near;
    $('#near-name').textContent = nameOf(near);
    $('#far-name').textContent = nameOf(far);
    $('#near-count').textContent = s.walls[near];
    $('#far-count').textContent = s.walls[far];
    renderWalls($('#inventory'), near, true);
    renderWalls($('#opp-inventory'), far, false);
    $('#orient-label').textContent = M.orient === 'h' ? 'Horizontal' : 'Vertical';
    $('#rail-top').classList.toggle('active', far === s.turn);
    $('#tray').classList.toggle('active', near === s.turn);
    const canPlace = interactive() && s.walls[near] > 0;
    $('#tray').classList.toggle('disabled', !canPlace);
    $('#tray-hint').style.visibility = canPlace ? 'visible' : 'hidden';
  }

  function renderWalls(container, owner, draggable) {
    const s = M.state;
    container.innerHTML = '';
    const color = owner === meIndex() ? 'mine' : 'opp';
    for (let i = 0; i < s.walls[owner]; i++) {
      const tok = document.createElement('div');
      tok.className = 'wtoken ' + color + (draggable && M.orient === 'v' ? ' vert' : '');
      if (draggable && interactive()) tok.addEventListener('pointerdown', startDrag);
      container.appendChild(tok);
    }
  }

  function updateStatus() {
    const s = M.state;
    if (drag?.locked || s.winner !== null) return;
    if (M.mode === 'otour') statusEl.textContent = !M.playing ? `Spectating · ${nameOf(s.turn)} to move`
      : (M.seat === s.turn ? 'Your turn' : "Opponent's turn");
    else if (M.net) statusEl.textContent = M.net.myPlayer === s.turn ? 'Your turn' : "Opponent's turn";
    else if (hotseat()) statusEl.textContent = `${nameOf(s.turn)} to move`;
    else statusEl.textContent = s.turn === 0 ? 'Your turn' : 'Bot thinking…';
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
    if (moved && target) submitAction({ type: 'wall', orient: M.orient, r: target.r, c: target.c });
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
    if (msg.type === 'forfeit') {
      if (s.winner === null) { s.winner = M.net.myPlayer; showWin('You win', 'Opponent forfeited.'); }
      return;
    }
    if (msg.type === 'draw-offer') { if (s.winner === null) openDrawPrompt('net'); return; }
    if (msg.type === 'draw-accept') { if (s.winner === null) { s.winner = 'draw'; endMatch(); } return; }
    if (msg.type === 'draw-decline') { toast('Draw declined'); return; }
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
    if (M.state.winner === 'draw') text = 'We drew a game of Detour.';
    else if (M.net) text = M.state.winner === M.net.myPlayer ? 'I won a game of Detour.' : 'I lost a game of Detour.';
    else if (M.mode === 'local') text = `Player ${M.state.winner + 1} won a game of Detour.`;
    else text = M.state.winner === 0 ? `I beat the ${M.difficulty} bot at Detour.` : `The ${M.difficulty} bot beat me at Detour.`;
    try { if (navigator.share) { await navigator.share({ title: 'Detour', text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); toast('Result copied'); return; } catch { /* fall through */ }
    fallbackCopy(text, () => toast('Result copied'));
  }

  // ---------- wiring ----------
  function openDifficulty() { renderRecords(); openOverlay('difficulty'); }

  const toMenu = () => { showScreen('menu'); renderRecords(); };
  const onPlayNext = () => { if (OT) return OT.host ? hostPlayNext() : leaveOtour(); playNext(); };
  const onStandingsBack = () => { if (OT) return leaveOtour(); toMenu(); };

  $$('.game-card[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    const m = b.dataset.mode;
    if (m === 'bot') openDifficulty();
    else if (m === 'friend') openOnline();
    else if (m === 'tournament') openTournamentSetup();
    else if (m === 'otour') openOtourEntry();
    else startMatch(m);
  }));
  $$('.diff-btn').forEach(b => b.addEventListener('click', () => startMatch('bot', b.dataset.diff)));
  $('#diff-close').addEventListener('click', () => closeOverlay('difficulty'));
  $('#how-btn').addEventListener('click', () => openOverlay('how'));
  $('#how-close').addEventListener('click', () => closeOverlay('how'));

  $('#back-btn').addEventListener('click', leaveMatch);
  $('#menu-btn').addEventListener('click', leaveMatch);
  $('#restart-btn').addEventListener('click', requestRematch);
  $('#rematch-btn').addEventListener('click', requestRematch);
  $('#forfeit-btn').addEventListener('click', forfeit);
  $('#draw-btn').addEventListener('click', offerDraw);
  $('#continue-btn').addEventListener('click', onContinue);
  $('#draw-accept').addEventListener('click', drawAccept);
  $('#draw-decline').addEventListener('click', drawDecline);
  $('#share-btn').addEventListener('click', share);
  $('#rotate-btn').addEventListener('click', () => setOrient(M.orient === 'h' ? 'v' : 'h'));

  $('#online-back').addEventListener('click', () => { window.Net.close(); showScreen('menu'); });
  $('#create-room').addEventListener('click', createRoom);
  $('#join-room').addEventListener('click', joinRoom);
  $('#copy-code').addEventListener('click', copyCode);
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

  $('#tp-add').addEventListener('click', addPlayer);
  $('#tp-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
  $('#tp-start').addEventListener('click', startTournament);
  $('#tp-back').addEventListener('click', toMenu);
  $('#ts-back').addEventListener('click', onStandingsBack);
  $('#play-next').addEventListener('click', onPlayNext);

  $('#ote-back').addEventListener('click', leaveOtour);
  $('#ote-create').addEventListener('click', otourCreate);
  $('#ote-join').addEventListener('click', otourJoin);
  $('#ote-code').addEventListener('keydown', e => { if (e.key === 'Enter') otourJoin(); });
  $('#otl-back').addEventListener('click', leaveOtour);
  $('#otl-start').addEventListener('click', hostStartTournament);

  const nameInput = $('#player-name');
  nameInput.value = loadName();
  nameInput.addEventListener('input', () => { const v = nameInput.value.trim(); if (v) saveName(v); });

  renderRecords();
})();
