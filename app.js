// app.js — UI + match controller for Detour.
(function () {
  const R = window.Rules;
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
  // Le coup mis en attente pendant que l'adversaire reflechit: { seat, action }. Il n'est pas
  // envoye, il n'entre pas dans l'historique, et il est reverifie au moment de partir -- un coup
  // legal maintenant peut devenir illegal apres le coup d'en face (le mur qu'on visait est pris,
  // ou le pion a bouge et le saut n'existe plus).
  let PRE = null;
  let drag = null;         // active drag-from-inventory gesture, or { locked:true } while input is frozen
  let armed = false;       // click-to-place: a wall is in hand, waiting for a junction click
  let pendingRole = null;  // 'host' | 'guest' while a room is connecting
  let mmSearching = false;  // true while looking for a random-match opponent
  let drawCtx = null;      // 'net' | 'local' | 'otour' — who the draw prompt is for
  let tourneyPlayers = []; // names being added on the local setup screen
  let netPeerName = null;  // opponent's display name in a friend game
  let netRematch = { me: false, opp: false }; // mutual-consent rematch flags (friend games)
  let roomCode = null;     // the friend room we are in — host, guest or watcher — for the HUD chip
  let hostOffer = null;    // host: the board already on screen, exactly as advertised to whoever knocks
  const SPECS = new Map(); // host: connection id -> that watcher's name

  // Watching someone else's game: the same board and the same chat, none of the moves. Both of
  // these are asked for from inside render(), so they have to answer for a match that is only
  // half built (a host sitting on an empty board, a watcher whose first state has yet to land).
  const spectating = () => !!(M && M.net && M.net.spectator);
  const waitingHost = () => !!(M && M.mode === 'net' && M.net.waiting && !M.net.spectator);

  // ---------- screens / overlays / toast ----------
  // Music belongs to the menu and the screens you pass through on the way to a game, never
  // to a game itself: you are reading a board, and a bed of pads under that is noise. It is
  // driven from here rather than from each caller so a screen can never be added that
  // forgets to stop it.
  const MUSIC_SCREENS = {
    menu: 1, appearance: 1, history: 1, 'bot-setup': 1, online: 1, random: 1,
    'otour-entry': 1, 'otour-lobby': 1, 'tournament-setup': 1, 'tournament-standings': 1,
  };
  const musicScreen = id => !!MUSIC_SCREENS[id] || (id === 'game' && LOOK.gameMusic === 'on');
  function showScreen(id) {
    // Un coup en attente n'a de sens que devant le plateau de SA partie. Le garder en quittant
    // l'ecran le ferait partir au retour, dans une position qui n'est plus la meme.
    if (id !== 'game') PRE = null;
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === id));
    if (window.Music) musicScreen(id) ? window.Music.start() : window.Music.stop();
  }
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

  // ---------- appearance ----------
  // Five independent axes, each one an attribute on <html> that styles.css reads.
  // The whole thing is data: adding an option is a line here and a block of variables
  // there, never a new code path. An inline script in the <head> has already applied
  // the stored set before the first paint, so nobody sees a wrong frame and a correction.
  const LOOK_KEY = 'detour_look';
  const LOOK_AXES = {
    theme:   { values: ['light', 'auto', 'dark'], def: 'auto' },
    palette: { values: ['press', 'dusk', 'signal', 'moss'], def: 'press' },
    shape:   { values: ['square', 'round'], def: 'square' },
    pawn:    { values: ['token', 'solid', 'ring', 'block'], def: 'token' },
    board:   { values: ['cells', 'checker', 'flat', 'bare'], def: 'cells' },
    sound:   { values: ['on', 'off'], def: 'on' },
    // Music under a board was deliberately left out: you are reading a position, and a bed of
    // pads under that is noise. It stays out by default for exactly that reason -- but it is a
    // taste, not a fact, so it is now a switch you can reach from the board itself.
    gameMusic: { values: ['on', 'off'], def: 'off' },
    // Two ways to put a wall down. 'hold' is the original: take one from the rail, then click a
    // junction. 'hover' skips the first half -- the junctions answer the pointer on their own, so
    // moving between two cells shows the wall and a click lays it. It is off by default because
    // live junctions sit on the corners of the squares you also click to walk.
    wallPlace: { values: ['hold', 'hover'], def: 'hold' },
  };
  const lookDefaults = () => Object.fromEntries(Object.entries(LOOK_AXES).map(([k, a]) => [k, a.def]));
  let LOOK = lookDefaults();

  function loadLook() {
    let raw; try { raw = JSON.parse(localStorage.getItem(LOOK_KEY)); } catch { /* ignore */ }
    const out = lookDefaults();
    if (raw) for (const [k, a] of Object.entries(LOOK_AXES)) {
      if (a.values.includes(raw[k])) out[k] = raw[k];
    }
    return out;
  }
  const saveLook = () => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(LOOK)); } catch { /* ignore */ } };

  function applyLook() {
    const d = document.documentElement.dataset;
    // "auto" is the absence of a choice, so the media query gets to decide
    if (LOOK.theme === 'auto') delete d.theme; else d.theme = LOOK.theme;
    d.palette = LOOK.palette;
    d.shape = LOOK.shape;
    d.pawn = LOOK.pawn;
    d.board = LOOK.board;
    d.sound = LOOK.sound;
    if (window.Sfx) window.Sfx.setEnabled(LOOK.sound !== 'off');
    if (window.Music) {
      window.Music.setEnabled(LOOK.sound !== 'off');
      // turning sound back on while sitting on the menu should start it again, not wait for
      // the next screen change
      if (LOOK.sound !== 'off' && musicScreen(($('.screen.is-active') || {}).id)) window.Music.start();
    }
    paintMusicBtn();      // turning all sound off has to grey out the music toggle too
    $$('[data-look]').forEach(b => {
      const on = LOOK[b.dataset.look] === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    window.dispatchEvent(new CustomEvent('detour:theme'));
  }
  function setLook(axis, value) {
    const a = LOOK_AXES[axis];
    if (!a || !a.values.includes(value) || LOOK[axis] === value) return;
    LOOK[axis] = value;
    saveLook();
    applyLook();
    renderLookBoard();
    if (M && $('#game').classList.contains('is-active')) render();
    renderMenuBoard();
  }
  function openAppearance() { renderLookBoard(); showScreen('appearance'); }

  // A real board, built by the same code path the game uses, so what you see on this
  // screen cannot drift from what you get: the same cells, walls, pawns and classes.
  function renderLookBoard() {
    const el = $('#look-board');
    if (!el) return;
    const n = 5;
    el.innerHTML = '';
    el.style.gridTemplateColumns = boardTracks(n);
    el.style.gridTemplateRows = boardTracks(n);
    const cells = [];
    for (let r = 0; r < n; r++) {
      cells[r] = [];
      for (let c = 0; c < n; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c; cell.dataset.p = (r + c) & 1;
        if (r === 0) cell.classList.add('goal-top', 'mine');
        if (r === n - 1) cell.classList.add('goal-bottom', 'opp');
        gridPos(cell, 2 * r + 1, 2 * c + 1);
        el.appendChild(cell);
        cells[r][c] = cell;
      }
    }
    const wall = (orient, r, c, who) => {
      const w = document.createElement('div');
      w.className = 'wall ' + who;
      if (orient === 'h') gridPos(w, 2 * r + 2, 2 * c + 1, 1, 3);
      else gridPos(w, 2 * r + 1, 2 * c + 2, 3, 1);
      el.appendChild(w);
    };
    wall('h', 1, 1, 'opp');
    wall('v', 2, 2, 'mine');
    const pawn = (r, c, who) => {
      const el2 = document.createElement('div');
      el2.className = 'pawn ' + who;
      cells[r][c].appendChild(el2);
    };
    pawn(3, 2, 'mine');
    pawn(1, 3, 'opp');
  }

  // ---------- /troll ----------  // ---------- /troll ----------
  // A hidden chat command. Typed into any online chat it hands you Path for the rest of the
  // session. It is swallowed where it is typed: never sent over the wire, never added to the
  // log, so the only trace is the engine appearing in your own action rail.
  let trollMode = false;
  function trollCommand(text) {
    if (!/^\/troll$/i.test(text)) return false;
    trollMode = true;
    if (M) { setControls(); render(); }
    toast('Path unlocked');
    return true;
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
  // The menu carries live state now — the still board and the saved-game count — so it is
  // refreshed alongside the bot records whenever we land back on it.
  function refreshMenu() {
    renderRecords();
    renderMenuBoard();
    const games = loadGames();
    const el = $('#history-count');
    if (!el) return;
    if (!games.length) { el.textContent = ''; el.className = 'bm-meta'; return; }
    // the history tile carries its own count and how the last one went, so the menu says
    // something about you rather than just listing what exists
    const g = games[0], me = g.me || 0;
    const drawn = g.winner === 'draw' || g.winner == null;
    const won = g.winner === me;
    el.className = 'bm-meta ' + (drawn ? '' : won ? 'win' : 'loss');
    el.textContent = games.length + (games.length === 1 ? ' game' : ' games')
      + ' \u00b7 last ' + (drawn ? 'drawn' : won ? 'won' : 'lost');
  }

  // ---------- the menu board ----------
  // The menu is a board. A 9x5 grid built from the same cell/gap tracks the game uses, with
  // every mode standing on cells and walls sitting in the gaps between them — so the first
  // thing you see is the thing you are about to play. Placement comes off each tile's
  // data-at="row,col,rowSpan,colSpan"; a cell c occupies track 2c-1, and the gap after it
  // is track 2c, which is the whole of the arithmetic below.
  const MENU_COLS = 9, MENU_ROWS = 5;
  const MENU_WALLS = [
    { o: 'v', r: 1, c: 4, n: 2, who: 'opp' },    // your opponent walling off the big tile
                                                 // (it has to be theirs: yours would vanish into it)
    { o: 'h', r: 2, c: 5, n: 5, who: 'opp' },
    { o: 'h', r: 4, c: 1, n: 4, who: 'mine' },
  ];
  const cellSpan = (i, n) => (2 * i - 1) + ' / ' + (2 * (i + n - 1));
  const gapLine = i => (2 * i) + ' / ' + (2 * i + 1);

  function renderMenuBoard() {
    const el = $('#board-menu');
    if (!el) return;
    el.style.gridTemplateColumns = boardTracks(MENU_COLS);
    el.style.gridTemplateRows = boardTracks(MENU_ROWS);
    $$('.bm-cell, .bm-wall', el).forEach(n => n.remove());
    const frag = document.createDocumentFragment();
    for (let r = 1; r <= MENU_ROWS; r++) {
      for (let c = 1; c <= MENU_COLS; c++) {
        const cell = document.createElement('span');
        cell.className = 'bm-cell';
        cell.style.gridRow = cellSpan(r, 1);
        cell.style.gridColumn = cellSpan(c, 1);
        frag.appendChild(cell);
      }
    }
    MENU_WALLS.forEach(w => {
      const bar = document.createElement('span');
      bar.className = 'bm-wall ' + w.who;
      if (w.o === 'h') { bar.style.gridRow = gapLine(w.r); bar.style.gridColumn = cellSpan(w.c, w.n); }
      else { bar.style.gridColumn = gapLine(w.c); bar.style.gridRow = cellSpan(w.r, w.n); }
      frag.appendChild(bar);
    });
    el.insertBefore(frag, el.firstChild);
    $$('[data-at]', el).forEach(t => {
      const [r, c, rs, cs] = t.dataset.at.split(',').map(Number);
      t.style.gridRow = cellSpan(r, rs);
      t.style.gridColumn = cellSpan(c, cs);
    });
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

  // Sounds are never played while scrubbing: stepping through a review or a rewind replays
  // dozens of positions in a second, and firing a knock for each one is unbearable.
  const sfx = name => { if (window.Sfx && !RV.on && !tbActive()) window.Sfx.play(name); };

  // ---------- interface sounds ----------
  //
  // Deliberately NOT routed through sfx() above. That helper goes quiet while you are
  // scrubbing a review, which is right for the board's own sounds — stepping through a game
  // replays dozens of positions a second — and wrong for a button you just pressed, which
  // should answer every time.
  //
  // Only real controls, so this can never double up with the board: a cell is a div and a
  // wall in the tray is a div, so moving a pawn or placing a wall still makes exactly one
  // sound, its own. The move list is included by hand because its cells are spans that
  // happen to be clickable.
  const UI_HIT = 'button, [role="button"], a[href], summary, .mv-cell.jump';
  const uiOff = el => !el || el.disabled || el.getAttribute('aria-disabled') === 'true';
  // No hover sound where there is no hover: on a touch screen pointerover fires once on tap,
  // immediately before the click, and every press would sound doubled. The test for that is
  // the pointer that raised THIS event, not a media query — a laptop with a touchscreen
  // answers yes to `(hover: hover)` and still sends touch events, and the query is evaluated
  // once at load while the way you are pointing at the thing can change at any moment.
  const hoverPointer = e => e.pointerType === 'mouse' || e.pointerType === 'pen';

  // pointerover/pointerout are not enter/leave: they fire again for every element boundary
  // crossed INSIDE a control. A menu tile is a button wrapping three spans, so drifting a
  // few pixels across it fires out-on-the-button (because the pointer moved to a child) and
  // then over-on-the-child — which cleared the "already hovering this" guard and replayed
  // the sound, over and over, without ever leaving the button.
  //
  // relatedTarget is the element on the other side of the crossing. If it is inside the same
  // control, the pointer is moving around within it and nothing has been entered or left.
  const within = (el, other) => !!(el && other && el.contains(other));

  let hoverEl = null, hoverAt = 0;
  document.addEventListener('pointerover', e => {
    if (!hoverPointer(e)) return;
    // A hover is not a user gesture. Asking for an audio context here would get a suspended
    // one and a console warning on every visit, so stay silent until something real has
    // opened it.
    if (!window.Sfx || !window.Sfx.ready()) return;
    const t = e.target.closest && e.target.closest(UI_HIT);
    if (!t || t === hoverEl || uiOff(t)) return;
    if (within(t, e.relatedTarget)) return;      // came from inside this same control
    hoverEl = t;
    const now = performance.now();
    if (now - hoverAt < 45) return;      // sweeping across a grid must not machine-gun
    hoverAt = now;
    window.Sfx.play('hover');
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    if (!hoverEl) return;
    if (within(hoverEl, e.relatedTarget)) return;   // still inside it, just over a child
    if (e.target === hoverEl || within(hoverEl, e.target)) hoverEl = null;
  }, { passive: true });
  document.addEventListener('click', e => {
    if (!window.Sfx) return;
    const t = e.target.closest && e.target.closest(UI_HIT);
    if (uiOff(t)) return;
    window.Sfx.play('click');
  });

  // The one control in the rail that is not about the game: whether there is music over it.
  // It is offered in every mode, including a review, because it answers a question you can have
  // at any moment and the answer should never be three screens away.
  function paintMusicBtn() {
    const b = $('#music-btn');
    if (!b) return;
    const on = LOOK.gameMusic === 'on' && LOOK.sound !== 'off';
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = LOOK.sound === 'off' ? 'Sound is off in Appearance' : (on ? 'Music on' : 'Music off');
    b.disabled = LOOK.sound === 'off';
  }
  function toggleGameMusic() {
    if (LOOK.sound === 'off') return toast('Sound is off in Appearance');
    setLook('gameMusic', LOOK.gameMusic === 'on' ? 'off' : 'on');
    paintMusicBtn();
    if (!window.Music) return;
    const id = ($('.screen.is-active') || {}).id;
    musicScreen(id) ? window.Music.start() : window.Music.stop();
    if (musicScreen(id)) window.Music.retry();   // first use may be the gesture that unlocks audio
    toast(LOOK.gameMusic === 'on' ? 'Music on' : 'Music off');
  }

  function setControls() {
    const net = !!M.net;                       // friend 1v1
    const otour = M.mode === 'otour';          // online tournament
    const freeplay = M.mode === 'local';       // local hotseat 1v1
    const tournament = M.mode === 'tournament'; // local tournament
    // Resign + draw live in every competitive mode except bot games and freeplay.
    // On peut abandonner partout ou le retour a disparu, sinon la partie n'aurait plus de sortie.
    const bot2 = M.mode === 'bot' && M.state.players === 2;
    const compete = M.state.winner === null &&
                 ((net && !spectating() && !waitingHost()) || tournament || (otour && M.playing)
                  || bot2 || M.mode === 'p4net');
    // Analysis is offered wherever it cannot be abused: bot games and local play, never
    // against a live opponent. Bot games otherwise have no action rail, so it has to be able
    // to bring the rail back on its own.
    if (RV.on) {
      $('#restart-btn').hidden = true; $('#forfeit-btn').hidden = true;
      $('#draw-btn').hidden = true; $('#analysis-btn').hidden = true;
      $('#setup-btn').hidden = true;
      // Export and import are things you DO to a game, so they belong in the rail above the
      // wall inventory with the rest of them, not buried among the review panel's view toggles.
      $('#board-import-btn').hidden = false;
      $('#board-export-btn').hidden = false;
      paintMusicBtn();
      $('#back-btn').hidden = false;      // une revision n'est pas une partie: on en sort librement
      showActionRail();
      return;
    }
    const board = M.mode === 'board';           // analysis board: you play both sides
    const canAnalyse = anOffered();
    // Import and export belong to the analysis board, which is the one place you are here to
    // study a game rather than play one.
    $('#board-import-btn').hidden = !board;
    $('#board-export-btn').hidden = !board;
    $('#setup-btn').hidden = !board;
    $('#setup-btn').classList.toggle('on', SU.on);
    // ...and the empty room, where restart means "put the sketch back how it was"
    $('#restart-btn').hidden = !(freeplay || board || waitingHost());
    // On a board you play both sides of, this button puts the position back -- it does not start
    // anything, so it should not say Restart.
    const rTitle = board ? 'Reset the board' : 'Restart';
    $('#restart-btn').title = rTitle;
    $('#restart-btn').setAttribute('aria-label', rTitle);
    $('#forfeit-btn').hidden = !compete;       // resign: friend + tournaments
    $('#draw-btn').hidden = !compete;          // draw:   friend + tournaments
    $('#analysis-btn').hidden = !canAnalyse || SU.on;   // engine: bot games + local play
    paintMusicBtn();
    $('#back-btn').hidden = !canLeaveFreely();
    showActionRail();
  }

  // The music toggle used to be the one button always in this rail, so the rail was always
  // shown. It has moved to the corner of the screen, so an empty rail is possible again (a
  // spectator has nothing to press) -- and an empty flex row still eats its gap on the layouts
  // that give it a grid area.
  function showActionRail() {
    const bar = $('#match-actions');
    bar.hidden = !bar.querySelector('button:not([hidden])');
  }

  function startMatch(mode, difficulty) {
    const st = mySettings();
    const p4 = st.fourP && (mode === 'bot' || mode === 'local');   // 4-player is local-only
    const opts = modOpts(st);
    if (p4) opts.players = 4;
    const human = p4
      ? (mode === 'bot' ? [true, false, false, false] : [true, true, true, true])
      : (mode === 'local' ? [true, true] : [true, false]);
    M = {
      state: R.createState(opts),
      mode,
      difficulty: mode === 'bot' ? difficulty : null,
      elo: mode === 'bot' && difficulty === 'hard' ? pathElo() : null,
      human,
      orient: 'h',
      net: null,
      settings: st,
      clock: p4 ? null : setupClock(st),   // clocks aren't shown in 4-player yet
      history: [],
    };
    M.state.turn = p4 ? 0 : randomTurn();   // 4-player opens with Bottom, then clockwise
    TB.ply = null; TB.states = null; TB.live = null;
    setControls();
    drag = null; armed = false;
    closeOverlay('overlay');
    closeOverlay('local-setup');
    showScreen('game');
    render();
    maybeBot();
    startClock();
  }

  // The analysis board: a game you play both sides of, with Path already open and no clock
  // running. It is the same match machinery as pass-and-play — the difference is who is
  // meant to be sitting there, so nothing here needs its own board, its own rules or its
  // own review. Reaching a goal ends it like any other game, but it is not saved to history:
  // a position you shuffled into to look at something is not a game you played.
  function startBoard() {
    const st = mySettings();
    const opts = modOpts(st);
    if (st.fourP) opts.players = 4;
    M = {
      state: R.createState(opts),
      mode: 'board',
      difficulty: null,
      human: opts.players === 4 ? [true, true, true, true] : [true, true],
      orient: 'h',
      net: null,
      settings: st,
      clock: null,
      history: [],
    };
    M.state.turn = 0;
    M.wallMax = M.state.walls[0];      // the pile each side started with: the ceiling for setup
    SU.on = false; SU.pick = null;
    TB.ply = null; TB.states = null; TB.live = null;
    AN.on = !!(anEngine() && anEngine().supports(M.state));
    setControls();
    drag = null; armed = false;
    closeOverlay('overlay');
    showScreen('game');
    render();
  }

  function startNetMatch(role, myPlayer, settings, first, fixed, how) {
    const cfg = how || {};
    const st = settings || (M && M.settings) || mySettings();
    // the host rolls any Debris walls and ships them over; the guest replays them (opts.debris off)
    // so both peers start from an identical board and stay in lockstep.
    const opts = modOpts(st);
    if (fixed) opts.debris = false;
    const state = R.createState(opts);
    if (fixed) R.setFixedWalls(state, fixed);
    M = {
      state,
      mode: 'net',
      difficulty: null,
      human: [false, false],
      orient: 'h',
      // `waiting` is a host sitting at its own board with the room open and nobody in it yet:
      // the position is rolled and on screen so the code can be handed out from the board, but
      // nothing is playable and no clock is running until someone takes the seat.
      net: { role, myPlayer, connected: !cfg.waiting, waiting: !!cfg.waiting, joining: false,
             spectator: false, first: first === 1 ? 1 : 0 },
      settings: st,
      clock: setupClock(st),
      history: [],
      chat: [],
      drawAsks: [0, 0],
      idleAt: Date.now(),
      spectators: SPECS.size,
    };
    if (cfg.code) roomCode = cfg.code;
    M.state.turn = first === 1 ? 1 : 0;   // starter is decided by the host and shared
    TB.ply = null; TB.states = null; TB.live = null;
    mmSearching = false;
    setControls();
    drag = null; armed = false;
    netRematch = { me: false, opp: false };
    resetRematchButton();
    resetOnlineScreen();         // so a finished game never leaves its room code lying around
    closeOverlay('overlay');
    closeOverlay('rematch-prompt');
    showScreen('game');
    render();
    if (!cfg.waiting) { startClock(); pushSpecState(); }
  }

  // clear the friend-room screen back to its create/join state
  function resetOnlineScreen() {
    $('#online-choice').hidden = false;
    $('#friend-lobby').hidden = true;
    $('#online-status').textContent = '';
    $('#join-code').value = '';
    resetOnlineButtons();
  }

  function setOrient(orient) { M.orient = orient; render(); }

  const hotseat = () => M.mode === 'local' || M.mode === 'tournament';

  // Index of the "near" player: shown at the bottom in teal, opponent at the top in amber.
  // Networked games flip per-client so you're at the bottom; local games keep a fixed board.
  const meIndex = () => {
    if (RV.on) return RV.me;
    // A drill hands you the board mid-game, and not always as the first player: "Answering the
    // Standard Opening" is seven plies in, so the side that has to find the move is the second.
    // Without this the near rail, the wall colours and the board's rotation all belonged to the
    // player the learner is NOT -- the rail said "You: 9 walls" about the opponent's walls.
    if (M.mode === 'lesson') return LS.side;
    if (M.mode === 'otour') return (OT && M.view === OT.myGame && OT.mySeat >= 0) ? OT.mySeat : 0;
    if (M.net) return M.net.myPlayer;
    return 0;
  };

  // 4-player seats are named by the edge they start on
  const SIDE_NAMES = ['Bottom', 'Top', 'Left', 'Right'];
  const playerLabel = seat => SIDE_NAMES[seat] || ('P' + (seat + 1));
  const wallColorClass = seat => (M.state.players === 4 ? 'p' + seat : (seat === meIndex() ? 'mine' : 'opp'));

  // How far to spin the board so the viewer's own start edge sits at the bottom.
  // 2-player: 180° for the second seat. 4-player online: per seat, by the edge you start on
  // (0 Bottom, 1 Top -> 180, 2 Left -> 270, 3 Right -> 90). Local games are never rotated so
  // hotseat play keeps a fixed shared board. Race shares one start edge, so both players already
  // run "upward" — flipping it would put the finish line behind the second player.
  function boardRotation() {
    const s = M.state;
    if (s.players === 4) return M.mode === 'p4net' ? [0, 180, 270, 90][M.mySeat] : 0;
    if (s.race) return 0;
    return meIndex() === 1 ? 180 : 0;
  }

  function nameOf(idx) {
    if (M.state && M.state.players === 4) return playerLabel(idx);
    if (M.names) return M.names[idx];
    if (M.net) return idx === M.net.myPlayer ? 'You' : (netPeerName || 'Opponent');
    if (M.mode === 'local') return `Player ${idx + 1}`;
    // "You" is seat 0 everywhere else because that is the seat you are given. A lesson can hand
    // you either, so it asks which one rather than assuming.
    if (M.mode === 'lesson') return idx === LS.side ? 'You' : 'Opponent';
    if (idx === 0) return 'You';
    const d = M.difficulty;
    return d ? 'Bot \u00b7 ' + d[0].toUpperCase() + d.slice(1) : 'Opponent';
  }

  // Reglage d'Appearance: les jonctions repondent au survol sans qu'on ait pris un mur en main.
  const hoverWalls = () => LOOK.wallPlace === 'hover';
  const interactive = () => {
    if (!M) return false;
    // Reviewing a finished game: during a drill only the drill's answer may be played; the
    // rest of the time the board is yours to try things on, which is the whole point of
    // looking at a finished game.
    if (RV.on) return RV.guess ? !RV.guess.done : true;
    // looking at a position already played — except on the analysis board, where playing
    // from it is the point and simply starts a new line
    if (tbActive() && M.mode !== 'board') return false;
    if (M.state.winner !== null || drag?.locked) return false;
    if (M.mode === 'otour') return M.playing && OT && OT.mySeat === M.state.turn;
    if (M.mode === 'p4net') return M.state.turn === M.mySeat;   // your seat, your turn
    if (M.net) {
      if (M.net.spectator) return false;
      // Waiting for an opponent, the board is yours to push pieces around on — both sides of
      // it, like the analysis board. An empty board you are forbidden to touch is just a
      // picture of a game. Nothing here goes on the wire, and the position is rebuilt from the
      // advertised one the moment somebody actually sits down.
      if (M.net.waiting) return true;
      return M.net.connected && M.net.myPlayer === M.state.turn;
    }
    return M.human[M.state.turn];
  };

  // Notre siege, si un coup en attente est permis en cet instant -- sinon null.
  //
  // La condition est "c'est notre partie et ce n'est pas notre tour". Exclus: la revue et le
  // plateau d'analyse (on y joue librement, il n'y a rien a attendre), les lecons, le partie
  // locale a deux sur le meme ecran (un coup en attente y serait joue POUR l'autre), le mode
  // spectateur, et l'attente d'un adversaire. Le tournoi en ligne et le jeu a quatre passent par
  // d'autres chemins d'application et ne sont pas couverts.
  function premoveSeat() {
    if (!M || RV.on || suOn() || tbActive()) return null;
    if (M.mode === 'lesson' || M.mode === 'board' || M.mode === 'local') return null;
    if (M.mode === 'otour' || M.mode === 'p4net') return null;
    if (!M.state || M.state.winner !== null) return null;
    if (M.net) {
      if (M.net.spectator || M.net.waiting || !M.net.connected) return null;
      return M.net.myPlayer === M.state.turn ? null : M.net.myPlayer;
    }
    if (!M.human) return null;
    const mine = M.human.indexOf(true);
    if (mine < 0 || M.human.filter(Boolean).length !== 1) return null;   // pas le fauteuil partage
    return mine === M.state.turn ? null : mine;
  }

  // Le siege qui agit maintenant: le notre quand c'est notre tour, celui du coup en attente
  // sinon. Partout ou le placement d'un mur lisait M.state.turn, il doit lire ceci -- sans quoi
  // la legalite, la couleur de l'apercu et le jeton souleve appartiennent a l'adversaire.
  function actingSeat() { const p = premoveSeat(); return p === null ? M.state.turn : p; }

  const PRE_MAX = 6;                 // de quoi preparer une sequence, pas de quoi jouer sans regarder
  const preList = () => (PRE ? PRE.list : []);
  const preCount = () => preList().length;

  // La position contre laquelle le PROCHAIN coup en attente se choisit: la position reelle avec
  // la file deja posee dessus. Recalculee a chaque lecture plutot que gardee de cote, parce
  // qu'un etat garde devient faux des que l'adversaire joue -- et c'est exactement le moment ou
  // on oublierait de le rafraichir.
  function premoveView() {
    if (!PRE || !PRE.list.length) return M.state;
    const v = R.cloneState(M.state);
    for (const a of PRE.list) {
      if (v.winner !== null) break;
      v.turn = PRE.seat;               // la file ne contient que NOS coups; les siens sont inconnus
      if (a.type === 'wall') R.applyWall(v, a.orient, a.r, a.c);
      else R.applyMove(v, a.to);
    }
    v.turn = PRE.seat;
    return v;
  }

  const premoveLegalIn = (st, seat, action) => action.type === 'wall'
    ? R.canPlaceWall(st, seat, action.orient, action.r, action.c)
    : R.legalMoves(st, seat).some(m => m.r === action.to.r && m.c === action.to.c);
  const premoveLegalNow = (seat, action) => premoveLegalIn(M.state, seat, action);

  // Un coup s'ajoute a la file. Il est juge sur la position que la file a deja produite, pas sur
  // la position reelle: deux pas d'affilee, ou un mur apres un pas, n'auraient aucun sens
  // autrement. Rien n'est garanti pour autant -- chaque coup est reverifie au moment de partir.
  function premoveSet(action) {
    const seat = premoveSeat();
    if (seat === null) return;
    // Recliquer le dernier coup prepare l'enleve: c'est la facon la plus courte de se corriger,
    // et elle ne demande aucun bouton.
    const list = preList();
    if (list.length && premoveSame(list[list.length - 1], action)) return premovePop();
    if (list.length >= PRE_MAX) { sfx('illegal'); return toast('That is as far ahead as you can plan'); }
    if (!premoveLegalIn(premoveView(), seat, action)) return sfx('illegal');
    PRE = { seat, list: list.concat([action]) };
    if (armed) setArmed(false);
    render();
    premoveHint();
  }

  const premoveSame = (a, b) => a.type === b.type && (a.type === 'wall'
    ? a.orient === b.orient && a.r === b.r && a.c === b.c
    : a.to.r === b.to.r && a.to.c === b.to.c);

  // Defaire le dernier prepare, pas toute la file: on se reprend d'un cran, et Echap repete
  // deroule la file a l'envers.
  function premovePop() {
    if (!PRE) return;
    PRE.list.pop();
    if (!PRE.list.length) PRE = null;
    render();
    premoveHint();
  }

  // Couper la file a partir de l'indice i (celui-la compris).
  function premoveCut(i) {
    if (!PRE) return;
    if (i <= 0) return premoveClear();
    PRE.list = PRE.list.slice(0, i);
    render();
    premoveHint();
  }

  function premoveClear(quiet) {
    if (!PRE) return;
    PRE = null;
    if (!quiet) { render(); premoveHint(); }
  }

  // Appele quand la position a change. Si le tour est revenu a nous et qu'un coup attendait, il
  // part -- a condition d'etre encore legal. S'il ne l'est plus on le jette en le disant: un coup
  // en attente qui disparait sans un mot ferait croire a un clic perdu.
  function premoveTry() {
    if (!PRE) return;
    const seat = PRE.seat;
    if (!M || !M.state || M.state.winner !== null) return premoveClear(true);
    if (premoveSeat() !== null) return;                 // toujours pas notre tour
    if (M.state.turn !== seat || !interactive()) return;
    const action = PRE.list[0], rest = PRE.list.slice(1);
    if (!premoveLegalNow(seat, action)) {
      // Le reste de la file a ete choisi EN SUPPOSANT ce coup-la, donc il tombe avec lui. Garder
      // la suite serait jouer une sequence dont le premier terme a disparu.
      PRE = null;
      sfx('illegal');
      render();
      return toast(rest.length ? 'Your waiting moves are no longer legal' : 'Your waiting move is no longer legal');
    }
    PRE = rest.length ? { seat, list: rest } : null;
    submitAction(action);
  }

  // All board input flows through here so networked moves can be routed to the host.
  function submitAction(action) {
    if (armed) setArmed(false);
    if (RV.on) {
      if (RV.guess) { if (!RV.guess.done) rvGuessSubmit(action); return; }
      rvBranchPlay(action);
      return;
    }
    if (M.mode === 'lesson') { lessonSubmit(action); return; }
    if (M.mode === 'otour') {
      if (!M.playing) return;
      if (M.otour.host) hostApplyAction(action, HOST_ID);
      else window.Net.sendHost({ t: 'action', action });
      return;
    }
    if (M.mode === 'p4net') {
      if (P4 && P4.host) hostP4Action(action, HOST_ID);
      else window.Net.sendHost({ t: 'p4act', action });
      return;
    }
    applyAction(action, false);
  }

  function applyAction(action, fromRemote) {
    // never apply a move to a position you were only looking at — unless looking at it was
    // the point, in which case the line you were looking at becomes the game
    if (tbActive() && M.mode === 'board') tbBranch();
    else tbReset();
    const s = M.state;
    const actor = s.turn;
    anBeforeAction(s, action);
    // the move list only stores notation; the review needs the move itself
    if (!M.actions || !M.actions.length) M.firstTurn = actor;
    (M.actions || (M.actions = [])).push(action.type === 'wall'
      ? { k: 1, o: action.orient, r: action.r, c: action.c }
      : { k: 0, r: action.to.r, c: action.to.c });
    const he = histEntry(s, action, actor);
    if (M.history) M.history.push(he);
    if (action.type === 'wall') R.applyWall(s, action.orient, action.r, action.c);
    else R.applyMove(s, action.to);
    markWin(he, s);
    sfx(action.type === 'wall' ? 'wall' : 'move');
    clockOnAction(actor, fromRemote, action);
    idleTouch();
    if (M.net && !M.net.spectator && !M.net.waiting && !fromRemote) { if (M.clock) action.clk = M.clock.rem[actor]; window.Net.send(action); }
    pushSpecState({ mv: 1 });
    render();
    anWatchBrilliant((M.history ? M.history.length : 0) - 1);
    if (s.winner !== null) {
      PRE = null;
      if (waitingHost()) { toast('Still waiting for an opponent'); return resetWaitingBoard(); }
      return endMatch();
    }
    if (!M.net) maybeBot();
    // Apres le coup d'en face, pas avant: maybeBot() ne joue pas tout de suite, donc au moment ou
    // le bot a reellement repondu on repasse ici et c'est la que le coup en attente part.
    premoveTry();
  }

  // Hard uses engine.js where engine.js applies — the standard game on any rectangular
  // board. Every modifier (race, king of the hill, inverted, 4-player, debris, other wall
  // lengths) falls back to bot.js, which still handles all of them.
  // Answers with a promise, because the search may be running on another thread. Off the main
  // thread it is allowed seconds instead of the 700ms the page can afford to freeze for, and
  // that is worth more than any change to the engine itself: four times the nodes is worth
  // about 63% in a paired match.
  function chooseBotAction(s, difficulty, elo) {
    const fallback = () => window.Bot.chooseAction(s, s.turn, difficulty);
    if (difficulty === 'hard' && window.Engine && window.Engine.supports(s)) {
      // The level carries its own node cap, so a weak opponent is fast without the page
      // having to shorten its clock — and the same Elo is the same opponent on any machine.
      const full = elo == null || elo >= window.Engine.ELO_MAX;
      // rootAll: la racine complete, pas seulement les candidats du filtre. Mesure le 2026-10-02:
      // le filtre ecarte le meilleur coup dans 1,14 % des positions, et sur 745 cas releves il
      // cachait 39 gains forces -- des parties gagnees jetees, qu'aucun temps de reflexion ne
      // rattrape puisque le coup n'est jamais engendre. A budget en TEMPS, celui que cette
      // fonction utilise, la racine complete ne coute rien: profondeur atteinte 11,80 contre
      // 11,73 a 400 ms, 12,57 contre 12,58 a 700 ms, 14,08 contre 14,16 a 2500 ms.
      return Brain.analyse(s, { budgetMs: Brain.budget(700, 2500), rootAll: true, elo: full ? undefined : elo })
        .then(r => r.bestAction || fallback())
        .catch(fallback);
    }
    return Promise.resolve(fallback());
  }

  function maybeBot() {
    const s = M.state;
    if (M.net || s.winner !== null || M.human[s.turn]) return;
    drag = { locked: true };
    statusEl.textContent = 'Bot thinking…';
    // The board can move on while a search is in flight — back to the menu, a restart, the
    // game ending — so the reply is only played if it still belongs to the position it was
    // asked about.
    const askedIn = M, askedAt = (M.actions || []).length;
    setTimeout(() => {
      chooseBotAction(s, M.difficulty, M.elo).then(action => {
        drag = null;
        if (!action || M !== askedIn || M.state !== s) return;
        if ((M.actions || []).length !== askedAt || s.winner !== null) return;
        applyAction(action, false);
      });
    }, 480);
  }

  function showWin(title, sub) {
    stopClock();
    // Every ending comes through here, and several of them -- resigning, running out of time,
    // an opponent who forfeits or goes silent, the draw and idle rules -- set a winner and come
    // straight here without passing endMatch. They are games you played, so they are games you
    // should be able to find again. recordGame is idempotent, so endMatch's own call still wins.
    if (M && M.state && M.state.winner !== null) recordGame(M.state.winner);
    if (M) setControls();      // la partie est finie: le retour revient, l'abandon s'en va
    $('#win-title').textContent = title;
    $('#win-sub').textContent = sub;
    statusEl.textContent = title;
    const tourney = M.mode === 'tournament' || M.mode === 'otour';
    $('#continue-btn').hidden = !tourney;
    $('#rematch-btn').hidden = tourney || M.mode === 'p4net' || spectating();   // no rematch coordination for 4-player online, none for a watcher
    $('#review-btn').hidden = tourney || !(M.actions && M.actions.length > 1);
    $('#export-btn').hidden = !(M.actions && M.actions.length > 1);
    $('#menu-btn').hidden = tourney;
    resetRematchButton();
    openOverlay('overlay');
    if (hostOfRoom() && M.state.winner !== null) pushSpecState({ end: watchEnd(specNames(), M.state.winner) });
  }
  function resetRematchButton() {
    const b = $('#rematch-btn');
    b.disabled = false;
    b.textContent = 'Rematch';
  }

  // what the winner actually reached, for the win-overlay subtitle
  const goalPhrase = () => (M.state && M.state.koth ? 'the hill' : 'the far side');

  function endMatch() {
    const w = M.state.winner;
    sfx(w === 'draw' ? 'notify' : (w === meIndex() ? 'win' : 'lose'));
    recordGame(w);
    if (M.mode === 'tournament') return endTournamentMatch(w);
    if (M.net) {
      if (w === 'draw') return showWin('Draw', 'Neither side broke through.');
      if (M.net.spectator) return showWin(nameOf(w) + ' wins', 'You were watching.');
      const won = w === M.net.myPlayer;
      return showWin(won ? 'You win' : 'You lose', won ? 'Nice detour.' : 'Out-maneuvered.');
    }
    if (w === 'draw') return showWin('Draw', 'A stalemate of detours.');
    recordResult(w === 0);
    if (M.state.players === 4) {
      if (M.mode === 'p4net') { const won = w === M.mySeat; return showWin(won ? 'You win' : `${playerLabel(w)} wins`, won ? `First pawn to ${goalPhrase()}.` : `${playerLabel(w)} got there first.`); }
      if (M.mode === 'bot') return showWin(w === 0 ? 'You win' : `${playerLabel(w)} wins`, w === 0 ? `First to ${goalPhrase()}.` : 'A bot got there first.');
      return showWin(`${playerLabel(w)} wins`, `First pawn to ${goalPhrase()}.`);
    }
    if (M.mode === 'local') showWin(`Player ${w + 1} wins`, M.state.koth ? 'Took the hill first.' : 'Reached the other side first.');
    else if (w === 0) showWin('You win', `You beat the bot on ${M.difficulty}.`);
    else showWin('You lose', 'Detoured one turn too many.');
  }

  function requestRematch() {
    if (waitingHost()) return resetWaitingBoard();   // nobody to rematch yet; clear the sketch
    // The analysis board has to go back through startBoard. startMatch would hand it the human
    // seats of a bot game ([true, false]) and then call maybeBot, so pressing Restart on a board
    // you play both sides of silently put Path in the other chair -- and lost the wall ceiling
    // and the open analysis panel with it.
    if (M.mode === 'board') return startBoard();
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
      startNetMatch('host', 0, M.settings, first);
      window.Net.send({ type: 'rematch-go', first, settings: M.settings, fixed: M.state.fixedWalls });
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
    // Le jeu a quatre en ligne: on s'en va, et le code dit deja qu'un depart termine la partie
    // pour tout le monde. C'est bien un abandon, il n'avait simplement pas de bouton.
    if (M.mode === 'p4net') return leaveP4();
    // Contre Path: abandonner, c'est perdre. Sans cette branche forfeit() ne faisait rien dans une
    // partie contre un bot -- et le bouton etait cache -- donc retirer le retour aurait enferme le
    // joueur dans une partie sans aucune sortie.
    if (!M.net) {
      const moi = M.human ? M.human.indexOf(true) : 0;
      if (moi < 0) return;
      stopClock();
      M.state.winner = 1 - moi;
      render();
      return endMatch();
    }
    window.Net.send({ type: 'forfeit' });
    M.state.winner = 1 - M.net.myPlayer;
    showWin('You resigned', 'You bailed on the race.');
  }

  // ---------- confirm (resign / draw) ----------
  let confirmCb = null;
  function confirmAction(title, body, onYes) {
    confirmCb = onYes;
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = body;
    openOverlay('confirm-prompt');
  }
  function confirmYes() { closeOverlay('confirm-prompt'); const cb = confirmCb; confirmCb = null; if (cb) cb(); }
  function confirmNo() { closeOverlay('confirm-prompt'); confirmCb = null; }

  // ---------- connection lost ----------
  function showDisconnect(msg) {
    stopClock(); hostStopClock();
    ['overlay', 'draw-prompt', 'rematch-prompt', 'confirm-prompt'].forEach(closeOverlay);
    $('#disconnect-text').textContent = msg || 'You lost your connection.';
    openOverlay('disconnect-prompt');
  }
  function dismissDisconnect() {
    closeOverlay('disconnect-prompt');
    try { window.Net.close(); } catch { /* ignore */ }
    OT = null; M = null;
    roomCode = null; hostOffer = null; SPECS.clear();
    showScreen('menu');
    refreshMenu();
  }

  // Quitter une partie qui compte ne doit se faire qu'en ABANDONNANT, donc le bouton retour
  // disparait pendant ce temps. Il revient partout ou il n'y a rien a abandonner: la partie finie
  // (partir n'est plus fuir), la revision, le plateau d'analyse, une lecon, le fauteuil partage,
  // l'attente d'un adversaire, le spectateur -- et la partie a quatre contre des bots, ou
  // "abandonner" ne designe personne.
  //
  // Le tournoi en ligne n'est pas dans la liste et c'est voulu: son bouton retour ne quitte pas la
  // partie, il remonte au classement. On quitte le tournoi depuis le classement, pas depuis le
  // plateau, donc il n'y a pas de porte de sortie a fermer ici.
  function canLeaveFreely() {
    if (!M || RV.on) return true;
    if (!M.state || M.state.winner !== null) return true;
    if (spectating() || waitingHost()) return true;
    if (M.mode === 'board' || M.mode === 'lesson' || M.mode === 'local') return true;
    if (M.mode === 'otour') return true;
    if (M.state.players === 4 && M.mode === 'bot') return true;
    return false;      // bot a deux, partie entre amis, tournoi local, quatre joueurs en ligne
  }

  function leaveMatch() {
    if (RV.on) {
      const back = RV.from;
      rvClose(); closeOverlay('overlay');
      if (back === 'history') { renderHistory(); showScreen('history'); }
      else if (back === 'board') { startBoard(); }   // back to an empty board, not the menu
      else { showScreen('menu'); refreshMenu(); }
      return;
    }
    if (M && M.mode === 'p4net') return leaveP4();   // leaving ends the 4-player game (host drop = game over)
    if (M && M.mode === 'otour') {            // Back from any board returns to the ranking page
      if (M.view >= 0) { stopClock(); return showOtourStandings(); }
      return leaveOtour();                    // already on the ranking → leave the tournament
    }
    stopClock();
    if (M && M.mode === 'net') {
      const wasWaiting = waitingHost();
      window.Net.close(); netPeerName = null; netRematch = { me: false, opp: false };
      roomCode = null; hostOffer = null; SPECS.clear();
      // A host who never got an opponent came here from the room screen and belongs back on
      // it, not dropped at the menu with nothing to show for the trip.
      if (wasWaiting) {
        M = null;
        closeOverlay('overlay'); closeOverlay('rematch-prompt');
        resetOnlineScreen(); setOnlineStatus('Room closed.'); showScreen('online');
        return;
      }
    }
    closeOverlay('overlay');
    closeOverlay('rematch-prompt');
    if (M && M.mode === 'tournament') return showTournamentStandings();
    showScreen('menu');
    refreshMenu();
  }

  function onContinue() {
    closeOverlay('overlay');
    if (M.mode === 'otour') return M.otour.host ? showHostStandings() : showClientStandings();
    showTournamentStandings();
  }

  // ---------- draw ----------
  // Asking is free. Asking over and over is a way to play the person rather than the position,
  // so the third offer in a row ends the game against whoever made it. "In a row" is meant
  // literally: an offer coming back the other way means the two of you are negotiating a draw
  // rather than one of you being worn down, and it clears the count. The second ask carries
  // the warning with it, so nobody loses to a rule they were never shown.
  const DRAW_LIMIT = 3;
  const drawAsks = () => (M.drawAsks || (M.drawAsks = [0, 0]));
  function offerDraw() {
    if (!M || M.state.winner !== null || spectating() || waitingHost()) return;
    if (M.mode === 'otour') {                 // online tournament: the host keeps the count
      if (!M.playing) return;
      if (M.otour.host) { hostDrawOffer(HOST_ID); toast('Draw offer sent'); }
      else { window.Net.sendHost({ t: 'draw-offer' }); toast('Draw offer sent'); }
      return;
    }
    if (M.net) {
      const asks = (drawAsks()[M.net.myPlayer] += 1);
      if (asks >= DRAW_LIMIT) return loseByDrawSpam();
      window.Net.send({ type: 'draw-offer' });
      toast(asks === DRAW_LIMIT - 1 ? 'Draw offer sent \u00b7 ask once more and you forfeit' : 'Draw offer sent');
      return;
    }
    openDrawPrompt('local');                  // local tournament (hotseat)
  }
  // The offerer enforces this on itself, the way resigning and flagging already do: it is the
  // only side that knows its own count, and the other side is told the result rather than asked
  // to agree with it.
  function loseByDrawSpam() {
    const me = M.net.myPlayer;
    window.Net.send({ type: 'draw-spam' });
    M.state.winner = 1 - me;
    showWin('You lose', 'You asked for a draw three times in a row.');
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
      state: R.createState(modOpts(T.settings)),
      mode: 'tournament',
      difficulty: null,
      human: [true, true],
      orient: 'h',
      net: null,
      names: [T.players[a].name, T.players[b].name],
      pair: [a, b],
      settings: T.settings,
      clock: setupClock(T.settings),
      history: [],
    };
    M.state.turn = randomTurn();
    setControls();
    drag = null; armed = false;
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

  // ---------- the search, on its own thread when the page is allowed one ----------
  // A worker cannot be created from a file:// page — the origin is "null" and the browser
  // refuses the script, the same rule that blocks fetch() here — so this is an upgrade the
  // page takes when it can rather than something it depends on. Served over http the search
  // gets a thread of its own and can be given SECONDS; opened from a file it runs inline on
  // the main thread exactly as it always has, and the budget goes back to what the page can
  // stop responding for.
  const Brain = (() => {
    let worker = null, nextId = 1;
    const waiting = new Map();
    try {
      worker = new Worker('path/engine-worker.js');
      worker.onmessage = ev => {
        const w = waiting.get(ev.data.id);
        if (!w) return;
        waiting.delete(ev.data.id);
        if (ev.data.ok) w.resolve(ev.data); else w.reject(new Error(ev.data.err));
      };
      // a worker that fails to start must not take the engine with it
      worker.onerror = () => {
        worker = null;
        for (const w of waiting.values()) w.reject(new Error('worker failed'));
        waiting.clear();
      };
    } catch (e) { worker = null; }

    // the same shape the worker posts back, so no caller has to know which side searched
    function inline(state, opts) {
      const E = window.Engine;
      const pos = E.fromRules(state);
      const res = E.analyse(pos, opts);
      return {
        ok: true, score: res.score, best: res.best, depth: res.depth, nodes: res.nodes,
        proven: !!res.proven, tablebase: !!res.tablebase, dist: res.dist,
        bestAction: res.best === E.MOVE_NONE ? null : E.toAction(pos, res.best),
        moves: res.moves ? res.moves.map(rm => [rm.move, rm.score]) : [],
        hashLo: pos.hashLo, hashHi: pos.hashHi,
      };
    }

    return {
      get remote() { return !!worker; },
      // how long a search may take, which is a different question on each side of the thread
      budget(onThread, offThread) { return worker ? offThread : onThread; },
      // L'historique des positions voyage avec chaque recherche, injecte ICI et pas chez les
      // appelants: depuis que la troisieme occurrence d'une position fait nulle, un moteur qui ne
      // le sait pas echange une victoire prouvee contre un demi-point en repetant. Un seul endroit
      // a retenir valait mieux que trois appelants a ne pas oublier. Une Map traverse
      // structuredClone, donc le worker la recoit comme la recherche en ligne.
      analyse(state, opts) {
        if (state && state.seen && state.seen.size) opts = Object.assign({}, opts, { seen: state.seen });
        if (!worker) { try { return Promise.resolve(inline(state, opts)); } catch (e) { return Promise.reject(e); } }
        const id = nextId++;
        return new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject });
          worker.postMessage({ id, snap: R.serState(state), opts });
        }).catch(() => inline(state, opts));   // a broken worker is a slow search, not a dead one
      },
    };
  })();

  // ---------- state (de)serialisation for snapshots ----------
  // Both live in rules.js now: the engine worker has to build the same position from the same
  // snapshot, and two copies of that would be two things to keep in step.
  const serState = R.serState, deState = R.deState;

  // ---------- move notation + history ----------
  // Absolute board coordinates, independent of the per-client board flip, so the move
  // list reads identically for both players and every spectator (no "true red" POV bug).
  // Files a… are columns 0…; ranks 1…R are rows R-1…0 (player 0 starts on rank 1, like e1).
  // Files follow the column count and ranks the row count, so it reads correctly on any board,
  // square or not (7×7, 9×9, 13×7…).
  // A pawn move is just its destination square (e8). Placing a wall — its own move kind we
  // call a "Wall" — is the wall's junction square plus h/v orientation (e4h).
  const FILES = 'abcdefghijklmnopq';   // up to 17 files (4-player board can be (15+2)=17 wide)
  const sqName = (rows, r, c) => FILES[c] + (rows - r);
  const wallName = (rows, orient, r, c) => FILES[c] + (rows - 1 - r) + orient;
  // Chess marks the move that ends the game, and a move list without that mark is missing the
  // one entry a reader looks for first. The notation is built before the move is applied (it
  // needs only the board's size, which never changes), so the mark is added once the result is
  // known. A draw is not a win and gets nothing.
  const markWin = (e, s) => { if (e && s.winner !== null && s.winner !== 'draw') e.n += '#'; return e; };
  function histEntry(s, action, actor) {
    return action.type === 'wall'
      ? { n: wallName(s.rows, action.orient, action.r, action.c), wall: true, orient: action.orient, p: actor }
      : { n: sqName(s.rows, action.to.r, action.to.c), wall: false, orient: null, p: actor };
  }

  // ---------- game settings (clock / bonus / walls) ----------
  // Settings live on every surface where you set up a game you host — bot, freeplay,
  // the create side of a friend room, and both tournament setups — never the menu, so
  // it's always clear which game they apply to. One in-memory object backs every input
  // surface, so editing any of them keeps the rest in sync.
  const SET_KEY = 'detour_settings';
  const DEFAULTS = {
    variant: 'standard',
    time: 10, bonus: 5, walls: 10,
    cols: 9, rows: 9, wallSize: 2, inverted: false, randomOrient: false, debris: false, fourP: false, race: false, koth: false,
  };
  const SIDE_MIN = 5, SIDE_MAX = 15;
  // a board only has one true centre cell when both sides are odd, so king of the hill rounds
  // each side down to odd (both bounds are already odd, so this never leaves the range)
  const toOdd = n => (n % 2 ? n : Math.max(SIDE_MIN, n - 1));
  const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const fieldMax = f => (typeof f.max === 'function' ? f.max(settings) : f.max);
  const fieldStep = f => (typeof f.step === 'function' ? f.step(settings) : (f.step || 1));

  const BASE_FIELDS = [
    { key: 'time', label: 'Clock (min)', min: 0, max: 120 },
    { key: 'bonus', label: 'Bonus (sec)', min: 0, max: 60 },
    { key: 'walls', label: 'Walls', min: 0, max: 20 },
  ];
  // the modifier menu — numbers and on/off toggles. `max` may depend on the current board size.
  // The board is two independent sides, so it needn't be square. 4-player pins them together
  // (opposite edges have to match for the four races to be equal).
  const MOD_FIELDS = [
    { type: 'num', key: 'cols', label: 'Board width', min: SIDE_MIN, max: SIDE_MAX, step: s => (s.koth ? 2 : 1) },
    { type: 'num', key: 'rows', label: 'Board height', min: SIDE_MIN, max: SIDE_MAX, step: s => (s.koth ? 2 : 1) },
    { type: 'num', key: 'wallSize', label: 'Wall length', min: 1, max: s => Math.min(s.rows, s.cols) - 1 },
    { type: 'toggle', key: 'koth', label: 'King of the hill' },
    { type: 'toggle', key: 'race', label: 'Race (same start side)' },
    { type: 'toggle', key: 'fourP', label: '4 players (local only)' },
    { type: 'toggle', key: 'debris', label: 'Debris' },
    { type: 'toggle', key: 'randomOrient', label: 'Random wall orientation' },
    { type: 'toggle', key: 'inverted', label: 'Inverted (reach = lose)' },
  ];
  const ALL_FIELDS = BASE_FIELDS.concat(MOD_FIELDS);
  // Everything that makes a game something other than the standard one. A room advertises
  // which of the two it is, so nobody joins a 5x15 inverted debris match expecting Detour.
  const MOD_TOGGLES = ['koth', 'race', 'fourP', 'debris', 'randomOrient', 'inverted'];
  const MOD_KEYS = ['cols', 'rows', 'wallSize'].concat(MOD_TOGGLES);
  const MOD_NAME = {
    koth: 'King of the hill', race: 'Race', fourP: '4 players',
    debris: 'Debris', randomOrient: 'Random orientation', inverted: 'Inverted',
  };
  // Judged on what the settings ARE, never on the label they arrived with — a peer's
  // `variant` field is just a claim, and this decides what a joiner is told.
  const isStandard = st => !!st && st.cols === DEFAULTS.cols && st.rows === DEFAULTS.rows
    && st.wallSize === DEFAULTS.wallSize && MOD_TOGGLES.every(k => !st[k]);
  const variantName = st => (isStandard(st) ? 'Standard game' : 'Custom game');
  function settingsLine(st) {
    if (!st) return '';
    const bits = [st.time ? st.time + '+' + st.bonus : 'No clock', st.walls + ' walls'];
    if (!isStandard(st)) {
      bits.push(st.cols + '\u00d7' + st.rows);
      if (st.wallSize !== DEFAULTS.wallSize) bits.push('wall ' + st.wallSize);
      MOD_TOGGLES.filter(k => st[k]).forEach(k => bits.push(MOD_NAME[k]));
    }
    return bits.join(' \u00b7 ');
  }
  const fieldByKey = k => ALL_FIELDS.find(f => f.key === k);
  // modifiers that can't coexist (turning one on switches its rival off)
  // King of the hill combines freely with race, 4 players and the rest — only misère is out, since
  // "flee your goal" needs a goal edge to run along, not a single square everyone is forced onto.
  const MOD_CONFLICTS = {
    fourP: ['inverted', 'race'],     // four seats, one per edge — no shared start side, no misère
    inverted: ['fourP', 'race', 'koth'],
    race: ['fourP', 'inverted'],
    koth: ['inverted'],
  };

  function loadSettings() {
    let raw; try { raw = JSON.parse(localStorage.getItem(SET_KEY)); } catch { /* ignore */ }
    const out = { ...DEFAULTS, ...(raw || {}) };
    if (raw && raw.longWalls && out.wallSize === DEFAULTS.wallSize) out.wallSize = 3;   // migrate the old "long walls" toggle
    if (raw && raw.randomWalls) out.debris = true;                                       // migrate the old "random walls" toggle
    if (raw && raw.size && raw.rows == null) out.rows = out.cols = raw.size;             // migrate the old square "size"
    ['longWalls', 'randomWalls', 'randomWallCount', 'randomWallSize', 'size'].forEach(k => delete out[k]);
    // settings saved before the standard/custom split carry no variant: anyone whose board
    // was already modified is filed as custom, so the migration doesn't quietly wipe it
    if (raw && raw.variant == null) out.variant = isStandard(out) ? 'standard' : 'custom';
    return clampSettings(out);
  }
  // Clamp everything into range, including the board-dependent fields (so shrinking a side pulls
  // the wall length in). `edited` names the field the user just touched, which decides which way a
  // squared-off 4-player board follows.
  function clampSettings(o, edited) {
    BASE_FIELDS.forEach(f => { o[f.key] = clampN(o[f.key], f.min, f.max, DEFAULTS[f.key]); });
    o.cols = clampN(o.cols, SIDE_MIN, SIDE_MAX, DEFAULTS.cols);
    o.rows = clampN(o.rows, SIDE_MIN, SIDE_MAX, DEFAULTS.rows);
    ['inverted', 'randomOrient', 'debris', 'fourP', 'race', 'koth'].forEach(k => { o[k] = !!o[k]; });
    if (o.fourP) { o.inverted = false; o.race = false; }   // mutually exclusive
    if (o.inverted) { o.race = false; o.koth = false; }
    if (o.fourP) { if (edited === 'cols') o.rows = o.cols; else o.cols = o.rows; }   // 4-player is square
    if (o.koth) { o.cols = toOdd(o.cols); o.rows = toOdd(o.rows); }                  // …and the hill is odd
    const side = Math.min(o.rows, o.cols);
    o.wallSize = clampN(o.wallSize, 1, side - 1, Math.min(DEFAULTS.wallSize, side - 1));
    // "Standard" isn't a hint — it holds the board and every modifier at the default game,
    // so a room labelled standard cannot quietly be anything else.
    if (o.variant !== 'custom') { o.variant = 'standard'; MOD_KEYS.forEach(k => { o[k] = DEFAULTS[k]; }); }
    return o;
  }
  const settings = loadSettings();
  const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
  const mySettings = () => ({ ...settings });
  // map a settings bundle to the rules-engine options (both board sides, wall length, mod flags)
  const modOpts = st => ({
    rows: st.rows, cols: st.cols, walls: st.walls, wallLen: st.wallSize,
    inverted: !!st.inverted, debris: !!st.debris, race: !!st.race, koth: !!st.koth,
  });
  // commit a change: clamp, persist, repaint every surface, push to lobby guests
  function commitSettings(edited) { clampSettings(settings, edited); saveSettings(); refreshSettingsInputs(); onSettingsChanged(); }
  // Flipping to Standard parks your custom board rather than deleting it, so a glance at
  // the standard settings doesn't cost you the modifiers you had set up.
  let modMemo = null;
  function setVariant(v) {
    if (v === settings.variant) return;
    if (v === 'standard') { modMemo = {}; MOD_KEYS.forEach(k => { modMemo[k] = settings[k]; }); }
    else if (modMemo) MOD_KEYS.forEach(k => { settings[k] = modMemo[k]; });
    settings.variant = v;
    commitSettings('variant');
  }
  function setToggle(key) {
    settings[key] = !settings[key];
    if (settings[key]) (MOD_CONFLICTS[key] || []).forEach(other => { settings[other] = false; });
    commitSettings(key);
  }

  // Each setup surface gets the base steppers inline + a "Modifiers" dropdown; all share `settings`.
  const settingsMounts = [];
  // wide and landscape: the modifiers move to the side. Portrait and phones keep the
  // dropdown, where stacking is the only thing that fits.
  const sideMods = window.matchMedia('(min-width: 900px) and (orientation: landscape)');
  if (sideMods.addEventListener) sideMods.addEventListener('change', () => refreshSettingsInputs());
  function buildStepper(f) {
    const wrap = document.createElement('div'); wrap.className = 'setting'; wrap.dataset.field = f.key;
    const span = document.createElement('span'); span.textContent = f.label;
    const stepper = document.createElement('div'); stepper.className = 'stepper';
    const inp = document.createElement('input');
    inp.className = 'num-input'; inp.type = 'number'; inp.min = f.min; inp.step = 1; inp.dataset.setKey = f.key;
    const set = val => { settings[f.key] = clampN(val, f.min, fieldMax(f), settings[f.key]); commitSettings(f.key); };
    // the step can depend on the settings: king of the hill moves the board sides two at a time,
    // so +/- walks 9 → 11 → 13 instead of landing on an even number that snaps straight back
    const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'step-btn'; minus.textContent = '−';
    minus.setAttribute('aria-label', 'Decrease ' + f.label);
    minus.addEventListener('click', () => set(settings[f.key] - fieldStep(f)));
    const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'step-btn'; plus.textContent = '+';
    plus.setAttribute('aria-label', 'Increase ' + f.label);
    plus.addEventListener('click', () => set(settings[f.key] + fieldStep(f)));
    inp.addEventListener('change', () => set(inp.value));
    stepper.append(minus, inp, plus);
    wrap.append(span, stepper);
    return wrap;
  }
  function buildToggle(f) {
    const wrap = document.createElement('div'); wrap.className = 'setting setting-wide'; wrap.dataset.field = f.key;
    const span = document.createElement('span'); span.textContent = f.label;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'toggle-btn'; btn.dataset.toggle = f.key;
    btn.addEventListener('click', () => setToggle(f.key));
    wrap.append(span, btn);
    return wrap;
  }
  function mountSettings(host) {
    if (!host) return;
    host.classList.add('settings-host');
    host.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'segmented variant-tabs';
    [['standard', 'Standard'], ['custom', 'Custom']].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'seg-btn'; b.dataset.variant = v; b.textContent = label;
      b.addEventListener('click', () => setVariant(v));
      tabs.appendChild(b);
    });
    // The core (variant tabs, the line describing them, the three base steppers) is boxed
    // so that on a wide landscape screen it can sit beside the modifiers instead of above
    // them — there is plenty of room sideways and none downwards.
    const core = document.createElement('div'); core.className = 'set-core';
    core.appendChild(tabs);
    const note = document.createElement('div'); note.className = 'variant-note';
    core.appendChild(note);
    const base = document.createElement('div'); base.className = 'settings-row';
    BASE_FIELDS.forEach(f => base.appendChild(buildStepper(f)));
    core.appendChild(base);
    host.appendChild(core);
    // Not a <details>: the browser display:none's a closed details' content, which no
    // transition can touch, so opening or closing it made the whole page jump. A plain
    // container can animate its own height, so this is one.
    const det = document.createElement('div');
    det.className = 'mods';
    det.dataset.open = 'false';
    const sum = document.createElement('button');
    sum.type = 'button'; sum.className = 'mods-summary';
    sum.setAttribute('aria-expanded', 'false');
    sum.addEventListener('click', () => {
      const open = det.dataset.open !== 'true';
      det.dataset.open = String(open);
      sum.setAttribute('aria-expanded', String(open));
    });
    det.appendChild(sum);
    const body = document.createElement('div'); body.className = 'mods-body';
    // The collapsing row is the clip, not the grid. A 0fr track takes the child's HEIGHT to
    // zero but leaves its padding standing, so a padded element put here keeps 28px of
    // itself on screen when the panel is shut. The clip carries no padding of its own.
    const clip = document.createElement('div'); clip.className = 'mods-clip';
    const grid = document.createElement('div'); grid.className = 'mods-grid settings-row';
    clip.appendChild(grid);
    body.appendChild(clip);
    MOD_FIELDS.forEach(f => grid.appendChild(f.type === 'toggle' ? buildToggle(f) : buildStepper(f)));
    det.appendChild(body);
    host.appendChild(det);
    settingsMounts.push(host);
    paintMount(host);
  }
  function modSummary() {
    const parts = [`${settings.cols}×${settings.rows}`, `wall ${settings.wallSize}`];
    if (settings.koth) parts.push('hill');
    if (settings.race) parts.push('race');
    if (settings.fourP) parts.push('4-player');
    if (settings.debris) parts.push('debris');
    if (settings.randomOrient) parts.push('rnd orient');
    if (settings.inverted) parts.push('inverted');
    return 'Modifiers · ' + parts.join(' · ');
  }
  function paintMount(host) {
    $$('input[data-set-key]', host).forEach(inp => { const f = fieldByKey(inp.dataset.setKey); if (f) { inp.max = fieldMax(f); inp.step = fieldStep(f); } inp.value = settings[inp.dataset.setKey]; });
    $$('[data-toggle]', host).forEach(b => {
      const on = !!settings[b.dataset.toggle];
      b.classList.toggle('on', on); b.textContent = on ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(on));
    });
    $$('[data-field]', host).forEach(w => { const f = fieldByKey(w.dataset.field); if (f && f.showIf) w.hidden = !f.showIf(settings); });
    const sum = $('.mods-summary', host); if (sum) sum.textContent = modSummary();
    const custom = settings.variant === 'custom';
    $$('[data-variant]', host).forEach(b => {
      const on = (b.dataset.variant === 'custom') === custom;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    const mods = $('.mods', host);
    if (mods) {
      mods.hidden = !custom;
      // beside the settings it is a panel, not a dropdown, so it is always open there
      const open = custom && sideMods.matches ? true : (custom ? mods.dataset.open === 'true' : false);
      mods.dataset.open = String(open);
      const sum2 = $('.mods-summary', mods);
      if (sum2) sum2.setAttribute('aria-expanded', String(open));
    }
    const note = $('.variant-note', host);
    if (note) note.textContent = custom ? modSummary().replace('Modifiers \u00b7 ', '') : 'The normal game \u2014 9\u00d79 board, walls of 2.';
  }
  function refreshSettingsInputs() { settingsMounts.forEach(paintMount); refreshSetupSummaries(); }
  // one plain-English line of what you are about to host
  function refreshSetupSummaries() {
    const el = $('#friend-summary');
    if (el) el.textContent = variantName(settings) + ' \u00b7 ' + settingsLine(settings);
  }
  // a host editing settings in an un-started lobby pushes them to the guests live
  function onSettingsChanged() {
    if (OT && OT.host && !OT.started && $('#otour-lobby').classList.contains('is-active')) broadcastLobby();
  }
  // Read-only view of someone else's settings — a tournament guest sees the host's, and a
  // joiner sees what they are being offered. Only rows that say something are drawn, so a
  // standard game reads as three lines rather than ten "Off"s.
  function renderSettingsView(container, st) {
    if (!container) return;
    container.classList.add('settings-row');
    container.innerHTML = '';
    const rows = [
      ['Clock', st ? (st.time ? st.time + '+' + st.bonus : 'Off') : '\u2013'],
      ['Walls', st ? st.walls : '\u2013'],
      ['Board', st && st.cols ? (st.cols + '\u00d7' + st.rows) : '\u2013'],
    ];
    if (st && st.wallSize !== DEFAULTS.wallSize) rows.push(['Wall length', st.wallSize]);
    if (st) MOD_TOGGLES.filter(k => st[k]).forEach(k => rows.push([MOD_NAME[k], 'On']));
    rows.forEach(([label, val]) => {
      const wrap = document.createElement('div'); wrap.className = 'setting';
      const span = document.createElement('span'); span.textContent = label;
      const v = document.createElement('div'); v.className = 'set-value'; v.textContent = val;
      wrap.append(span, v);
      container.appendChild(wrap);
    });
  }

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
    if (!M) return;
    if (!M.clock && !idleRuleOn()) return;   // the same ticker carries the no-clock idle rule
    if (M.clock) M.clock.last = performance.now();
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
    if (!M) return stopClock();
    if (!M.clock) { if (!idleRuleOn()) return stopClock(); return idleStep(); }
    const s = M.state;
    if (s.winner !== null) return;
    const now = performance.now();
    const dt = now - M.clock.last; M.clock.last = now;
    const p = s.turn;
    M.clock.rem[p] = Math.max(0, M.clock.rem[p] - dt);
    renderClocks();
    specClockPush(now);
    if (M.clock.rem[p] <= 0 && clockAuthority(p)) onFlag(p);
  }
  function clockAuthority(p) {
    if (M.mode === 'otour') return false;   // host ticks every game via hostClockTick; clients never flag
    if (M.net) return !M.net.spectator && M.net.myPlayer === p;
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
  // ---------- the ten-minute idle rule (games played without a clock) ----------
  // A game with no clock has nothing in it to stop someone simply never moving. Ten minutes
  // owing the same move ends the game against whoever owes it.
  //
  // Wall-clock time, not performance.now(): a backgrounded tab has its timers throttled to a
  // crawl and a sleeping laptop stops them dead — which is precisely the "walked away" case
  // the rule exists for. Date.now() still reports the real gap on the way back.
  //
  // Both sides watch it, but not at the same moment. The player who owes the move reports it
  // against themselves the instant it elapses, exactly as flagging on time already works. The
  // one waiting only claims it twenty seconds later, and only if nothing arrived — because the
  // usual reason a self-report never comes is that the tab is asleep or gone.
  const IDLE_MS = 10 * 60000;
  const IDLE_WARN = 60000;     // the last minute is counted down in the status line
  const IDLE_GRACE = 20000;
  const idleRuleOn = () => !!M && M.mode === 'net' && !M.net.spectator && !M.net.waiting
    && M.net.connected && !M.clock && M.state.winner === null;
  const idleTouch = () => { if (M) M.idleAt = Date.now(); };
  let idleWarned = false;
  function idleStep() {
    if (!idleRuleOn()) { if (idleWarned) { idleWarned = false; updateStatus(); } return; }
    const p = M.state.turn, mine = M.net.myPlayer === p;
    const left = IDLE_MS - (Date.now() - (M.idleAt || Date.now()));
    if (left <= 0) {
      if (mine) {
        window.Net.send({ type: 'idle' });
        M.state.winner = 1 - p;
        showWin('You lose', 'You went ten minutes without playing.');
      } else if (left <= -IDLE_GRACE) {
        window.Net.send({ type: 'idle-claim' });
        M.state.winner = M.net.myPlayer;
        showWin('You win', 'Your opponent went ten minutes without playing.');
      }
      return;
    }
    if (left <= IDLE_WARN) {
      idleWarned = true;
      statusEl.textContent = mine
        ? 'Play within ' + fmtClock(left) + ' or you forfeit'
        : 'They forfeit in ' + fmtClock(left);
    } else if (idleWarned) { idleWarned = false; updateStatus(); }
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
    if (!OT) return;
    // It runs for an untimed tournament too: with no clock to flag, the ten-minute idle rule
    // is the only thing standing between one absent player and a round that never finishes.
    hostClockTimer = setInterval(hostClockTick, 200);
  }
  function hostStopClock() { if (hostClockTimer) { clearInterval(hostClockTimer); hostClockTimer = null; } }
  function hostClockTick() {
    if (!OT || !OT.host || !OT.live) return hostStopClock();
    const now = performance.now();
    for (const g of OT.live.values()) {
      if (g.done || g.state.winner !== null) continue;
      if (!g.clock) {                                     // untimed: the idle rule is all there is
        if (g.idleAt && Date.now() - g.idleAt >= IDLE_MS) hostEndGame(g.gi, 1 - g.state.turn);
        continue;
      }
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
    OT = { host: false, names: [], code, chat: [], settings: null };
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
    // settings are visible to everyone before the start: the host edits them, guests see them read-only
    $('#otl-settings-wrap').hidden = false;
    $('#otl-settings-label').textContent = host ? 'Game settings' : "Host's game settings";
    $('#otour-settings').hidden = !host;
    $('#otl-settings-view').hidden = host;
    if (!host) renderSettingsView($('#otl-settings-view'), OT && OT.settings);

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
    if (name !== myName()) sfx('chat');     // your own line coming back is not news
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
    if (trollCommand(clean)) return;
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
    else if (msg.t === 'gchat') hostGameChat(id, msg.gi, msg.text);
  }
  function hostChat(id, text) {
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean) return;
    const name = nameById(id);
    addChat(name, clean);
    window.Net.broadcast({ t: 'chat', name, text: clean });   // echo to everyone (incl. sender)
  }
  function broadcastLobby() { window.Net.broadcast({ t: 'lobby', names: OT.roster.map(p => p.name), settings: mySettings() }); }
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
    if (p) { p.left = true; toast(`${p.name} disconnected`); }
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
    const st = R.createState(modOpts(OT.settings)); st.turn = randomTurn();
    const g = {
      gi, a: m.a, b: m.b, aName: OT.players[m.a].name, bName: OT.players[m.b].name,
      state: st, clock: setupClock(OT.settings), drawOffer: null, done: false, history: [], chat: [],
      drawAsks: [0, 0], idleAt: Date.now(),
    };
    OT.live.set(gi, g);
    OT.busy.add(m.a); OT.busy.add(m.b);
    OT.gameOf.set(OT.players[m.a].id, gi); OT.gameOf.set(OT.players[m.b].id, gi);
    const snap = serState(st);
    const clk = g.clock ? g.clock.rem : null;
    window.Net.broadcast({ t: 'gamestart', gi, a: g.aName, b: g.bName });
    window.Net.broadcast({ t: 'state', gi, s: snap, clk, h: g.history });
    [[m.a, 0], [m.b, 1]].forEach(([pi, seat]) => {
      const id = OT.players[pi].id;
      if (id === HOST_ID) { OT.myGame = gi; OT.mySeat = seat; OT.viewCoolUntil = 0; viewGame(gi); }
      else window.Net.sendTo(id, { t: 'youplay', gi, seat, a: g.aName, b: g.bName, s: snap, clk, h: g.history });
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
    drag = null; armed = false;
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
    if (!g.history) g.history = [];
    g.history.push(markWin(histEntry(g.state, action, actor), s));
    if (g.clock) { g.clock.rem[actor] += g.clock.bonus; g.clock.last = performance.now(); }
    g.idleAt = Date.now();
    window.Net.broadcast({ t: 'state', gi: g.gi, s: serState(s), clk: g.clock ? g.clock.rem : null, h: g.history });
    if (M && M.mode === 'otour' && M.view === g.gi) { M.state = s; sfx(action.type === 'wall' ? 'wall' : 'move'); render(); }
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
    // Same rule as a friend game, except that here the host has both counts in front of it and
    // enforces it directly rather than trusting either player to enforce it on themselves.
    if (!g.drawAsks) g.drawAsks = [0, 0];
    g.drawAsks[1 - slot] = 0;
    if (++g.drawAsks[slot] >= DRAW_LIMIT) return hostEndGame(g.gi, 1 - slot);
    if (g.drawAsks[slot] === DRAW_LIMIT - 1) {
      const askerId = OT.players[slot === 0 ? g.a : g.b].id;
      if (askerId === HOST_ID) toast('Ask once more and you forfeit');
      else window.Net.sendTo(askerId, { t: 'draw-warn' });
    }
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
    window.Net.broadcast({ t: 'state', gi, s: serState(g.state), clk: g.clock ? g.clock.rem : null, h: g.history });
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
    else if (ev.type === 'close') { showDisconnect('You were disconnected from the host.'); }
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
    if (msg.t === 'lobby') { OT.names = msg.names; if (msg.settings) OT.settings = msg.settings; if ($('#otour-lobby').classList.contains('is-active')) renderLobby(); }
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
      if (!OT.live.get(msg.gi)) OT.live.set(msg.gi, { gi: msg.gi, aName: msg.a, bName: msg.b, state: null, clock: null, done: false, history: [], chat: [] });
      if ($('#tournament-standings').classList.contains('is-active')) showClientStandings();
    }
    else if (msg.t === 'youplay') {       // self-contained, so a dropped gamestart/state can't strand you
      OT.started = true;
      if (!OT.live) OT.live = new Map();
      ensureOtourM();
      OT.myGame = msg.gi; OT.mySeat = msg.seat; OT.viewCoolUntil = 0;
      let g = OT.live.get(msg.gi);
      if (!g) { g = { gi: msg.gi, aName: msg.a, bName: msg.b, state: null, clock: null, done: false, history: [], chat: [] }; OT.live.set(msg.gi, g); }
      if (msg.s) g.state = deState(msg.s);
      if (msg.clk) g.clock = { rem: msg.clk.slice() };
      if (msg.h) g.history = msg.h;
      viewGame(msg.gi);
    }
    else if (msg.t === 'state') {
      const g = OT.live && OT.live.get(msg.gi); if (!g) return;
      g.state = deState(msg.s);
      if (msg.clk) g.clock = { rem: msg.clk.slice() };
      if (msg.h) g.history = msg.h;
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
    else if (msg.t === 'gchat') {
      if (!OT.live) OT.live = new Map();
      let g = OT.live.get(msg.gi);
      if (!g) { g = { gi: msg.gi, aName: '', bName: '', state: null, clock: null, done: false, history: [], chat: [] }; OT.live.set(msg.gi, g); }
      if (!g.chat) g.chat = [];
      g.chat.push({ name: msg.name, text: msg.text });
      if (g.chat.length > 80) g.chat.shift();
      if (M && M.mode === 'otour' && M.view === msg.gi) renderGameChat();
    }
    else if (msg.t === 'draw-offer') { if (M && M.mode === 'otour' && OT.myGame >= 0) openDrawPrompt('otour'); }
    else if (msg.t === 'draw-declined') { toast('Draw declined'); }
    else if (msg.t === 'draw-warn') { toast('Ask once more and you forfeit'); }
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

  // On a phone the action rail costs a whole row under the board, which is the scarcest
  // thing on the screen; next to the status text it costs nothing. The desktop layout
  // places it by grid area inside .play, so it has to physically go back there — hence a
  // move rather than a CSS reorder.
  const wideGame = window.matchMedia('(min-width: 1140px)');
  function placeActions() {
    const acts = $('#match-actions'), hud = $('.hud'), play = $('.play');
    if (!acts || !hud || !play) return;
    const target = wideGame.matches ? play : hud;
    if (acts.parentElement === target) return;
    if (target === play) play.insertBefore(acts, $('.side-right'));
    else hud.appendChild(acts);
  }
  // The code chip labels the game, and in the wide layout the thing it sits over is the right
  // column. Pinned to the far edge of a fixed-width HUD it landed 48px off that column's centre
  // and overhung its right edge, because the HUD and the play grid are sized independently.
  // Putting it IN the column makes it aligned by construction rather than by arithmetic that
  // stops being true the moment the board resizes. Narrow layout has no column, so it goes home.
  function placeRoomChip() {
    const chip = $('#room-chip'), hud = $('.hud'), side = $('.side-right');
    if (!chip || !hud || !side) return;
    const target = wideGame.matches ? side : hud;
    if (chip.parentElement === target) return;
    if (target === side) side.insertBefore(chip, side.firstChild);
    else {
      const acts = $('#match-actions');
      hud.insertBefore(chip, acts && acts.parentElement === hud ? acts : null);
    }
  }
  if (wideGame.addEventListener) {
    wideGame.addEventListener('change', placeActions);
    wideGame.addEventListener('change', placeRoomChip);
  }

  // ---------- rendering ----------
  function gridPos(el, row, col, rowSpan = 1, colSpan = 1) {
    el.style.gridRow = `${row} / span ${rowSpan}`;
    el.style.gridColumn = `${col} / span ${colSpan}`;
  }

  // grid track template for an N-cell board: cell, gap, cell, … (2N-1 tracks)
  function boardTracks(n) { return `var(--cell) repeat(${n - 1}, var(--gap) var(--cell))`; }

  function render() {
    placeActions();
    const s = M.state;
    const rows = s.rows, cols = s.cols;
    const p4 = s.players === 4;
    const me = p4 ? s.turn : meIndex();   // "near"/active player
    boardEl.innerHTML = '';
    boardEl.classList.remove('placing');
    const deg = boardRotation();   // spin so the viewer's own edge faces them
    boardEl.style.transform = deg ? `rotate(${deg}deg)` : '';
    // size the board (and its label strips) for the current board — the two sides are independent
    boardEl.style.gridTemplateColumns = boardTracks(cols);
    boardEl.style.gridTemplateRows = boardTracks(rows);
    const frame = boardEl.closest('.board-frame');
    if (frame) {
      frame.style.setProperty('--board-span-w', cols + (cols - 1) * 0.22);
      frame.style.setProperty('--board-span-h', rows + (rows - 1) * 0.22);
    }
    const cells = Array.from({ length: rows }, () => []);
    const hill = s.koth ? s.goals[0].cell : null;   // every seat shares it, so seat 0's will do

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c;
        cell.dataset.p = (r + c) & 1;        // parity, for the checkerboard board style
        if (R.isHole(s, r, c)) cell.classList.add('hole');   // cut corner in 4-player
        else if (hill) {
          // king of the hill: no edge is a goal any more, just the one square everyone wants
          if (r === hill.r && c === hill.c) cell.classList.add('goal-hill');
        } else if (p4) {                                       // each goal edge tinted in that player's colour
          if (r === 0) cell.classList.add('goal-top', 'p0');
          if (r === rows - 1) cell.classList.add('goal-bottom', 'p1');
          if (c === cols - 1) cell.classList.add('goal-right', 'p2');
          if (c === 0) cell.classList.add('goal-left', 'p3');
        } else if (s.race) {
          // one finish line shared by both pawns, so it's tinted neutrally rather than per player
          if (r === 0) cell.classList.add('goal-top', 'goal-shared');
        } else {
          // row 0 is player 0's goal, the bottom row is player 1's; colour by perspective
          if (r === 0) cell.classList.add('goal-top', me === 0 ? 'mine' : 'opp');
          if (r === rows - 1) cell.classList.add('goal-bottom', me === 1 ? 'mine' : 'opp');
        }
        gridPos(cell, 2 * r + 1, 2 * c + 1);
        cells[r][c] = cell;
        boardEl.appendChild(cell);
      }
    }

    (s.fixedWalls || []).forEach(addFixedWallEl);   // neutral pre-placed walls (Debris modifier)
    s.hWalls.forEach(k => addWall(k, 'h'));
    s.vWalls.forEach(k => addWall(k, 'v'));
    preList().forEach((a, i) => { if (a.type === 'wall') addPremoveWall(a, i); });

    s.pawns.forEach((p, i) => {
      const pawn = document.createElement('div');
      pawn.className = 'pawn ' + (p4 ? 'p' + i : (i === me ? 'mine' : 'opp'));
      pawn.dataset.seat = i;
      // In a game only the player to move can pick a pawn up. On a board being set up every
      // pawn is yours, so the drag has to know which one it is carrying rather than assume.
      if (suOn() || (i === s.turn && interactive())) { pawn.classList.add('draggable'); pawn.addEventListener('pointerdown', startPawnDrag); }
      if (suOn() && SU.pick === i) pawn.classList.add('picked');
      cells[p.r][p.c].appendChild(pawn);
    });

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const j = document.createElement('div');
        j.className = 'wjunction';
        j.dataset.r = r; j.dataset.c = c;
        gridPos(j, 2 * r + 2, 2 * c + 2);
        j.addEventListener('click', onJunctionClick);
        j.addEventListener('pointerenter', onJunctionEnter);
        j.addEventListener('pointerleave', onJunctionLeave);
        boardEl.appendChild(j);
      }
    }

    previewEl = document.createElement('div');
    previewEl.className = 'preview';
    previewEl.style.display = 'none';
    boardEl.appendChild(previewEl);

    if (suOn()) {
      // Every square a pawn could stand on is a target, not just the ones a rule would allow
      // you to step to. The same class, so the drag's hit test and the hover dot work unchanged.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (R.isHole(s, r, c)) continue;
          if (s.pawns.some(p => p.r === r && p.c === c)) continue;
          const cell = cells[r][c];
          cell.classList.add('movable');
          cell.addEventListener('click', () => {
            if (SU.pick == null) return;
            const i = SU.pick; SU.pick = null;
            suPlacePawn(i, r, c);
          });
        }
      }
    } else if (interactive()) {
      for (const m of R.legalMoves(s, s.turn)) {
        const cell = cells[m.r][m.c];
        cell.classList.add('movable');
        cell.addEventListener('click', () => {
          if (!interactive()) return;
          submitAction({ type: 'move', to: { r: m.r, c: m.c } });
        });
      }
    } else if (premoveSeat() !== null) {
      // Les cases ou NOTRE pion pourrait aller, calculees sur la position que la file a deja
      // produite -- sans quoi un deuxieme pas prepare repartirait de la case de depart. Elles ne
      // sont pas marquees 'movable': ce ne sont pas des coups jouables, et le reste du code (le
      // glisser du pion, le test de visee) lit cette classe.
      const seat = premoveSeat(), view = premoveView();
      // Le chemin deja prepare, marque dans l'ordre. Un seul coup en attente n'a pas besoin de
      // numero; une sequence, si, sinon on ne sait plus par ou elle passe.
      const steps = preList().filter(a => a.type === 'move');
      preList().forEach((a, i) => {
        if (a.type !== 'move') return;
        const cell = cells[a.to.r][a.to.c];
        cell.classList.add('premove');
        if (steps.length > 1) cell.dataset.preOrder = preList().slice(0, i + 1).filter(x => x.type === 'move').length;
        // Recliquer une case preparee coupe la file a partir de la: avec un seul coup en attente
        // c'est l'annulation, et avec une sequence c'est la raccourcir -- le meme geste.
        cell.addEventListener('click', ev => { ev.stopPropagation(); premoveCut(i); });
      });
      // Une case deja preparee garde SON clic. A partir du deuxieme pas, la position de la file
      // permet souvent de revenir sur une case deja choisie, et deux ecouteurs sur la meme case
      // feraient les deux choses a la fois.
      if (view.winner === null) for (const m of R.legalMoves(view, seat)) {
        const cell = cells[m.r][m.c];
        if (cell.classList.contains('premove')) continue;
        cell.classList.add('premovable');
        cell.addEventListener('click', () => premoveSet({ type: 'move', to: { r: m.r, c: m.c } }));
      }
    }

    // the board was rebuilt from scratch, so re-apply the in-hand state (and drop it if the
    // turn moved on); with the pointer already resting on a junction, re-show its preview
    if (armed && !interactive() && premoveSeat() === null) armed = false;
    boardEl.classList.toggle('placing', armed);
    // Mode survol: les jonctions deviennent vivantes des qu'il reste un mur a poser, sans les 64
    // points gris du mode "mur en main" -- un damier de cibles sur un plateau ou on ne fait que
    // passer la souris serait illisible. L'apercu suffit a dire ou le mur irait.
    boardEl.classList.toggle('hoverwall', hoverWalls() && !suOn() && canPlaceByHover());
    boardEl.classList.toggle('setup', suOn());
    // 79 target dots at once read as 79 pieces, so they only come up once a pawn is in hand.
    // A dragged pawn does not need them: the cell under the pointer lights up on its own.
    boardEl.classList.toggle('su-hold', suOn() && SU.pick != null);
    // and they are the colour of the pawn you are holding, not always the near seat's
    boardEl.classList.toggle('su-hold-opp', suOn() && SU.pick != null && SU.pick !== meIndex());
    if (armed || boardEl.classList.contains('hoverwall')) {
      const j = boardEl.querySelector('.wjunction:hover');
      if (j) onJunctionEnter({ currentTarget: j });
    }

    renderRails();
    renderClocks();
    renderMoves();
    renderCoords();
    updateStatus();
    syncGameChat();
    syncRoomChip();
    syncEmoteBar();
    anAfterRender();
  }

  // ---------- the room code, on the board ----------
  // It used to live only on the screen you left behind the instant the game began, which made
  // inviting someone something you had to finish before sitting down. Keeping it in the HUD for
  // the life of the room is also what makes a game shareable while it is being played: the code
  // you hand out mid-game is the code a watcher types in.
  function syncRoomChip() {
    const chip = $('#room-chip');
    if (!chip) return;
    placeRoomChip();
    const show = !!(M && M.mode === 'net' && !RV.on && roomCode);
    chip.hidden = !show;
    if (!show) return;
    $('#room-chip-code').textContent = roomCode;
    const n = spectating() ? 0 : (M.spectators || 0);
    const eye = $('#room-chip-specs');
    eye.hidden = !n;
    eye.textContent = '\u{1F441} ' + n;
  }
  function syncSpecCount() {
    if (!M || M.mode !== 'net') return;
    M.spectators = SPECS.size;
    syncRoomChip();
  }

  // ---------- watching a friend game ----------
  // The host owns the game; everyone else reads it. A watcher is handed the whole position on
  // arrival and the whole position again after every move, rather than a stream of moves to
  // replay: a 9x9 board serialises to a few hundred bytes, and a feed that cannot drift out of
  // step is worth far more than the bytes replaying it would save. It is the same thing the
  // tournament host already does for the boards its clients are watching.
  //
  // Only the host can be watched, because the room's code IS the host's id on the broker — a
  // watcher has nowhere else to knock. So the host relays in both directions: the guest's moves
  // and chat out to the watchers, and the watchers' chat and reactions back to the guest.
  const EMOTES = ['\u{1F44F}', '\u{1F62E}', '\u{1F525}', '\u{1F602}', '\u{1F630}', '\u{1F389}'];
  const emoteOk = g => EMOTES.indexOf(g) >= 0;
  const specEmoteAt = new Map();   // host: connection id -> when that watcher last reacted
  let emoteAt = 0;                 // watcher: when we last reacted
  let specClockAt = 0;

  const hostOfRoom = () => !!(M && M.mode === 'net' && !M.net.spectator && M.net.role === 'host');
  const watching = () => hostOfRoom() && !!window.Net.specs && window.Net.specs() > 0;
  // Absolute, in seat order, because "You" and "Opponent" mean nothing to a third person.
  const specNames = () => {
    const n = ['Player 1', 'Player 2'];
    if (!M || !M.net) return n;
    n[M.net.myPlayer] = myName();
    n[1 - M.net.myPlayer] = netPeerName || 'Opponent';
    return n;
  };
  const watchEnd = (names, w) => (w === 'draw'
    ? { title: 'Draw', sub: 'Neither side broke through.' }
    : { title: ((names && names[w]) || 'Player ' + (w + 1)) + ' wins', sub: 'You were watching.' });

  function specPacket(extra) {
    const s = M.state;
    return Object.assign({
      t: 'sp-state',
      s: serState(s), h: M.history || [], acts: M.actions || [],
      rem: M.clock ? M.clock.rem.map(Math.round) : null,
      names: specNames(), settings: M.settings, first: M.net.first,
      waiting: !!M.net.waiting, winner: s.winner,
    }, extra || {});
  }
  function pushSpecState(extra) {
    if (!watching()) return;
    window.Net.sendSpecs(specPacket(extra));
  }
  // Between moves a watcher's clock is only as good as its last sync, so push one a second.
  function specClockPush(now) {
    if (!watching() || !M.clock) return;
    if (now - specClockAt < 1000) return;
    specClockAt = now;
    window.Net.sendSpecs({ t: 'sp-clock', rem: M.clock.rem.map(Math.round) });
  }

  function hostSpecData(id, msg) {
    if (!msg) return;
    if (msg.type === 'sp-hello') {
      SPECS.set(id, String(msg.name || 'Watching').slice(0, 16));
      syncSpecCount();
      // The channel can open in the gap between the broker handing back a code and the board
      // being built, so the first packet waits for a board to exist rather than being dropped.
      const greet = tries => {
        if (!SPECS.has(id)) return;
        if (!hostOfRoom()) { if (tries > 0) setTimeout(() => greet(tries - 1), 400); return; }
        window.Net.sendTo(id, Object.assign(specPacket(), { t: 'sp-init', chat: (M.chat || []).slice(-40) }));
      };
      greet(12);
      return;
    }
    if (!hostOfRoom()) return;
    if (msg.type === 'sp-chat') return hostRelayChat(SPECS.get(id) || 'Watching', msg.text, true);
    if (msg.type === 'sp-emote') return hostRelayEmote(id, SPECS.get(id) || 'Watching', msg.e);
  }

  // One line of chat, wherever it came from, to everyone in the room.
  function hostRelayChat(name, text, fromSpec, own) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean || !hostOfRoom()) return;
    pushChat(name, clean, fromSpec, own);
    window.Net.send({ type: 'chat', name, text: clean, spec: fromSpec ? 1 : 0 });
    if (watching()) window.Net.sendSpecs({ t: 'sp-chat', name, text: clean, spec: fromSpec ? 1 : 0 });
  }
  function hostRelayEmote(id, name, glyph) {
    if (!emoteOk(glyph) || !hostOfRoom()) return;
    const now = Date.now();
    if (now - (specEmoteAt.get(id) || 0) < 1200) return;   // one reaction at a time, per watcher
    specEmoteAt.set(id, now);
    showEmote(name, glyph);
    window.Net.send({ type: 'emote', name, e: glyph });
    if (watching()) window.Net.sendSpecs({ t: 'sp-emote', name, e: glyph });
  }

  function pushChat(name, text, spec, silent) {
    if (!M) return;
    if (!M.chat) M.chat = [];
    M.chat.push({ name: name || 'Opponent', text: String(text || '').slice(0, 200), spec: !!spec });
    if (M.chat.length > 120) M.chat.shift();
    if (!silent) sfx('chat');
    renderGameChat();
  }

  // ---- reactions ----
  function sendEmote(glyph) {
    if (!emoteOk(glyph) || !spectating()) return;
    const now = Date.now();
    if (now - emoteAt < 1200) return;
    emoteAt = now;
    window.Net.send({ type: 'sp-emote', e: glyph });
  }
  function syncEmoteBar() {
    const bar = $('#emote-bar');
    if (!bar) return;
    const show = spectating() && !RV.on;
    bar.hidden = !show;
    if (!show || bar.childElementCount) return;
    EMOTES.forEach(g => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emote-btn';
      b.textContent = g;
      b.setAttribute('aria-label', 'React');
      b.addEventListener('click', () => sendEmote(g));
      bar.appendChild(b);
    });
  }
  function showEmote(name, glyph) {
    const layer = $('#emote-layer');
    if (!layer || !emoteOk(glyph)) return;
    const el = document.createElement('div');
    el.className = 'emote-pop';
    el.style.left = (10 + Math.random() * 74) + '%';
    const g = document.createElement('span'); g.className = 'emote-glyph'; g.textContent = glyph;
    const w = document.createElement('span'); w.className = 'emote-who'; w.textContent = name || '';
    el.append(g, w);
    layer.appendChild(el);
    while (layer.childElementCount > 12) layer.firstElementChild.remove();
    setTimeout(() => el.remove(), 2400);
  }

  // ---- the watcher's side ----
  function startSpectate(init) {
    const state = deState(init.s);
    mmSearching = false;
    pendingRole = null; pendingJoin = null; pendingHost = null; hostOffer = null;
    M = {
      state,
      mode: 'net',
      difficulty: null,
      human: [false, false],
      orient: 'h',
      net: { role: 'spec', myPlayer: 0, connected: true, waiting: !!init.waiting, joining: false,
             spectator: true, first: init.first | 0 },
      settings: init.settings || mySettings(),
      clock: init.rem ? { rem: init.rem.slice(), bonus: 0, last: performance.now() } : null,
      history: init.h || [],
      actions: init.acts || [],
      firstTurn: init.first | 0,
      chat: (init.chat || []).slice(),
      names: (init.names || ['Player 1', 'Player 2']).slice(),
      drawAsks: [0, 0],
      idleAt: Date.now(),
      spectators: 0,
    };
    TB.ply = null; TB.states = null; TB.live = null;
    setControls();
    drag = null; armed = false;
    ['overlay', 'rematch-prompt', 'draw-prompt', 'confirm-prompt', 'join-preview'].forEach(closeOverlay);
    resetOnlineScreen();
    showScreen('game');
    render();
    startClock();
    toast('Watching · ' + M.names.join(' vs '));
    if (state.winner !== null) { const e = watchEnd(M.names, state.winner); showWin(e.title, e.sub); }
  }

  function specData(msg) {
    if (!M) return;
    if (msg.t === 'sp-state') return specState(msg);
    if (msg.t === 'sp-clock') {
      if (!msg.rem) return;
      if (!M.clock) M.clock = { rem: msg.rem.slice(), bonus: 0, last: performance.now() };
      else { M.clock.rem = msg.rem.slice(); M.clock.last = performance.now(); }
      renderClocks();
      return;
    }
    if (msg.t === 'sp-chat') return pushChat(msg.name, msg.text, msg.spec);
    if (msg.t === 'sp-emote') return showEmote(msg.name, msg.e);
  }
  function specState(msg) {
    tbReset();                                  // never merge a new position into a replay
    const before = (M.history || []).length;
    M.state = deState(msg.s);
    M.history = msg.h || [];
    M.actions = msg.acts || [];
    M.firstTurn = msg.first | 0;
    if (msg.names) M.names = msg.names.slice();
    if (msg.settings) M.settings = msg.settings;
    M.net.waiting = !!msg.waiting;
    if (msg.rem) {
      if (!M.clock) M.clock = { rem: msg.rem.slice(), bonus: 0, last: performance.now() };
      else { M.clock.rem = msg.rem.slice(); M.clock.last = performance.now(); }
    } else M.clock = null;
    if (M.history.length > before) {
      const last = M.history[M.history.length - 1];
      sfx(last && last.wall ? 'wall' : 'move');
    }
    if (M.state.winner === null) closeOverlay('overlay');   // a rematch: take the last result down
    setControls();
    render();
    if (msg.end && M.state.winner !== null) { recordGame(M.state.winner); showWin(msg.end.title, msg.end.sub); }
  }


  // file/rank labels around the board, oriented for the current viewer. The strips stay fixed
  // (numbers down the left, letters across the bottom) while only the board spins, so a 90°/270°
  // rotation swaps which axis each strip reads. Text is never rotated, so it always stays upright.
  function renderCoords() {
    const ranks = $('#ranks'), files = $('#files');
    if (!ranks || !files || !M || !M.state) return;
    const rows = M.state.rows, cols = M.state.cols;
    const deg = boardRotation();
    const quarter = deg === 90 || deg === 270;    // a quarter turn swaps which axis each strip reads
    const nFiles = quarter ? rows : cols;         // labels along the bottom strip
    const nRanks = quarter ? cols : rows;         // labels down the left strip
    ranks.innerHTML = ''; files.innerHTML = '';
    files.style.gridTemplateColumns = boardTracks(nFiles);   // align label tracks with the board
    ranks.style.gridTemplateRows = boardTracks(nRanks);
    for (let v = 0; v < nFiles; v++) {
      const f = document.createElement('span'); f.textContent = coordLabel('files', deg, rows, cols, v); f.style.gridColumn = String(2 * v + 1); files.appendChild(f);
    }
    for (let v = 0; v < nRanks; v++) {
      const rk = document.createElement('span'); rk.textContent = coordLabel('ranks', deg, rows, cols, v); rk.style.gridRow = String(2 * v + 1); ranks.appendChild(rk);
    }
  }
  // Label shown at visual index v of a strip, given the board's rotation. 'files' is the bottom
  // strip (screen columns), 'ranks' the left strip (screen rows); at 90/270 they read the opposite
  // axis — which only happens in 4-player, where the board is square.
  function coordLabel(strip, deg, rows, cols, v) {
    if (strip === 'files') {
      if (deg === 90) return String(v + 1);
      if (deg === 180) return FILES[cols - 1 - v];
      if (deg === 270) return String(rows - v);
      return FILES[v];
    }
    if (deg === 90) return FILES[v];
    if (deg === 180) return String(v + 1);
    if (deg === 270) return FILES[cols - 1 - v];
    return String(rows - v);
  }

  // ---------- in-game chat (online games: friend 1v1 + each tournament game) ----------
  // Friend games keep the thread on the match (M.chat). Tournament games keep one thread
  // per live game (g.chat), so a game's two players and anyone spectating it all share it.
  function syncGameChat() {
    const box = $('#game-chat');
    if (!box) return;
    // A replayed game keeps the mode it was played in, so this has to exclude review
    // explicitly — otherwise reviewing an online game reopens a chat with nobody on the
    // other end of it.
    const show = !!(M && !RV.on && (M.mode === 'net' || M.mode === 'otour'));
    box.hidden = !show;
    if (show) renderGameChat();
  }
  function currentChat() {
    if (!M) return [];
    if (M.mode === 'net') { if (!M.chat) M.chat = []; return M.chat; }
    if (M.mode === 'otour') { const g = OT && OT.live && OT.live.get(M.view); if (!g) return []; if (!g.chat) g.chat = []; return g.chat; }
    return [];
  }
  function renderGameChat() {
    const log = $('#game-chat-log');
    if (!log) return;
    const me = myName();
    log.innerHTML = '';
    currentChat().forEach(m => {
      const row = document.createElement('div');
      row.className = 'chat-msg' + (m.name === me ? ' you' : '') + (m.spec ? ' watcher' : '');
      const nm = document.createElement('span'); nm.className = 'chat-name'; nm.textContent = m.name === me ? 'You' : m.name;
      const tx = document.createElement('span'); tx.className = 'chat-text'; tx.textContent = m.text;
      row.append(nm, tx);
      log.appendChild(row);
    });
    log.scrollTop = log.scrollHeight;
  }
  function sendGameChat(text) {
    const clean = String(text || '').trim().slice(0, 200);
    if (trollCommand(clean)) return;
    if (!clean || !M) return;
    if (M.mode === 'net') {
      if (M.net.spectator) { window.Net.send({ type: 'sp-chat', text: clean }); return; }
      if (hostOfRoom()) return hostRelayChat(myName(), clean, false, true);
      pushChat(myName(), clean, false, true);
      window.Net.send({ type: 'chat', name: myName(), text: clean });
    } else if (M.mode === 'otour') {
      const gi = M.view;
      if (gi == null || gi < 0) return;
      if (OT.host) hostGameChat(HOST_ID, gi, clean);
      else window.Net.sendHost({ t: 'gchat', gi, text: clean });
    }
  }
  // host relays a game's chat to everyone tagged with the game id; each client keeps it on that game
  function hostGameChat(fromId, gi, text) {
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean || !OT || !OT.host) return;
    const g = OT.live && OT.live.get(gi);
    if (!g) return;
    const name = nameById(fromId);
    if (!g.chat) g.chat = [];
    g.chat.push({ name, text: clean });
    if (g.chat.length > 80) g.chat.shift();
    window.Net.broadcast({ t: 'gchat', gi, name, text: clean });
    if (M && M.mode === 'otour' && M.view === gi) renderGameChat();
  }

  function addWall(k, orient) {
    const [r, c] = k.split(',').map(Number);
    const owner = M.state.wallBy[orient + k];
    const span = 2 * (M.state.wallLen || 2) - 1;   // a length-L wall covers L cells + (L-1) gaps
    const w = document.createElement('div');
    w.className = 'wall ' + wallColorClass(owner);
    if (orient === 'h') gridPos(w, 2 * r + 2, 2 * c + 1, 1, span);
    else gridPos(w, 2 * r + 1, 2 * c + 2, span, 1);
    if (suOn()) {
      w.classList.add('liftable');
      w.addEventListener('click', ev => { ev.stopPropagation(); suRemoveWall(orient, r, c); });
    }
    boardEl.appendChild(w);
  }
  // Le mur en attente, dessine comme un mur pose mais a notre couleur et en pointille, pour
  // qu'on voie ce qui partira sans le confondre avec un mur deja sur le plateau.
  function addPremoveWall(a, i) {
    const span = 2 * (M.state.wallLen || 2) - 1;
    const w = document.createElement('div');
    w.className = 'wall premove ' + wallColorClass(PRE.seat);
    if (a.orient === 'h') gridPos(w, 2 * a.r + 2, 2 * a.c + 1, 1, span);
    else gridPos(w, 2 * a.r + 1, 2 * a.c + 2, span, 1);
    // Cliquer dessus retire ce mur-la et ceux prepares apres lui: ils ont ete choisis sur une
    // position qui le contenait, donc les garder seuls n'aurait pas de sens.
    w.addEventListener('click', ev => { ev.stopPropagation(); premoveCut(i); });
    boardEl.appendChild(w);
  }
  // pre-placed neutral wall (random-walls modifier); carries its own length
  function addFixedWallEl(wall) {
    const span = 2 * wall.len - 1;
    const w = document.createElement('div');
    w.className = 'wall neutral';
    if (wall.orient === 'h') gridPos(w, 2 * wall.r + 2, 2 * wall.c + 1, 1, span);
    else gridPos(w, 2 * wall.r + 1, 2 * wall.c + 2, span, 1);
    boardEl.appendChild(w);
  }
  // is the random-orientation modifier active for the game on screen?
  function matchRandomOrient() {
    if (!M) return false;
    if (M.mode === 'otour') return !!(OT && OT.settings && OT.settings.randomOrient);
    return !!(M.settings && M.settings.randomOrient);
  }

  function renderRails() {
    if (M.state.players === 4) return render4pRails();
    $('#opp-inventory').classList.remove('p4-chips');
    $('#far-count').hidden = false;
    const s = M.state, bottom = meIndex(), top = 1 - bottom;
    $('#near-name').textContent = nameOf(bottom);
    $('#far-name').textContent = nameOf(top);
    // Setting up, both piles are open: a position needs walls from both sides, and waiting for
    // the turn to come round to place them would be the move-by-move business this replaces.
    // And during the opponent's turn your own pile stays reachable, because that is where a wall
    // comes from to prepare one.
    const pre = premoveSeat();
    const bottomDrag = suOn() || (interactive() && bottom === s.turn) || pre === bottom;
    const topDrag = suOn() || (interactive() && top === s.turn) || pre === top;  // local hotseat: the player to move drags from their own rail
    // The count shown is what is LEFT once the waiting walls are counted against it. Showing ten
    // while only eight can be placed would be a lie the junction then has to tell you about.
    const view = premoveView();
    $('#near-count').textContent = view.walls[bottom];
    $('#far-count').textContent = view.walls[top];
    renderWalls($('#inventory'), bottom, bottomDrag, view.walls[bottom]);
    renderWalls($('#opp-inventory'), top, topDrag, view.walls[top]);
    const orientLabel = M.orient === 'h' ? 'Horizontal' : 'Vertical';
    $('#orient-label').textContent = orientLabel;
    $('#orient-label-top').textContent = orientLabel;
    const ro = matchRandomOrient();
    $('#rotate-btn').hidden = ro || spectating();       // random orientation, or nothing to place
    $('#rotate-btn-top').hidden = ro || !hotseat();     // p2 (top) gets their own button in hotseat
    $('#rail-top').classList.toggle('active', top === s.turn);
    $('#tray').classList.toggle('active', bottom === s.turn);
    paintTrayHint(suOn() || ((bottomDrag || topDrag) && view.walls[actingSeat()] > 0));
  }
  // 4-player: the top rail becomes a 4-player scoreboard; the bottom tray belongs to whoever's turn it is
  function render4pRails() {
    const s = M.state, cur = s.turn;
    $('#far-name').textContent = 'Players';
    $('#far-count').hidden = true;
    $('#far-clock').hidden = true;
    $('#near-clock').hidden = true;
    $('#rotate-btn-top').hidden = true;
    const box = $('#opp-inventory');
    box.classList.add('p4-chips');
    // it was a wall supply a moment ago, and the supply carries a live pointer handler
    box.classList.remove('grab');
    box.removeEventListener('pointerdown', startDrag);
    box.innerHTML = '';
    for (const seat of s.order) {   // clockwise
      const chip = document.createElement('span');
      chip.className = 'p4-chip p' + seat + (seat === cur ? ' cur' : '');
      const dot = document.createElement('span'); dot.className = 'p4-dot';
      const nm = document.createElement('span'); nm.textContent = playerLabel(seat) + ' · ' + s.walls[seat];
      chip.append(dot, nm);
      box.appendChild(chip);
    }
    // online: the tray is YOUR seat (whatever the turn); hotseat: it's the current player
    const traySeat = M.mode === 'p4net' ? M.mySeat : cur;
    $('#near-name').textContent = playerLabel(traySeat) + (M.mode === 'p4net' ? ' · you' : '');
    $('#near-count').textContent = s.walls[traySeat];
    renderWalls($('#inventory'), traySeat, interactive());
    $('#orient-label').textContent = M.orient === 'h' ? 'Horizontal' : 'Vertical';
    $('#rotate-btn').hidden = matchRandomOrient();
    $('#rail-top').classList.toggle('active', false);
    $('#tray').classList.toggle('active', interactive());
    paintTrayHint(interactive() && s.walls[traySeat] > 0);
  }

  function paintTrayHint(show) {
    const el = $('#tray-hint');
    if (suOn()) {
      el.textContent = 'setting up \u00b7 drag a pawn or a wall anywhere \u00b7 click a wall to take it off \u00b7 Space to rotate';
      el.style.visibility = show ? 'visible' : 'hidden';
      return;
    }
    const pre = premoveSeat() !== null;
    el.textContent = armed
      ? (pre ? 'click a junction to have the wall waiting · Space to rotate · Esc to cancel'
             : 'click a junction to place · Space to rotate · Esc to cancel')
      : (pre ? 'take a wall to prepare one while they think · Space to rotate'
             : 'drag a wall onto the board, or click one to pick it up · Space to rotate');
    el.style.visibility = show ? 'visible' : 'hidden';
  }

  // One hitbox for the whole supply, not one per wall. Every token in the row is the same wall,
  // so asking the pointer to land on a particular 26x9 sliver of it was a precision test with no
  // question behind it -- and on a phone it was a missed tap. The listener lives on the box; the
  // tokens are only the picture of how many are left.
  function renderWalls(container, owner, draggable, count) {
    const s = M.state;
    const n = count == null ? s.walls[owner] : count;
    container.innerHTML = '';
    const color = wallColorClass(owner);
    const grab = draggable && n > 0;
    container.dataset.seat = owner;
    container.classList.toggle('grab', grab);
    // addEventListener with the same function, type and phase is a no-op the second time, so
    // re-rendering the rail cannot stack handlers.
    if (grab) container.addEventListener('pointerdown', startDrag);
    else container.removeEventListener('pointerdown', startDrag);
    for (let i = 0; i < n; i++) {
      const tok = document.createElement('div');
      const inHand = armed && draggable && owner === actingSeat() && i === n - 1;   // the one you picked up
      tok.className = 'wtoken ' + color + (draggable && M.orient === 'v' ? ' vert' : '') + (inHand ? ' armed' : '');
      container.appendChild(tok);
    }
  }

  function updateStatus() {
    statusEl.classList.remove('rewound');
    const s = M.state;
    // Nobody is waiting on the analysis board and there is no bot on it, so "Your turn" and
    // "Bot thinking" were both untrue there — and a board you play both sides of has no
    // status worth a line. The scrubber under it already says which move you are on.
    statusEl.hidden = !RV.on && M.mode === 'board';
    if (statusEl.hidden) { statusEl.textContent = ''; return; }
    if (RV.on) {
      const total = rvTotal();
      const names = (RV.rec && RV.rec.names) || [];
      if (rvExploring()) {
        statusEl.textContent = 'Your own line · ' + RV.branch.hist.length
          + (RV.branch.hist.length === 1 ? ' move' : ' moves') + ' on from move ' + RV.branch.base;
        return;
      }
      if (RV.guess) statusEl.textContent = 'Find the best move · ' + (names[s.turn] || 'Player ' + (s.turn + 1)) + ' to move';
      else if (RV.ply >= total) statusEl.textContent = 'Game review · final position';
      else if (RV.ply === 0) statusEl.textContent = 'Game review · starting position';
      else statusEl.textContent = 'Game review · after move ' + RV.ply + ' of ' + total;
      return;
    }
    if (drag?.locked || s.winner !== null) return;
    if (M.mode === 'otour') statusEl.textContent = !M.playing ? `Spectating · ${nameOf(s.turn)} to move`
      : (OT.mySeat === s.turn ? 'Your turn' : "Opponent's turn");
    else if (M.net) {
      if (M.net.spectator) statusEl.textContent = 'Watching \u00b7 ' + nameOf(s.turn) + ' to move';
      else if (M.net.waiting) statusEl.textContent = M.net.joining
        ? (netPeerName || 'Someone') + ' is looking at the game\u2026'
        : 'Waiting for an opponent \u00b7 share the code';
      else statusEl.textContent = M.net.myPlayer === s.turn ? 'Your turn' : "Opponent's turn";
    }
    else if (hotseat()) statusEl.textContent = `${nameOf(s.turn)} to move`;
    // There is no bot in a lesson -- the line plays the other side -- so saying one is thinking
    // was simply untrue, and in a drill where the learner is the second player it said it on
    // the learner's own turn.
    else if (M.mode === 'lesson') statusEl.textContent = s.turn === LS.side ? 'Your turn' : 'The lesson answers…';
    else statusEl.textContent = s.turn === 0 ? 'Your turn' : 'Bot thinking…';
    if (s.inverted) statusEl.textContent = 'Inverted · ' + statusEl.textContent;   // reaching your edge loses
    if (s.race) statusEl.textContent = 'Race · ' + statusEl.textContent;           // same start side, one finish line
    if (s.koth) statusEl.textContent = 'Hill · ' + statusEl.textContent;           // the centre cell is the only goal
    premoveHint();
  }

  // Le rappel qu'un coup attend. Ajoute ici ET apres un clic, parce que pendant que le bot
  // reflechit la ligne d'etat est ecrite directement par maybeBot et updateStatus s'arrete avant
  // d'y toucher (drag.locked) -- sans ce second appel, preparer un coup contre le bot ne se
  // verrait nulle part.
  // La file peut contenir plusieurs coups, donc l'etiquette se reecrit au lieu de s'ajouter
  // une fois pour toutes: on retire celle qui est la, puis on remet celle qui convient.
  const PRE_RE = / · \d+ moves? ready$/;
  const preTag = n => ' · ' + n + (n > 1 ? ' moves ready' : ' move ready');
  function premoveHint() {
    if (!statusEl || statusEl.hidden) return;
    const bare = statusEl.textContent.replace(PRE_RE, '');
    const want = preCount() ? bare + preTag(preCount()) : bare;
    if (statusEl.textContent !== want) statusEl.textContent = want;
  }

  // ---------- move list ----------
  // History of the game currently on screen: the live otour game being viewed, else this match.
  function currentHistory() {
    // On a branch the list reads: the game up to where you left it, then your own moves.
    if (RV.on && RV.branch) return RV.hist.slice(0, RV.branch.base).concat(RV.branch.hist);
    if (RV.on) return RV.hist;
    if (!M) return [];
    if (M.mode === 'otour') { const g = OT && OT.live && OT.live.get(M.view); return (g && g.history) || []; }
    return M.history || [];
  }
  // The named opening, shown while the game is in one. Matched against the position on screen
  // rather than the live one, so scrubbing back through a game names the opening as it was.
  function paintOpening() {
    const box = $('#opening');
    if (!box) return;
    const OP = window.Openings;
    const acts = (M && M.actions) || null;
    if (!OP || !M || !M.state || !acts) { box.hidden = true; return; }
    const shown = RV.on ? RV.ply : (tbActive() ? TB.ply : acts.length);
    const hit = OP.match(acts.slice(0, shown == null ? acts.length : shown), M.state);
    box.hidden = !hit;
    if (!hit) return;
    $('#opening-name').textContent = hit.name;
    $('#opening-note').textContent = hit.note;
    const src = $('#opening-src');
    src.textContent = hit.src === 'q' ? 'QuoridorStrategy' : hit.src === 'd' ? 'Played here' : 'Wikipedia';
    src.title = hit.notation ? 'Line: ' + hit.notation : (hit.code ? 'Board code: ' + hit.code : '');
  }

  function renderMoves() {
    paintOpening();
    lessonPaint();
    suPaint();
    const list = $('#moves-list');
    if (!list) return;
    const hist = currentHistory();
    const me = meIndex();
    const per = M.state.players === 4 ? 4 : 2;   // one column per player: a round is 4 plies in 4-player
    list.classList.toggle('four', per === 4);
    list.innerHTML = '';
    for (let i = 0; i < hist.length; i += per) {
      const row = document.createElement('div'); row.className = 'mv-row';
      const no = document.createElement('span'); no.className = 'mv-no'; no.textContent = i / per + 1;
      row.append(no);
      for (let k = 0; k < per; k++) {
        const e = hist[i + k];
        // A branch move has no index in the game, and must never be given one: the index is
        // what makes a move clickable, and clicking it would jump into the line it is not in.
        if (e && e.idx == null && !e.branch) e.idx = i + k;
        row.append(e ? moveCell(e, me) : blankCell());
      }
      list.appendChild(row);
    }
    if (RV.on || tbActive()) {
      const cur = list.querySelector('.mv-cell.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    } else list.scrollTop = list.scrollHeight;
  }

  // ---------- game history screen ----------
  // ============================================================
  //  Lessons
  //  ------------------------------------------------------------
  //  Two kinds on one screen.
  //
  //  An OPENING lesson walks a published line. You play one side, the lesson answers for the
  //  other, and a move that is not the line is refused rather than played -- the whole point is
  //  to arrive at the position the line reaches, so letting you wander off it would teach the
  //  wrong thing. Several of these moves are ones Path itself would not choose; that is not a
  //  mistake in the lesson, it is what an opening is.
  //
  //  A POSITION lesson drops you into one position and asks for the move Path found clearly
  //  best. Only positions where the best move beats the second by a wide margin are shipped, so
  //  you are never marked wrong for choosing between two good moves. A wrong answer is priced
  //  in win probability rather than merely called wrong.
  // ============================================================
  const LS = { on: false, kind: null, id: null, entry: null, tries: 0, done: false, side: 0, why: null, act: null, pending: false };
  const LESSON_KEY = 'detour_lessons_done';

  function lessonsDone() {
    try { return new Set(JSON.parse(localStorage.getItem(LESSON_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function lessonMark(id) {
    const d = lessonsDone(); d.add(id);
    try { localStorage.setItem(LESSON_KEY, JSON.stringify([...d])); } catch (e) { /* private window */ }
  }

  function lessonCard(id, title, note, doneSet) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lesson-card' + (doneSet.has(id) ? ' done' : '');
    const t = document.createElement('span'); t.className = 'lesson-card-name'; t.textContent = title;
    const n = document.createElement('span'); n.className = 'lesson-card-note'; n.textContent = note;
    b.append(t, n);
    b.addEventListener('click', () => startLesson(id));
    return b;
  }

  // An idea is read where it stands: the card opens under itself. No board and no answer to find,
  // because there is no move that says whether you have understood "make them commit first" --
  // and a lesson that marks you wrong on a plan teaches you to distrust the lessons.
  function ideaCard(idea, doneSet) {
    const id = 'i:' + idea.id;
    const wrap = document.createElement('div');
    wrap.className = 'lesson-idea';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'lesson-card idea-head' + (doneSet.has(id) ? ' done' : '');
    head.setAttribute('aria-expanded', 'false');
    const t = document.createElement('span'); t.className = 'lesson-card-name'; t.textContent = idea.title;
    const n = document.createElement('span'); n.className = 'lesson-card-note'; n.textContent = idea.summary;
    head.append(t, n);
    const body = document.createElement('div');
    body.className = 'idea-body';
    body.hidden = true;
    for (const para of idea.body) {
      const el = document.createElement('p');
      el.textContent = para;
      body.appendChild(el);
    }
    if (idea.from) {
      const src = document.createElement('p');
      src.className = 'idea-from';
      src.textContent = idea.from;
      body.appendChild(src);
    }
    head.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('open', open);
      // Read is done: there is nothing else here to get right.
      if (open && !doneSet.has(id)) { lessonMark(id); doneSet.add(id); head.classList.add('done'); }
      if (open) sfx('click');
    });
    wrap.append(head, body);
    return wrap;
  }

  function renderLessons() {
    const done = lessonsDone();
    const ops = $('#lesson-openings'), drs = $('#lesson-drills'), ids = $('#lesson-ideas');
    ops.innerHTML = ''; drs.innerHTML = '';
    const OP = window.Openings;
    if (OP) for (const o of OP.list) {
      if (!o.line) continue;                       // the position-only entries are not walkable
      ops.appendChild(lessonCard('o:' + o.name, o.name, o.note, done));
    }
    const LE = window.Lessons;
    if (LE && LE.drills) for (const d of LE.drills) drs.appendChild(lessonCard('d:' + d.id, d.title, d.prompt, done));
    if (!drs.children.length) drs.innerHTML = '<p class="lesson-groupnote">None yet.</p>';
    if (ids) {
      ids.innerHTML = '';
      const list = (LE && LE.ideas) || [];
      for (const idea of list) ids.appendChild(ideaCard(idea, done));
      if (!list.length) ids.innerHTML = '<p class="lesson-groupnote">None yet.</p>';
    }
    $('#lessons-reset').hidden = done.size === 0;
  }
  function openLessons() { renderLessons(); showScreen('lessons'); }

  function lessonEntry(id) {
    if (id[0] === 'o') return (window.Openings ? window.Openings.list : []).find(o => 'o:' + o.name === id);
    return (window.Lessons && window.Lessons.drills || []).find(d => 'd:' + d.id === id);
  }

  function startLesson(id) {
    const entry = lessonEntry(id);
    if (!entry) return;
    const st = mySettings();
    M = {
      state: R.createState({ size: 9, walls: 10, players: 2 }),
      mode: 'lesson', difficulty: null, human: [true, true],
      orient: 'h', net: null, settings: st, clock: null, history: [], actions: [],
    };
    M.state.turn = 0;
    LS.on = true; LS.kind = id[0]; LS.id = id; LS.entry = entry; LS.tries = 0; LS.done = false;
    LS.why = null; LS.act = null; LS.pending = false; LS.msg = ''; LS.good = false;
    if (id[0] === 'd' && entry.setup) {
      // Applied straight to the board rather than through applyAction: the setup is the
      // problem, not moves the learner made, and it should not appear as their move list.
      for (const t of entry.setup.split(' ').filter(Boolean)) {
        const a = window.Openings.actionOf(t);
        if (a.type === 'move') R.applyMove(M.state, a.to); else R.applyWall(M.state, a.orient, a.r, a.c);
      }
    }
    LS.side = M.state.turn;
    // BOTH sides stay human. Marking the lesson's side as non-human looks right and is not: it
    // hands that side to the app's bot, which then plays its own move at the same time as the
    // lesson plays the line's, and the two answer each other. The Reed Opening came out as
    // "c3h e8 f3h e7" -- one move of the line, one of the bot's, alternating. Whose turn it is
    // belongs to the lesson, so the lesson enforces it in lessonSubmit and nowhere else.
    M.human = [true, true];
    TB.ply = null; TB.states = null; TB.live = null;
    AN.on = false;
    setControls();
    drag = null; armed = false;
    showScreen('game');
    render();
    lessonPaint();
  }

  // The analysis panel is off during a lesson, so its route never gets drawn; the lesson draws
  // its own. Called from the same place the board is rebuilt.
  function lessonDrawHint() {
    if (!LS.on || !M || M.mode !== 'lesson' || !LS.why) return;
    const cls = LS.why.seat === LS.side ? 'own' : 'threat';
    if (LS.pending) {
      // The answer was named, not played: the board still poses the question, so the move itself
      // is what to draw, and the route only if it is about somewhere the move is not.
      if (LS.act) drawAction(M.state, LS.act, LS.side, 'best');
      if (LS.why.path && !anRouteSaysNothing(LS.why, LS.act)) drawRoute(LS.why.path, cls);
      return;
    }
    // The move HAS been played. The stored route was measured before it, so it starts on the
    // square the pawn has just left -- an arrow out of an empty cell. Walk it again from where
    // the board actually is, and there is no move arrow here to collide with.
    let path = LS.why.path;
    if (window.Explain && anEngine() && LS.why.seat != null) {
      try { path = window.Explain.route(R, anEngine(), M.state, LS.why.seat) || path; } catch (e) { /* keep the old one */ }
    }
    if (path) drawRoute(path, cls);
  }

  // The column between the two wall boxes is empty in every other mode, and a lesson is the one
  // mode with something worth putting there: for an opening, the line being learnt with the step
  // you are on; for a drill, the moves that built the position. A drill drops you into a board
  // mid-game with its setup applied straight to the state rather than through applyAction -- so
  // it deliberately never reaches the move list, and without this the position has no history on
  // screen at all. The line ahead stays masked: the panel already names the move you owe, and
  // printing the opponent's replies too would leave nothing to work out.
  function lessonTrack() {
    const box = $('#lesson-line');
    if (!box) return;
    const on = !!(LS.on && M && M.mode === 'lesson');
    box.hidden = !on;
    if (!on) { box.innerHTML = ''; return; }
    const isOpening = LS.kind === 'o';
    const rows = M.state.rows;
    const names = isOpening
      ? (LS.entry.notation || '').split(' ').filter(Boolean)
      : (LS.entry.setup || '').split(' ').filter(Boolean).map(t => {
        const a = window.Openings.actionOf(t);
        return a.type === 'move' ? sqName(rows, a.to.r, a.to.c) : wallName(rows, a.orient, a.r, a.c);
      });
    const at = isOpening ? lessonStep() : names.length;   // a drill's moves are all behind you
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'lt-head';
    head.textContent = isOpening ? 'The line' : 'How we got here';
    box.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'lt-grid';
    const cell = (cls, text) => {
      const el = document.createElement('span');
      el.className = cls; el.textContent = text;
      grid.appendChild(el);
      return el;
    };
    // The learner is not always the first player -- a drill can hand you the board on either
    // side -- so which column says "You" follows LS.side rather than being written down.
    cell('lt-lab', '');
    cell('lt-lab', LS.side === 0 ? 'You' : 'Them');
    cell('lt-lab', LS.side === 1 ? 'You' : 'Them');
    for (let i = 0; i < names.length; i++) {
      if (i % 2 === 0) cell('lt-n', (i / 2 + 1) + '.');
      cell('lt-mv ' + (i < at ? 'lt-done' : i === at ? 'lt-now' : 'lt-soon'), i > at ? '\u00b7' : names[i]);
    }
    box.appendChild(grid);
  }

  function lessonLine() { return LS.entry && LS.entry.line ? LS.entry.line.split(' ') : []; }
  function lessonStep() { return (M.actions || []).length; }

  function lessonPaint() {
    const box = $('#lesson-panel');
    if (!box) return;
    box.hidden = !(LS.on && M && M.mode === 'lesson');
    lessonTrack();
    if (box.hidden) return;
    const isOpening = LS.kind === 'o';
    $('#lesson-kind').textContent = isOpening ? 'Opening' : 'Position';
    $('#lesson-title').textContent = isOpening ? LS.entry.name : LS.entry.title;
    const line = lessonLine();
    $('#lesson-step').textContent = isOpening ? (Math.min(lessonStep() + 1, line.length) + ' / ' + line.length) : '';
    const ask = $('#lesson-ask'), say = $('#lesson-say');
    if (LS.done) {
      ask.textContent = (isOpening ? LS.entry.note : LS.entry.why) +
        (LS.why && LS.why.text ? '  ' + LS.why.text : '');
      $('#lesson-next').hidden = false;
    } else if (isOpening) {
      const want = (LS.entry.notation || '').split(' ')[lessonStep()];
      ask.textContent = M.state.turn === LS.side
        ? 'Your move: ' + (want || '') + '.'
        : 'The lesson answers…';
      $('#lesson-next').hidden = true;
    } else {
      ask.textContent = LS.entry.prompt;
      $('#lesson-next').hidden = true;
    }
    say.hidden = !LS.msg;
    say.textContent = LS.msg || '';
    say.className = 'lesson-say' + (LS.good ? ' good' : LS.msg ? ' bad' : '');
  }

  // A move arrives from the board while a lesson is running.
  function lessonSubmit(action) {
    if (!LS.on || LS.done) return;
    const tok = window.Openings.tokenOf(action);
    if (LS.kind === 'o') {
      if (M.state.turn !== LS.side) return;      // the lesson is mid-answer; not your move
      const line = lessonLine(), want = line[lessonStep()];
      if (tok !== want) {
        LS.tries++; LS.good = false;
        LS.msg = 'Not the line. ' + LS.entry.name + ' plays ' +
          (LS.entry.notation || '').split(' ')[lessonStep()] + ' here.';
        lessonPaint();
        sfx('illegal');
        return;
      }
      LS.msg = ''; LS.good = true;
      applyAction(action, false);
      lessonAdvance();
    } else {
      if (tok === LS.entry.answer) {
        // Computed BEFORE the move is played: the explanation is about the position the move was
        // chosen in, and applying it first would explain a board that no longer poses the question.
        LS.why = lessonWhy(action); LS.act = action; LS.pending = false;
        LS.good = true; LS.done = true; LS.msg = 'That is the move.';
        applyAction(action, false);
        lessonMark(LS.id);
        lessonPaint();
        return;
      }
      LS.tries++; LS.good = false;
      if (LS.tries >= 3) { lessonReveal(); sfx('illegal'); return; }
      LS.msg = lessonCost(action);
      lessonPaint();
      sfx('illegal');
    }
  }

  // A drill asks one question and the panel does not contain its answer, so without the "Show
  // me" button it could dead-end. Three wrong tries open it instead: the move is named, the
  // explanation is drawn, and the lesson is NOT marked done, because it was not solved.
  function lessonReveal() {
    LS.act = window.Openings.actionOf(LS.entry.answer);
    LS.why = lessonWhy(LS.act);
    LS.pending = true;                 // named, not played: the board still shows the question
    LS.good = false; LS.done = true;
    LS.msg = 'The move is ' + (LS.entry.answerText || LS.entry.answer) + '.';
    render();          // lessonDrawHint rides on the rebuild; painting alone leaves no route
    lessonPaint();
  }

  // What a wrong answer costs, in the same units the analysis panel grades moves in. Saying
  // "that gives up 12% of the win" teaches something; saying "wrong" does not.
  function lessonCost(action) {
    const E = anEngine();
    if (!E || LS.entry.wp == null) return 'Not the move here.';
    try {
      const pos = E.fromRules(M.state);
      const mv = E.fromAction(pos, action);
      const sc = E.scoreMove(pos, mv, 0, { budgetMs: 400 });
      if (sc == null) return 'Not the move here.';
      const loss = Math.max(0, LS.entry.wp - E.evalToWinProb(sc) * 100);
      return loss < 1 ? 'Close, but not the move here.'
        : 'That gives up about ' + loss.toFixed(0) + '% of the win. Try again.';
    } catch (e) { return 'Not the move here.'; }
  }

  function lessonAdvance() {
    const line = lessonLine();
    if (lessonStep() >= line.length) {
      LS.done = true; LS.good = true; LS.msg = 'Line complete.';
      lessonMark(LS.id);
      lessonPaint();
      return;
    }
    lessonPaint();
    if (M.state.turn !== LS.side) {
      // the lesson answers for the other side, after a beat so the move can be seen
      setTimeout(() => {
        if (!LS.on || LS.done || M.mode !== 'lesson') return;
        const a = window.Openings.actionOf(line[lessonStep()]);
        if (!a) return;
        applyAction(a, false);
        lessonAdvance();
      }, 650);
    }
  }

  // What the engine says about a move, in the same words it uses in the analysis panel. This is
  // why the explanations came first: a lesson's "why" is better coming from a measurement than
  // from a sentence written once per lesson by hand.
  function lessonWhy(action) {
    if (!window.Explain || !M) return null;
    try { return window.Explain.explain(R, anEngine(), M.state, action, { viewer: LS.side }); } catch (e) { return null; }
  }

  function openHistory() { renderHistory(); showScreen('history'); }

  const MODE_LABEL = {
    bot: 'vs Computer', local: 'Two players', net: 'Friend', tournament: 'Tournament',
    otour: 'Online tournament', p4net: '4-player online', review: 'Game',
    board: 'Analysis board',
  };

  function relativeDay(ts) {
    const d = new Date(ts), now = new Date();
    const day = 86400000;
    const midnight = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(now) - midnight(d)) / day);
    if (diff === 0) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff === 1) return 'Yesterday ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 7) return diff + ' days ago';
    return d.toLocaleDateString();
  }

  function variantTag(setup) {
    const bits = [];
    if (setup.koth) bits.push('Hill');
    if (setup.race) bits.push('Race');
    if (setup.inverted) bits.push('Inverted');
    if (setup.players === 4) bits.push('4P');
    if (setup.rows !== 9 || setup.cols !== 9) bits.push(setup.cols + '\u00d7' + setup.rows);
    if (setup.wallLen && setup.wallLen !== 2) bits.push('wall ' + setup.wallLen);
    return bits;
  }

  function renderHistory() {
    const list = $('#history-list');
    if (!list) return;
    const games = loadGames();
    $('#history-clear').hidden = !games.length;
    list.innerHTML = '';
    if (!games.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'No games yet. Finish one and it will show up here.';
      list.appendChild(empty);
      return;
    }
    for (const g of games) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'history-row';
      const me = g.me || 0;
      const won = g.winner === me;
      const drawn = g.winner === 'draw' || g.winner == null;

      const res = document.createElement('span');
      res.className = 'h-res ' + (drawn ? 'draw' : won ? 'win' : 'loss');
      res.textContent = drawn ? '\u00bd' : won ? 'W' : 'L';

      const mid = document.createElement('span');
      mid.className = 'h-mid';
      const who = document.createElement('span');
      who.className = 'h-who';
      who.textContent = (g.names && g.names.length === 2)
        ? g.names[0] + ' vs ' + g.names[1]
        : (MODE_LABEL[g.mode] || 'Game');
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      const tags = variantTag(g.setup || {});
      meta.textContent = [MODE_LABEL[g.mode] || 'Game', g.acts.length + ' moves']
        .concat(tags).join(' \u00b7 ');
      mid.append(who, meta);

      const when = document.createElement('span');
      when.className = 'h-when';
      when.textContent = relativeDay(g.t || g.id);

      row.append(res, mid, when);
      row.addEventListener('click', () => rvOpen(g, 'history'));

      // A button inside a button is invalid HTML and the inner one never receives the
      // click, so the export control is a sibling and the two sit in a wrapper.
      const item = document.createElement('div');
      item.className = 'history-item';
      const exp = document.createElement('button');
      exp.type = 'button';
      exp.className = 'h-export';
      exp.title = 'Export this game';
      exp.setAttribute('aria-label', 'Export this game');
      exp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 20h16"/></svg>';
      exp.addEventListener('click', e => { e.stopPropagation(); exportGame(g); });
      item.append(row, exp);
      list.appendChild(item);
    }
  }

  // ---------- import and export ----------
  //
  // A saved game is already a self-contained record — setup, who opened, any Debris walls,
  // and every action — because that is what review replays from. So the exchange format is
  // that record with a marker around it rather than a second notation to keep in step:
  // anything the review can open, a file can carry.
  //
  // Both directions have to work from file://, which rules out fetch(); a Blob URL for the
  // way out and FileReader for the way in both work with no server.
  const GAME_FILE = { magic: 'detour-game', version: 1 };

  function gameToFile(rec) {
    return JSON.stringify({ ...GAME_FILE, game: rec }, null, 2);
  }

  // Accepts a bare record too. Someone will paste one in, and refusing it on a technicality
  // when it is obviously a game would just be rude.
  function gameFromFile(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('that file is not JSON'); }
    const rec = o && o.game ? o.game : o;
    if (!rec || !Array.isArray(rec.acts) || !rec.acts.length) throw new Error('no moves in that file');
    if (!rec.setup || !rec.setup.rows || !rec.setup.cols) throw new Error('no board in that file');
    for (const a of rec.acts) {
      const okWall = a && a.k === 1 && typeof a.r === 'number' && typeof a.c === 'number' && (a.o === 'h' || a.o === 'v');
      const okMove = a && a.k === 0 && typeof a.r === 'number' && typeof a.c === 'number';
      if (!okWall && !okMove) throw new Error('that file has a move I do not understand');
    }
    return {
      id: rec.id || Date.now(), t: rec.t || Date.now(),
      mode: rec.mode || 'review', diff: rec.diff || null,
      me: rec.me === 1 ? 1 : 0,
      names: Array.isArray(rec.names) && rec.names.length ? rec.names.slice() : null,
      setup: rec.setup, first: rec.first === 1 ? 1 : 0,
      fixed: Array.isArray(rec.fixed) ? rec.fixed : [],
      acts: rec.acts, winner: rec.winner === undefined ? null : rec.winner,
    };
  }

  const gameFileName = rec => {
    const who = (rec.names && rec.names.length === 2) ? rec.names.join('-vs-') : (rec.mode || 'game');
    const when = new Date(rec.t || rec.id || Date.now()).toISOString().slice(0, 10);
    return ('detour-' + who + '-' + when).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) + '.json';
  };

  function exportGame(rec) {
    if (!rec) return toast('nothing to export');
    try {
      const blob = new Blob([gameToFile(rec)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = gameFileName(rec);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // revoking immediately can cancel the download in some browsers, so let it settle
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('game exported');
    } catch (e) { toast('could not export that game'); }
  }

  // The record for the game on screen, built the same way the history one is.
  function currentRecord() {
    if (!M || !M.actions || !M.actions.length) return null;
    const s = M.state;
    return {
      id: Date.now(), t: Date.now(), mode: M.mode, diff: M.difficulty || null, elo: M.elo || null,
      me: M.net ? M.net.myPlayer : (M.mySeat != null ? M.mySeat : 0),
      names: playerNames(),
      setup: {
        rows: s.innerRows || s.rows, cols: s.innerCols || s.cols, players: s.players,
        walls: startingWalls(s), wallLen: s.wallLen,
        race: !!s.race, koth: !!s.koth, inverted: !!s.inverted,
      },
      first: M.firstTurn || 0,
      fixed: (s.fixedWalls || []).map(w => ({ orient: w.orient, r: w.r, c: w.c, len: w.len })),
      acts: M.actions.slice(), winner: s.winner,
    };
  }

  function importGameFile(file, then) {
    if (!file) return;
    const fr = new FileReader();
    fr.onerror = () => toast('could not read that file');
    fr.onload = () => {
      let rec;
      try { rec = gameFromFile(String(fr.result)); }
      catch (e) { return toast(e.message || 'could not read that game'); }
      then(rec);
    };
    fr.readAsText(file);
  }

  // ---------- rewind: an earlier position, without leaving the game ----------
  // The match already records every action from ply 0 and which side opened, which is all a
  // replay needs — so going back in time costs no memory and reuses the same replay the
  // review does. The live position is held aside untouched while you are back there, the
  // board is read-only, and playing or receiving a move brings you straight back to it: you
  // can never lose a game because you were looking at move 12.
  const TB = { ply: null, states: null, live: null };
  const tbActive = () => TB.ply != null;
  // Every game can be read back, online ones included — the same scrubber as the review's,
  // in the same place, doing the same thing. It used to appear only once there was a move to
  // look back at, which cost more than the empty bar did: this flag also drives the game's
  // `scrubbing` class, and that class changes --vert-reserve and --cell, so the first move of
  // every game resized the board under the player's hand. The bar is here from ply 0 instead,
  // reading 0 / 0 with all four buttons disabled, and nothing moves when the game starts.
  function tbAllowed() {
    return !!(M && !RV.on);
  }

  function tbRecord() {
    const s = TB.live || M.state;   // while rewound, M.state is the past one
    return {
      setup: {
        rows: s.innerRows || s.rows, cols: s.innerCols || s.cols,
        players: s.players, walls: startingWalls(s),
        wallLen: s.wallLen, race: !!s.race, koth: !!s.koth, inverted: !!s.inverted,
      },
      fixed: (s.fixedWalls || []).map(w => ({ orient: w.orient, r: w.r, c: w.c, len: w.len })),
      first: M.firstTurn || 0,
      acts: (M.actions || []).slice(),
    };
  }
  function tbStates() {
    if (!TB.states) {
      try { TB.states = replayGame(tbRecord()).states; }
      catch (e) { TB.states = null; }   // a position the replay can't reproduce stays put
    }
    return TB.states;
  }
  function tbGo(i) {
    if (!tbAllowed()) return;
    const states = tbStates();
    if (!states) return;
    const last = states.length - 1;
    const p = Math.max(0, Math.min(last, i));
    if (p === last) return tbLive();          // the end of the list is the live game
    if (TB.live == null) TB.live = M.state;
    TB.ply = p;
    M.state = states[p];
    render();
  }
  function tbLive() {
    if (TB.live == null) { TB.ply = null; return; }
    M.state = TB.live;
    TB.live = null; TB.ply = null;
    render();
  }
  // a new move on either side invalidates the replay and puts you back on the live board
  function tbReset() { TB.states = null; if (TB.live != null) tbLive(); else TB.ply = null; }
  // ...except on the analysis board, where you are both players and there is nothing to
  // protect. A move played from an earlier position is a new line, not a mistake: the moves
  // that came after it are dropped and the game carries on from where you were looking.
  function tbBranch() {
    const p = TB.ply;
    TB.states = null; TB.live = null; TB.ply = null;
    const cut = (a, n) => { if (a && a.length > n) a.length = n; };
    cut(M.actions, p);
    cut(M.history, p);
    // AN.evals[i] reads the position after i moves, so the one at the branch point survives;
    // the move stored at that ply and everything past it does not.
    cut(AN.evals, p + 1);
    cut(AN.snaps, p); cut(AN.acts, p); cut(AN.verdicts, p);
    // a shorter history normally means a different game and wipes the analysis; here the
    // moves up to the branch keep their verdicts, so the shrink is declared rather than found
    AN.lastLen = p;
    if (anLastFanfare >= p) anLastFanfare = -1;
  }
  const tbStep = d => tbGo((TB.ply == null ? (M.actions || []).length : TB.ply) + d);

  function tbAfterRender() {
    const bar = $('#tb-bar');
    if (!bar) return;
    bar.hidden = !tbAllowed();
    if (bar.hidden) return;
    // The bar reads the same live as it does rewound: at the end of the list you are at the
    // latest move, which is what "3 / 3" says. Review counts positions the same way.
    const total = (M.actions || []).length;
    const on = tbActive();
    const at = on ? TB.ply : total;
    $('#tb-count').textContent = at + ' / ' + total;
    $('#tb-first').disabled = $('#tb-prev').disabled = at <= 0;
    $('#tb-next').disabled = $('#tb-last').disabled = at >= total;
    if (on && M.mode !== 'board') {
      statusEl.textContent = 'Looking back \u00b7 move ' + at + ' of ' + total;
      statusEl.classList.add('rewound');
    }
    centreScrubbers();
  }

  // ---------- game review ----------
  // The review reuses the game board rather than building a second one: it swaps M.state
  // for the position at the chosen ply and re-renders, so walls, the board flip for the far
  // seat and the coordinate strips all behave exactly as they do during play.
  //
  // Analysis is progressive. Reviewing a 60-ply game means 60 searches, so they run one per
  // tick with the ply you are actually looking at jumped to the front of the queue — you can
  // start reading the review immediately and the rest fills in behind you.
  const RV = {
    on: false, rec: null,
    states: [], acts: [], hist: [],
    evals: [], verdicts: [],
    ply: 0, pending: false,
    // A line you played out yourself from some position in the game. It hangs off `base` and
    // never touches RV.states, so the game itself is always one click away and never edited.
    branch: null,
    showBest: true, guess: null,
    budget: 340, me: 0, from: 'game',
  };

  const rvTotal = () => RV.acts.length;


  function rvOpenCurrent() {
    tbLive();
    if (!M || !M.actions || !M.actions.length) return toast('nothing to review yet');
    const s = M.state;
    rvOpen({
      id: Date.now(), t: Date.now(), mode: M.mode, diff: M.difficulty || null, elo: M.elo || null,
      me: M.net ? M.net.myPlayer : 0, names: playerNames(),
      setup: {
        rows: s.innerRows || s.rows, cols: s.innerCols || s.cols, players: s.players,
        walls: startingWalls(s), wallLen: s.wallLen,
        race: !!s.race, koth: !!s.koth, inverted: !!s.inverted,
      },
      first: M.firstTurn || 0,
      fixed: (s.fixedWalls || []).map(w => ({ orient: w.orient, r: w.r, c: w.c, len: w.len })),
      acts: M.actions.slice(), winner: s.winner,
    });
  }

  function rvOpen(rec, from) {
    let built;
    try { built = replayGame(rec); }
    catch (e) { return toast('could not replay that game'); }
    stopClock();
    closeOverlay('overlay');
    RV.on = true; RV.rec = rec;
    RV.states = built.states; RV.acts = built.acts; RV.hist = built.hist;
    RV.evals = []; RV.verdicts = [];
    RV.ply = 0; RV.pending = false; RV.showBest = true; RV.guess = null;
    RV.me = rec.me || 0;
    RV.from = from || 'game';
    AN.on = false;
    M = {
      state: built.states[0], mode: rec.mode || 'review', difficulty: rec.diff, elo: rec.elo || null,
      human: [false, false, false, false], orient: 'h', net: null,
      settings: mySettings(), clock: null,
      history: built.hist, actions: rec.acts.slice(),
      review: true, reviewMe: RV.me,
      // A replayed game has no live opponent to ask, so the names have to come out of the
      // record. Without them nameOf() falls through to the bot branch and reads a
      // difficulty that an online game never had — which threw half way through the first
      // render and left the review with no panel, no arrows, and the previous game's board.
      names: (rec.names && rec.names.length) ? rec.names.slice() : null,
    };
    drag = null; armed = false;
    setControls();
    showScreen('game');
    render();
  }

  function rvClose() {
    RV.on = false; RV.rec = null; RV.states = []; RV.acts = []; RV.hist = [];
    RV.evals = []; RV.verdicts = []; RV.guess = null;
    if (M) M.review = false;
  }

  function rvGo(ply) {
    if (!RV.on) return;
    const p = Math.max(0, Math.min(RV.states.length - 1, ply));
    if (p === RV.ply && !RV.guess && !RV.branch) return;
    RV.ply = p;
    RV.guess = null;
    RV.branch = null;        // stepping along the game is leaving your own line
    M.state = RV.states[p];
    render();
  }

  // Play a move from wherever you are looking. The first one opens a branch off that ply; the
  // rest extend it. Nothing here writes to RV.states, so "back to the game" is just dropping
  // the branch -- there is no undo to get wrong.
  function rvBranchPlay(action) {
    const from = RV.branch ? RV.branch.states[RV.branch.states.length - 1] : RV.states[RV.ply];
    if (!from || from.winner !== null) return;
    const actor = from.turn;
    const legal = action.type === 'wall'
      ? R.canPlaceWall(from, actor, action.orient, action.r, action.c)
      : R.legalMoves(from, actor).some(m => m.r === action.to.r && m.c === action.to.c);
    if (!legal) return;
    const next = R.cloneState(from);
    const he = histEntry(next, action, actor);
    if (action.type === 'wall') R.applyWall(next, action.orient, action.r, action.c);
    else R.applyMove(next, action.to);
    markWin(he, next);
    he.branch = true;
    if (!RV.branch) RV.branch = { base: RV.ply, states: [from], hist: [] };
    RV.branch.states.push(next);
    RV.branch.hist.push(he);
    M.state = next;
    if (window.Sfx) window.Sfx.play(action.type === 'wall' ? 'wall' : 'move');
    render();
  }
  function rvBackToGame() {
    if (!RV.branch) return;
    RV.branch = null;
    M.state = RV.states[RV.ply];
    render();
  }
  const rvExploring = () => !!(RV.on && RV.branch);

  // analyse the ply on screen first, then backfill the rest from the start of the game
  function rvPump() {
    if (!RV.on || RV.pending) return;
    if (!anEngine() || !anEngine().supports(RV.states[0])) return;
    let target = -1;
    if (!RV.evals[RV.ply]) target = RV.ply;
    else for (let i = 0; i < RV.states.length; i++) if (!RV.evals[i]) { target = i; break; }
    if (target < 0) return;
    RV.pending = true;
    setTimeout(() => {
      const done = () => {
        RV.pending = false;
        if (!RV.on) return;
        if (target === RV.ply) render();          // redraws the board overlays too
        else { rvPanel(); renderMoves(); rvPump(); }
      };
      const st = RV.states[target];
      if (!st || st.winner !== null) { RV.evals[target] = AN_NONE; return done(); }
      anRun(st, Brain.budget(RV.budget, RV.budget * 3)).then(ev => {
        RV.evals[target] = ev;
        if (ev && !ev.none && RV.acts[target]) RV.verdicts[target] = anClassify(ev, RV.acts[target]);
      }, () => { RV.evals[target] = AN_NONE; }).then(done);
    }, 16);
  }

  function rvAfterRender() {
    $('#rotate-btn').hidden = true;
    $('#rotate-btn-top').hidden = true;
    $('#analysis').hidden = true;
    $('#review-panel').hidden = false;
    $('#rv-nav').hidden = false;
    $('#match-actions').hidden = false;     // it now carries review's export and import
    // On a line of your own the board is drained and the way back appears. The eval bar and the
    // verdicts describe the GAME at this ply, so on a branch they would be describing a position
    // that is no longer on the board: they stand down rather than lie.
    const off = rvExploring();
    $('#game').classList.toggle('exploring', off);
    $('#rv-back-game').hidden = !off;
    $('#rotate-btn').hidden = !off || matchRandomOrient();   // placing walls again needs it back
    $('#evalbar').hidden = off;
    // Review brings its own scrubber; the in-game rewind bar must not sit beside it.
    const tb = $('#tb-bar'); if (tb) tb.hidden = true;
    syncEvalClass();      // resizes the board — must land before anything reads its geometry

    const i = RV.ply, ev = RV.evals[i];
    const live = ev && !ev.none ? ev : null;

    if (RV.guess) {
      // the one place a second move is drawn: your own guess, marked right or wrong
      if (RV.guess.last) {
        const el = drawAction(M.state, RV.guess.last, M.state.turn, 'played');
        if (el) el.style.setProperty('--vc', RV.guess.result === 'right' || RV.guess.result === 'close'
          ? 'var(--good)' : 'var(--danger)');
      }
      if (RV.guess.done && live && live.bestAction) drawAction(M.state, live.bestAction, live.turn, 'best');
    } else if (RV.showBest && live && live.bestAction) {
      // Only Path's move is ever drawn, always green. The move that was played is already
      // on the board in front of you — the pawn has moved, the wall is standing — so drawing
      // it again only competed with the one thing you opened review to see.
      drawAction(M.state, live.bestAction, live.turn, 'best');
    }
    // and how good the move that led here was, marked on the move itself
    if (RV.ply > 0) {
      const vd = RV.verdicts[RV.ply - 1];
      if (vd) drawVerdictMark(RV.acts[RV.ply - 1], vd.key);
    }
    rvPanel();
    centreScrubbers();   // after the counter's text, which is what sets the bar's width
    rvPump();
  }

  function rvPanel() {
    const total = rvTotal();
    const cnt = $('#rv-count');
    if (cnt) cnt.textContent = RV.ply + ' / ' + total;
    $('#rv-first').disabled = RV.ply === 0;
    $('#rv-prev').disabled = RV.ply === 0;
    $('#rv-next').disabled = RV.ply >= total;
    $('#rv-last').disabled = RV.ply >= total;

    let analysed = 0;
    for (let i = 0; i < RV.states.length; i++) if (RV.evals[i]) analysed++;
    const supported = anEngine() && anEngine().supports(RV.states[0]);
    $('#rv-progress').textContent = !supported ? 'engine n/a for this variant'
      : analysed >= RV.states.length ? 'review complete'
      : 'analysing ' + Math.round(analysed / RV.states.length * 100) + '%';
    $('#rv-show').classList.toggle('on', RV.showBest);
    $('#rv-guess').classList.toggle('on', !!RV.guess);
    $('#rv-show').disabled = !supported;
    $('#rv-guess').disabled = !supported;

    rvEvalBar();
    rvVerdictBox();
    rvAccuracy();
    rvGraph();
  }

  // The bar's label when the result is proven. "WIN" alone left the one thing you actually
  // want to know off the screen — how long it takes — so it carries the distance: W5 is a
  // win in five moves, L5 a loss in five. Falls back to the bare word when the engine has
  // proved the result without pinning the length, which happens outside a solved ending.
  function provenLabel(E, ev, winning) {
    const n = ev.solved && ev.dist > 0 ? ev.dist : E.winDistance(ev.score);
    const tag = winning ? 'W' : 'L';
    return n ? tag + n : (winning ? 'WIN' : 'LOSS');
  }

  function rvEvalBar() {
    const bar = $('#evalbar'), fill = $('#evalbar-fill'), num = $('#evalbar-num');
    const ev = RV.evals[RV.ply];
    if (!ev || ev.none) {
      const w = M.state.winner;
      const p = w === RV.me ? 1 : w === null ? 0.5 : 0;
      fill.style.height = (p * 100) + '%';
      num.textContent = w === null ? '—' : (w === RV.me ? 'WIN' : 'LOSS');
      return;
    }
    const E = anEngine();
    const wpTurn = E.evalToWinProb(ev.score);
    const wp = ev.turn === RV.me ? wpTurn : 1 - wpTurn;
    fill.style.height = (wp * 100).toFixed(1) + '%';
    bar.classList.toggle('proven', !!ev.proven);
    num.textContent = ev.proven ? provenLabel(E, ev, wp > 0.5) : Math.round(wp * 100) + '%';
  }

  function rvVerdictBox() {
    const box = $('#rv-verdict');
    if (RV.guess) {
      box.hidden = false;
      const g = RV.guess;
      const key = g.result === 'right' ? 'best' : g.result === 'close' ? 'excellent'
        : g.result === 'illegal' ? 'mistake' : 'blunder';
      box.style.setProperty('--vc', 'var(--v-' + key + ')');
      const msg = !g.result ? 'Your move — play what you think is best.'
        : g.result === 'right' ? 'Correct. That is the engine\u2019s first choice.'
        : g.result === 'close' ? 'Good enough — within a hair of best.'
        : g.result === 'illegal' ? 'That move is not available here.'
        : 'Not this one: it gives up ' + Math.round(g.loss * 100) + '% win chance.';
      box.innerHTML = '';
      const t = document.createElement('span'); t.className = 'vd-name';
      t.textContent = g.result ? (g.result === 'right' ? 'Best move' : g.result === 'close' ? 'Close enough'
        : g.result === 'illegal' ? 'Not legal' : 'Try again') : 'Your turn';
      const n = document.createElement('span'); n.className = 'vd-note'; n.textContent = msg;
      box.append(t, n);
      return;
    }
    // The move that was just played, not the one about to be. RV.ply indexes POSITIONS, so
    // the move that produced the position on screen is RV.ply - 1. The board mark has always
    // used that; the panel used RV.ply, so the two described different moves, and the last
    // move of a game never got a verdict at all because no position follows it.
    const i = RV.ply - 1;
    const vd = RV.verdicts[i];
    const act = RV.acts[i];
    // Nothing has been played at the starting position, so there is genuinely nothing to
    // say. Anywhere else, a move with no verdict gets told apart from a move still being
    // looked at — silently hiding the box made "analysis has not reached this yet" and
    // "this move could not be rated" look identical, which is not something you can report
    // a bug about.
    if (i < 0 || !act) { box.hidden = true; return; }
    if (!vd) {
      box.hidden = false;
      box.style.setProperty('--vc', 'var(--muted)');
      box.innerHTML = '';
      const nm = document.createElement('span'); nm.className = 'vd-name';
      const nt = document.createElement('span'); nt.className = 'vd-note';
      const ev = RV.evals[i];
      if (!ev) { nm.textContent = 'Analysing\u2026'; nt.textContent = 'this move has not been looked at yet'; }
      else if (ev.none) { nm.textContent = 'Not analysed'; nt.textContent = 'the engine does not handle this position'; }
      else { nm.textContent = 'Unrated'; nt.textContent = 'the engine could not put a number on this move'; }
      box.append(nm, nt);
      return;
    }
    box.hidden = false;
    const info = VERDICT[vd.key];
    box.style.setProperty('--vc', 'var(--v-' + vd.key + ')');
    box.innerHTML = '';
    const who = document.createElement('span'); who.className = 'vd-note';
    who.textContent = (RV.rec.names && RV.rec.names[vd.player] ? RV.rec.names[vd.player] : 'Player ' + (vd.player + 1)) + ':';
    const nm = document.createElement('span'); nm.className = 'vd-name'; nm.textContent = info.name;
    const nt = document.createElement('span'); nt.className = 'vd-note';
    nt.textContent = (vd.key === 'best' || vd.key === 'book' || vd.key === 'brilliant')
      ? info.note : '\u2212' + Math.round(vd.loss * 100) + '% win chance';
    box.append(who, nm, nt);
  }

  function rvAccuracy() {
    const el = $('#rv-acc');
    const acc = [[], []];
    for (let i = 0; i < RV.verdicts.length; i++) {
      const v = RV.verdicts[i];
      if (v && v.player < 2) acc[v.player].push(anAccuracy(v.loss));
    }
    if (!acc[0].length || !acc[1].length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '';
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    for (const seat of [RV.me, 1 - RV.me]) {
      const sp = document.createElement('span');
      sp.className = 'rv-acc-item' + (seat === RV.me ? ' me' : '');
      const nm = (RV.rec.names && RV.rec.names[seat]) || ('Player ' + (seat + 1));
      sp.innerHTML = '<i></i>' + nm + ' <b>' + mean(acc[seat]).toFixed(0) + '%</b>';
      el.appendChild(sp);
    }
  }

  // win probability for the reviewing player, plotted across the whole game
  function rvGraph() {
    const cv = $('#rv-graph');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 520, h = cv.clientHeight || 96;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const meCol = css.getPropertyValue('--me').trim() || '#e3a83c';
    const oppCol = css.getPropertyValue('--opp').trim() || '#6e9bc9';
    const line = css.getPropertyValue('--line').trim() || '#413b35';
    const E = anEngine();
    const n = RV.states.length;
    const pts = [];
    let last = 0.5;
    for (let i = 0; i < n; i++) {
      const ev = RV.evals[i];
      if (ev && !ev.none && E) {
        const wpTurn = E.evalToWinProb(ev.score);
        last = ev.turn === RV.me ? wpTurn : 1 - wpTurn;
      } else if (i === n - 1) {
        const win = RV.rec ? RV.rec.winner : null;
        if (win === RV.me) last = 1; else if (win != null && win !== 'draw') last = 0;
      }
      pts.push(last);
    }
    const x = i => (n <= 1 ? 0 : i / (n - 1)) * w;
    const y = p => h - p * h;

    g.fillStyle = oppCol; g.globalAlpha = 0.16; g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.beginPath(); g.moveTo(0, h);
    for (let i = 0; i < n; i++) g.lineTo(x(i), y(pts[i]));
    g.lineTo(w, h); g.closePath();
    g.fillStyle = meCol; g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1;

    g.beginPath();
    for (let i = 0; i < n; i++) (i ? g.lineTo(x(i), y(pts[i])) : g.moveTo(x(i), y(pts[i])));
    g.strokeStyle = meCol; g.lineWidth = 1.6; g.stroke();

    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2);
    g.strokeStyle = line; g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);

    // where we are now
    const px = x(RV.ply);
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h);
    g.strokeStyle = css.getPropertyValue('--text').trim() || '#f0ebe4';
    g.globalAlpha = 0.55; g.lineWidth = 1.4; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); g.arc(px, y(pts[RV.ply] == null ? 0.5 : pts[RV.ply]), 3.2, 0, Math.PI * 2);
    g.fillStyle = css.getPropertyValue('--text').trim() || '#f0ebe4'; g.fill();

    // blunders get a tick, so the graph doubles as a table of contents
    for (let i = 0; i < RV.verdicts.length; i++) {
      const v = RV.verdicts[i];
      if (!v || (v.key !== 'blunder' && v.key !== 'mistake' && v.key !== 'miss')) continue;
      g.beginPath(); g.arc(x(i), y(pts[i] == null ? 0.5 : pts[i]), 2.6, 0, Math.PI * 2);
      g.fillStyle = css.getPropertyValue('--v-' + v.key).trim() || '#cc5b45';
      g.fill();
    }
  }

  // ---- find the best move yourself ----
  function rvGuessToggle() {
    if (!RV.on) return;
    RV.guess = RV.guess ? null : { tries: 0, done: false, last: null, result: null };
    render();
  }

  function rvGuessSubmit(action) {
    const ev = RV.evals[RV.ply];
    if (!ev || ev.none) return toast('still analysing this position');
    const E = anEngine();
    const mv = E.fromAction({ cols: ev.cols, JW: ev.cols - 1 }, action);
    RV.guess.last = action;
    RV.guess.tries++;
    const score = mv === ev.best ? null : anScoreOf(ev, mv);
    if (mv === ev.best) { RV.guess.result = 'right'; RV.guess.done = true; }
    else if (score != null) {
      const loss = Math.max(0, E.evalToWinProb(ev.score) - E.evalToWinProb(score));
      RV.guess.loss = loss;
      RV.guess.result = loss < 0.02 ? 'close' : 'wrong';
      if (RV.guess.result === 'close') RV.guess.done = true;
    } else RV.guess.result = 'illegal';
    render();
  }

  // ---------- game history ----------
  // Every finished local game is kept so it can be replayed and reviewed later. Only what
  // is needed to rebuild the game from scratch is stored — the setup, the Debris walls if
  // any (they are rolled at random, so they cannot be regenerated), and the list of moves.
  const GAMES_KEY = 'detour_games';
  const GAMES_MAX = 40;

  function loadGames() {
    try {
      const raw = localStorage.getItem(GAMES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function saveGames(list) {
    try { localStorage.setItem(GAMES_KEY, JSON.stringify(list.slice(0, GAMES_MAX))); } catch (e) {}
  }
  function clearGames() { try { localStorage.removeItem(GAMES_KEY); } catch (e) {} }

  function recordGame(winner) {
    if (!M || !M.actions || M.actions.length < 2) return;
    if (M.mode === 'board') return;     // a position you set up to study is not a game played
    if (M.recorded) return;             // one game, one entry, however many endings call this
    M.recorded = true;
    const s = M.state;
    const rec = {
      id: Date.now(),
      t: Date.now(),
      mode: M.mode,
      diff: M.difficulty || null,
      elo: M.elo || null,          // which level Path was playing at, so review names it correctly
      me: M.net ? M.net.myPlayer : (M.mySeat != null ? M.mySeat : 0),
      names: playerNames(),
      setup: {
        rows: s.innerRows || s.rows, cols: s.innerCols || s.cols,
        players: s.players, walls: startingWalls(s),
        wallLen: s.wallLen, race: !!s.race, koth: !!s.koth, inverted: !!s.inverted,
      },
      first: M.firstTurn || 0,
      fixed: (s.fixedWalls || []).map(w => ({ orient: w.orient, r: w.r, c: w.c, len: w.len })),
      acts: M.actions.slice(),
      winner,
    };
    const list = loadGames();
    list.unshift(rec);
    saveGames(list);
  }

  // how many walls each player began with — what they still hold plus what they placed
  function startingWalls(s) {
    let placed = 0;
    for (const k in s.wallBy) if (s.wallBy[k] === 0) placed++;
    return s.walls[0] + placed;
  }

  function playerNames() {
    const s = M.state;
    if (s.players === 4) return [0, 1, 2, 3].map(i => playerLabel(i));
    if (M.mode === 'bot') {
      if (M.difficulty === 'hard') return ['You', 'Path (' + (M.elo || (window.Engine && window.Engine.ELO_MAX) || 3200) + ')'];
      return ['You', 'Bot (' + (M.difficulty || 'hard') + ')'];
    }
    if (M.mode === 'local') return ['Player 1', 'Player 2'];
    if (M.net && M.net.spectator) return (M.names || ['Player 1', 'Player 2']).slice();
    if (M.net) return M.net.myPlayer === 0 ? ['You', netPeerName || 'Opponent'] : [netPeerName || 'Opponent', 'You'];
    return ['Player 1', 'Player 2'];
  }

  // rebuild a stored game into the list of positions it passed through
  function replayGame(rec) {
    const st = R.createState({
      rows: rec.setup.rows, cols: rec.setup.cols, players: rec.setup.players,
      walls: rec.setup.walls, wallLen: rec.setup.wallLen,
      race: rec.setup.race, koth: rec.setup.koth, inverted: rec.setup.inverted,
    });
    if (rec.fixed && rec.fixed.length) R.setFixedWalls(st, rec.fixed);
    st.turn = rec.first || 0;   // games open with a random side; replaying from 0 corrupts everything
    const states = [st], acts = [], hist = [];
    let cur = st;
    for (const a of rec.acts) {
      const action = a.k === 1
        ? { type: 'wall', orient: a.o, r: a.r, c: a.c }
        : { type: 'move', to: { r: a.r, c: a.c } };
      const ok = action.type === 'wall'
        ? R.canPlaceWall(cur, cur.turn, action.orient, action.r, action.c)
        : R.legalMoves(cur, cur.turn).some(m => m.r === action.to.r && m.c === action.to.c);
      if (!ok) throw new Error('replay diverged at ply ' + acts.length);
      const rhe = histEntry(cur, action, cur.turn);
      hist.push(rhe);
      acts.push(action);
      const next = R.cloneState(cur);
      if (action.type === 'wall') R.applyWall(next, action.orient, action.r, action.c);
      else R.applyMove(next, action.to);
      markWin(rhe, next);        // a replayed game must read exactly like the game did
      states.push(next);
      cur = next;
    }
    hist.forEach((h, i) => { h.idx = i; });
    return { states, acts, hist };
  }

  // ---------- engine analysis ----------
  // engine.js only knows the standard game, so the panel offers itself where it applies and
  // stays hidden everywhere else. It never runs during a net game — showing one player the
  // best move mid-match is just cheating.
  //
  // The search runs on the main thread, one position per tick behind a setTimeout, so the
  // board always paints before the engine thinks and the page never locks up. Positions are
  // snapshotted as they go by, which means a move played faster than the engine can answer
  // still gets its verdict a moment later instead of being lost.
  // ---------- setting a position up on the analysis board ----------
  //
  // Reaching a position by playing it out is right for a game and wrong for study: the position
  // you want to look at is usually one nobody would play into, and walking there move by move
  // means inventing a plausible game first. In setup the board stops being a game. Pawns go
  // anywhere, walls go on and come off either side's pile, and whose turn it is is a choice.
  //
  // Three rules survive, because they are the ones that decide whether a position can be
  // analysed at all rather than whether it is any good: no two pawns on a square, no wall
  // crossing or overlapping another, and both players keeping a route home. Everything else --
  // a pawn parked on its own back rank, nine walls spent by one side and none by the other --
  // is a position you are allowed to ask about.
  const SU = { on: false, pick: null, wasAnalysing: false };

  const suOn = () => SU.on && !!M && M.mode === 'board';
  const suMax = () => (M && M.wallMax != null) ? M.wallMax : 10;

  function suToggle(on) {
    if (!M || M.mode !== 'board' || RV.on) return;
    const next = on == null ? !SU.on : !!on;
    if (next === SU.on) return;
    SU.on = next; SU.pick = null;
    if (SU.on) {
      // Path is paused rather than left running: it would restart on every pawn you nudge, and
      // the number it printed would be about a board you are halfway through building.
      SU.wasAnalysing = AN.on; AN.on = false;
      armed = false; drag = null;
    } else {
      AN.on = SU.wasAnalysing && !!anEngine() && anEngine().supports(M.state);
      anReset();
    }
    setControls();
    render();
  }

  // Any edit makes the move list a description of a game that did not happen, so it goes. The
  // position stays; the story of how it was reached does not.
  function suTouched() {
    M.actions = []; M.history = []; M.firstTurn = undefined;
    TB.ply = null; TB.states = null; TB.live = null;
    M.state.winner = null;
    anReset();
  }

  // A pawn standing on its own goal is a game already won, not a position to study.
  function suOnGoal(s, i, r, c) {
    const g = s.goals[i];
    if (!g) return false;
    if (g.cell) return r === g.cell.r && c === g.cell.c;
    return (g.axis === 'r' ? r : c) === g.at;
  }

  function suPlacePawn(i, r, c) {
    const s = M.state;
    if (R.isHole(s, r, c)) return sfx('illegal');
    if (s.pawns.some((p, k) => k !== i && p.r === r && p.c === c)) return sfx('illegal');
    if (suOnGoal(s, i, r, c)) return sfx('illegal');
    const was = s.pawns[i];
    if (was.r === r && was.c === c) { render(); return; }
    s.pawns[i] = { r, c };
    // The walls that were fine a moment ago may shut this pawn in from where it now stands.
    if (!s.pawns.every((_, k) => R.hasPath(s, k))) { s.pawns[i] = was; return sfx('illegal'); }
    suTouched(); sfx('move'); render();
  }

  function suPlaceWall(orient, r, c, owner) {
    const s = M.state;
    // canPlaceWall is the same test the game uses, including "this side still has one to spend"
    // and "neither player is shut out" -- there is no reason for setup to be more permissive
    // about the things that would make the position unplayable.
    if (!R.canPlaceWall(s, owner, orient, r, c)) return sfx('illegal');
    const k = r + ',' + c;
    (orient === 'h' ? s.hWalls : s.vWalls).add(k);
    s.wallBy[orient + k] = owner;
    s.walls[owner] -= 1;
    suTouched(); sfx('wall'); render();
  }

  function suRemoveWall(orient, r, c) {
    const s = M.state, k = r + ',' + c;
    const set = orient === 'h' ? s.hWalls : s.vWalls;
    if (!set.has(k)) return;
    set.delete(k);
    const owner = s.wallBy[orient + k];
    if (owner != null && s.walls[owner] != null) s.walls[owner] = Math.min(s.walls[owner] + 1, suMax());
    delete s.wallBy[orient + k];
    suTouched(); sfx('wall'); render();
  }

  function suClear() {
    const s = M.state;
    s.hWalls.clear(); s.vWalls.clear(); s.wallBy = {};
    s.walls = s.pawns.map(() => suMax());
    suTouched(); sfx('wall'); render();
  }

  function suSetTurn(t) {
    if (M.state.turn === t) return;
    M.state.turn = t;
    suTouched(); render();
  }

  // The count in hand is not implied by the board: a side can have spent walls that were later
  // taken off again, and "both down to three" is a position worth asking about. It cannot go
  // below zero, and it cannot go above the pile it started with.
  function suNudgeWalls(i, d) {
    const s = M.state;
    const next = Math.max(0, Math.min(suMax(), s.walls[i] + d));
    if (next === s.walls[i]) return sfx('illegal');
    s.walls[i] = next;
    suTouched(); render();
  }

  function suPaint() {
    const box = $('#setup-panel');
    if (!box) return;
    box.hidden = !suOn();
    if (box.hidden) return;
    const s = M.state;
    const placed = s.hWalls.size + s.vWalls.size;
    $('#setup-count').textContent = placed + (placed === 1 ? ' wall' : ' walls');
    const seg = $('#setup-turn');
    seg.innerHTML = '';
    s.pawns.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'setup-pill ' + (M.state.players === 4 ? 'p' + i : (i === meIndex() ? 'mine' : 'opp')) + (s.turn === i ? ' on' : '');
      b.textContent = nameOf(i);
      b.addEventListener('click', () => suSetTurn(i));
      seg.appendChild(b);
    });
    const hands = $('#setup-hands');
    hands.innerHTML = '';
    s.pawns.forEach((_, i) => {
      const row = document.createElement('div');
      row.className = 'setup-hand';
      const dot = document.createElement('span');
      dot.className = 'setup-dot ' + (M.state.players === 4 ? 'p' + i : (i === meIndex() ? 'mine' : 'opp'));
      const num = document.createElement('span');
      num.className = 'setup-num'; num.textContent = s.walls[i];
      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'setup-step'; minus.textContent = '\u2212';
      minus.setAttribute('aria-label', 'One wall fewer for ' + nameOf(i));
      minus.addEventListener('click', () => suNudgeWalls(i, -1));
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'setup-step'; plus.textContent = '+';
      plus.setAttribute('aria-label', 'One wall more for ' + nameOf(i));
      plus.addEventListener('click', () => suNudgeWalls(i, 1));
      row.append(dot, num, minus, plus);
      hands.appendChild(row);
    });
  }

  const AN = {
    on: false, showBest: true, pending: false,
    budget: 420,
    evals: [], snaps: [], acts: [], verdicts: [],
    lastLen: 0, lastSig: '',
  };

  const VERDICT = {
    brilliant:  { name: 'Brilliant',  tag: '!!', note: 'this turned the game around' },
    best:       { name: 'Best move',  tag: '\u2605', note: 'the engine agrees' },
    excellent:  { name: 'Excellent',  tag: '!',  note: 'as good as makes no difference' },
    good:       { name: 'Good',       tag: '\u00b7', note: 'solid' },
    book:       { name: 'Book move',  tag: 'B',  note: 'known opening' },
    inaccuracy: { name: 'Inaccuracy', tag: '?!', note: 'there was better' },
    mistake:    { name: 'Mistake',    tag: '?',  note: 'this gives real ground away' },
    blunder:    { name: 'Blunder',    tag: '??', note: 'this may lose the game' },
    miss:       { name: 'Missed win', tag: '\u00d7', note: 'a forced win was there' },
  };

  const anEngine = () => window.Engine;
  // Where Path may be offered at all. This used to be written out three times -- in setControls,
  // in anAfterRender and here -- and the three did not agree. setControls checked supports() and
  // the other two did not, and since anAfterRender runs on EVERY render it always had the last
  // word: that is how the button turned up in a four-player online game, which setControls had
  // correctly refused. The list of live-opponent modes was also short by one; p4net was missing
  // from every copy.
  const anOffered = () => {
    if (!M || !M.state || !anEngine()) return false;
    if (!anEngine().supports(M.state)) return false;
    if (trollMode) return true;                       // /troll unlocks it deliberately
    return !M.net && M.mode !== 'otour' && M.mode !== 'p4net';
  };
  const anSupported = () => anOffered();
  const anSig = () => (M && M.state ? M.mode + ':' + M.state.rows + 'x' + M.state.cols : '');
  // The ply the panel, the eval bar and the hint all describe: the position on screen. On
  // the analysis board that is not always the end of the move list, because looking back
  // there leaves a playable position rather than a replay.
  const anPly = () => (tbActive() ? TB.ply : currentHistory().length);

  function anReset() {
    AN.evals = []; AN.snaps = []; AN.acts = []; AN.verdicts = [];
    AN.pending = false; AN.lastLen = 0;
  }

  // Record the position before every move, whether or not the panel is open, so switching
  // analysis on halfway through a game can still rate the moves already played.
  function anBeforeAction(s, action) {
    if (!anEngine() || !anEngine().supports(s)) return;
    const i = currentHistory().length;
    AN.snaps[i] = serState(s);
    AN.acts[i] = action;
  }

  // moves arrive as [move, score] pairs: that is what survives a trip through a worker, and
  // it is cheaper to rebuild from than a Map is to clone
  function anSecond(moves, best) {
    let s = null, m = null;
    for (const [mv, sc] of moves) if (mv !== best && (s === null || sc > s)) { s = sc; m = mv; }
    return { score: s, move: m };
  }

  // One engine search, returning everything the UI needs about a position at once: the best
  // move, and the true value of EVERY legal move so a played move can be scored exactly.
  // That is what exactRoot buys — without it every move but the best comes back as a bound.
  // Answers with a promise: the search may be running on another thread. Off the main thread
  // it gets several times the budget, because the only thing capping it there was how long
  // the page may stop responding.
  function anRun(state, budget) {
    // rootAll pour la meme raison que le bot, et une de plus ici: ce panneau met une note sur le
    // coup joue, et un coup que la recherche n'a jamais regarde n'a pas de note a comparer.
    return Brain.analyse(state, { budgetMs: budget, maxDepth: 24, exactRoot: true, rootAll: true }).then(r => {
      const byMove = new Map();
      for (const [mv, sc] of r.moves) byMove.set(mv, sc);
      const sec = anSecond(r.moves, r.best);
      return {
        score: r.score, turn: state.turn, best: r.best,
        bestAction: r.bestAction,
        depth: r.depth, nodes: r.nodes, proven: r.proven,
        // the ending was looked up rather than searched: the value is exact and so is the
        // number of moves it takes
        solved: !!r.tablebase, dist: r.dist,
        byMove, second: sec.score, secondMove: sec.move,
        // kept so a move the search never generated can still be scored on demand — see
        // anScoreOf(). A copy, not the live state: M.state is mutated as the game goes on.
        snap: R.serState(state),
        cols: state.cols, rows: state.rows,
        hash: r.hashLo + ':' + r.hashHi,
      };
    });
  }

  // The value of one move, whether or not the search had it in its root list.
  //
  // The engine's move generator is a CANDIDATE generator: it deliberately skips walls that
  // cross neither player's shortest route, touch no wall already down and sit near neither
  // pawn, because searching them wins no strength. Rating is the one job where that hurts —
  // players do play those walls, and a move the search never looked at has no score, so it
  // came back with no rating at all and guessing it was reported as "illegal". Widening the
  // root to every legal move costs a full ply of depth on every position; searching the one
  // move being asked about costs about a sixtieth of the position. So it is done here, and
  // to the same depth the original search reached, or the two values would not compare.
  function anScoreOf(ev, mv) {
    if (ev.byMove.has(mv)) return ev.byMove.get(mv);
    let v = null;
    try {
      const E = anEngine();
      v = E.scoreMove(E.fromRules(deState(ev.snap)), mv, ev.depth, { budgetMs: 300 });
    } catch (e) { v = null; }
    ev.byMove.set(mv, v);      // a miss is cached too, so a timeout is not retried forever
    return v;
  }

  const anBook = (hash, mv) => {
    const b = window.OpeningBook;
    return !!(b && b[hash] && b[hash].indexOf(mv) >= 0);
  };

  // Moves are graded on how much WIN PROBABILITY they give up, not on raw score: losing
  // half a step matters enormously in a close race and not at all in a decided one.
  function anClassify(ev, action) {
    const E = anEngine();
    const mv = E.fromAction({ cols: ev.cols, JW: ev.cols - 1 }, action);
    const played = anScoreOf(ev, mv);
    if (played == null) return null;
    const wpBest = E.evalToWinProb(ev.score);
    const wpPlay = E.evalToWinProb(played);
    const loss = Math.max(0, wpBest - wpPlay);

    let key;
    if (anBook(ev.hash, mv)) key = 'book';
    else if (mv === ev.best) {
      // "Brilliant" is a move that turns the game over: play anything else here and you
      // come out behind, play this and you come out ahead. Two things about how that is
      // measured were decided by counting rather than taste.
      //
      // It is measured in SCORE, not win probability. Win probability was the obvious
      // choice and it does not work: in a position the engine has not already decided, the
      // probabilities crowd around 50%, so a ±5% band fired 22 times in 667 moves and a
      // ±10% band fired once. Score is the unit the game is actually played in — 100 is one
      // step of path — and the same sweep falls off smoothly, which is what lets a
      // threshold be chosen at all. BRILLIANT is 0.8 of a step each way, a swing of more
      // than a step and a half, which lands at about one move in ninety.
      //
      // And it has to be a move the engine had to FIND. In a race it has already counted
      // out, every step on the shortest path wins and every other move loses, so any test
      // like this fires on each step in turn — three times inside five plies in one measured
      // game. Those are forced, not brilliant, so a decided position cannot produce one.
      const REVERSAL = 80;
      const reverses = !ev.proven && !ev.solved
        && ev.second != null && ev.second <= -REVERSAL && played >= REVERSAL;
      key = reverses ? 'brilliant' : 'best';
    } else if (ev.proven && ev.score > 0 && played < E.PROVEN) key = 'miss';
    else if (loss < 0.02) key = 'excellent';
    else if (loss < 0.05) key = 'good';
    else if (loss < 0.10) key = 'inaccuracy';
    else if (loss < 0.20) key = 'mistake';
    else key = 'blunder';
    return { key, loss, player: ev.turn };
  }

  const anAccuracy = lossFrac => {
    const l = Math.max(0, Math.min(1, lossFrac)) * 100;
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l) - 3.1669));
  };

  // A brilliant move is worth hearing about while you are playing, not only when you review
  // afterwards. With Path open the verdict is already being computed, so this costs nothing.
  // With Path closed nothing is being searched at all, so it runs one short search of the
  // position the move was played from — deferred, so it never delays the move appearing, and
  // thrown away rather than stored, because a 200ms verdict must not become the one the
  // panel shows later. Skipped entirely when sound is off, which is the only reason to look.
  let anLastFanfare = -1;
  function anWatchBrilliant(i) {
    if (RV.on || tbActive()) return;
    if (i < 0 || i === anLastFanfare) return;
    if (!AN.acts[i] || !AN.snaps[i]) return;
    if (!window.Sfx || LOOK.sound === 'off') return;
    if (!anEngine()) return;
    const fire = vd => {
      if (!vd || vd.key !== 'brilliant') return;
      anLastFanfare = i;
      sfx('brilliant');
    };
    if (AN.verdicts[i]) return fire(AN.verdicts[i]);
    if (AN.evals[i] && !AN.evals[i].none) return fire(anClassify(AN.evals[i], AN.acts[i]));
    setTimeout(() => {
      if (RV.on || tbActive()) return;
      try {
        const st = deState(AN.snaps[i]);
        if (!st || st.winner !== null || !anEngine().supports(st)) return;
        anRun(st, 220).then(ev => fire(anClassify(ev, AN.acts[i])), () => {});
      } catch (e) { /* a sound is never worth an exception */ }
    }, 0);
  }

  function anRecompute() {
    const hist = currentHistory();
    for (let i = 0; i < hist.length; i++) {
      if (AN.verdicts[i] || !AN.evals[i] || AN.evals[i].none || !AN.acts[i]) continue;
      AN.verdicts[i] = anClassify(AN.evals[i], AN.acts[i]);
      if (i === hist.length - 1) anWatchBrilliant(i);
    }
  }

  // current position first (it drives the bar and the hint), then backfill anything skipped
  function anPump() {
    if (!AN.on || AN.pending || !anSupported()) return;
    const cur = anPly();
    if (!AN.evals[cur]) return anWork(cur, true);
    for (let i = 0; i < cur; i++) if (!AN.evals[i] && AN.snaps[i]) return anWork(i, false);
  }

  // A terminal or unanalysable position still has to be RECORDED as looked at, otherwise
  // the pump keeps seeing a hole at that ply and re-queues it forever.
  const AN_NONE = { none: true };

  function anWork(i, isCurrent) {
    AN.pending = true;
    if (isCurrent) anSetDepth('thinking\u2026');
    setTimeout(() => {
      const done = () => {
        AN.pending = false;
        // When the position on screen is the one that just finished, the board has to be
        // rebuilt — the panel alone would update while Path's arrow never got drawn, which
        // is exactly what "I opened Path and saw nothing" looked like.
        if (isCurrent && anPly() === i) render();
        else { anRenderPanel(); renderMoves(); anPump(); }
      };
      // the board may have moved on while this was queued (the bot replies fast); storing
      // the new position's verdict against the old ply would be silently wrong
      if (isCurrent && anPly() !== i) return done();
      let st = null;
      try { st = isCurrent ? M.state : deState(AN.snaps[i]); } catch (e) { st = null; }
      if (!st || st.winner !== null) { AN.evals[i] = AN_NONE; return done(); }
      anRun(st, Brain.budget(AN.budget, AN.budget * 4)).then(ev => {
        AN.evals[i] = ev; anRecompute();
      }, () => { AN.evals[i] = AN_NONE; }).then(done);
    }, 24);
  }

  const anSetDepth = t => { const el = $('#eng-depth'); if (el) el.textContent = t; };

  function anRenderPanel() {
    const panel = $('#analysis'), bar = $('#evalbar');
    if (!panel || !bar) return;
    if (!AN.on) { panel.hidden = true; bar.hidden = true; return; }
    panel.hidden = false;
    const ok = anSupported();
    bar.hidden = !ok;
    const scoreEl = $('#eng-score'), bestEl = $('#eng-best'), vEl = $('#eng-verdict'), aEl = $('#eng-acc');
    if (!ok) {
      anSetDepth('unavailable');
      scoreEl.textContent = '\u2014';
      bestEl.textContent = '\u2014'; bestEl.disabled = true;
      vEl.hidden = true; aEl.hidden = true;
      return;
    }
    const E = anEngine();
    const at = anPly();
    const evRaw = AN.evals[at];
    const ev = evRaw && !evRaw.none ? evRaw : null;
    const near = meIndex();

    if (ev) {
      const wpTurn = E.evalToWinProb(ev.score);
      const wpNear = ev.turn === near ? wpTurn : 1 - wpTurn;
      const fill = $('#evalbar-fill'), num = $('#evalbar-num');
      fill.style.height = (wpNear * 100).toFixed(1) + '%';
      bar.classList.toggle('proven', !!ev.proven);
      num.textContent = ev.proven ? provenLabel(E, ev, wpNear > 0.5) : Math.round(wpNear * 100) + '%';
      // the panel reads in steps of path advantage, which is the unit the game is played in
      const steps = (ev.turn === near ? ev.score : -ev.score) / 100;
      // ev.dist counts single actions, the same thing the move list calls a move
      scoreEl.textContent = ev.solved && ev.dist > 0
        ? (wpNear > 0.5 ? 'Win in ' : 'Loss in ') + ev.dist + (ev.dist === 1 ? ' move' : ' moves')
        : ev.proven
          ? (wpNear > 0.5 ? 'Winning' : 'Losing')
          : (steps >= 0 ? '+' : '\u2212') + Math.abs(steps).toFixed(1);
      anSetDepth(ev.solved ? 'solved' : 'depth ' + ev.depth);
      if (ev.bestAction) {
        bestEl.textContent = anMoveName(M.state, ev.bestAction);
        bestEl.disabled = false;
        bestEl.classList.toggle('on', AN.showBest);
      } else { bestEl.textContent = '\u2014'; bestEl.disabled = true; }
      // What the recommendation is worth OVER the next move, named. The panel could say what a
      // move does but never why it beat the alternative, so a move the player thought was
      // obvious simply vanished with no account of itself. exactRoot already pays for the true
      // value of every root move, so this costs nothing but the sentence.
      const altEl = $('#eng-alt');
      let alt = '';
      if (!ev.proven && !ev.solved && ev.second != null && ev.secondMove != null) {
        let nm = null;
        // before anWhy: fromRules hands back a shared buffer and explain() builds its own
        try { const a = E.toAction(E.fromRules(M.state), ev.secondMove); nm = a ? anMoveName(M.state, a) : null; } catch (e) { nm = null; }
        if (nm) {
          const gap = (E.evalToWinProb(ev.score) - E.evalToWinProb(ev.second)) * 100;
          alt = gap < 1
            ? 'Almost nothing in it \u2014 ' + nm + ' is worth the same.'
            : nm + ' is the next best, ' + (gap < 10 ? gap.toFixed(1) : Math.round(gap)) + '% worse.';
        }
      }
      altEl.hidden = !alt;
      altEl.textContent = alt;
      const whyEl = $('#eng-why');
      const why = anWhy(M.state, ev);
      whyEl.hidden = !(why && why.text);
      whyEl.textContent = why ? why.text : '';
    } else if (M.state.winner !== null) {
      $('#eng-why').hidden = true;
      $('#eng-alt').hidden = true;
      anSetDepth('game over');
      scoreEl.textContent = M.state.winner === near ? 'Won' : 'Lost';
      bestEl.textContent = '\u2014'; bestEl.disabled = true;
    }

    // verdict on the move that was just played
    const li = at - 1;
    const vd = li >= 0 ? AN.verdicts[li] : null;
    if (vd) {
      const info = VERDICT[vd.key];
      vEl.hidden = false;
      vEl.style.setProperty('--vc', 'var(--v-' + vd.key + ')');
      vEl.innerHTML = '';
      const who = document.createElement('span');
      who.className = 'vd-note';
      who.textContent = (vd.player === near ? 'You' : 'Opponent') + ':';
      const nm = document.createElement('span'); nm.className = 'vd-name'; nm.textContent = info.name;
      const nt = document.createElement('span'); nt.className = 'vd-note';
      nt.textContent = vd.key === 'best' || vd.key === 'book' || vd.key === 'brilliant'
        ? info.note : '\u2212' + Math.round(vd.loss * 100) + '% win chance';
      vEl.append(who, nm, nt);
    } else vEl.hidden = true;

    // running accuracy per player, once there is anything to average
    const acc = [[], []];
    for (let i = 0; i < AN.verdicts.length; i++) {
      const v = AN.verdicts[i];
      if (v) acc[v.player].push(anAccuracy(v.loss));
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    if (acc[0].length && acc[1].length) {
      aEl.hidden = false;
      aEl.innerHTML = '';
      for (const seat of [near, 1 - near]) {
        const sp = document.createElement('span');
        sp.innerHTML = (seat === near ? 'You ' : 'Opponent ') + '<b>' + mean(acc[seat]).toFixed(0) + '%</b>';
        aEl.appendChild(sp);
      }
    } else aEl.hidden = true;
  }

  const anMoveName = (st, a) => a.type === 'wall'
    ? wallName(st.rows, a.orient, a.r, a.c)
    : sqName(st.rows, a.to.r, a.to.c);

  // ---------- drawing a move on the board ----------
  // A pawn move is an arrow from the pawn to where it should go; a wall is a ghost of the
  // wall itself. Both are drawn in the board's own coordinate space (offsetLeft/offsetTop
  // are layout values, so they ignore the 180° flip the board gets for the far seat) and
  // both are rebuilt after every render, because render() empties the board.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const cellAt = (r, c) => boardEl.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');

  function arrowLayer() {
    let svg = boardEl.querySelector('.board-arrows');
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'board-arrows');
      svg.setAttribute('preserveAspectRatio', 'none');
      boardEl.appendChild(svg);
    }
    svg.setAttribute('viewBox', '0 0 ' + boardEl.clientWidth + ' ' + boardEl.clientHeight);
    return svg;
  }

  function drawArrow(r0, c0, r1, c1, cls) {
    const a = cellAt(r0, c0), b = cellAt(r1, c1);
    if (!a || !b) return;
    const svg = arrowLayer();
    const size = a.offsetWidth;
    const x0 = a.offsetLeft + size / 2, y0 = a.offsetTop + a.offsetHeight / 2;
    const x1 = b.offsetLeft + b.offsetWidth / 2, y1 = b.offsetTop + b.offsetHeight / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = Math.min(size * 0.46, len * 0.6);
    const sx = x0 + ux * size * 0.26, sy = y0 + uy * size * 0.26;      // clear of the pawn
    const hx = x1 - ux * size * 0.16, hy = y1 - uy * size * 0.16;      // tip, just short of centre
    const bx = hx - ux * head, by = hy - uy * head;                    // base of the head
    const px = -uy, py = ux;                                           // perpendicular

    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'arrow ' + (cls || ''));
    const shaft = document.createElementNS(SVGNS, 'line');
    shaft.setAttribute('x1', sx); shaft.setAttribute('y1', sy);
    shaft.setAttribute('x2', bx + ux * head * 0.25); shaft.setAttribute('y2', by + uy * head * 0.25);
    shaft.setAttribute('stroke-width', size * 0.155);
    shaft.setAttribute('stroke-linecap', 'round');
    const tip = document.createElementNS(SVGNS, 'polygon');
    const w = head * 0.46;
    tip.setAttribute('points',
      hx + ',' + hy + ' ' +
      (bx + px * w) + ',' + (by + py * w) + ' ' +
      (bx - px * w) + ',' + (by - py * w));
    g.append(shaft, tip);
    svg.appendChild(g);
    return g;
  }

  // A whole route, not one step of it: the line an explanation is about, drawn through the
  // centres of the squares with a head on the last segment. Used for "this is the way home they
  // would have taken", which is a sentence about a path and not about a move.
  function drawRoute(cells, cls) {
    if (!cells || cells.length < 2) return null;
    const first = cellAt(cells[0].r, cells[0].c);
    if (!first) return null;
    const svg = arrowLayer();
    const size = first.offsetWidth;
    const pt = (x) => { const el = cellAt(x.r, x.c); return el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 } : null; };
    const pts = cells.map(pt);
    if (pts.some(p => !p)) return null;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'route ' + (cls || ''));

    // Every measurement below is drawArrow's, deliberately: same shaft weight, same clearance
    // off the pawn, same head. A route and a move are both "go this way" and there is no reason
    // for them to be two different-looking things -- the colour already carries the difference.
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = Math.min(size * 0.46, len * 0.6);
    const hx = b.x - ux * size * 0.16, hy = b.y - uy * size * 0.16;   // tip, short of the centre
    const bx = hx - ux * head, by = hy - uy * head;                    // base of the head
    const px = -uy, py = ux, w = head * 0.46;

    // The first point leaves the pawn the same way a move arrow does, along its own first leg.
    const s0 = pts[0], s1 = pts[1];
    const d0 = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1;
    const start = { x: s0.x + (s1.x - s0.x) / d0 * size * 0.26, y: s0.y + (s1.y - s0.y) / d0 * size * 0.26 };

    const poly = document.createElementNS(SVGNS, 'polyline');
    poly.setAttribute('points', [start].concat(pts.slice(1, -1)).map(p => p.x + ',' + p.y).join(' ') +
      // stop inside the head, so the join never shows through its point
      ' ' + (bx + ux * head * 0.25) + ',' + (by + uy * head * 0.25));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke-width', size * 0.155);
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    const tip = document.createElementNS(SVGNS, 'polygon');
    tip.setAttribute('points', hx + ',' + hy + ' ' + (bx + px * w) + ',' + (by + py * w) + ' ' + (bx - px * w) + ',' + (by - py * w));
    g.append(poly, tip);
    svg.appendChild(g);
    return g;
  }

  function drawGhostWall(st, orient, r, c, cls) {
    const span = 2 * (st.wallLen || 2) - 1;
    const el = document.createElement('div');
    el.className = 'hint-wall ' + (cls || '');
    if (orient === 'h') gridPos(el, 2 * r + 2, 2 * c + 1, 1, span);
    else gridPos(el, 2 * r + 1, 2 * c + 2, span, 1);
    boardEl.appendChild(el);
    return el;
  }

  // draw any action on the board, whichever kind it is
  function drawAction(st, action, mover, cls) {
    if (!action) return null;
    if (action.type === 'wall') return drawGhostWall(st, action.orient, action.r, action.c, cls);
    const from = st.pawns[mover];
    return from ? drawArrow(from.r, from.c, action.to.r, action.to.c, cls) : null;
  }

  // The verdict for the move that led to the position on screen, marked where the move
  // actually happened rather than only in the move list: the far corner of the square the
  // pawn landed on, or the near end of the wall that was placed. The board is where you are
  // looking, so that is where "that was a blunder" belongs.
  function drawVerdictMark(action, key) {
    if (!action || !key) return null;
    const info = VERDICT[key];
    if (!info) return null;
    const el = document.createElement('span');
    el.className = 'mv-mark';
    el.style.setProperty('--vc', 'var(--v-' + key + ')');
    el.textContent = info.tag;
    el.title = info.name;
    // Placed on the board's own grid rather than at a pixel offset. The board rescales with
    // the window, and anything pinned to the pixels of the size it used to be slides off
    // the square it was marking; a grid item moves with the squares.
    if (action.type === 'wall') {
      if (action.orient === 'h') {
        gridPos(el, 2 * action.r + 2, 2 * action.c + 1);      // the gap below row r
        el.classList.add('at-start', 'at-middle');            // the near end of the wall
      } else {
        gridPos(el, 2 * action.r + 1, 2 * action.c + 2);      // the gap right of column c
        el.classList.add('at-centre', 'at-top');
      }
    } else {
      gridPos(el, 2 * action.to.r + 1, 2 * action.to.c + 1);  // the square landed on
      el.classList.add('at-end', 'at-top');                   // its far corner
    }
    // the mark rides inside .board, which is turned upside down for the far seat, so the
    // glyph has to be turned back or it reads as a different symbol entirely
    const deg = boardRotation();
    if (deg) el.style.setProperty('--mark-spin', 'rotate(' + (-deg) + 'deg)');
    boardEl.appendChild(el);
    return el;
  }

  // Why the engine likes its move. Cached on the position and the move, because it costs up to
  // forty milliseconds and the board repaints far more often than the position changes.
  let whyCache = { key: '', out: null };
  function anWhy(st, ev) {
    if (!window.Explain || !ev || !ev.bestAction || !ev.hash) return null;
    // The seat reading the panel is part of the answer, not just of the display: it decides
    // whether the sentence says "you" or "they". It goes in the cache key with everything else.
    const near = meIndex();
    const key = ev.hash + '|' + JSON.stringify(ev.bestAction) + '|' + near;
    if (whyCache.key === key) return whyCache.out;
    let out = null;
    try { out = window.Explain.explain(R, anEngine(), st, ev.bestAction, { viewer: near }); } catch (e) { out = null; }
    whyCache = { key, out };
    return out;
  }

  // When the recommendation is "walk on", the route home starts WITH that step -- so the two
  // shapes lie along the same line and the board grows a second arrowhead six squares further
  // on, pointing at nothing you were asked to do. The route earns its place when it is about
  // somewhere the move is not: a wall being answered, a step off the file, the opponent's way
  // home. When it is just the recommendation drawn longer, it is left out.
  function anRouteSaysNothing(why, action) {
    if (!why || !why.path || why.path.length < 2) return true;
    if (!action || action.type !== 'move') return false;
    return why.path[1].r === action.to.r && why.path[1].c === action.to.c;
  }

  // the engine's recommendation, painted onto the freshly built board
  function anDrawHint(st) {
    if (!AN.on || !anSupported()) return;
    const n = anPly();
    if (n > 0 && AN.verdicts[n - 1] && AN.acts[n - 1]) drawVerdictMark(AN.acts[n - 1], AN.verdicts[n - 1].key);
    if (!AN.showBest) return;
    const ev = AN.evals[n];
    if (!ev || ev.none || !ev.bestAction) return;
    // The route the sentence is about: red when it is the opponent's way home being attacked,
    // green when it is your own being run down. Drawn BEFORE the recommendation, because when
    // the best move is the first step of your own route the two shapes lie on top of each other
    // and the one that has to stay crisp is the move you are being told to play.
    const why = anWhy(st, ev);
    // Green when the route is yours, red when it is theirs -- read off the seat the explanation
    // says the route belongs to. Guessing it from the kind was right only while the side to move
    // was also the side reading, so on the opponent's turn it drew their way home in "your" green.
    if (why && why.path && !anRouteSaysNothing(why, ev.bestAction)) {
      drawRoute(why.path, why.seat === meIndex() ? 'own' : 'threat');
    }
    drawAction(st, ev.bestAction, ev.turn, 'best');
  }

  // Centre the move scrubber on the BOARD rather than on whatever box it happens to sit in.
  // Its container is never the board: on a wide screen it is a grid column shared with the
  // rail, and in every layout the eval bar and the rank strip sit to the left of the board
  // inside the same panel, so anything centred on the container lands left of the squares
  // it is scrubbing. The offset depends on the eval bar being shown, the board's size and
  // the rank strip's width, so it is measured rather than guessed at.
  function centreScrubbers() {
    const board = $('#board');
    if (!board) return;
    for (const el of [$('#rv-nav'), $('#tb-bar')]) {
      if (!el || el.hidden) continue;
      el.style.transform = '';
      const b = board.getBoundingClientRect(), n = el.getBoundingClientRect();
      if (!b.width || !n.width) continue;
      const dx = (b.left + b.width / 2) - (n.left + n.width / 2);
      if (Math.abs(dx) >= 1) el.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    }
  }

  // the board sizes itself around the eval bar, so the class has to reflect what is shown
  function syncEvalClass() {
    const game = $('#game'), bar = $('#evalbar');
    if (game && bar) game.classList.toggle('has-eval', !bar.hidden);
  }

  function anAfterRender() {
    const game = $('#game');
    if (game) {
      game.classList.toggle('reviewing', RV.on);
      // the board gives back the height the scrubber takes whenever it is there, not only
      // in review, or a long game pushes the bar off the bottom of the window
      game.classList.toggle('scrubbing', !RV.on && tbAllowed());
      game.classList.toggle('rewound-view', !RV.on && tbActive());
    }
    if (RV.on) return rvAfterRender();
    tbAfterRender();
    // the engine has nothing to say about a position already played — but on the analysis
    // board the position you stepped back to is one you can play from, so it keeps reading it
    if (tbActive() && M.mode !== 'board') {
      $('#analysis').hidden = true;
      $('#evalbar').hidden = true;
      syncEvalClass();
      $('#review-panel').hidden = true;
      $('#rv-nav').hidden = true;
      return;
    }
    $('#review-panel').hidden = true;
    $('#rv-nav').hidden = true;
    const n = anPly(), sig = anSig();
    // a shorter history means a different game — unless you are simply looking at an earlier
    // move of this one, which must not throw away what has already been worked out
    if ((n < AN.lastLen && !tbActive()) || sig !== AN.lastSig) { anReset(); AN.lastSig = sig; }
    if (!tbActive()) AN.lastLen = n;
    if (!anOffered()) AN.on = false;
    const btn = $('#analysis-btn');
    if (btn) {
      btn.classList.toggle('on', AN.on);
      // setControls sets this too; this pass runs after it on every render, so the setup
      // condition has to be repeated here or the button comes straight back.
      btn.hidden = !anOffered() || suOn();
    }
    anRenderPanel();
    syncEvalClass();      // resizes the board — must land before anything reads its geometry
    anDrawHint(M.state);
    lessonDrawHint();
    anPump();
  }

  function anToggle() {
    AN.on = !AN.on;
    if (AN.on) anRecompute();
    render();
  }
  // one move token: a teal/amber marker (your colour vs the opponent's) + the square
  function moveCell(entry, me) {
    const cell = document.createElement('span');
    const cls = M.state.players === 4 ? 'mv-p' + entry.p : (entry.p === me ? 'mv-me' : 'mv-opp');
    cell.className = 'mv-cell ' + cls;
    if (entry.wall) {
      const ic = document.createElement('span'); ic.className = 'mv-wall' + (entry.orient === 'v' ? ' v' : '');
      cell.appendChild(ic);
      cell.title = 'Wall ' + entry.n;
    } else {
      const dot = document.createElement('span'); dot.className = 'mv-dot';
      cell.appendChild(dot);
      cell.title = 'Move ' + entry.n;
    }
    const tx = document.createElement('span'); tx.className = 'mv-text'; tx.textContent = entry.n;
    cell.appendChild(tx);
    if (entry.branch) {
      cell.classList.add('mv-branch');
      cell.title = (entry.wall ? 'Wall ' : 'Move ') + entry.n + ' \u2014 your line, not the game';
      if (RV.branch && entry === RV.branch.hist[RV.branch.hist.length - 1]) cell.classList.add('current');
      return cell;
    }
    if (entry.idx != null && (RV.on || tbAllowed())) {
      // clicking a move shows the position it was played from — in review, and in a game
      // you are allowed to look back through, where it is the way in. Against a live
      // opponent there is no looking back, so the move reads as text and not as a control.
      cell.classList.add('jump');
      // Both indexes count positions, so the move that produced the one on screen is at - 1.
      // Clicking a move shows the position it led to, so the move you picked is the one
      // highlighted, marked on the board and described in the panel.
      const at = RV.on ? RV.ply : TB.ply;
      if (entry.idx === at - 1) cell.classList.add('current');
      cell.addEventListener('click', () => (RV.on ? rvGo(entry.idx + 1) : tbGo(entry.idx + 1)));
    }
    const vd = entry.idx != null ? (RV.on ? RV.verdicts[entry.idx] : AN.verdicts[entry.idx]) : null;
    if ((AN.on || RV.on) && vd) {
      const v = vd, info = VERDICT[v.key];
      const b = document.createElement('span');
      b.className = 'mv-badge';
      b.style.setProperty('--vc', 'var(--v-' + v.key + ')');
      b.textContent = info.tag;
      b.title = info.name;
      cell.appendChild(b);
    }
    return cell;
  }
  function blankCell() { const s = document.createElement('span'); s.className = 'mv-cell mv-empty'; return s; }

  // ---------- wall preview ----------
  function placePreview(orient, r, c, ok) {
    const span = 2 * (M.state.wallLen || 2) - 1;
    if (orient === 'h') gridPos(previewEl, 2 * r + 2, 2 * c + 1, 1, span);
    else gridPos(previewEl, 2 * r + 1, 2 * c + 2, span, 1);
    const who = wallColorClass(actingSeat());
    previewEl.className = 'preview ' + (ok ? 'ok ' + who : 'bad');
    previewEl.style.display = '';
  }
  const hidePreview = () => { if (previewEl) previewEl.style.display = 'none'; };

  // ---------- click a wall, then click the board ----------
  // The same gesture as the drag, split in two: clicking a wall in your rail takes it in hand,
  // clicking a junction puts it down. Both paths share the preview and the legality check, so a
  // wall can only ever land where a drag could have dropped it.
  function setArmed(on) {
    // Pendant le tour de l'adversaire, prendre un mur en main sert a preparer un coup en attente.
    const pre = premoveSeat();
    const seat = pre === null ? M.state.turn : pre;
    const next = !!on && (interactive() || pre !== null) && premoveView().walls[seat] > 0;
    if (next === armed) return;
    armed = next;
    if (armed && matchRandomOrient()) M.orient = Math.random() < 0.5 ? 'h' : 'v';   // rolled when you pick it up, as in a drag
    if (!armed) hidePreview();
    boardEl.classList.toggle('placing', armed);   // junctions only light up while a wall is in hand
    renderRails();
  }
  const junctionRC = el => ({ r: Number(el.dataset.r), c: Number(el.dataset.c) });
  // Le survol ne peut poser un mur que la ou un mur en main pourrait l'etre: meme siege, meme
  // reserve, meme droit de jouer. Le coup en attente compte, puisqu'il se prepare de la meme main.
  function canPlaceByHover() {
    if (!M || !M.state || suOn()) return false;
    if (!interactive() && premoveSeat() === null) return false;
    return premoveView().walls[actingSeat()] > 0;
  }
  const junctionsLive = () => armed || (hoverWalls() && canPlaceByHover());
  function onJunctionEnter(e) {
    if (!junctionsLive() || drag) return;         // a live drag drives its own preview
    const { r, c } = junctionRC(e.currentTarget);
    placePreview(M.orient, r, c, R.canPlaceWall(premoveView(), actingSeat(), M.orient, r, c));
  }
  function onJunctionLeave() { if (junctionsLive() && !drag) hidePreview(); }
  function onJunctionClick(e) {
    if (suOn()) {
      if (drag) return;
      e.stopPropagation();
      const j = junctionRC(e.currentTarget);
      // Whose wall it is has to come from somewhere; the side to move is the one answer that
      // needs no extra control, and the turn is one click away in the panel.
      return suPlaceWall(M.orient, j.r, j.c, M.state.turn);
    }
    if (!junctionsLive() || drag) return;
    e.stopPropagation();
    const { r, c } = junctionRC(e.currentTarget);
    if (premoveSeat() !== null) return premoveSet({ type: 'wall', orient: M.orient, r, c });
    // an illegal spot keeps the wall in hand; say so, since nothing on screen changes
    if (!R.canPlaceWall(M.state, M.state.turn, M.orient, r, c)) return sfx('illegal');
    submitAction({ type: 'wall', orient: M.orient, r, c });
  }

  // ---------- drag a wall from the inventory ----------
  function startDrag(e) {
    // Pendant le tour de l'adversaire, le glisser sert a preparer un mur: meme geste, meme
    // apercu, et c'est premoveSet qui le recoit a l'arrivee.
    if ((!interactive() && !suOn() && premoveSeat() === null) || drag) return;
    e.preventDefault();
    if (matchRandomOrient()) M.orient = Math.random() < 0.5 ? 'h' : 'v';   // you don't choose — it's rolled at pickup

    const seat = Number(e.currentTarget.dataset.seat);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, target: null,
             seat: Number.isInteger(seat) ? seat : actingSeat() };
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
    if (armed) setArmed(false);   // dragging supersedes a wall held by click
    drag.moved = true;
    boardEl.classList.add('placing');
    const cell = boardEl.querySelector('.cell').getBoundingClientRect().width;
    const L = M.state.wallLen || 2;
    const span = cell * (L + (L - 1) * 0.22);   // L cells + (L-1) gaps
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost ' + wallColorClass(drag.seat != null ? drag.seat : actingSeat());
    const rot = boardRotation();                                   // the floaty ghost isn't inside the board,
    const visH = rot === 90 || rot === 270 ? M.orient === 'v' : M.orient === 'h';   // so match the on-screen axis
    ghost.style.width = (visH ? span : cell * 0.26) + 'px';
    ghost.style.height = (visH ? cell * 0.26 : span) + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }

  function moveGhost(x, y) { drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px'; }

  function hitTest(x, y) {
    const el = document.elementFromPoint(x, y);
    const j = el && el.closest && el.closest('.wjunction');
    if (!j) { drag.target = null; hidePreview(); return; }
    const r = Number(j.dataset.r), c = Number(j.dataset.c);
    const ok = R.canPlaceWall(premoveView(), drag.seat != null ? drag.seat : actingSeat(), M.orient, r, c);
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
    const target = drag.target, moved = drag.moved, seat = drag.seat;
    drag = null;
    if (suOn()) {
      // No arming step here: every junction is already live while setting up, so a tap on a
      // token would take a wall in hand that there is nothing to do with.
      if (moved && target) suPlaceWall(M.orient, target.r, target.c, seat);
      else if (moved) sfx('illegal');
      return;
    }
    const pre = premoveSeat() !== null;
    if (moved && target) {
      const action = { type: 'wall', orient: M.orient, r: target.r, c: target.c };
      pre ? premoveSet(action) : submitAction(action);
    }
    else if (moved) sfx('illegal');      // dragged it somewhere it cannot go, and it came back
    else setArmed(!armed);               // a tap rather than a drag: take the wall in hand, or put it back
  }

  // ---------- drag a pawn to move (alongside click-to-move) ----------
  function startPawnDrag(e) {
    if (!interactive() || drag) return;
    e.preventDefault();
    e.stopPropagation();
    const seat = Number(e.currentTarget.dataset.seat);
    drag = { kind: 'pawn', id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, cell: null,
             src: e.currentTarget, seat: Number.isInteger(seat) ? seat : M.state.turn };
    document.addEventListener('pointermove', onPawnMove);
    document.addEventListener('pointerup', endPawnDrag);
    document.addEventListener('pointercancel', endPawnDrag);
  }
  function onPawnMove(e) {
    if (!drag || drag.kind !== 'pawn' || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) beginPawnGhost();
    if (!drag.moved) return;
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    hitTestPawn(e.clientX, e.clientY);
  }
  function beginPawnGhost() {
    drag.moved = true;
    if (drag.src) drag.src.classList.add('lifted');
    const size = boardEl.querySelector('.cell').getBoundingClientRect().width * 0.74;
    const ghost = document.createElement('div');
    ghost.className = 'pawn pawn-ghost ' + wallColorClass(drag.seat != null ? drag.seat : M.state.turn);
    ghost.style.width = ghost.style.height = size + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }
  function hitTestPawn(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest('.cell.movable');
    if (drag.cell && drag.cell !== cell) drag.cell.classList.remove('drop');
    if (cell) cell.classList.add('drop');
    drag.cell = cell || null;
  }
  function endPawnDrag(e) {
    if (!drag || drag.kind !== 'pawn' || (e && e.pointerId !== drag.id)) return;
    document.removeEventListener('pointermove', onPawnMove);
    document.removeEventListener('pointerup', endPawnDrag);
    document.removeEventListener('pointercancel', endPawnDrag);
    if (drag.ghost) drag.ghost.remove();
    if (drag.src) drag.src.classList.remove('lifted');
    const cell = drag.cell, moved = drag.moved, seat = drag.seat;
    if (cell) cell.classList.remove('drop');
    drag = null;
    if (suOn()) {
      // A tap that never became a drag picks the pawn up instead, so a phone can place one
      // without having to hold and drag it across the board.
      if (moved && cell) suPlacePawn(seat, Number(cell.dataset.r), Number(cell.dataset.c));
      else if (!moved) { SU.pick = SU.pick === seat ? null : seat; render(); }
      return;
    }
    if (moved && cell) submitAction({ type: 'move', to: { r: Number(cell.dataset.r), c: Number(cell.dataset.c) } });
  }

  // ---------- online (friend room code) ----------
  function openOnline() {
    pendingRole = null;
    P4 = null;
    roomCode = null; hostOffer = null; SPECS.clear();
    resetOnlineScreen();
    showScreen('online');
  }

  // ---------- random match (matchmaking → ordinary friend game) ----------
  function openRandom() {
    mmSearching = true;
    pendingRole = null;
    netPeerName = null;
    $('#random-status').textContent = 'Looking for an opponent…';
    showScreen('random');
    window.Net.findMatch(onNetEvent);
  }
  function cancelRandom() {
    mmSearching = false;
    try { window.Net.cancelMatch(); } catch { /* ignore */ }
    netPeerName = null;
    showScreen('menu');
    refreshMenu();
  }
  const setOnlineStatus = msg => { $('#online-status').textContent = msg; };
  // matchmaking and the friend room are two screens running the same handshake
  const setWaitStatus = msg => { if (mmSearching) $('#random-status').textContent = msg; else setOnlineStatus(msg); };
  const resetOnlineButtons = () => { $('#create-room').disabled = false; $('#join-room').disabled = false; };

  function onNetEvent(ev) {
    switch (ev.type) {
      case 'role':                              // matchmaker decided who hosts the matched game
        pendingRole = ev.role;
        $('#random-status').textContent = 'Opponent found — connecting…';
        break;
      case 'searching':                         // we're the one waiting in the lobby now
        $('#random-status').textContent = 'Waiting for an opponent to join…';
        break;
      case 'open':
        if (pendingRole === 'spec') { window.Net.send({ type: 'sp-hello', v: NET_V, name: myName() }); setOnlineStatus('Connected \u00b7 waiting for the game\u2026'); break; }
        if (waitingHost()) { sendHostOffer(); break; }   // board already up: advertise what is on it
        if (pendingRole === 'host') offerGame();
        break;
      case 'data':
        handleNetData(ev.msg);
        break;
      case 'close':
        if (spectating()) { showDisconnect('The game you were watching has ended.'); break; }
        // A visitor who looked and left is not a disconnection: the room is still yours and the
        // board is still up, so take the connection back and wait for the next person.
        if (waitingHost()) {
          M.net.joining = false; netPeerName = null;
          try { window.Net.release(); } catch { /* ignore */ }
          render(); pushSpecState();
          break;
        }
        if (M && M.mode === 'net') { M.net.connected = false; netPeerName = null; showDisconnect('Your opponent disconnected.'); break; }
        abandonHandshake('The room closed.');
        break;
      case 'error':
        handleNetError(ev.err);
        break;
      // ---- watchers, from the host's side ----
      case 'spec-connect':
        SPECS.set(ev.id, 'Watching'); syncSpecCount();
        break;
      case 'spec-data':
        hostSpecData(ev.id, ev.msg);
        break;
      case 'spec-close':
        SPECS.delete(ev.id); syncSpecCount();
        break;
    }
  }

  // ---------- friend rooms: a handshake before either board appears ----------
  // The host rolls its board the moment someone connects but does NOT start playing — it
  // ships the settings over and waits. The guest is shown who it is facing and on exactly
  // what terms, and only its "Play" starts the game on both sides. Declining hands the room
  // back to the host, who keeps waiting for the next person instead of being stranded.
  //
  // The catch is that the other browser is whatever build the other person happens to have
  // loaded, and a build from before this existed never sends "accept" — it starts playing
  // the instant it has the config. So both sides announce a protocol version and fall back
  // to the old, immediate start when the peer doesn't speak this one. Nobody gets stuck
  // waiting on a message the other end was never going to send.
  //
  // TO REMOVE THE FALLBACK once nobody is running v1 any more: grep for LEGACY-PEER.
  // There are exactly three sites, all of them `if` branches that can be deleted whole.
  // NET_V and speaksHandshake are worth keeping — the next protocol change will want them.
  const NET_V = 2;
  const speaksHandshake = msg => !!msg && msg.v >= 2;
  let pendingHost = null;   // host: the game on offer, held until the guest accepts
  let pendingJoin = null;   // guest: the offer currently on screen

  function offerGame() {
    const st = mySettings(); const first = randomTurn();
    // build the board once, here, so any Debris walls are rolled before they are advertised
    const probe = R.createState(modOpts(st));
    pendingHost = { st, first, fixed: probe.fixedWalls || null };
    window.Net.send({ type: 'config', v: NET_V, settings: st, name: myName(), first, fixed: pendingHost.fixed });
    setWaitStatus('Someone is joining\u2026');
  }
  // take the offer off the table and put the board up
  function startOffered() {
    if (!pendingHost) return;
    const p = pendingHost; pendingHost = null;
    startNetMatch('host', 0, p.st, p.first, p.fixed);
  }
  // A host that created a room is already at its board, so there is nothing to build — only a
  // position to advertise, and later a game to start on the board that is already there.
  function sendHostOffer() {
    if (!hostOffer) return;
    M.net.joining = false; netPeerName = null; render();   // a fresh visitor, whoever came before
    // `room` is what tells the visitor a third answer exists. A matchmaking host omits it:
    // there is no code, no board yet and nothing to watch — only a game to accept or decline.
    window.Net.send({ type: 'config', v: NET_V, settings: hostOffer.st, name: myName(),
                      first: hostOffer.first, fixed: hostOffer.fixed, room: true });
  }
  // the guest said yes, by either route
  function hostGuestReady() {
    if (waitingHost()) return beginWaitingGame();
    startOffered();
  }
  // Put back exactly the position that was advertised. Whatever was pushed around while the
  // room was empty was a sketch, and a sketch must not become the game either side agreed to.
  function resetWaitingBoard() {
    if (!hostOffer || !M || !M.net.waiting) return;
    const opts = modOpts(hostOffer.st);
    if (hostOffer.fixed) opts.debris = false;
    const st = R.createState(opts);
    if (hostOffer.fixed) R.setFixedWalls(st, hostOffer.fixed);
    st.turn = hostOffer.first === 1 ? 1 : 0;
    M.state = st;
    M.history = []; M.actions = null; M.firstTurn = undefined;
    M.clock = setupClock(hostOffer.st);
    TB.ply = null; TB.states = null; TB.live = null;
    drag = null; armed = false;
    render();
  }
  function beginWaitingGame() {
    const p = hostOffer;
    hostOffer = null;
    // Rebuild from the offer rather than un-pausing what is on screen: the host may have been
    // playing with it, and the guest accepted the advertised board, not that one.
    if (p) startNetMatch('host', 0, p.st, p.first, p.fixed);
    else { M.net.waiting = false; M.net.joining = false; M.net.connected = true; setControls(); startClock(); render(); pushSpecState(); }
    M.idleAt = Date.now();
    sfx('notify');
    toast((netPeerName || 'Your opponent') + ' joined');
  }

  function openJoinPreview() {
    if (!pendingJoin) return;
    const st = pendingJoin.st || {};
    $('#jp-you').textContent = myName();
    $('#jp-opp').textContent = pendingJoin.name || 'Opponent';
    const tag = $('#jp-tag');
    tag.textContent = variantName(st);
    tag.classList.toggle('custom', !isStandard(st));
    renderSettingsView($('#jp-settings'), st);
    $('#jp-watch').hidden = !pendingJoin.room;
    openOverlay('join-preview');
  }
  function joinAccept() {
    if (!pendingJoin) return;
    const p = pendingJoin; pendingJoin = null;
    closeOverlay('join-preview');
    window.Net.send({ type: 'accept' });
    startNetMatch('guest', 1, p.st, p.first, p.fixed);
  }
  // You looked at the game and would rather watch it. Nothing reconnects: the host moves the
  // channel you already have out of the seat and into the audience, frees the seat for the next
  // person, and sends the position back down the same link.
  function joinWatch() {
    if (!pendingJoin) return;
    pendingJoin = null;
    closeOverlay('join-preview');
    pendingRole = 'spec';
    window.Net.send({ type: 'watch', v: NET_V, name: myName() });
    setWaitStatus('Watching · waiting for the position…');
  }
  function joinDecline() {
    if (!pendingJoin) return;
    pendingJoin = null;
    closeOverlay('join-preview');
    try { window.Net.send({ type: 'decline' }); } catch { /* ignore */ }
    setTimeout(() => { try { window.Net.close(); } catch { /* ignore */ } }, 150);   // let it flush
    leaveHandshake('You left the room.');
  }
  // shared exit for both sides of an offer that never became a game
  function leaveHandshake(msg) {
    pendingRole = null; pendingHost = null; pendingJoin = null; netPeerName = null;
    if (mmSearching) { mmSearching = false; showScreen('menu'); refreshMenu(); toast(msg); return; }
    resetOnlineScreen(); setOnlineStatus(msg); showScreen('online');
  }
  // the other side vanished mid-handshake: a host keeps its room, everyone else backs out
  function abandonHandshake(msg) {
    if (pendingJoin) { pendingJoin = null; closeOverlay('join-preview'); }
    pendingHost = null; netPeerName = null;
    if (mmSearching) { try { window.Net.close(); } catch { /* ignore */ } return leaveHandshake(msg); }
    if (pendingRole === 'host') {
      try { window.Net.release(); } catch { /* ignore */ }
      setOnlineStatus('Share this code. Waiting for your opponent\u2026');
      return;
    }
    if (pendingRole === 'guest' || pendingRole === 'spec') leaveHandshake(msg);
  }

  function handleNetError(err) {
    const t = err && err.type;
    let msg = 'Connection error.';
    if (t === 'peer-unavailable') msg = 'No room with that code.';
    else if (t === 'unavailable-id') msg = 'Room code clash — try again.';
    else if (t === 'timeout') msg = "Couldn't connect — your network is likely blocking it. Try another network or a phone hotspot.";
    else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') msg = 'Could not reach the server.';
    if (M && M.mode === 'net') { toast(msg); return; }
    if (mmSearching) { $('#random-status').textContent = msg + ' Tap Back to try again.'; return; }
    resetOnlineButtons(); setOnlineStatus(msg);
  }

  function handleNetData(msg) {
    if (!msg) return;
    if (msg.type === 'room-full') return onRoomFull(msg);
    if (msg.t === 'sp-init') return startSpectate(msg);   // arrives before there is a match to speak of
    if (spectating()) return specData(msg);
    if (msg.type === 'config') {
      netPeerName = msg.name || null;
      window.Net.send({ type: 'name', v: NET_V, name: myName() });   // who we are, and what we speak
      // LEGACY-PEER (1 of 3) — an older host is already sitting at the board with its clock
      // running, so holding it there while we read the settings would cost it real time.
      // Against one of those we start the way we always used to and say why the preview
      // didn't appear. Delete this branch and the preview becomes unconditional.
      if (!speaksHandshake(msg)) {
        startNetMatch('guest', 1, msg.settings, msg.first, msg.fixed);
        toast('Opponent is on an older version');
        return;
      }
      pendingJoin = { st: msg.settings, first: msg.first, fixed: msg.fixed, name: netPeerName, room: !!msg.room };
      openJoinPreview();
      return;
    }
    // --- handshake traffic: either there is no match yet, or there is one with nobody in it ---
    if (pendingHost || waitingHost()) {
      if (msg.type === 'name') {
        netPeerName = msg.name || null;
        // LEGACY-PEER (2 of 3) — the name is the only thing an older build sends before its
        // first move, so its version tag is where the two are told apart. Without one, that
        // browser is already playing and the host has to catch up rather than wait forever
        // for an "accept" that is never coming. This is the line that fixes "X is looking at
        // the game" hanging until you give up.
        if (!speaksHandshake(msg)) { hostGuestReady(); return; }
        if (waitingHost()) { M.net.joining = true; render(); return; }
        setWaitStatus((netPeerName || 'Someone') + ' is looking at the game\u2026');
        return;
      }
      if (msg.type === 'accept') { hostGuestReady(); return; }
      if (msg.type === 'watch') {
        // Only a host sitting at its own board can answer this; a matched game never offered it.
        if (!waitingHost()) return;
        const id = window.Net.toSpectator();
        netPeerName = null;
        M.net.joining = false;
        if (!id) { render(); return; }   // the audience was full; net.js has already said so
        SPECS.set(id, String(msg.name || 'Watching').slice(0, 16));
        syncSpecCount();
        window.Net.sendTo(id, Object.assign(specPacket(), { t: 'sp-init', chat: (M.chat || []).slice(-40) }));
        render();
        return;
      }
      if (msg.type === 'decline') {
        netPeerName = null;
        if (waitingHost()) {
          M.net.joining = false;
          try { window.Net.release(); } catch { /* ignore */ }
          toast('They passed on this one');
          render();
          return;
        }
        pendingHost = null;
        if (mmSearching) { try { window.Net.close(); } catch { /* ignore */ } return leaveHandshake('Opponent declined'); }
        try { window.Net.release(); } catch { /* ignore */ }
        setOnlineStatus('They passed on this one. Still waiting for an opponent\u2026');
        return;
      }
      // LEGACY-PEER (3 of 3) — backstop for any peer that neither accepts nor tags itself:
      // a move on the wire is proof the game is on. No `return`, so the move it carries is
      // played rather than dropped.
      if (msg.type === 'move' || msg.type === 'wall') hostGuestReady();
    }
    if (!M || M.mode !== 'net') return;
    // Stop reading the past before any of this touches the board. While you are looking back,
    // M.state is the position you are LOOKING at, not the live one — so validating their move
    // against it rejects legal moves and drops them, and a forfeit or a timeout would end a
    // game on a replay that is thrown away the moment you step forward again.
    tbLive();
    const s = M.state;
    if (msg.type === 'name') { netPeerName = msg.name || null; render(); return; }
    if (msg.type === 'chat') {
      const who = msg.name || netPeerName || 'Opponent';
      pushChat(who, msg.text, msg.spec);
      // the guest's line still has to reach the watchers, and only the host can carry it there
      if (hostOfRoom() && !msg.spec && watching()) {
        window.Net.sendSpecs({ t: 'sp-chat', name: who, text: String(msg.text || '').slice(0, 200), spec: 0 });
      }
      return;
    }
    if (msg.type === 'emote') { showEmote(msg.name, msg.e); return; }
    if (msg.type === 'rematch') {
      netRematch.opp = true;
      if (netRematch.me) reachRematch();   // we already wanted it → both agree
      else openRematchPrompt();            // ask permission
      return;
    }
    if (msg.type === 'rematch-go') {        // host's signal to start the agreed rematch
      startNetMatch('guest', 1, msg.settings || M.settings, msg.first, msg.fixed);
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
    if (msg.type === 'draw-offer') {
      if (s.winner === null) { drawAsks()[M.net.myPlayer] = 0; openDrawPrompt('net'); }
      return;
    }
    if (msg.type === 'draw-spam') {
      if (s.winner === null) { s.winner = M.net.myPlayer; showWin('You win', 'Your opponent asked for a draw three times in a row.'); }
      return;
    }
    if (msg.type === 'idle') {
      if (s.winner === null) { s.winner = M.net.myPlayer; showWin('You win', 'Your opponent went ten minutes without playing.'); }
      return;
    }
    // Their reading of a clock we both keep on our own, so it is checked against ours before
    // it is allowed to end anything: the move has to be genuinely ours, and genuinely overdue.
    if (msg.type === 'idle-claim') {
      if (s.winner !== null || M.net.myPlayer !== s.turn) return;
      if (Date.now() - (M.idleAt || Date.now()) < IDLE_MS) return;
      s.winner = 1 - M.net.myPlayer;
      showWin('You lose', 'You went ten minutes without playing.');
      return;
    }
    if (msg.type === 'draw-accept') { if (s.winner === null) { s.winner = 'draw'; endMatch(); } return; }
    if (msg.type === 'draw-decline') { toast('Draw declined'); return; }
    if (msg.type !== 'move' && msg.type !== 'wall') return;
    if (s.winner !== null || M.net.myPlayer === s.turn) return; // only the opponent, on their turn
    if (msg.type === 'wall') { if (!R.canPlaceWall(s, s.turn, msg.orient, msg.r, msg.c)) return; }
    else if (!R.legalMoves(s, s.turn).some(m => m.r === msg.to.r && m.c === msg.to.c)) return;
    applyAction(msg, true);
  }

  // Creating a room used to leave you on a screen with a code on it, waiting. The board is
  // rolled and shown immediately instead — the code travels with it, in the HUD — so the wait
  // happens at the board you are about to play on rather than in front of a placeholder, and
  // the code stays to hand for the whole game instead of vanishing the moment it starts.
  async function createRoom() {
    if (settings.fourP) return friendCreate4p();
    pendingRole = 'host';
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus('Creating room…');
    try {
      const code = await window.Net.host(onNetEvent);
      SPECS.clear();
      netPeerName = null;
      // Roll the position NOW, not when somebody knocks: what gets advertised has to be what is
      // already on the screen, Debris walls and opening side included.
      const st = mySettings(), first = randomTurn();
      const probe = R.createState(modOpts(st));
      hostOffer = { st, first, fixed: probe.fixedWalls || null };
      startNetMatch('host', 0, st, first, hostOffer.fixed, { waiting: true, code });
    } catch {
      roomCode = null; hostOffer = null;
      resetOnlineButtons();
      setOnlineStatus('Could not reach the server. Check your connection.');
    }
  }

  // Join takes the free seat; Watch asks for a seat in the audience. The difference travels
  // with the connection itself, so the host knows which one knocked before the channel opens.
  async function joinRoom() {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 4) return setOnlineStatus('Enter the 4-character code.');
    if (settings.fourP) return friendJoin4p(code);
    return connectRoom(code, false);
  }
  async function connectRoom(code, spectate) {
    pendingRole = spectate ? 'spec' : 'guest';
    roomCode = code;
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus(spectate ? 'Finding the game…' : 'Connecting…');
    try { await window.Net.join(code, onNetEvent, { spectate }); }
    catch { resetOnlineButtons(); setOnlineStatus('Could not connect. Check the code and try again.'); }
  }
  // Knocking on a room that is already playing is the commonest way anyone ends up wanting to
  // watch one, so the refusal offers it rather than just reporting a closed door.
  function onRoomFull(msg) {
    const code = roomCode;
    pendingRole = null;
    try { window.Net.close(); } catch { /* ignore */ }
    resetOnlineButtons();
    if (msg.spec) { setOnlineStatus('Too many people are already watching that game.'); return; }
    setOnlineStatus('That game has already started.');
    confirmAction('Already under way', 'Both seats in that room are taken. Watch the game instead?',
      () => connectRoom(code, true));
  }

  function copyText(text) {
    if (!text) return;
    const done = () => toast('Code copied');
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done)); }
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch { toast(text); }
  }

  // ---------- 4-player online (host-authoritative hub; exactly 4 humans) ----------
  // Reachable from "Play with a Friend" when the 4-player modifier is on. The host owns the board,
  // validates each seat's move, and relays the whole state; everyone must have the modifier on.
  let P4 = null;

  async function friendCreate4p() {
    P4 = { host: true, roster: [{ id: HOST_ID, name: myName() }], started: false, settings: mySettings() };
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus('Creating 4-player room…');
    try {
      P4.code = await window.Net.hostHub(onP4Hub);
      $('#online-choice').hidden = true;
      $('#friend-lobby').hidden = false;
      setOnlineStatus('');
      renderP4Lobby();
    } catch {
      P4 = null; resetOnlineButtons();
      setOnlineStatus('Could not reach the server. Check your connection.');
    }
  }
  async function friendJoin4p(code) {
    P4 = { host: false, code, names: [], started: false };
    $('#create-room').disabled = true; $('#join-room').disabled = true;
    setOnlineStatus('Joining 4-player room…');
    try { await window.Net.joinHub(code, onP4Client); }
    catch { P4 = null; resetOnlineButtons(); setOnlineStatus('Could not connect. Check the code.'); }
  }
  function leaveP4() {
    try { window.Net.close(); } catch { /* ignore */ }
    P4 = null; M = null;
    closeOverlay('overlay');
    showScreen('menu'); refreshMenu();
  }

  function renderP4Lobby() {
    if (!P4) return;
    $('#friend-lobby').hidden = false;
    $('#friend-code').textContent = P4.code || '----';
    const names = P4.host ? P4.roster.map(p => p.name) : (P4.names || []);
    const list = $('#friend-roster'); list.innerHTML = '';
    names.forEach((n, i) => {
      const onKick = (P4.host && i > 0) ? () => hostP4Kick(P4.roster[i].id) : null;
      list.appendChild(tRow(i + 1, n, playerLabel(i), false, onKick));   // seat label shown in the score slot
    });
    const n = names.length;
    $('#friend-start').hidden = !P4.host;
    if (P4.host) {
      $('#friend-start').disabled = n !== 4;
      $('#friend-lobby-status').textContent = n < 4 ? `${n}/4 players — need ${4 - n} more…` : 'Four players ready.';
    } else {
      $('#friend-lobby-status').textContent = 'Waiting for the host to start…';
    }
  }
  function hostP4Kick(id) {
    if (!P4 || !P4.host || P4.started) return;
    window.Net.sendTo(id, { t: 'kicked' });
    P4.roster = P4.roster.filter(p => p.id !== id);
    window.Net.kick(id);
    broadcastP4Lobby(); renderP4Lobby();
  }

  // ---- host ----
  function onP4Hub(ev) {
    if (ev.type === 'data') hostP4Data(ev.id, ev.msg);
    else if (ev.type === 'disconnect') hostP4Disconnect(ev.id);
    else if (ev.type === 'error') toast('Network error');
  }
  function hostP4Data(id, msg) {
    if (!P4 || !P4.host) return;
    if (msg.t === 'hello') {
      if (P4.started) { window.Net.sendTo(id, { t: 'too-late' }); return; }
      if (P4.roster.length >= 4) { window.Net.sendTo(id, { t: 'full' }); return; }
      if (!P4.roster.some(p => p.id === id)) P4.roster.push({ id, name: String(msg.name || 'Player').slice(0, 16) });
      broadcastP4Lobby(); renderP4Lobby();
    } else if (msg.t === 'p4act') hostP4Action(msg.action, id);
  }
  function broadcastP4Lobby() { window.Net.broadcast({ t: 'lobby', names: P4.roster.map(p => p.name) }); }
  function hostP4Disconnect(id) {
    if (!P4 || !P4.host) return;
    if (!P4.started) { P4.roster = P4.roster.filter(p => p.id !== id); broadcastP4Lobby(); renderP4Lobby(); return; }
    // mid-game: exactly four are required, so a drop ends it for everyone
    const seat = P4.seatId.indexOf(id);
    const name = seat >= 0 ? P4.seatName[seat] : 'A player';
    window.Net.broadcast({ t: 'p4abort', name });
    if (M && M.mode === 'p4net' && M.state && M.state.winner === null) showDisconnect(`${name} left — the game ended.`);
    P4.started = false;
  }
  function hostP4Start() {
    if (!P4 || !P4.host || P4.roster.length !== 4 || P4.started) return;
    P4.started = true;
    P4.seatId = P4.roster.map(p => p.id);
    P4.seatName = P4.roster.map(p => p.name);
    const opts = modOpts(P4.settings); opts.players = 4;
    P4.state = R.createState(opts);
    P4.state.turn = 0;
    P4.history = [];
    P4.seatId.forEach((pid, seat) => {
      if (pid === HOST_ID) return;
      window.Net.sendTo(pid, { t: 'p4start', seat, names: P4.seatName, s: serState(P4.state), settings: P4.settings });
    });
    startP4Match(0, null, P4.seatName, P4.settings);
  }
  function hostP4Action(action, fromId) {
    if (!P4 || !P4.host || !P4.state || P4.state.winner !== null) return;
    const s = P4.state, turn = s.turn;
    if (fromId !== P4.seatId[turn]) return;   // only the seat whose turn it is
    if (action.type === 'wall') { if (!R.canPlaceWall(s, turn, action.orient, action.r, action.c)) return; }
    else { if (!R.legalMoves(s, turn).some(m => m.r === action.to.r && m.c === action.to.c)) return; }
    const p4he = histEntry(s, action, turn);
    P4.history.push(p4he);
    if (action.type === 'wall') R.applyWall(s, action.orient, action.r, action.c); else R.applyMove(s, action.to);
    markWin(p4he, s);
    window.Net.broadcast({ t: 'p4state', s: serState(s), h: P4.history });
    if (M && M.mode === 'p4net') { M.state = s; M.history = P4.history; render(); }
    if (s.winner !== null) endMatch();
  }

  // ---- client ----
  function onP4Client(ev) {
    if (ev.type === 'open') { window.Net.sendHost({ t: 'hello', name: myName() }); $('#online-choice').hidden = true; setOnlineStatus(''); renderP4Lobby(); }
    else if (ev.type === 'data') clientP4Data(ev.msg);
    else if (ev.type === 'close') showDisconnect('You were disconnected from the host.');
    else if (ev.type === 'error') {
      const t = ev.err && ev.err.type;
      setOnlineStatus(t === 'peer-unavailable' ? 'No room with that code.' : 'Could not connect. Check the code.');
      P4 = null; resetOnlineButtons(); $('#friend-lobby').hidden = true; $('#online-choice').hidden = false;
    }
  }
  function clientP4Data(msg) {
    if (!P4 || P4.host) return;
    if (msg.t === 'lobby') { P4.names = msg.names; renderP4Lobby(); }
    else if (msg.t === 'too-late') { toast('Game already started'); leaveP4(); }
    else if (msg.t === 'full') { toast('Room is full'); leaveP4(); }
    else if (msg.t === 'kicked') { toast('Removed by the host'); leaveP4(); }
    else if (msg.t === 'p4start') { P4.started = true; P4.seatName = msg.names; startP4Match(msg.seat, msg.s, msg.names, msg.settings); }
    else if (msg.t === 'p4state') {
      if (!M || M.mode !== 'p4net') return;
      M.state = deState(msg.s); if (msg.h) M.history = msg.h;
      render();
      if (M.state.winner !== null) endMatch();
    }
    else if (msg.t === 'p4abort') { showDisconnect(`${msg.name || 'A player'} left — the game ended.`); }
  }

  // set up the game screen for a 4-player online match (host: seat 0; guests: their assigned seat)
  function startP4Match(seat, snap, names, st) {
    M = {
      mode: 'p4net',
      state: P4.host ? P4.state : deState(snap),
      mySeat: seat,
      difficulty: null,
      human: [],
      orient: 'h',
      net: null,
      settings: st || (P4 && P4.settings) || mySettings(),
      names: names || (P4 && P4.seatName) || [],
      clock: null,
      history: P4.host ? P4.history : [],
    };
    setControls();
    drag = null; armed = false;
    resetOnlineScreen();
    closeOverlay('overlay');
    showScreen('game');
    render();
  }

  // ---------- wiring ----------
  // Picking a bot is a screen, not a popup: three opponents, their record against you, and
  // the game settings all fit without anything being squeezed into an overlay card.
  let botDiff = 'medium';
  // Path's level, on the engine's own Elo scale. It is an opponent setting, not a board
  // setting, so it lives beside the difficulty pick rather than in the game settings that
  // get sent to the other side of an online room.
  const ELO_KEY = 'detour_path_elo';
  const eloMax = () => (window.Engine && window.Engine.ELO_MAX) || 3200;
  const eloMin = () => (window.Engine && window.Engine.ELO_MIN) || 100;
  function pathElo() {
    let v = eloMax();
    try { const raw = localStorage.getItem(ELO_KEY); if (raw != null) v = Number(raw); } catch { /* ignore */ }
    if (!Number.isFinite(v)) v = eloMax();
    return Math.min(eloMax(), Math.max(eloMin(), Math.round(v / 100) * 100));
  }
  function setPathElo(v) { try { localStorage.setItem(ELO_KEY, String(v)); } catch { /* ignore */ } }
  function openBotSetup() { renderRecords(); paintBotPick(); showScreen('bot-setup'); }
  function paintBotPick() {
    $$('#bot-grid .bot-card').forEach(b => b.classList.toggle('is-sel', b.dataset.diff === botDiff));
    const hard = botDiff === 'hard';
    $('#bot-elo-block').hidden = !hard;
    if (hard) {
      const e = pathElo();
      $('#bot-elo').min = eloMin(); $('#bot-elo').max = eloMax(); $('#bot-elo').value = e;
      $('#bot-elo-val').textContent = e;
      $('#bot-elo-note').textContent = window.Engine && window.Engine.describeElo ? window.Engine.describeElo(e) : '';
      $('#bot-start').textContent = 'Play Path (' + e + ')';
    } else {
      $('#bot-start').textContent = 'Play ' + botDiff[0].toUpperCase() + botDiff.slice(1);
    }
  }
  // paste a code straight into the menu and skip the room screen entirely
  function quickJoin(code) {
    const c = String(code || '').trim().toUpperCase();
    if (c.length < 4) return toast('Enter the 4-character code');
    openOnline();
    $('#join-code').value = c;
    joinRoom();
  }

  const toMenu = () => { showScreen('menu'); refreshMenu(); };
  const onPlayNext = () => { if (OT) return OT.host ? hostPlayNext() : leaveOtour(); playNext(); };
  const onStandingsBack = () => { if (OT) return leaveOtour(); toMenu(); };

  $$('#menu [data-mode]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    const m = b.dataset.mode;
    if (m === 'bot') openBotSetup();
    else if (m === 'friend') openOnline();
    else if (m === 'tournament') openTournamentSetup();
    else if (m === 'otour') openOtourEntry();
    else if (m === 'random') openRandom();
    else if (m === 'local') openOverlay('local-setup');
    else if (m === 'history') openHistory();
    else if (m === 'lessons') openLessons();
    else if (m === 'board') startBoard();
    else startMatch(m);
  }));
  $('#local-start').addEventListener('click', () => startMatch('local'));
  $('#local-close').addEventListener('click', () => closeOverlay('local-setup'));
  $$('#bot-grid .bot-card').forEach(b => b.addEventListener('click', () => { botDiff = b.dataset.diff; paintBotPick(); }));
  $('#bot-elo').addEventListener('input', e => { setPathElo(Number(e.target.value)); paintBotPick(); });
  $('#bot-start').addEventListener('click', () => startMatch('bot', botDiff));
  $('#bot-back').addEventListener('click', toMenu);
  $('#quick-join').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('#quick-code'); const code = inp.value; inp.value = '';
    quickJoin(code);
  });
  $('#history-back').addEventListener('click', () => { showScreen('menu'); refreshMenu(); });
  $('#lessons-back').addEventListener('click', () => { showScreen('menu'); refreshMenu(); });
  $('#lessons-reset').addEventListener('click', () => {
    try { localStorage.removeItem(LESSON_KEY); } catch (e) { /* private window */ }
    renderLessons();
  });
  $('#lesson-quit').addEventListener('click', () => { LS.on = false; M = null; openLessons(); });
  $('#lesson-next').addEventListener('click', () => { LS.on = false; M = null; openLessons(); });

  // Import and export. One hidden file input serves every import button; where the loaded
  // game should go depends on which button opened it, so the destination is parked on the
  // input until the file arrives.
  let importThen = null;
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    const then = importThen || (rec => rvOpen(rec, 'history'));
    importThen = null;
    e.target.value = '';                    // so picking the same file twice still fires
    importGameFile(f, then);
  });
  const pickGameFile = then => { importThen = then; $('#import-file').click(); };
  $('#history-import').addEventListener('click', () => pickGameFile(rec => {
    const list = loadGames();
    list.unshift(rec);
    saveGames(list);
    renderHistory();
    rvOpen(rec, 'history');
  }));
  $('#export-btn').addEventListener('click', () => exportGame(RV.on ? RV.rec : currentRecord()));
  // One pair of buttons, two contexts: the analysis board, and a review of a finished game.
  $('#board-import-btn').addEventListener('click', () => pickGameFile(rec => rvOpen(rec, RV.on ? (RV.from || 'game') : 'board')));
  $('#board-export-btn').addEventListener('click', () => exportGame(RV.on ? (RV.rec || currentRecord()) : currentRecord()));
  $('#history-clear').addEventListener('click', () => {
    if (!confirm('Delete all saved games? This cannot be undone.')) return;
    clearGames(); renderHistory();
  });
  $('#how-btn').addEventListener('click', () => openOverlay('how'));
  $('#how-close').addEventListener('click', () => closeOverlay('how'));

  $('#back-btn').addEventListener('click', leaveMatch);
  $('#menu-btn').addEventListener('click', leaveMatch);
  $('#restart-btn').addEventListener('click', requestRematch);
  $('#analysis-btn').addEventListener('click', anToggle);
  $('#setup-btn').addEventListener('click', () => suToggle());
  $('#music-btn').addEventListener('click', toggleGameMusic);
  $('#setup-done').addEventListener('click', () => suToggle(false));
  $('#setup-clear').addEventListener('click', suClear);
  $('#eng-best').addEventListener('click', () => { AN.showBest = !AN.showBest; render(); });

  // ---- rewind controls ----
  $('#tb-first').addEventListener('click', () => tbGo(0));
  $('#tb-prev').addEventListener('click', () => tbStep(-1));
  $('#tb-next').addEventListener('click', () => tbStep(1));
  $('#tb-last').addEventListener('click', tbLive);
  document.addEventListener('keydown', e => {
    if (RV.on || !M || !$('#game').classList.contains('is-active')) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); tbStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tbStep(1); }
    // Un cran a la fois -- et seulement si rien n'est en main: un autre ecouteur rend le mur a la
    // reserve sur Echap, et les deux repondaient au meme appui, ce qui defaisait deux choses.
    else if (e.key === 'Escape' && PRE && !armed) { e.preventDefault(); premovePop(); }
    else if (e.key === 'Escape' && tbActive()) { e.preventDefault(); tbLive(); }
  });

  // ---- review controls ----
  $('#review-btn').addEventListener('click', rvOpenCurrent);
  $('#rv-first').addEventListener('click', () => rvGo(0));
  $('#rv-prev').addEventListener('click', () => rvGo(RV.ply - 1));
  $('#rv-next').addEventListener('click', () => rvGo(RV.ply + 1));
  $('#rv-last').addEventListener('click', () => rvGo(RV.states.length - 1));
  $('#rv-show').addEventListener('click', () => { RV.showBest = !RV.showBest; render(); });
  $('#rv-back-game').addEventListener('click', rvBackToGame);
  $('#rv-guess').addEventListener('click', rvGuessToggle);
  // the eval graph doubles as a scrubber
  $('#rv-graph').addEventListener('click', e => {
    if (!RV.on || RV.states.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    rvGo(Math.round((e.clientX - r.left) / r.width * (RV.states.length - 1)));
  });
  document.addEventListener('keydown', e => {
    if (!RV.on) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && RV.branch) { e.preventDefault(); return rvBackToGame(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); rvGo(RV.ply - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); rvGo(RV.ply + 1); }
    else if (e.key === 'Home') { e.preventDefault(); rvGo(0); }
    else if (e.key === 'End') { e.preventDefault(); rvGo(RV.states.length - 1); }
  });
  $('#rematch-btn').addEventListener('click', requestRematch);
  $('#forfeit-btn').addEventListener('click', () => confirmAction('Resign the game?', 'You concede this match to your opponent.', forfeit));
  $('#draw-btn').addEventListener('click', () => {
    if (M && (M.net || M.mode === 'otour')) confirmAction('Offer a draw?', 'Your opponent will be asked to accept.', offerDraw);
    else offerDraw();   // local tournament shows its own agree-to-draw prompt
  });
  $('#confirm-yes').addEventListener('click', confirmYes);
  $('#confirm-no').addEventListener('click', confirmNo);
  $('#disconnect-ok').addEventListener('click', dismissDisconnect);
  $('#continue-btn').addEventListener('click', onContinue);
  $('#draw-accept').addEventListener('click', drawAccept);
  $('#draw-decline').addEventListener('click', drawDecline);
  $('#rematch-accept').addEventListener('click', rematchAccept);
  $('#rematch-deny').addEventListener('click', rematchDeny);
  const toggleOrient = () => setOrient(M.orient === 'h' ? 'v' : 'h');
  $('#rotate-btn').addEventListener('click', toggleOrient);
  $('#rotate-btn-top').addEventListener('click', toggleOrient);
  // clicking the board anywhere but a junction puts a held wall back (a legal move still moves)
  boardEl.addEventListener('click', e => {
    if (!armed || !e.target.closest) return;
    if (e.target.closest('.wjunction') || e.target.closest('.cell.movable')) return;
    setArmed(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !armed) return;
    e.preventDefault();
    setArmed(false);
  });
  // Space toggles wall orientation while it's your turn to place -- and while you are preparing a
  // wall for the turn that is coming, which is the same gesture a beat earlier.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (drag || !$('#game').classList.contains('is-active') || matchRandomOrient()) return;
    if (!interactive() && premoveSeat() === null) return;
    e.preventDefault();
    setOrient(M.orient === 'h' ? 'v' : 'h');
  });

  $('#random-back').addEventListener('click', cancelRandom);
  $('#random-cancel').addEventListener('click', cancelRandom);
  $('#online-back').addEventListener('click', () => {
    try { window.Net.close(); } catch { /* ignore */ }
    P4 = null; pendingHost = null; pendingJoin = null; pendingRole = null;
    roomCode = null; hostOffer = null; SPECS.clear();
    closeOverlay('join-preview');
    resetOnlineScreen(); showScreen('menu'); refreshMenu();
  });
  $('#jp-accept').addEventListener('click', joinAccept);
  $('#jp-watch').addEventListener('click', joinWatch);
  $('#jp-decline').addEventListener('click', joinDecline);
  $('#create-room').addEventListener('click', createRoom);
  $('#join-room').addEventListener('click', joinRoom);
  $('#room-chip-copy').addEventListener('click', () => copyText(roomCode));
  $('#friend-start').addEventListener('click', hostP4Start);
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
  $('#game-chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#game-chat-input');
    const text = input.value;
    input.value = '';
    sendGameChat(text);
  });

  const nameInput = $('#player-name');
  nameInput.value = loadName();
  nameInput.addEventListener('input', () => { const v = nameInput.value.trim(); if (v) saveName(v); });

  $$('[data-look]').forEach(b => b.addEventListener('click', () => setLook(b.dataset.look, b.dataset.value)));
  $('#look-btn').addEventListener('click', openAppearance);
  $('#look-back').addEventListener('click', toMenu);
  $('#look-reset').addEventListener('click', () => {
    LOOK = lookDefaults(); saveLook(); applyLook(); renderLookBoard(); renderMenuBoard();
  });
  LOOK = loadLook();
  applyLook();

  ['#bot-settings', '#local-settings', '#friend-settings', '#tour-settings', '#otour-settings']
    .forEach(id => mountSettings($(id)));
  refreshSetupSummaries();

  refreshMenu();

  // The menu is already the active screen when the page loads, so showScreen() never fires
  // for it and the music would wait for the first navigation. Browsers will not start audio
  // before a gesture anyway, so the first one doubles as the cue — and then this stops
  // listening, because every screen change after it goes through showScreen().
  const startMusicOnFirstGesture = () => {
    window.removeEventListener('pointerdown', startMusicOnFirstGesture);
    window.removeEventListener('keydown', startMusicOnFirstGesture);
    const id = ($('.screen.is-active') || {}).id;
    if (!window.Music || LOOK.sound === 'off' || !musicScreen(id)) return;
    // start() for the case where nothing has tried yet, retry() for the far more common one:
    // the page loaded, something asked for music before any interaction, and the browser
    // refused. That refusal is not a verdict on the track, only on the timing.
    window.Music.start();
    window.Music.retry();
  };
  window.addEventListener('pointerdown', startMusicOnFirstGesture, { passive: true });
  window.addEventListener('keydown', startMusicOnFirstGesture, { passive: true });
})();
