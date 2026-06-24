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
  let drawCtx = null;      // 'net' | 'local' | 'otour' — who the draw prompt is for
  let tourneyPlayers = []; // names being added on the local setup screen
  let netPeerName = null;  // opponent's display name in a friend game
  let netRematch = { me: false, opp: false }; // mutual-consent rematch flags (friend games)

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
  const randomTurn = () => (Math.random() < 0.5 ? 0 : 1);   // who moves first — no fixed advantage

  function setControls() {
    const net = !!M.net;                       // friend 1v1
    const otour = M.mode === 'otour';          // online tournament
    const freeplay = M.mode === 'local';       // local hotseat 1v1
    const tournament = M.mode === 'tournament'; // local tournament
    // Resign + draw live in every competitive mode except bot games and freeplay.
    const compete = net || tournament || (otour && M.playing);
    $('#restart-btn').hidden = !freeplay;      // restart: freeplay only
    $('#forfeit-btn').hidden = !compete;       // resign: friend + tournaments
    $('#draw-btn').hidden = !compete;          // draw:   friend + tournaments
  }

  function startMatch(mode, difficulty) {
    const st = mySettings();
    M = {
      state: R.createState(st.walls),
      mode,
      difficulty: mode === 'bot' ? difficulty : null,
      human: mode === 'local' ? [true, true] : [true, false],
      orient: 'h',
      net: null,
      settings: st,
      clock: setupClock(st),
    };
    M.state.turn = randomTurn();
    setControls();
    drag = null;
    closeOverlay('overlay');
    closeOverlay('difficulty');
    showScreen('game');
    render();
    maybeBot();
    startClock();
  }

  function startNetMatch(role, myPlayer, settings, first) {
    const st = settings || (M && M.settings) || mySettings();
    M = {
      state: R.createState(st.walls),
      mode: 'net',
      difficulty: null,
      human: [false, false],
      orient: 'h',
      net: { role, myPlayer, connected: true },
      settings: st,
      clock: setupClock(st),
    };
    M.state.turn = first === 1 ? 1 : 0;   // starter is decided by the host and shared
    setControls();
    drag = null;
    netRematch = { me: false, opp: false };
    resetRematchButton();
    resetOnlineScreen();         // so a finished game never leaves its room code lying around
    closeOverlay('overlay');
    closeOverlay('rematch-prompt');
    showScreen('game');
    render();
    startClock();
  }

  // clear the friend-room screen back to its create/join state
  function resetOnlineScreen() {
    $('#online-choice').hidden = false;
    $('#room-display').hidden = true;
    $('#online-status').textContent = '';
    $('#join-code').value = '';
    $('#create-room').disabled = false;
    $('#join-room').disabled = false;
  }

  function setOrient(orient) { M.orient = orient; render(); }

  const hotseat = () => M.mode === 'local' || M.mode === 'tournament';

  // Index of the "near" player: shown at the bottom in teal, opponent at the top in amber.
  // Networked games flip per-client so you're at the bottom; local games keep a fixed board.
  const meIndex = () => {
    if (M.mode === 'otour') return (OT && M.view === OT.myGame && OT.mySeat >= 0) ? OT.mySeat : 0;
    if (M.net) return M.net.myPlayer;
    return 0;
  };

  function nameOf(idx) {
    if (M.names) return M.names[idx];
    if (M.net) return idx === M.net.myPlayer ? 'You' : (netPeerName || 'Opponent');
    if (M.mode === 'local') return `Player ${idx + 1}`;
    return idx === 0 ? 'You' : 'Bot · ' + M.difficulty[0].toUpperCase() + M.difficulty.slice(1);
  }

  const interactive = () => {
    if (!M || M.state.winner !== null || drag?.locked) return false;
    if (M.mode === 'otour') return M.playing && OT && OT.mySeat === M.state.turn;
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
    const actor = s.turn;
    if (action.type === 'wall') R.applyWall(s, action.orient, action.r, action.c);
    else R.applyMove(s, action.to);
    clockOnAction(actor, fromRemote, action);
    if (M.net && !fromRemote) { if (M.clock) action.clk = M.clock.rem[actor]; window.Net.send(action); }
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
    stopClock();
    $('#win-title').textContent = title;
    $('#win-sub').textContent = sub;
    statusEl.textContent = title;
    const tourney = M.mode === 'tournament' || M.mode === 'otour';
    $('#continue-btn').hidden = !tourney;
    $('#rematch-btn').hidden = tourney;
    $('#menu-btn').hidden = tourney;
    resetRematchButton();
    openOverlay('overlay');
  }
  function resetRematchButton() {
    const b = $('#rematch-btn');
    b.disabled = false;
    b.textContent = 'Rematch';
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
    if (M.net) return netWantRematch();          // friend games need both players to agree
    if (M.mode === 'tournament') startTournamentMatch();
    else startMatch(M.mode, M.difficulty);
  }

  // ---- friend-game rematch: both must agree (either both press Rematch, or one accepts the other's offer) ----
  function netWantRematch() {
    closeOverlay('rematch-prompt');
    netRematch.me = true;
    window.Net.send({ type: 'rematch' });
    if (netRematch.opp) return reachRematch();    // the other side already wants it → go
    const b = $('#rematch-btn');                  // otherwise wait for them
    b.disabled = true;
    b.textContent = 'Waiting…';
  }
  // Both players agreed. The host picks (and shares) who starts so the new game stays in sync.
  function reachRematch() {
    closeOverlay('rematch-prompt');
    if (M.net.role === 'host') {
      const first = randomTurn();
      window.Net.send({ type: 'rematch-go', first, settings: M.settings });
      startNetMatch('host', 0, M.settings, first);
    }
    // the guest waits for 'rematch-go'
  }
  function openRematchPrompt() {
    $('#rematch-text').textContent = `${netPeerName || 'Your opponent'} wants a rematch.`;
    openOverlay('rematch-prompt');
  }
  function rematchAccept() { netWantRematch(); }
  function rematchDeny() {
    closeOverlay('rematch-prompt');
    netRematch.opp = false;
    window.Net.send({ type: 'rematch-decline' });
  }

  function forfeit() {
    if (!M || M.state.winner !== null) return;
    if (M.mode === 'otour') {
      if (!M.playing) return;
      if (M.otour.host) hostForfeit(HOST_ID);
      else window.Net.sendHost({ t: 'forfeit' });
      return;
    }
    if (M.mode === 'tournament') {        // the player to move concedes the match
      const loser = M.state.turn;
      M.state.winner = 1 - loser;
      return endTournamentMatch(1 - loser);
    }
    if (!M.net) return;
    window.Net.send({ type: 'forfeit' });
    M.state.winner = 1 - M.net.myPlayer;
    showWin('You resigned', 'You bailed on the race.');
  }

  function leaveMatch() {
    if (M && M.mode === 'otour') {            // Back from any board returns to the ranking page
      if (M.view >= 0) { stopClock(); return showOtourStandings(); }
      return leaveOtour();                    // already on the ranking → leave the tournament
    }
    stopClock();
    if (M && M.mode === 'net') { window.Net.close(); netPeerName = null; netRematch = { me: false, opp: false }; }
    closeOverlay('overlay');
    closeOverlay('rematch-prompt');
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
    if (M.mode === 'otour') {                 // online tournament: route through the host
      if (!M.playing) return;
      if (M.otour.host) { hostDrawOffer(HOST_ID); toast('Draw offer sent'); }
      else { window.Net.sendHost({ t: 'draw-offer' }); toast('Draw offer sent'); }
      return;
    }
    if (M.net) { window.Net.send({ type: 'draw-offer' }); toast('Draw offer sent'); }
    else openDrawPrompt('local');             // local tournament (hotseat)
  }
  function endAsDraw() {
    if (M.state.winner !== null) return;
    M.state.winner = 'draw';
    endMatch();
  }
  function openDrawPrompt(ctx) {
    drawCtx = ctx;
    if (ctx === 'net' || ctx === 'otour') {
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
    else if (drawCtx === 'otour') {
      if (M.otour.host) hostDrawAccept(HOST_ID);
      else window.Net.sendHost({ t: 'draw-accept' });
    }
    else endAsDraw();
  }
  function drawDecline() {
    closeOverlay('draw-prompt');
    if (drawCtx === 'net') window.Net.send({ type: 'draw-decline' });
    else if (drawCtx === 'otour') {
      if (M.otour.host) hostDrawDecline(HOST_ID);
      else window.Net.sendHost({ t: 'draw-decline' });
    }
  }

  // ---------- tournament card (shared list rendering) ----------
  // A short, stable discriminator so identical-looking names stay distinct.
  function tagFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return ('00' + h.toString(36)).slice(-3);
  }
  // One leaderboard/roster row: rank · name#tag · score, with an optional remove button.
  function tRow(rank, name, score, winner, onRemove) {
    const row = document.createElement('div');
    row.className = 'trow' + (winner ? ' t-winner' : '');
    const r = document.createElement('span'); r.className = 't-rank'; r.textContent = rank;
    const nm = document.createElement('span'); nm.className = 't-name'; nm.textContent = name;
    const tag = document.createElement('span'); tag.className = 't-tag'; tag.textContent = '#' + tagFor(name);
    nm.appendChild(tag);
    const sc = document.createElement('span'); sc.className = 't-score'; sc.textContent = score;
    row.append(r, nm, sc);
    if (onRemove) {
      const x = document.createElement('button');
      x.className = 't-remove'; x.textContent = '✕';
      x.setAttribute('aria-label', 'Remove ' + name);
      x.addEventListener('click', onRemove);
      row.appendChild(x);
    }
    return row;
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
      list.appendChild(tRow(i + 1, n, 0, false, () => { tourneyPlayers.splice(i, 1); renderSetupList(); }));
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
    T = { players, schedule, current: 0, settings: mySettings() };
    showTournamentStandings();
  }
  function showTournamentStandings() {
    renderStandings();
    showScreen('tournament-standings');
  }
  const sortRows = list => [...list].sort((a, b) => b.pts - a.pts || b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));

  // Shared leaderboard renderer for local + online tournaments.
  function fillLeaderboard(rows, headline, btnText, crown, title, onKick) {
    if (title) $('#ts-head').textContent = title;
    const body = $('#standings-body');
    body.innerHTML = '';
    rows.forEach((p, rank) => {
      const kick = onKick && p.id && p.id !== HOST_ID && !p.left ? () => onKick(p.id) : null;
      body.appendChild(tRow(rank + 1, p.name, p.pts, crown && rank === 0, kick));
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
    fillLeaderboard(sortRows(T.players), headline, done ? 'New tournament' : 'Play match', done, 'Local tournament');
    $('#ts-chat').hidden = true;        // local tournaments are single-device — no chat/spectate
    $('#live-games').hidden = true;
  }
  function playNext() {
    if (T.current >= T.schedule.length) openTournamentSetup();
    else startTournamentMatch();
  }
  function startTournamentMatch() {
    const [a, b] = T.schedule[T.current];
    M = {
      state: R.createState(T.settings.walls),
      mode: 'tournament',
      difficulty: null,
      human: [true, true],
      orient: 'h',
      net: null,
      names: [T.players[a].name, T.players[b].name],
      pair: [a, b],
      settings: T.settings,
      clock: setupClock(T.settings),
    };
    M.state.turn = randomTurn();
    setControls();
    drag = null;
    closeOverlay('overlay');
    showScreen('game');
    render();
    startClock();
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
    return { t: s.turn, p: s.pawns.map(x => [x.r, x.c]), w: s.walls.slice(), h: [...s.hWalls], v: [...s.vWalls], by: s.wallBy, win: s.winner };
  }
  function deState(o) {
    const s = R.createState();
    s.turn = o.t;
    s.pawns = o.p.map(([r, c]) => ({ r, c }));
    s.walls = o.w.slice();
    s.hWalls = new Set(o.h);
    s.vWalls = new Set(o.v);
    s.wallBy = o.by || {};
    s.winner = o.win;
    return s;
  }

  // ---------- game settings (clock / bonus / walls) ----------
  const SET_KEY = 'detour_settings';
  const DEFAULTS = { time: 10, bonus: 5, walls: 10 };
  const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  function loadSettings() {
    let s; try { s = JSON.parse(localStorage.getItem(SET_KEY)); } catch { /* ignore */ }
    return { ...DEFAULTS, ...(s || {}) };
  }
  const saveSettings = s => { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  // current values from the menu inputs, clamped
  const mySettings = () => ({
    time: clampN($('#set-time').value, 0, 120, DEFAULTS.time),
    bonus: clampN($('#set-bonus').value, 0, 60, DEFAULTS.bonus),
    walls: clampN($('#set-walls').value, 0, 20, DEFAULTS.walls),
  });

  // ---------- clock ----------
  let clockTimer = null;
  const setupClock = st => st.time ? { rem: [st.time * 60000, st.time * 60000], bonus: st.bonus * 1000, last: performance.now() } : null;
  function fmtClock(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  function renderClocks() {
    const near = $('#near-clock'), far = $('#far-clock');
    if (!M || !M.clock) { near.hidden = true; far.hidden = true; return; }
    const b = meIndex(), t = 1 - b;
    near.hidden = false; far.hidden = false;
    near.textContent = fmtClock(M.clock.rem[b]);
    far.textContent = fmtClock(M.clock.rem[t]);
    near.classList.toggle('low', M.clock.rem[b] <= 30000);
    far.classList.toggle('low', M.clock.rem[t] <= 30000);
  }
  function startClock() {
    stopClock();
    if (!M || !M.clock) return;
    M.clock.last = performance.now();
    clockTimer = setInterval(clockStep, 200);
  }
  const stopClock = () => { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } };
  // keep the currently-viewed game's clock alive: build M.clock if missing and (re)start the local ticker
  function syncViewClock(gi, rem) {
    if (!M || M.mode !== 'otour' || M.view !== gi || !rem) return;
    if (!M.clock) { M.clock = { rem: rem.slice(), bonus: 0, last: performance.now() }; if (OT && !OT.host) startClock(); }
    else { M.clock.rem = rem.slice(); M.clock.last = performance.now(); }
  }
  function clockStep() {
    if (!M || !M.clock) return stopClock();
    const s = M.state;
    if (s.winner !== null) return;
    const now = performance.now();
    const dt = now - M.clock.last; M.clock.last = now;
    const p = s.turn;
    M.clock.rem[p] = Math.max(0, M.clock.rem[p] - dt);
    renderClocks();
    if (M.clock.rem[p] <= 0 && clockAuthority(p)) onFlag(p);
  }
  function clockAuthority(p) {
    if (M.mode === 'otour') return false;   // host ticks every game via hostClockTick; clients never flag
    if (M.net) return M.net.myPlayer === p;
    return true;
  }
  function onFlag(p) {
    const s = M.state;
    if (s.winner !== null) return;
    if (M.mode === 'otour') return;          // handled by the host's per-game ticker
    if (M.net) { window.Net.send({ type: 'timeout' }); s.winner = 1 - p; showWin('You lost on time', 'Your clock ran out.'); return; }
    s.winner = 1 - p;
    if (M.mode === 'tournament') return endTournamentMatch(1 - p);
    if (M.mode === 'local') return showWin(`${nameOf(1 - p)} wins`, `${nameOf(p)} ran out of time.`);
    recordResult(p === 1);
    showWin(p === 0 ? 'You lose on time' : 'You win on time', p === 0 ? 'Your clock ran out.' : 'The bot ran out of time.');
  }
  // add the increment to whoever just moved, then hand the clock over
  function clockOnAction(actor, fromRemote, action) {
    if (!M.clock) return;
    if (!fromRemote) M.clock.rem[actor] += M.clock.bonus;
    else if (action && action.clk != null) M.clock.rem[actor] = action.clk;
    M.clock.last = performance.now();
  }

  // host-authoritative clock for ALL concurrent games in the round
  let hostClockTimer = null;
  function hostStartClock() {
    hostStopClock();
    if (!OT || !OT.settings || !OT.settings.time) return;   // untimed tournament
    hostClockTimer = setInterval(hostClockTick, 200);
  }
  function hostStopClock() { if (hostClockTimer) { clearInterval(hostClockTimer); hostClockTimer = null; } }
  function hostClockTick() {
    if (!OT || !OT.host || !OT.live) return hostStopClock();
    const now = performance.now();
    for (const g of OT.live.values()) {
      if (g.done || !g.clock || g.state.winner !== null) continue;
      const dt = now - g.clock.last; g.clock.last = now;
      const p = g.state.turn;
      g.clock.rem[p] = Math.max(0, g.clock.rem[p] - dt);
      if (g.clock.rem[p] <= 0) hostEndGame(g.gi, 1 - p);   // flagged on time
    }
    if (M && M.mode === 'otour' && M.view >= 0) renderClocks();
    // push authoritative clocks ~1/s so spectators & idle players stay in sync between moves
    if (now - (OT.lastClockBcast || 0) >= 1000) {
      OT.lastClockBcast = now;
      const c = [];
      for (const g of OT.live.values()) if (g.clock && !g.done) c.push([g.gi, Math.round(g.clock.rem[0]), Math.round(g.clock.rem[1])]);
      if (c.length) window.Net.broadcast({ t: 'clocks', c });
    }
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
    OT = { host: true, roster: [{ id: HOST_ID, name: myName() }], started: false, chat: [] };
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
    OT = { host: false, names: [], code, chat: [] };
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
    $('#otl-code').textContent = (OT && OT.code) || '----';
    $('#otl-start').hidden = !host;

    const list = $('#otl-roster');
    list.innerHTML = '';
    if (host) {
      OT.roster.forEach((p, i) => {
        const onKick = p.id === HOST_ID ? null : () => hostKick(p.id);   // host can drop a joiner
        list.appendChild(tRow(i + 1, p.name, 0, false, onKick));
      });
      const n = OT.roster.length;
      $('#otl-start').disabled = n < 2;
      $('#otl-status').textContent = n < 2 ? 'Waiting for players to join…' : `${n} players ready`;
    } else {
      (OT.names || []).forEach((n, i) => list.appendChild(tRow(i + 1, n, 0, false, null)));
      $('#otl-status').textContent = 'Waiting for the host to start…';
    }
    $('#otl-chat').hidden = false;
    renderChat();
  }
  function leaveOtour() {
    stopClock();
    hostStopClock();
    window.Net.close();
    OT = null; M = null;
    closeOverlay('overlay'); closeOverlay('draw-prompt');
    showScreen('menu');
  }

  // ---------- tournament chat (host relays everyone's messages) ----------
  function addChat(name, text) {
    if (!OT) return;
    if (!OT.chat) OT.chat = [];
    OT.chat.push({ name, text });
    if (OT.chat.length > 60) OT.chat.shift();
    renderChat();
  }
  function renderChat() {
    const logs = $$('[data-chat-log]');
    if (!logs.length) return;
    const me = myName();
    logs.forEach(log => {
      log.innerHTML = '';
      ((OT && OT.chat) || []).forEach(m => {
        const row = document.createElement('div');
        row.className = 'chat-msg' + (m.name === me ? ' you' : '');
        const nm = document.createElement('span'); nm.className = 'chat-name'; nm.textContent = m.name === me ? 'You' : m.name;
        const tx = document.createElement('span'); tx.className = 'chat-text'; tx.textContent = m.text;
        row.append(nm, tx);
        log.appendChild(row);
      });
      log.scrollTop = log.scrollHeight;
    });
  }
  function sendChat(text) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean || !OT) return;
    if (OT.host) { addChat(myName(), clean); window.Net.broadcast({ t: 'chat', name: myName(), text: clean }); }
    else window.Net.sendHost({ t: 'chat', text: clean });
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
    else if (msg.t === 'draw-offer') hostDrawOffer(id);
    else if (msg.t === 'draw-accept') hostDrawAccept(id);
    else if (msg.t === 'draw-decline') hostDrawDecline(id);
    else if (msg.t === 'chat') hostChat(id, msg.text);
  }
  function hostChat(id, text) {
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean) return;
    const name = nameById(id);
    addChat(name, clean);
    window.Net.broadcast({ t: 'chat', name, text: clean });   // echo to everyone (incl. sender)
  }
  function broadcastLobby() { window.Net.broadcast({ t: 'lobby', names: OT.roster.map(p => p.name) }); }
  function nameById(id) {
    if (id === HOST_ID) return myName();
    const src = (OT && (OT.started ? OT.players : OT.roster)) || [];
    const p = src.find(x => x.id === id);
    return (p && p.name) || 'Player';
  }
  // Host drops a player: tell them, run the same removal/forfeit path as a disconnect, then close.
  function hostKick(id) {
    if (!OT || !OT.host || id === HOST_ID) return;
    window.Net.sendTo(id, { t: 'kicked' });
    hostOnDisconnect(id);          // lobby: drops from roster + re-renders; in-play: forfeits
    window.Net.kick(id);
    // refresh the standings if we're on it (and not mid result-overlay from a just-ended match)
    if ($('#tournament-standings').classList.contains('is-active') && !$('#overlay').classList.contains('is-active')) showHostStandings();
  }

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
    const gi = OT.gameOf && OT.gameOf.get(id);
    const g = (gi != null) ? OT.live.get(gi) : null;
    if (g && !g.done) {
      const slot = OT.players[g.a].id === id ? 0 : 1;
      hostEndGame(g.gi, 1 - slot);   // their opponent takes the game
    }
    hostSchedule();   // auto-award the departed player's remaining matches; launch anything newly free
  }

  // round-robin organised into rounds (circle method) so a whole round runs concurrently
  function buildRounds(n) {
    const arr = [...Array(n).keys()];
    if (n % 2) arr.push(-1);              // odd player count → a bye seat
    const m = arr.length, rounds = [];
    for (let r = 0; r < m - 1; r++) {
      const round = [];
      for (let i = 0; i < m / 2; i++) {
        const a = arr[i], b = arr[m - 1 - i];
        if (a !== -1 && b !== -1) round.push([a, b]);
      }
      if (round.length) rounds.push(round);
      arr.splice(1, 0, arr.pop());        // rotate, keeping arr[0] fixed
    }
    for (let i = rounds.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [rounds[i], rounds[k]] = [rounds[k], rounds[i]]; }
    return rounds;
  }

  const COOLDOWN = 5000;   // ms a player rests between matches

  function hostStartTournament() {
    if (!OT || !OT.host || OT.roster.length < 2) return;
    OT.settings = mySettings();
    OT.players = OT.roster.map(p => ({ id: p.id, name: p.name, w: 0, d: 0, l: 0, pts: 0, left: false }));
    // every pairing, ordered by rounds so the opening launches a balanced spread, kept as a flat queue
    OT.schedule = buildRounds(OT.players.length).flat().map(([a, b]) => ({ a, b, played: false }));
    OT.live = new Map();        // gi -> live game
    OT.gameOf = new Map();      // playerId -> gi (live only)
    OT.busy = new Set();        // player idx currently in a game
    OT.coolUntil = new Map();   // player idx -> ms when free again
    OT.nextGi = 0;
    OT.myGame = -1; OT.mySeat = -1; OT.viewCoolUntil = 0;
    OT.started = true; OT.done = false;
    ensureOtourM();
    window.Net.broadcast({ t: 'begin', rows: sortRows(OT.players) });
    hostStartClock();
    showOtourStandings();
    hostSchedule();   // launch the opening matches; from here it self-schedules
  }
  function awardMatch(ai, bi, winSlot) {
    const win = OT.players[winSlot === 0 ? ai : bi], lose = OT.players[winSlot === 0 ? bi : ai];
    win.w++; win.pts += 3; lose.l++;
  }
  const playerFree = (p, now) => !OT.players[p].left && !OT.busy.has(p) && now >= (OT.coolUntil.get(p) || 0);

  // launch every pending match whose two players are free right now (greedy, continuous)
  function hostSchedule() {
    if (!OT || !OT.host || OT.done) return;
    const now = performance.now();
    let changed = false;
    for (const m of OT.schedule) {
      if (m.played) continue;
      if (OT.players[m.a].left || OT.players[m.b].left) {     // someone gone → auto-award (or void)
        if (!(OT.players[m.a].left && OT.players[m.b].left)) awardMatch(m.a, m.b, OT.players[m.a].left ? 1 : 0);
        m.played = true; changed = true; continue;
      }
      if (playerFree(m.a, now) && playerFree(m.b, now)) { launchGame(m); changed = true; }
    }
    if (OT.schedule.every(m => m.played) && OT.live.size === 0) return hostFinish();
    if (changed && $('#tournament-standings').classList.contains('is-active') && (!M || M.view < 0)) showHostStandings();
  }
  function launchGame(m) {
    m.played = true;
    const gi = OT.nextGi++;
    const st = R.createState(OT.settings.walls); st.turn = randomTurn();
    const g = {
      gi, a: m.a, b: m.b, aName: OT.players[m.a].name, bName: OT.players[m.b].name,
      state: st, clock: setupClock(OT.settings), drawOffer: null, done: false,
    };
    OT.live.set(gi, g);
    OT.busy.add(m.a); OT.busy.add(m.b);
    OT.gameOf.set(OT.players[m.a].id, gi); OT.gameOf.set(OT.players[m.b].id, gi);
    const snap = serState(st);
    const clk = g.clock ? g.clock.rem : null;
    window.Net.broadcast({ t: 'gamestart', gi, a: g.aName, b: g.bName });
    window.Net.broadcast({ t: 'state', gi, s: snap, clk });
    [[m.a, 0], [m.b, 1]].forEach(([pi, seat]) => {
      const id = OT.players[pi].id;
      if (id === HOST_ID) { OT.myGame = gi; OT.mySeat = seat; OT.viewCoolUntil = 0; viewGame(gi); }
      else window.Net.sendTo(id, { t: 'youplay', gi, seat, a: g.aName, b: g.bName, s: snap, clk });
    });
  }
  // re-show the ranking once the local player's cooldown elapses (spectate buttons reappear)
  function scheduleCoolRefresh() {
    if (OT.coolTimer) clearTimeout(OT.coolTimer);
    OT.coolTimer = setTimeout(() => {
      OT.coolTimer = null;
      if ($('#tournament-standings').classList.contains('is-active')) showOtourStandings();
    }, COOLDOWN + 60);
  }

  function gameName(g, slot) { return slot === 0 ? g.aName : g.bName; }

  function ensureOtourM() {
    if (!M || M.mode !== 'otour') {
      M = { mode: 'otour', orient: 'h', net: null, otour: { host: !!(OT && OT.host) }, view: -1, playing: false, spectating: false, state: null, clock: null, names: ['', ''] };
      setControls();
    }
  }

  // open a game's board: own game is playable, others are read-only
  function viewGame(gi) {
    const g = OT && OT.live && OT.live.get(gi);
    if (!g) return;
    ensureOtourM();
    M.view = gi;
    M.names = [gameName(g, 0), gameName(g, 1)];
    M.state = g.state || R.createState();
    M.clock = g.clock ? (OT.host ? g.clock : { rem: g.clock.rem.slice(), bonus: 0, last: performance.now() }) : null;
    M.playing = gi === OT.myGame && !g.done;
    M.spectating = gi !== OT.myGame;
    setControls();
    drag = null;
    closeOverlay('overlay'); closeOverlay('draw-prompt');
    showScreen('game');
    render();
    if (!OT.host) startClock();   // clients tick the viewed clock locally; the host uses hostClockTick
  }

  function gameOfId(fromId) { const gi = OT && OT.gameOf && OT.gameOf.get(fromId); return (gi != null) ? OT.live.get(gi) : null; }

  function hostApplyAction(action, fromId) {
    const g = gameOfId(fromId);
    if (!g || g.done || g.state.winner !== null) return;
    const s = g.state;
    const expect = s.turn === 0 ? OT.players[g.a].id : OT.players[g.b].id;
    if (fromId !== expect) return;
    const actor = s.turn;
    if (action.type === 'wall') { if (!R.canPlaceWall(s, s.turn, action.orient, action.r, action.c)) return; R.applyWall(s, action.orient, action.r, action.c); }
    else { if (!R.legalMoves(s, s.turn).some(m => m.r === action.to.r && m.c === action.to.c)) return; R.applyMove(s, action.to); }
    if (g.clock) { g.clock.rem[actor] += g.clock.bonus; g.clock.last = performance.now(); }
    window.Net.broadcast({ t: 'state', gi: g.gi, s: serState(s), clk: g.clock ? g.clock.rem : null });
    if (M && M.mode === 'otour' && M.view === g.gi) { M.state = s; render(); }
    if (s.winner !== null) hostEndGame(g.gi, s.winner);
  }
  function hostForfeit(fromId) {
    const g = gameOfId(fromId);
    if (!g || g.done) return;
    const slot = OT.players[g.a].id === fromId ? 0 : 1;
    hostEndGame(g.gi, 1 - slot);
  }
  // ---- online-tournament draws: offer → opponent agrees → host ends that game ----
  function hostDrawOffer(fromId) {
    const g = gameOfId(fromId);
    if (!g || g.done) return;
    const slot = OT.players[g.a].id === fromId ? 0 : 1;
    g.drawOffer = slot;
    const otherId = OT.players[slot === 0 ? g.b : g.a].id;
    if (otherId === HOST_ID) openDrawPrompt('otour');     // host is the opponent — prompt locally
    else window.Net.sendTo(otherId, { t: 'draw-offer' });
  }
  function hostDrawAccept(fromId) {
    const g = gameOfId(fromId);
    if (!g || g.done || g.drawOffer == null) return;
    const slot = OT.players[g.a].id === fromId ? 0 : 1;
    if (slot === g.drawOffer) return;                     // only the offerer's opponent accepts
    g.drawOffer = null;
    hostEndGame(g.gi, null, true);
  }
  function hostDrawDecline(fromId) {
    const g = gameOfId(fromId);
    if (!g || g.drawOffer == null) return;
    const offererId = OT.players[g.drawOffer === 0 ? g.a : g.b].id;
    g.drawOffer = null;
    if (offererId === HOST_ID) toast('Draw declined');
    else window.Net.sendTo(offererId, { t: 'draw-declined' });
  }
  // end one game: award points, free both players (after a cooldown), then schedule their next match
  function hostEndGame(gi, winSlot, draw) {
    const g = OT.live.get(gi);
    if (!g || g.done) return;
    g.done = true;
    g.state.winner = draw ? 'draw' : winSlot;
    const a = g.a, b = g.b;
    if (draw) { OT.players[a].d++; OT.players[b].d++; OT.players[a].pts++; OT.players[b].pts++; }
    else { awardMatch(a, b, winSlot); g.winnerName = OT.players[winSlot === 0 ? a : b].name; }
    const now = performance.now();
    OT.live.delete(gi);
    OT.busy.delete(a); OT.busy.delete(b);
    OT.gameOf.delete(OT.players[a].id); OT.gameOf.delete(OT.players[b].id);
    OT.coolUntil.set(a, now + COOLDOWN); OT.coolUntil.set(b, now + COOLDOWN);
    const rows = sortRows(OT.players);
    window.Net.broadcast({ t: 'state', gi, s: serState(g.state), clk: g.clock ? g.clock.rem : null });
    window.Net.broadcast({ t: 'gameresult', gi, winner: draw ? null : g.winnerName, draw: !!draw, rows });
    if (M && M.mode === 'otour' && M.view === gi) {     // host was at this board → drop to ranking
      if (gi === OT.myGame) { OT.myGame = -1; OT.viewCoolUntil = now + COOLDOWN; scheduleCoolRefresh(); }
      toast(draw ? 'Draw' : `${g.winnerName} wins`);
      showOtourStandings();
    } else if ($('#tournament-standings').classList.contains('is-active')) showHostStandings();
    if (OT.schedule.every(m => m.played) && OT.live.size === 0) return hostFinish();
    setTimeout(() => hostSchedule(), COOLDOWN);          // launch the freed players' next match
  }
  function hostFinish() {
    OT.done = true;
    hostStopClock();
    window.Net.broadcast({ t: 'done', rows: sortRows(OT.players) });
    showHostStandings();
  }
  function showHostStandings() {
    stopClock();
    if (M) { M.view = -1; M.playing = false; M.spectating = false; }
    const liveN = OT.live ? OT.live.size : 0;
    const pending = OT.schedule ? OT.schedule.filter(m => !m.played).length : 0;
    const headline = OT.done ? `${sortRows(OT.players)[0].name} takes the crown`
      : liveN ? `${liveN} game${liveN > 1 ? 's' : ''} live${pending ? ` · ${pending} to come` : ''}`
        : (pending ? 'Setting up…' : 'Wrapping up…');
    // matches launch on their own; the host only leaves at the end
    fillLeaderboard(sortRows(OT.players), headline, OT.done ? 'Back to menu' : '', OT.done, 'Online tournament', hostKick);
    renderLiveGames();
    showOtourChat();
    showScreen('tournament-standings');
  }
  function hostPlayNext() { leaveOtour(); }   // the "Back to menu" button, shown only when done

  // ---------- online tournament: client ----------
  function onClientEvent(ev) {
    if (ev.type === 'open') { window.Net.sendHost({ t: 'hello', name: myName() }); showLobby(); }
    else if (ev.type === 'data') clientOnData(ev.msg);
    else if (ev.type === 'close') { toast('Disconnected from host'); leaveOtour(); }
    else if (ev.type === 'error') {
      const t = ev.err && ev.err.type;
      $('#ote-status').textContent = t === 'peer-unavailable' ? 'No tournament with that code.'
        : t === 'timeout' ? "Couldn't connect — your network is likely blocking it. Try another network or a hotspot."
          : 'Could not connect. Check the code.';
      OT = null; $('#ote-create').disabled = false; $('#ote-join').disabled = false;
    }
  }
  function clientOnData(msg) {
    if (!OT || OT.host) return;
    if (msg.t === 'lobby') { OT.names = msg.names; if ($('#otour-lobby').classList.contains('is-active')) renderLobby(); }
    else if (msg.t === 'too-late') { toast('Tournament already started'); leaveOtour(); }
    else if (msg.t === 'kicked') { toast('Removed by the host'); leaveOtour(); }
    else if (msg.t === 'chat') { addChat(msg.name, msg.text); }
    else if (msg.t === 'begin') {
      OT.started = true; OT.done = false;
      OT.live = new Map(); OT.lastRows = msg.rows || [];
      OT.myGame = -1; OT.mySeat = -1; OT.viewCoolUntil = 0;
      ensureOtourM();
      showClientStandings();
    }
    else if (msg.t === 'gamestart') {
      OT.started = true;
      if (!OT.live) OT.live = new Map();
      ensureOtourM();
      if (!OT.live.get(msg.gi)) OT.live.set(msg.gi, { gi: msg.gi, aName: msg.a, bName: msg.b, state: null, clock: null, done: false });
      if ($('#tournament-standings').classList.contains('is-active')) showClientStandings();
    }
    else if (msg.t === 'youplay') {       // self-contained, so a dropped gamestart/state can't strand you
      OT.started = true;
      if (!OT.live) OT.live = new Map();
      ensureOtourM();
      OT.myGame = msg.gi; OT.mySeat = msg.seat; OT.viewCoolUntil = 0;
      let g = OT.live.get(msg.gi);
      if (!g) { g = { gi: msg.gi, aName: msg.a, bName: msg.b, state: null, clock: null, done: false }; OT.live.set(msg.gi, g); }
      if (msg.s) g.state = deState(msg.s);
      if (msg.clk) g.clock = { rem: msg.clk.slice() };
      viewGame(msg.gi);
    }
    else if (msg.t === 'state') {
      const g = OT.live && OT.live.get(msg.gi); if (!g) return;
      g.state = deState(msg.s);
      if (msg.clk) g.clock = { rem: msg.clk.slice() };
      if (M && M.mode === 'otour' && M.view === msg.gi) {
        M.state = g.state;
        syncViewClock(msg.gi, msg.clk);
        render();
      }
    }
    else if (msg.t === 'clocks') {
      if (!OT.live) return;
      for (const [gi, r0, r1] of msg.c) {
        const g = OT.live.get(gi);
        if (g && !g.done) g.clock = { rem: [r0, r1] };
        syncViewClock(gi, [r0, r1]);
      }
      if (M && M.mode === 'otour' && M.view >= 0) renderClocks();
    }
    else if (msg.t === 'gameresult') {
      OT.lastRows = msg.rows || OT.lastRows;
      const viewing = M && M.mode === 'otour' && M.view === msg.gi;
      const mine = msg.gi === OT.myGame;
      if (OT.live) OT.live.delete(msg.gi);
      if (mine) { OT.myGame = -1; OT.viewCoolUntil = performance.now() + COOLDOWN; scheduleCoolRefresh(); }
      if (viewing) { toast(msg.draw ? 'Draw' : `${msg.winner} wins`); showClientStandings(); }
      else if ($('#tournament-standings').classList.contains('is-active')) showClientStandings();
    }
    else if (msg.t === 'done') {
      OT.lastRows = msg.rows || OT.lastRows; OT.done = true; OT.live = new Map();
      showClientStandings();
    }
    else if (msg.t === 'draw-offer') { if (M && M.mode === 'otour' && OT.myGame >= 0) openDrawPrompt('otour'); }
    else if (msg.t === 'draw-declined') { toast('Draw declined'); }
  }
  function showClientStandings() {
    stopClock();
    if (M) { M.view = -1; M.playing = false; M.spectating = false; }
    const rows = (OT && OT.lastRows) || [];
    const liveN = (OT && OT.live) ? OT.live.size : 0;
    const headline = OT && OT.done ? `${rows[0] ? rows[0].name : ''} takes the crown`
      : (OT && OT.started) ? (liveN ? `${liveN} game${liveN > 1 ? 's' : ''} live` : 'Waiting for your next match…')
        : 'Waiting for the host…';
    fillLeaderboard(rows, headline, OT && OT.done ? 'Back to menu' : '', OT && OT.done, 'Online tournament');
    renderLiveGames();
    showOtourChat();
    showScreen('tournament-standings');
  }

  function showOtourChat() { $('#ts-chat').hidden = false; renderChat(); }
  function showOtourStandings() { if (OT) { closeOverlay('overlay'); closeOverlay('draw-prompt'); OT.host ? showHostStandings() : showClientStandings(); } }
  // games in progress, each watchable — except during your between-match cooldown (buttons hidden)
  function renderLiveGames() {
    const box = $('#live-games');
    if (!box) return;
    box.innerHTML = '';
    const games = (OT && OT.live) ? [...OT.live.values()] : [];
    const cooling = !!(OT && OT.viewCoolUntil && performance.now() < OT.viewCoolUntil);
    const show = OT && OT.started && !OT.done && (games.length || cooling);
    box.hidden = !show;
    if (!show) return;
    if (cooling) {
      const note = document.createElement('div');
      note.className = 'lg-cool';
      note.textContent = 'Take a breath — your next match starts shortly…';
      box.appendChild(note);
    }
    games.forEach(g => {
      const row = document.createElement('div');
      row.className = 'lg-row';
      const dot = document.createElement('span'); dot.className = 'lg-dot';
      const label = document.createElement('span'); label.className = 'lg-label';
      label.textContent = `${gameName(g, 0)} vs ${gameName(g, 1)}`;
      row.append(dot, label);
      if (!cooling) {   // spectate buttons are hidden during the cooldown breather
        const btn = document.createElement('button'); btn.className = 'lg-watch';
        btn.textContent = g.gi === OT.myGame ? 'Resume' : 'Watch';
        btn.addEventListener('click', () => viewGame(g.gi));
        row.appendChild(btn);
      }
      box.appendChild(row);
    });
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
    renderClocks();
    updateStatus();
  }

  function addWall(k, orient) {
    const [r, c] = k.split(',').map(Number);
    const owner = M.state.wallBy[orient + k];
    const w = document.createElement('div');
    w.className = 'wall ' + (owner === meIndex() ? 'mine' : 'opp');
    if (orient === 'h') gridPos(w, 2 * r + 2, 2 * c + 1, 1, 3);
    else gridPos(w, 2 * r + 1, 2 * c + 2, 3, 1);
    boardEl.appendChild(w);
  }

  function renderRails() {
    const s = M.state, bottom = meIndex(), top = 1 - bottom;
    $('#near-name').textContent = nameOf(bottom);
    $('#far-name').textContent = nameOf(top);
    $('#near-count').textContent = s.walls[bottom];
    $('#far-count').textContent = s.walls[top];
    const bottomDrag = interactive() && bottom === s.turn;
    const topDrag = interactive() && top === s.turn;  // local hotseat: the player to move drags from their own rail
    renderWalls($('#inventory'), bottom, bottomDrag);
    renderWalls($('#opp-inventory'), top, topDrag);
    $('#orient-label').textContent = M.orient === 'h' ? 'Horizontal' : 'Vertical';
    $('#rail-top').classList.toggle('active', top === s.turn);
    $('#tray').classList.toggle('active', bottom === s.turn);
    $('#tray-hint').style.visibility = (bottomDrag || topDrag) && s.walls[s.turn] > 0 ? 'visible' : 'hidden';
  }

  function renderWalls(container, owner, draggable) {
    const s = M.state;
    container.innerHTML = '';
    const color = owner === meIndex() ? 'mine' : 'opp';
    for (let i = 0; i < s.walls[owner]; i++) {
      const tok = document.createElement('div');
      tok.className = 'wtoken ' + color + (draggable ? ' grab' : '') + (draggable && M.orient === 'v' ? ' vert' : '');
      if (draggable) tok.addEventListener('pointerdown', startDrag);
      container.appendChild(tok);
    }
  }

  function updateStatus() {
    const s = M.state;
    if (drag?.locked || s.winner !== null) return;
    if (M.mode === 'otour') statusEl.textContent = !M.playing ? `Spectating · ${nameOf(s.turn)} to move`
      : (OT.mySeat === s.turn ? 'Your turn' : "Opponent's turn");
    else if (M.net) statusEl.textContent = M.net.myPlayer === s.turn ? 'Your turn' : "Opponent's turn";
    else if (hotseat()) statusEl.textContent = `${nameOf(s.turn)} to move`;
    else statusEl.textContent = s.turn === 0 ? 'Your turn' : 'Bot thinking…';
  }

  // ---------- wall preview ----------
  function placePreview(orient, r, c, ok) {
    if (orient === 'h') gridPos(previewEl, 2 * r + 2, 2 * c + 1, 1, 3);
    else gridPos(previewEl, 2 * r + 1, 2 * c + 2, 3, 1);
    const who = M.state.turn === meIndex() ? 'mine' : 'opp';
    previewEl.className = 'preview ' + (ok ? 'ok ' + who : 'bad');
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
    ghost.className = 'drag-ghost ' + (M.state.turn === meIndex() ? 'mine' : 'opp');
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
    resetOnlineScreen();
    showScreen('online');
  }
  const setOnlineStatus = msg => { $('#online-status').textContent = msg; };
  const resetOnlineButtons = () => { $('#create-room').disabled = false; $('#join-room').disabled = false; };

  function onNetEvent(ev) {
    switch (ev.type) {
      case 'open':
        // the host fixes the settings and sends them (with its name); the guest waits for that config
        if (pendingRole === 'host') { const st = mySettings(); const first = randomTurn(); window.Net.send({ type: 'config', settings: st, name: myName(), first }); startNetMatch('host', 0, st, first); }
        break;
      case 'data':
        handleNetData(ev.msg);
        break;
      case 'close':
        if (M && M.mode === 'net') { M.net.connected = false; netPeerName = null; stopClock(); closeOverlay('overlay'); closeOverlay('rematch-prompt'); showScreen('menu'); toast('Opponent disconnected'); }
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
    else if (t === 'timeout') msg = "Couldn't connect — your network is likely blocking it. Try another network or a phone hotspot.";
    else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') msg = 'Could not reach the server.';
    if (M && M.mode === 'net') toast(msg);
    else { resetOnlineButtons(); setOnlineStatus(msg); }
  }

  function handleNetData(msg) {
    if (msg.type === 'config') {
      netPeerName = msg.name || null;
      window.Net.send({ type: 'name', name: myName() });   // tell the host who we are
      startNetMatch('guest', 1, msg.settings, msg.first);
      return;
    }
    if (!M || M.mode !== 'net') return;
    const s = M.state;
    if (msg.type === 'name') { netPeerName = msg.name || null; render(); return; }
    if (msg.type === 'rematch') {
      netRematch.opp = true;
      if (netRematch.me) reachRematch();   // we already wanted it → both agree
      else openRematchPrompt();            // ask permission
      return;
    }
    if (msg.type === 'rematch-go') {        // host's signal to start the agreed rematch
      startNetMatch('guest', 1, msg.settings || M.settings, msg.first);
      return;
    }
    if (msg.type === 'rematch-decline') {
      netRematch = { me: false, opp: false };
      closeOverlay('rematch-prompt');
      resetRematchButton();
      toast('Rematch declined');
      return;
    }
    if (msg.type === 'forfeit') {
      if (s.winner === null) { s.winner = M.net.myPlayer; showWin('You win', 'Opponent forfeited.'); }
      return;
    }
    if (msg.type === 'timeout') {
      if (s.winner === null) { s.winner = M.net.myPlayer; showWin('You win', 'Opponent ran out of time.'); }
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
      $('#online-choice').hidden = true;        // host a duel like a tournament: no "join" once you've created
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
  $('#rematch-accept').addEventListener('click', rematchAccept);
  $('#rematch-deny').addEventListener('click', rematchDeny);
  $('#rotate-btn').addEventListener('click', () => setOrient(M.orient === 'h' ? 'v' : 'h'));
  // Space toggles wall orientation while it's your turn to place
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (drag || !$('#game').classList.contains('is-active') || !interactive()) return;
    e.preventDefault();
    setOrient(M.orient === 'h' ? 'v' : 'h');
  });

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
  $$('[data-chat-form]').forEach(form => form.addEventListener('submit', e => {
    e.preventDefault();
    const input = form.querySelector('[data-chat-input]');
    if (!input) return;
    const text = input.value;
    input.value = '';
    sendChat(text);
  }));

  const nameInput = $('#player-name');
  nameInput.value = loadName();
  nameInput.addEventListener('input', () => { const v = nameInput.value.trim(); if (v) saveName(v); });

  const st = loadSettings();
  $('#set-time').value = st.time;
  $('#set-bonus').value = st.bonus;
  $('#set-walls').value = st.walls;
  ['#set-time', '#set-bonus', '#set-walls'].forEach(id => $(id).addEventListener('change', () => saveSettings(mySettings())));

  renderRecords();
})();
