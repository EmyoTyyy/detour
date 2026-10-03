// rules.js — pure game logic for Detour (Quoridor-style race)
// 2-player: a ROWS×COLS board (each side 5..15; default 9×9 — boards need not be square).
// Player 0 starts on the bottom row and races to the top row; player 1 starts top and races bottom.
// Race: both pawns instead start side by side on the BOTTOM row, in their own lanes, and race
// the same way to the top row — first one there wins, so walls cut both ways.
// King of the hill: everyone keeps their usual start but the goal becomes a SINGLE cell at the
// centre of the board — first pawn to stand on it wins. Equal distances need a true centre, so
// the caller should hand this odd row and column counts (the settings layer enforces that).
// 4-player: the board grows to (ROWS+2)×(COLS+2) with the four single corner cells cut out (an
// octagon). Four pawns start at the middle of each outer edge and race to the opposite edge; turns
// go clockwise (bottom → left → top → right). First pawn to reach its goal edge wins. Fair play
// needs equal opposing edges, so the 4-player board is always square.
//
// Modifiers ride on the state so one engine serves every variant:
//   s.rows/s.cols — actual board dimensions (inner +2 each in 4p).  s.players — 2 or 4.
//   s.holes    — cut corner cells (Set; empty for 2p).           s.order — clockwise turn order.
//   s.goals[p] — what player p must reach: {cell:{r,c}} under king of the hill, otherwise
//                {axis:'r'|'c', at} for a whole goal edge.
//   s.wallLen  — length L of a player wall (1..min(rows,cols)-1).  s.inverted — misère (2p only).
//   s.race     — both pawns start on the bottom row sharing one goal (2-player only).
//   s.koth     — every goal collapses to the one centre cell (works with 2 or 4 players).
//   fixed walls — pre-placed neutral "Debris" walls of any length (s.fixedH/V/HP/VP + s.fixedWalls).

