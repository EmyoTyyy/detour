// rules.js — pure game logic for Detour (Quoridor-style race)
// 2-player: an N×N board (N = 5..15; default 9). Player 0 starts bottom and races to the top row;
// player 1 starts top and races to the bottom.
// 4-player: the board grows to (N+2)×(N+2) with the four single corner cells cut out (an octagon).
// Four pawns start at the middle of each outer edge and race to the opposite edge; turns go
// clockwise (bottom → left → top → right). First pawn to reach its goal edge wins.
//
// Modifiers ride on the state so one engine serves every variant:
//   s.size     — actual board dimension (N for 2p, N+2 for 4p).  s.players — 2 or 4.
//   s.holes    — cut corner cells (Set; empty for 2p).           s.order — clockwise turn order.
//   s.goals[p] — {axis:'r'|'c', at} the edge player p must reach.
//   s.wallLen  — length L of a player wall (1..size-1).           s.inverted — misère (2-player only).
//   fixed walls — pre-placed neutral "Debris" walls of any length (s.fixedH/V/HP/VP + s.fixedWalls).

(function () {
  const DEFAULT_SIZE = 9;
  const WALL_MAX = 10;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const key = (r, c) => r + ',' + c;
  const isHole = (s, r, c) => !!(s.holes && s.holes.has(key(r, c)));
  const inBounds = (s, r, c) => r >= 0 && r < s.size && c >= 0 && c < s.size && !isHole(s, r, c);
  const randInt = n => Math.floor(Math.random() * n);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const hEdges = (r, c, len) => { const a = []; for (let i = 0; i < len; i++) a.push(key(r, c + i)); return a; };
  const vEdges = (r, c, len) => { const a = []; for (let i = 0; i < len; i++) a.push(key(r + i, c)); return a; };
  const hPosts = (r, c, len) => { const a = []; for (let i = 0; i < len - 1; i++) a.push(key(r, c + i)); return a; };
  const vPosts = (r, c, len) => { const a = []; for (let i = 0; i < len - 1; i++) a.push(key(r + i, c)); return a; };

  function createState(opts) {
    const o = opts || {};
    const players = o.players === 4 ? 4 : 2;
    const inner = o.size || DEFAULT_SIZE;
    const size = players === 4 ? inner + 2 : inner;
    const wallCount = o.walls != null ? o.walls : WALL_MAX;
    const mid = Math.floor(size / 2);
    const holes = new Set();
    let pawns, goals, order;
    if (players === 4) {
      [[0, 0], [0, size - 1], [size - 1, 0], [size - 1, size - 1]].forEach(([r, c]) => holes.add(key(r, c)));
      pawns = [{ r: size - 1, c: mid }, { r: 0, c: mid }, { r: mid, c: 0 }, { r: mid, c: size - 1 }];
      goals = [{ axis: 'r', at: 0 }, { axis: 'r', at: size - 1 }, { axis: 'c', at: size - 1 }, { axis: 'c', at: 0 }];
      order = [0, 2, 1, 3];   // clockwise: bottom, left, top, right
    } else {
      pawns = [{ r: size - 1, c: mid }, { r: 0, c: mid }];
      goals = [{ axis: 'r', at: 0 }, { axis: 'r', at: size - 1 }];
      order = [0, 1];
    }
    const s = {
      size, players, inner, holes, order, goals,
      wallLen: clamp(o.wallLen != null ? o.wallLen : 2, 1, size - 1),
      inverted: players === 2 && !!o.inverted,
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
      size: s.size, players: s.players, inner: s.inner,
      holes: s.holes, order: s.order, goals: s.goals,   // immutable after creation → shared
      wallLen: s.wallLen, inverted: s.inverted,
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
      if (r < 0 || r > s.size - 2 || c < 0 || c > s.size - len) return true;
      if (touchesHole(s, 'h', r, c, len)) return true;
      for (const k of hEdges(r, c, len)) if (s.fixedH.has(k)) return true;
      for (const k of hPosts(r, c, len)) if (s.fixedVP.has(k)) return true;
      return false;
    }
    if (r < 0 || r > s.size - len || c < 0 || c > s.size - 2) return true;
    if (touchesHole(s, 'v', r, c, len)) return true;
    for (const k of vEdges(r, c, len)) if (s.fixedV.has(k)) return true;
    for (const k of vPosts(r, c, len)) if (s.fixedHP.has(k)) return true;
    return false;
  }
  function placeRandomWalls(s, count, len) {
    let placed = 0, guard = 0, cap = count * 80 + 300;
    while (placed < count && guard++ < cap) {
      const orient = Math.random() < 0.5 ? 'h' : 'v';
      const r = orient === 'h' ? randInt(s.size - 1) : randInt(s.size - len + 1);
      const c = orient === 'h' ? randInt(s.size - len + 1) : randInt(s.size - 1);
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

  // cells that make up a player's goal edge (excluding any holes)
  function goalCells(s, player) {
    const g = s.goals[player];
    const out = [];
    for (let i = 0; i < s.size; i++) {
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
      if (r < 0 || r > s.size - 2 || c < 0 || c > s.size - L) return true;
      if (touchesHole(s, 'h', r, c, L)) return true;
      for (let cc = c - L + 1; cc <= c + L - 1; cc++) if (s.hWalls.has(key(r, cc))) return true;
      for (let cc = c; cc <= c + L - 1; cc++) if (s.fixedH.has(key(r, cc))) return true;
      for (let pc = c; pc <= c + L - 2; pc++) {
        if (s.fixedVP.has(key(r, pc))) return true;
        for (let ar = r - L + 2; ar <= r; ar++) if (s.vWalls.has(key(ar, pc))) return true;
      }
      return false;
    }
    if (r < 0 || r > s.size - L || c < 0 || c > s.size - 2) return true;
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

  function applyMove(s, to) {
    const p = s.turn;
    s.pawns[p] = { r: to.r, c: to.c };
    const g = s.goals[p];
    const reached = (g.axis === 'r' ? to.r : to.c) === g.at;
    if (reached) s.winner = s.inverted ? 1 - p : p;   // inverted is 2-player only
    else s.turn = nextTurn(s);
    return s;
  }

  function applyWall(s, orient, r, c) {
    const p = s.turn;
    (orient === 'h' ? s.hWalls : s.vWalls).add(key(r, c));
    s.wallBy[orient + key(r, c)] = p;
    s.walls[p] -= 1;
    s.turn = nextTurn(s);
    return s;
  }

  window.Rules = {
    SIZE: DEFAULT_SIZE, DEFAULT_SIZE, WALL_MAX, DIRS, key, inBounds, isHole,
    createState, cloneState, edgeBlocked, legalMoves, rawMoves, setFixedWalls,
    distanceMap, pathLength, hasPath, wallConflict, canPlaceWall,
    applyMove, applyWall,
  };
})();
