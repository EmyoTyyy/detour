// rules.js — pure game logic for Detour (Quoridor-style race)
// Board: 9x9. Player 0 starts bottom (row 8), reaches row 0. Player 1 starts top (row 0), reaches row 8.
// Walls anchored on an 8x8 grid of interior cross-points (r,c in 0..7).
//   horizontal wall (r,c): groove between rows r and r+1, covering columns c and c+1
//   vertical wall   (r,c): groove between cols c and c+1, covering rows r and r+1

(function () {
  const SIZE = 9;
  const WALL_MAX = 10;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const key = (r, c) => r + ',' + c;
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  function createState(wallCount = WALL_MAX) {
    return {
      turn: 0,
      pawns: [{ r: SIZE - 1, c: 4 }, { r: 0, c: 4 }],
      goalRow: [0, SIZE - 1],
      walls: [wallCount, wallCount],
      hWalls: new Set(),
      vWalls: new Set(),
      wallBy: {},   // "<orient><r>,<c>" -> player who placed it
      winner: null,
    };
  }

  function cloneState(s) {
    return {
      turn: s.turn,
      pawns: [{ ...s.pawns[0] }, { ...s.pawns[1] }],
      goalRow: s.goalRow.slice(),
      walls: s.walls.slice(),
      hWalls: new Set(s.hWalls),
      vWalls: new Set(s.vWalls),
      wallBy: { ...s.wallBy },
      winner: s.winner,
    };
  }

  // True if a wall blocks the orthogonal step between two adjacent cells.
  function edgeBlocked(s, r1, c1, r2, c2) {
    if (r1 === r2) {
      const r = r1, lc = Math.min(c1, c2);
      return s.vWalls.has(key(r, lc)) || s.vWalls.has(key(r - 1, lc));
    }
    const c = c1, tr = Math.min(r1, r2);
    return s.hWalls.has(key(tr, c)) || s.hWalls.has(key(tr, c - 1));
  }

  function legalMoves(s, player) {
    const p = s.pawns[player];
    const o = s.pawns[1 - player];
    const out = [];
    const seen = new Set();
    const push = (r, c) => { const k = key(r, c); if (!seen.has(k)) { seen.add(k); out.push({ r, c }); } };

    for (const [dr, dc] of DIRS) {
      const nr = p.r + dr, nc = p.c + dc;
      if (!inBounds(nr, nc) || edgeBlocked(s, p.r, p.c, nr, nc)) continue;
      if (!(nr === o.r && nc === o.c)) { push(nr, nc); continue; }
      // opponent is adjacent: try straight jump
      const jr = nr + dr, jc = nc + dc;
      if (inBounds(jr, jc) && !edgeBlocked(s, nr, nc, jr, jc)) {
        push(jr, jc);
      } else {
        // blocked behind opponent: side-step around them
        const perp = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const [pr, pc] of perp) {
          const sr = nr + pr, sc = nc + pc;
          if (inBounds(sr, sc) && !edgeBlocked(s, nr, nc, sr, sc)) push(sr, sc);
        }
      }
    }
    return out;
  }

  // Multi-source BFS from a player's goal row; distance (in steps) from every cell to the goal.
  function distanceMap(s, player) {
    const goal = s.goalRow[player];
    const dist = new Map();
    const q = [];
    for (let c = 0; c < SIZE; c++) { const k = key(goal, c); dist.set(k, 0); q.push({ r: goal, c }); }
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const d = dist.get(key(cur.r, cur.c));
      for (const [dr, dc] of DIRS) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (!inBounds(nr, nc) || edgeBlocked(s, cur.r, cur.c, nr, nc)) continue;
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

  function hasPath(s, player) {
    return pathLength(s, player) !== Infinity;
  }

  function wallConflict(s, orient, r, c) {
    if (r < 0 || r > SIZE - 2 || c < 0 || c > SIZE - 2) return true;
    if (orient === 'h') {
      return s.hWalls.has(key(r, c)) || s.hWalls.has(key(r, c - 1)) ||
        s.hWalls.has(key(r, c + 1)) || s.vWalls.has(key(r, c));
    }
    return s.vWalls.has(key(r, c)) || s.vWalls.has(key(r - 1, c)) ||
      s.vWalls.has(key(r + 1, c)) || s.hWalls.has(key(r, c));
  }

  function canPlaceWall(s, player, orient, r, c) {
    if (s.walls[player] <= 0) return false;
    if (wallConflict(s, orient, r, c)) return false;
    const set = orient === 'h' ? s.hWalls : s.vWalls;
    set.add(key(r, c));
    const ok = hasPath(s, 0) && hasPath(s, 1);
    set.delete(key(r, c));
    return ok;
  }

  function applyMove(s, to) {
    const p = s.turn;
    s.pawns[p] = { r: to.r, c: to.c };
    if (to.r === s.goalRow[p]) s.winner = p;
    else s.turn = 1 - p;
    return s;
  }

  function applyWall(s, orient, r, c) {
    const p = s.turn;
    (orient === 'h' ? s.hWalls : s.vWalls).add(key(r, c));
    s.wallBy[orient + key(r, c)] = p;
    s.walls[p] -= 1;
    s.turn = 1 - p;
    return s;
  }

  window.Rules = {
    SIZE, WALL_MAX, DIRS, key, inBounds,
    createState, cloneState, edgeBlocked, legalMoves,
    distanceMap, pathLength, hasPath, wallConflict, canPlaceWall,
    applyMove, applyWall,
  };
})();