(function () {
  const DEFAULT_SIZE = 9;
  const WALL_MAX = 10;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const key = (r, c) => r + ',' + c;
  const isHole = (s, r, c) => !!(s.holes && s.holes.has(key(r, c)));
  const inBounds = (s, r, c) => r >= 0 && r < s.rows && c >= 0 && c < s.cols && !isHole(s, r, c);
  const randInt = n => Math.floor(Math.random() * n);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const hEdges = (r, c, len) => { const a = []; for (let i = 0; i < len; i++) a.push(key(r, c + i)); return a; };
  const vEdges = (r, c, len) => { const a = []; for (let i = 0; i < len; i++) a.push(key(r + i, c)); return a; };
  const hPosts = (r, c, len) => { const a = []; for (let i = 0; i < len - 1; i++) a.push(key(r, c + i)); return a; };
  const vPosts = (r, c, len) => { const a = []; for (let i = 0; i < len - 1; i++) a.push(key(r + i, c)); return a; };

  // Race start columns: two lanes mirrored about the board's centre line, one cell of clearance
  // between them on odd widths and two on even, so neither pawn opens closer to the middle.
  function raceStarts(cols) {
    const mid = (cols - 1) / 2;
    const off = cols % 2 ? 1 : 1.5;
    return [Math.round(mid - off), Math.round(mid + off)];
  }

  function createState(opts) {
    const o = opts || {};
    const players = o.players === 4 ? 4 : 2;
    const innerRows = o.rows || o.size || DEFAULT_SIZE;
    const innerCols = players === 4 ? innerRows : (o.cols || o.size || DEFAULT_SIZE);
    const rows = players === 4 ? innerRows + 2 : innerRows;
    const cols = players === 4 ? innerCols + 2 : innerCols;
    const wallCount = o.walls != null ? o.walls : WALL_MAX;
    const midR = Math.floor(rows / 2), midC = Math.floor(cols / 2);
    const race = players === 2 && !!o.race;
    const koth = !!o.koth;
    const holes = new Set();
    let pawns, goals, order;
    if (players === 4) {
      [[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1]].forEach(([r, c]) => holes.add(key(r, c)));
      pawns = [{ r: rows - 1, c: midC }, { r: 0, c: midC }, { r: midR, c: 0 }, { r: midR, c: cols - 1 }];
      goals = [{ axis: 'r', at: 0 }, { axis: 'r', at: rows - 1 }, { axis: 'c', at: cols - 1 }, { axis: 'c', at: 0 }];
      order = [0, 2, 1, 3];   // clockwise: bottom, left, top, right
    } else if (race) {
      const [c0, c1] = raceStarts(cols);
      pawns = [{ r: rows - 1, c: c0 }, { r: rows - 1, c: c1 }];
      goals = [{ axis: 'r', at: 0 }, { axis: 'r', at: 0 }];   // same side, same finish line
      order = [0, 1];
    } else {
      pawns = [{ r: rows - 1, c: midC }, { r: 0, c: midC }];
      goals = [{ axis: 'r', at: 0 }, { axis: 'r', at: rows - 1 }];
      order = [0, 1];
    }
    // king of the hill keeps every start where it is and collapses all the goal edges into the
    // one centre cell, so everybody is racing the same square from their own side
    if (koth) goals = pawns.map(() => ({ cell: { r: midR, c: midC } }));
    const s = {
      // Les positions deja vues, pour la nulle par triple repetition. Une Map plutot qu'un Set:
      // c'est le COMPTE qui decide, pas la simple presence.
      seen: new Map(),
      rows, cols, players, innerRows, innerCols, holes, order, goals, race, koth,
      wallLen: clamp(o.wallLen != null ? o.wallLen : 2, 1, Math.min(rows, cols) - 1),
      inverted: players === 2 && !race && !koth && !!o.inverted,
      turn: 0,
      pawns,
      walls: pawns.map(() => wallCount),
      hWalls: new Set(), vWalls: new Set(),
      fixedH: new Set(), fixedV: new Set(), fixedHP: new Set(), fixedVP: new Set(),
      fixedWalls: [],
      wallBy: {},
      winner: null,
    };
    if (o.debris) placeRandomWalls(s, 2 + randInt(5), 2);
    return s;
  }

  function cloneState(s) {
    return {
      // Copiee, pas partagee: une variante exploree ne doit pas compter ses positions dans la partie.
      seen: s.seen ? new Map(s.seen) : new Map(),
      rows: s.rows, cols: s.cols, players: s.players, innerRows: s.innerRows, innerCols: s.innerCols,
      holes: s.holes, order: s.order, goals: s.goals,   // immutable after creation → shared
      wallLen: s.wallLen, inverted: s.inverted, race: s.race, koth: s.koth,
      turn: s.turn,
      pawns: s.pawns.map(p => ({ ...p })),
      walls: s.walls.slice(),
      hWalls: new Set(s.hWalls),
      vWalls: new Set(s.vWalls),
      fixedH: s.fixedH, fixedV: s.fixedV, fixedHP: s.fixedHP, fixedVP: s.fixedVP, fixedWalls: s.fixedWalls,
      wallBy: { ...s.wallBy },
      winner: s.winner,
    };
  }

  const nextTurn = s => s.order[(s.order.indexOf(s.turn) + 1) % s.order.length];

  // ---- fixed (Debris) walls ----
  function addFixedWall(s, orient, r, c, len) {
    if (orient === 'h') { hEdges(r, c, len).forEach(k => s.fixedH.add(k)); hPosts(r, c, len).forEach(k => s.fixedHP.add(k)); }
    else { vEdges(r, c, len).forEach(k => s.fixedV.add(k)); vPosts(r, c, len).forEach(k => s.fixedVP.add(k)); }
    s.fixedWalls.push({ orient, r, c, len });
  }
  function popFixedWall(s, orient, r, c, len) {
    if (orient === 'h') { hEdges(r, c, len).forEach(k => s.fixedH.delete(k)); hPosts(r, c, len).forEach(k => s.fixedHP.delete(k)); }
    else { vEdges(r, c, len).forEach(k => s.fixedV.delete(k)); vPosts(r, c, len).forEach(k => s.fixedVP.delete(k)); }
    s.fixedWalls.pop();
  }
  function touchesHole(s, orient, r, c, len) {
    if (orient === 'h') { for (let cc = c; cc < c + len; cc++) if (isHole(s, r, cc) || isHole(s, r + 1, cc)) return true; }
    else { for (let rr = r; rr < r + len; rr++) if (isHole(s, rr, c) || isHole(s, rr, c + 1)) return true; }
    return false;
  }
  function fixedConflict(s, orient, r, c, len) {
    if (orient === 'h') {
      if (r < 0 || r > s.rows - 2 || c < 0 || c > s.cols - len) return true;
      if (touchesHole(s, 'h', r, c, len)) return true;
      for (const k of hEdges(r, c, len)) if (s.fixedH.has(k)) return true;
      for (const k of hPosts(r, c, len)) if (s.fixedVP.has(k)) return true;
      return false;
    }
    if (r < 0 || r > s.rows - len || c < 0 || c > s.cols - 2) return true;
    if (touchesHole(s, 'v', r, c, len)) return true;
    for (const k of vEdges(r, c, len)) if (s.fixedV.has(k)) return true;
    for (const k of vPosts(r, c, len)) if (s.fixedHP.has(k)) return true;
    return false;
  }
  function placeRandomWalls(s, count, len) {
    if (len > Math.min(s.rows, s.cols) - 1) return;   // wouldn't fit on a narrow board
    let placed = 0, guard = 0, cap = count * 80 + 300;
    while (placed < count && guard++ < cap) {
      const orient = Math.random() < 0.5 ? 'h' : 'v';
      const r = orient === 'h' ? randInt(s.rows - 1) : randInt(s.rows - len + 1);
      const c = orient === 'h' ? randInt(s.cols - len + 1) : randInt(s.cols - 1);
      if (fixedConflict(s, orient, r, c, len)) continue;
      addFixedWall(s, orient, r, c, len);
      if (s.pawns.every((_, i) => hasPath(s, i))) placed++;
      else popFixedWall(s, orient, r, c, len);
    }
  }
  function setFixedWalls(s, list) {
    s.fixedH = new Set(); s.fixedV = new Set(); s.fixedHP = new Set(); s.fixedVP = new Set(); s.fixedWalls = [];
    (list || []).forEach(w => addFixedWall(s, w.orient, w.r, w.c, w.len));
  }

  function edgeBlocked(s, r1, c1, r2, c2) {
    const L = s.wallLen || 2;
    if (r1 === r2) {
      const r = r1, lc = Math.min(c1, c2);
      if (s.fixedV.has(key(r, lc))) return true;
      for (let ar = r - L + 1; ar <= r; ar++) if (s.vWalls.has(key(ar, lc))) return true;
      return false;
    }
    const c = c1, tr = Math.min(r1, r2);
    if (s.fixedH.has(key(tr, c))) return true;
    for (let ac = c - L + 1; ac <= c; ac++) if (s.hWalls.has(key(tr, ac))) return true;
    return false;
  }

  // moves ignoring the inverted "must advance" rule; handles jumps over any pawn (2 or 4 players)
  function rawMoves(s, player) {
    const p = s.pawns[player];
    const occ = (r, c) => s.pawns.some((pw, i) => i !== player && pw.r === r && pw.c === c);
    const out = [];
    const seen = new Set();
    const push = (r, c) => { const k = key(r, c); if (!seen.has(k)) { seen.add(k); out.push({ r, c }); } };

    for (const [dr, dc] of DIRS) {
      const nr = p.r + dr, nc = p.c + dc;
      if (!inBounds(s, nr, nc) || edgeBlocked(s, p.r, p.c, nr, nc)) continue;
      if (!occ(nr, nc)) { push(nr, nc); continue; }
      // a pawn is adjacent: try to jump straight over it
      const jr = nr + dr, jc = nc + dc;
      if (inBounds(s, jr, jc) && !edgeBlocked(s, nr, nc, jr, jc) && !occ(jr, jc)) {
        push(jr, jc);
      } else {
        // blocked behind them: side-step around
        const perp = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const [pr, pc] of perp) {
          const sr = nr + pr, sc = nc + pc;
          if (inBounds(s, sr, sc) && !edgeBlocked(s, nr, nc, sr, sc) && !occ(sr, sc)) push(sr, sc);
        }
      }
    }
    return out;
  }

  function legalMoves(s, player) {
    const moves = rawMoves(s, player);
    if (!s.inverted) return moves;
    const dmap = distanceMap(s, player);
    const here = dmap.get(key(s.pawns[player].r, s.pawns[player].c));
    if (here === undefined) return moves;
    const forward = moves.filter(m => { const d = dmap.get(key(m.r, m.c)); return d !== undefined && d < here; });
    return forward.length ? forward : moves;
  }

  // cells that make up a player's goal — one square under king of the hill, otherwise a whole
  // edge (excluding any holes)
  function goalCells(s, player) {
    const g = s.goals[player];
    if (g.cell) return isHole(s, g.cell.r, g.cell.c) ? [] : [{ r: g.cell.r, c: g.cell.c }];
    const n = g.axis === 'r' ? s.cols : s.rows;   // a goal row spans the columns, and vice versa
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = g.axis === 'r' ? g.at : i;
      const c = g.axis === 'c' ? g.at : i;
      if (!isHole(s, r, c)) out.push({ r, c });
    }
    return out;
  }

  // BFS from a player's goal edge; distance (in steps) from every cell to the goal.
  function distanceMap(s, player) {
    const dist = new Map();
    const q = [];
    for (const cell of goalCells(s, player)) { dist.set(key(cell.r, cell.c), 0); q.push(cell); }
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const d = dist.get(key(cur.r, cur.c));
      for (const [dr, dc] of DIRS) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (!inBounds(s, nr, nc) || edgeBlocked(s, cur.r, cur.c, nr, nc)) continue;
        const k = key(nr, nc);
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        q.push({ r: nr, c: nc });
      }
    }
    return dist;
  }

  function pathLength(s, player) {
    const d = distanceMap(s, player).get(key(s.pawns[player].r, s.pawns[player].c));
    return d === undefined ? Infinity : d;
  }
  function hasPath(s, player) { return pathLength(s, player) !== Infinity; }

  // A new length-L player wall at (r,c) conflicts if it leaves the board, touches a cut corner,
  // overlaps a same-orientation wall (shared segment), or crosses a perpendicular wall at a post.
  function wallConflict(s, orient, r, c) {
    const L = s.wallLen || 2;
    if (orient === 'h') {
      if (r < 0 || r > s.rows - 2 || c < 0 || c > s.cols - L) return true;
      if (touchesHole(s, 'h', r, c, L)) return true;
      for (let cc = c - L + 1; cc <= c + L - 1; cc++) if (s.hWalls.has(key(r, cc))) return true;
      for (let cc = c; cc <= c + L - 1; cc++) if (s.fixedH.has(key(r, cc))) return true;
      for (let pc = c; pc <= c + L - 2; pc++) {
        if (s.fixedVP.has(key(r, pc))) return true;
        for (let ar = r - L + 2; ar <= r; ar++) if (s.vWalls.has(key(ar, pc))) return true;
      }
      return false;
    }
    if (r < 0 || r > s.rows - L || c < 0 || c > s.cols - 2) return true;
    if (touchesHole(s, 'v', r, c, L)) return true;
    for (let rr = r - L + 1; rr <= r + L - 1; rr++) if (s.vWalls.has(key(rr, c))) return true;
    for (let rr = r; rr <= r + L - 1; rr++) if (s.fixedV.has(key(rr, c))) return true;
    for (let pr = r; pr <= r + L - 2; pr++) {
      if (s.fixedHP.has(key(pr, c))) return true;
      for (let ac = c - L + 2; ac <= c; ac++) if (s.hWalls.has(key(pr, ac))) return true;
    }
    return false;
  }

  function canPlaceWall(s, player, orient, r, c) {
    if (s.walls[player] <= 0) return false;
    if (wallConflict(s, orient, r, c)) return false;
    const set = orient === 'h' ? s.hWalls : s.vWalls;
    set.add(key(r, c));
    const ok = s.pawns.every((_, i) => hasPath(s, i));   // every player must keep a route home
    set.delete(key(r, c));
    return ok;
  }

  // ---- repetition ----
  // Quoridor n'a pas de regle officielle de repetition: Gigamic n'en a jamais publie. Sans elle une
  // position decidee peut tourner indefiniment -- le camp perdant rachete un coup de delai a chaque
  // aller-retour, et rien ne penalise le retour sur une position deja vue. Mesure le 2026-10-03:
  // 20 parties sur 64 contre Ishtar n'ont jamais fini, et aucune n'etait vraiment bloquee.
  //
  // La troisieme occurrence d'une position fait donc nulle, comme aux echecs.
  //
  // La cle n'a pas besoin de lister les murs: dans une partie un mur n'est jamais retire, donc deux
  // moments ou le NOMBRE de murs est le meme ont forcement les memes murs. Restent les pions, les
  // reserves et le trait.
  function posKey(s) {
    let k = '';
    for (const p of s.pawns) k += p.r + ',' + p.c + ' ';
    return k + '|' + s.walls.join(',') + '|' + s.turn + '|' + (s.hWalls.size + s.vWalls.size);
  }
  // Compte la position courante et rend true si elle vient d'etre vue pour la troisieme fois.
  function noteRepetition(s) {
    if (!s.seen) return false;
    const k = posKey(s);
    const n = (s.seen.get(k) || 0) + 1;
    s.seen.set(k, n);
    return n >= 3;
  }

  function applyMove(s, to) {
    const p = s.turn;
    s.pawns[p] = { r: to.r, c: to.c };
    const g = s.goals[p];
    const reached = g.cell ? (to.r === g.cell.r && to.c === g.cell.c) : (g.axis === 'r' ? to.r : to.c) === g.at;
    if (reached) s.winner = s.inverted ? 1 - p : p;   // inverted is 2-player only
    else {
      s.turn = nextTurn(s);
      if (noteRepetition(s)) s.winner = 'draw';
    }
    return s;
  }

  function applyWall(s, orient, r, c) {
    const p = s.turn;
    (orient === 'h' ? s.hWalls : s.vWalls).add(key(r, c));
    s.wallBy[orient + key(r, c)] = p;
    s.walls[p] -= 1;
    s.turn = nextTurn(s);
    // Un mur ne peut jamais ramener a une position deja vue -- il n'en sort jamais -- mais la
    // position compte tout de meme, sinon celle d'apres croirait etre une premiere visite.
    noteRepetition(s);
    return s;
  }

  // ---- snapshots ----
  // A position as plain data: no Sets, no functions, so it survives JSON and survives being
  // posted to a worker. It lives here rather than in the page because the worker needs it too
  // and neither copy may be allowed to drift from the other.
  function serState(s) {
    return { nr: s.rows, nc: s.cols, pl: s.players, ir: s.innerRows, ic: s.innerCols,
      rc: !!s.race, kh: !!s.koth, wl: s.wallLen, inv: s.inverted, fx: s.fixedWalls, t: s.turn,
      p: s.pawns.map(x => [x.r, x.c]), w: s.walls.slice(), h: [...s.hWalls], v: [...s.vWalls],
      by: s.wallBy, win: s.winner };
  }
  function deState(o) {
    const players = o.pl || 2;
    const rows = o.nr || o.n || DEFAULT_SIZE;
    const cols = o.nc || o.n || DEFAULT_SIZE;
    // createState lays out the pawns and goal edges, so the variant flags it keys off (players,
    // race) must go in there; the rest of the snapshot is stamped on afterwards.
    const s = createState({
      rows: players === 4 ? (o.ir || rows - 2) : rows,
      cols: players === 4 ? (o.ic || cols - 2) : cols,
      players, race: !!o.rc, koth: !!o.kh,
    });
    s.wallLen = o.wl || 2;
    s.inverted = !!o.inv;
    setFixedWalls(s, o.fx);
    s.turn = o.t;
    s.pawns = o.p.map(([r, c]) => ({ r, c }));
    s.walls = o.w.slice();
    s.hWalls = new Set(o.h);
    s.vWalls = new Set(o.v);
    s.wallBy = o.by || {};
    s.winner = o.win;
    return s;
  }

  (typeof window !== 'undefined' ? window : self).Rules = {
    SIZE: DEFAULT_SIZE, DEFAULT_SIZE, WALL_MAX, DIRS, key, inBounds, isHole,
    createState, cloneState, edgeBlocked, legalMoves, rawMoves, setFixedWalls, raceStarts, goalCells,
    distanceMap, pathLength, hasPath, wallConflict, canPlaceWall,
    applyMove, applyWall, serState, deState,
  };
})();
