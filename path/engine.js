// engine.js — Detour analysis engine. Standard game only: 2 players, length-2 walls,
// opposite goal edges, any rectangular board. No modifiers (no race / king of the hill /
// inverted / 4-player / debris) — those keep using bot.js.
//
// It is built along the lines of a modern chess engine, because the problems are the same
// ones. Four things carry most of the strength, in this order:
//
//   * SPEED. The board is a flat Uint8Array of adjacency bitmasks and moves are made and
//     unmade in place, so a shortest path costs about 1us instead of the ~90us rules.js
//     spends building a Map of string keys. On top of that a path memo (pathLen) and a
//     cheap "could this wall have trapped anyone?" filter (mayCut) between them roughly
//     halve the remaining work, without changing a single node of the tree.
//   * A SELECTIVE SEARCH. Negamax with alpha-beta, but the shape that matters is
//     principal variation search plus forward pruning — reverse futility, null moves and
//     move-count pruning. Turning those three off costs about ninety games in a hundred.
//     Late move reductions are here too, but see the note above lmrTab: the settings that
//     suit chess lose outright in this game, and why they do is the most interesting thing
//     in the file.
//   * A TRANSPOSITION TABLE. It matters more here than in chess because wall placements
//     commute: A-then-B and B-then-A are the same position, so the same node is reached an
//     enormous number of ways. It caches the static evaluation as well as the score.
//   * AN EXACTLY SOLVED ENDING. Once both players are out of walls the board can never
//     change again, so the rest of the game is a pursuit on a fixed graph of about
//     thirteen thousand positions — small enough to solve outright rather than search.
//     See solveRace(): the engine does not estimate endings, it knows them.
//
// window.Engine

(function () {
  'use strict';

  // adjacency bits: which way can this cell be left
  const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8;
  const DBIT = [UP, DOWN, LEFT, RIGHT];
  const DR = [-1, 1, 0, 0];
  const DC = [0, 0, -1, 1];
  const PERP = [[2, 3], [2, 3], [0, 1], [0, 1]];   // sidestep directions when a jump is blocked

  const WIN = 1 << 20;            // a proven win scores near this
  const RACE_SURE = 2;            // step margin beyond which a no-walls race cannot be flipped
  const PROVEN = WIN - 100000;    // |score| above this means "proven", not "estimated"
  const INF = 1 << 24;
  const MOVE_NONE = -1;

  // move encoding: (index << 2) | (orient << 1) | kind
  //   kind 0 = pawn move, index = destination cell
  //   kind 1 = wall,      index = junction, orient 0 = horizontal, 1 = vertical
  const mvPawn = cell => (cell << 2);
  const mvWall = (j, orient) => (j << 2) | (orient << 1) | 1;
  const mvKind = m => m & 1;
  const mvOrient = m => (m >> 1) & 1;
  const mvIndex = m => m >> 2;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =====================================================================
  //  position
  // =====================================================================

  // Wall geometry, cached per board size. A wall spans two cells, so it runs between three
  // grid points (the corners of the cells). Knowing those points — and which of them lie on
  // the board's outer edge — is what makes the "can this wall have cut someone off?" test
  // O(1) instead of a search. See mayCut().
  const geoCache = new Map();
  function geometry(rows, cols) {
    const ck = rows + 'x' + cols;
    let g = geoCache.get(ck);
    if (g) return g;
    const JW = cols - 1, JH = rows - 1, JN = JW * JH, GW = cols + 1;
    const pt = new Int32Array(2 * JN * 3), border = new Uint8Array(2 * JN * 3);
    for (let o = 0; o < 2; o++) {
      for (let j = 0; j < JN; j++) {
        const jr = (j / JW) | 0, jc = j - jr * JW;
        for (let k = 0; k < 3; k++) {
          // horizontal wall: along the line below row jr, from column jc to jc+2
          // vertical wall:   along the line right of column jc, from row jr to jr+2
          const gr = o === 0 ? jr + 1 : jr + k;
          const gc = o === 0 ? jc + k : jc + 1;
          const idx = (o * JN + j) * 3 + k;
          pt[idx] = gr * GW + gc;
          border[idx] = (gr === 0 || gr === rows || gc === 0 || gc === cols) ? 1 : 0;
        }
      }
    }
    g = { pt, border, points: (rows + 1) * GW };
    geoCache.set(ck, g);
    return g;
  }

  const zobCache = new Map();
  function zobrist(rows, cols) {
    const ck = rows + 'x' + cols;
    let z = zobCache.get(ck);
    if (z) return z;
    const N = rows * cols, JN = (rows - 1) * (cols - 1);
    const rnd = mulberry32(0x9E3779B9 ^ (rows * 131 + cols));
    const u32 = n => { const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = (rnd() * 4294967296) >>> 0; return a; };
    z = {
      pawnLo: [u32(N), u32(N)], pawnHi: [u32(N), u32(N)],
      wallLo: [u32(JN), u32(JN)], wallHi: [u32(JN), u32(JN)],   // [orient][junction]
      handLo: [u32(32), u32(32)], handHi: [u32(32), u32(32)],
      turnLo: (rnd() * 4294967296) >>> 0, turnHi: (rnd() * 4294967296) >>> 0,
    };
    zobCache.set(ck, z);
    return z;
  }

  function create(opts) {
    const o = opts || {};
    const rows = o.rows || 9, cols = o.cols || 9;
    const N = rows * cols, JW = cols - 1, JH = rows - 1, JN = JW * JH;
    const pos = {
      rows, cols, N, JW, JH, JN,
      adj: new Uint8Array(N),
      wall: [new Uint8Array(JN), new Uint8Array(JN)],   // [orient][junction]
      pawn: new Int32Array(2),
      hand: new Int32Array(2),
      goalRow: new Int32Array(2),
      wallsEach: 10,
      turn: 0,
      winner: -1,
      hashLo: 0, hashHi: 0,
      wLo: 0, wHi: 0,          // walls only — the key the path memo is built on
      z: zobrist(rows, cols),
      g: geometry(rows, cols),
      touch: null,             // walls meeting at each grid point
      // scratch
      dist: [new Int16Array(N), new Int16Array(N)],
      bfsQ: new Int32Array(N),
      bfsD: new Int16Array(N),
    };
    pos.touch = new Uint8Array(pos.g.points);
    pos.goalRow[0] = 0;
    pos.goalRow[1] = rows - 1;
    reset(pos, o.walls == null ? 10 : o.walls);
    return pos;
  }

  function reset(pos, wallsEach) {
    pos.wallsEach = wallsEach;
    const { rows, cols, N } = pos;
    pos.adj.fill(0);
    pos.touch.fill(0);
    pos.wLo = 0; pos.wHi = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let m = 0;
        if (r > 0) m |= UP;
        if (r < rows - 1) m |= DOWN;
        if (c > 0) m |= LEFT;
        if (c < cols - 1) m |= RIGHT;
        pos.adj[r * cols + c] = m;
      }
    }
    pos.wall[0].fill(0); pos.wall[1].fill(0);
    pos.pawn[0] = (rows - 1) * cols + (cols >> 1);
    pos.pawn[1] = 0 * cols + (cols >> 1);
    pos.hand[0] = pos.hand[1] = wallsEach;
    pos.turn = 0;
    pos.winner = -1;
    rehash(pos);
    return pos;
  }

  function rehash(pos) {
    const z = pos.z;
    let lo = 0, hi = 0;
    for (let p = 0; p < 2; p++) {
      lo ^= z.pawnLo[p][pos.pawn[p]]; hi ^= z.pawnHi[p][pos.pawn[p]];
      lo ^= z.handLo[p][pos.hand[p]]; hi ^= z.handHi[p][pos.hand[p]];
    }
    for (let o = 0; o < 2; o++) {
      for (let j = 0; j < pos.JN; j++) {
        if (pos.wall[o][j]) { lo ^= z.wallLo[o][j]; hi ^= z.wallHi[o][j]; }
      }
    }
    if (pos.turn) { lo ^= z.turnLo; hi ^= z.turnHi; }
    // keep both halves as signed int32, which is what ^= produces everywhere else —
    // mixing >>> 0 in here makes the same position hash to two different JS numbers
    pos.hashLo = lo | 0; pos.hashHi = hi | 0;
  }

  // =====================================================================
  //  walls
  // =====================================================================

  // A wall's four adjacency bits. Horizontal wall at junction (jr,jc) sits on the boundary
  // between rows jr and jr+1 and spans columns jc..jc+1; vertical is the transpose.
  function wallEdges(pos, orient, j, out) {
    const jr = (j / pos.JW) | 0, jc = j - jr * pos.JW, cols = pos.cols;
    const a = jr * cols + jc;
    if (orient === 0) {
      out[0] = a;             out[1] = DOWN;
      out[2] = a + 1;         out[3] = DOWN;
      out[4] = a + cols;      out[5] = UP;
      out[6] = a + cols + 1;  out[7] = UP;
    } else {
      out[0] = a;             out[1] = RIGHT;
      out[2] = a + cols;      out[3] = RIGHT;
      out[4] = a + 1;         out[5] = LEFT;
      out[6] = a + cols + 1;  out[7] = LEFT;
    }
  }
  const _edges = new Int32Array(8);

  // Geometric legality only (overlap and crossing). Cheap, O(1). It does NOT check that both
  // players keep a route home — that costs a BFS and the search gets it for free from the
  // evaluation it has to do at the child anyway.
  function wallFits(pos, orient, j) {
    if (pos.wall[0][j] || pos.wall[1][j]) return false;     // crossing: same junction, other way
    const JW = pos.JW;
    const jc = j % JW;
    if (orient === 0) {
      if (jc > 0 && pos.wall[0][j - 1]) return false;
      if (jc < JW - 1 && pos.wall[0][j + 1]) return false;
    } else {
      if (j - JW >= 0 && pos.wall[1][j - JW]) return false;
      if (j + JW < pos.JN && pos.wall[1][j + JW]) return false;
    }
    return true;
  }

  function addWall(pos, orient, j) {
    wallEdges(pos, orient, j, _edges);
    const adj = pos.adj;
    adj[_edges[0]] &= ~_edges[1];
    adj[_edges[2]] &= ~_edges[3];
    adj[_edges[4]] &= ~_edges[5];
    adj[_edges[6]] &= ~_edges[7];
    pos.wall[orient][j] = 1;
    const g = pos.g, b = (orient * pos.JN + j) * 3;
    pos.touch[g.pt[b]]++; pos.touch[g.pt[b + 1]]++; pos.touch[g.pt[b + 2]]++;
    pos.wLo ^= pos.z.wallLo[orient][j]; pos.wHi ^= pos.z.wallHi[orient][j];
  }
  function delWall(pos, orient, j) {
    wallEdges(pos, orient, j, _edges);
    const adj = pos.adj;
    adj[_edges[0]] |= _edges[1];
    adj[_edges[2]] |= _edges[3];
    adj[_edges[4]] |= _edges[5];
    adj[_edges[6]] |= _edges[7];
    pos.wall[orient][j] = 0;
    const g = pos.g, b = (orient * pos.JN + j) * 3;
    pos.touch[g.pt[b]]--; pos.touch[g.pt[b + 1]]--; pos.touch[g.pt[b + 2]]--;
    pos.wLo ^= pos.z.wallLo[orient][j]; pos.wHi ^= pos.z.wallHi[orient][j];
  }

  // =====================================================================
  //  shortest paths
  // =====================================================================

  // BFS from a player's whole goal row back across the board. Early-exits the moment the
  // pawn's cell is settled, which is the common case in the search.
  function distTo(pos, player) {
    const { cols, N, adj } = pos;
    const from = pos.pawn[player], goalRow = pos.goalRow[player];
    const d = pos.bfsD, q = pos.bfsQ;
    d.fill(-1);
    let head = 0, tail = 0;
    const base = goalRow * cols;
    for (let c = 0; c < cols; c++) { d[base + c] = 0; q[tail++] = base + c; }
    if (d[from] === 0) return 0;
    while (head < tail) {
      const cur = q[head++];
      const nd = d[cur] + 1, m = adj[cur];
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      for (let k = 0; k < 4; k++) {
        if (!(m & DBIT[k])) continue;
        const ni = (cr + DR[k]) * cols + (cc + DC[k]);
        if (d[ni] >= 0) continue;
        d[ni] = nd;
        if (ni === from) return nd;
        q[tail++] = ni;
      }
    }
    return -1;   // walled off
  }

  // Full distance map, kept when we need to walk the shortest path (for wall candidates).
  function distMap(pos, player, out) {
    const { cols, N, adj } = pos;
    const goalRow = pos.goalRow[player];
    out.fill(-1);
    const q = pos.bfsQ;
    let head = 0, tail = 0;
    const base = goalRow * cols;
    for (let c = 0; c < cols; c++) { out[base + c] = 0; q[tail++] = base + c; }
    while (head < tail) {
      const cur = q[head++];
      const nd = out[cur] + 1, m = adj[cur];
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      for (let k = 0; k < 4; k++) {
        if (!(m & DBIT[k])) continue;
        const ni = (cr + DR[k]) * cols + (cc + DC[k]);
        if (out[ni] >= 0) continue;
        out[ni] = nd; q[tail++] = ni;
      }
    }
    const d = out[pos.pawn[player]];
    const z = pos.z, kLo = (pos.wLo ^ z.pawnLo[player][pos.pawn[player]]) | 0;
    const i = kLo & DC_MASK;
    dcKey[i] = (pos.wHi ^ z.pawnHi[player][pos.pawn[player]]) | 0; dcVal[i] = d + 2;
    return d;
  }

  // Shortest paths are the single most expensive thing this engine does — about half the
  // search's time went into repeating them. They are also a pure function of (walls, this
  // pawn), so they memoise perfectly: the same wall layout is reached by a huge number of
  // move orders, and every one of them used to pay again. The table is never invalidated,
  // because the key says everything the answer depends on.
  // 22 bits, not 16. At 16 the cache held 65,536 entries and hit barely half the time, and the
  // half it missed was not new positions -- it was eviction. Measured over 9.6 million nodes per
  // variant, at an identical node count so nodes per second IS the result and no match is needed:
  //
  //   bits   memory   hit rate   BFS per node   nodes/s
  //     16    0.4 MB     48.2%       0.79          --
  //     20      5 MB     66.1%       0.52        +8.6%
  //     22     20 MB     80.8%       0.29       +19.4%
  //     24     80 MB     87.4%       0.19       +16.8%
  //
  // 24 hits MORE often and runs SLOWER: 80 MB no longer fits the processor's own caches, so a
  // probe costs more in memory latency than the shortest-path search it saves. The peak is 22.
  // Shortest paths are 22.8% of search time by profile, so cutting their work from 0.79 to 0.29
  // predicts about 11.5%... and the measured 19.4% is larger, because a cached distance also
  // spares the cache pressure the search itself would have caused.
  //
  // The value is Int8, not Int16: it stores distance + 2, and the longest shortest-path on a 9x9
  // board cannot exceed 80 even if it had to visit every cell (33 was the longest seen across
  // 200 games). Same speed, half the memory.
  const DC_BITS = 22, DC_SIZE = 1 << DC_BITS, DC_MASK = DC_SIZE - 1;
  const dcKey = new Int32Array(DC_SIZE);
  const dcVal = new Int8Array(DC_SIZE);      // 0 = empty; otherwise distance + 2, so -1 fits
  let dcHit = 0, dcMiss = 0;

  function pathLen(pos, player) {
    const z = pos.z, cell = pos.pawn[player];
    const kLo = (pos.wLo ^ z.pawnLo[player][cell]) | 0;
    const kHi = (pos.wHi ^ z.pawnHi[player][cell]) | 0;
    const i = kLo & DC_MASK;
    if (dcVal[i] !== 0 && dcKey[i] === kHi) { dcHit++; return dcVal[i] - 2; }
    dcMiss++;
    const d = distTo(pos, player);
    dcKey[i] = kHi; dcVal[i] = d + 2;
    return d;
  }

  function bothHavePath(pos) {
    return pathLen(pos, 0) >= 0 && pathLen(pos, 1) >= 0;
  }

  // Could the wall just placed at (orient, j) have cut somebody off? A wall only traps a
  // player by closing a barrier — a chain of walls running from one edge of the board to
  // another, or a ring around a region. The new wall would be a link in that chain, so the
  // chain has to carry on from two of the three grid points the wall touches, each one
  // either running into the board's edge or meeting a wall that was already there. With
  // fewer than two such points nothing can have closed, and the route check can be skipped.
  //
  // It is a filter, not an answer: it never misses a real cut, it only declines to ask when
  // asking is pointless. On an empty board it declines almost every time, which is most of
  // the opening. (touch > 1 rather than > 0 because the new wall counts itself.)
  function mayCut(pos, orient, j) {
    const g = pos.g, b = (orient * pos.JN + j) * 3, t = pos.touch;
    let anchors = 0;
    if (g.border[b] || t[g.pt[b]] > 1) anchors++;
    if (g.border[b + 1] || t[g.pt[b + 1]] > 1) anchors++;
    if (g.border[b + 2] || t[g.pt[b + 2]] > 1) anchors++;
    return anchors >= 2;
  }

  // Both players still have a route home after this wall. Same answer as bothHavePath(),
  // reached without a search in the common case.
  function wallLegal(pos, orient, j) {
    return !mayCut(pos, orient, j) || bothHavePath(pos);
  }

  // =====================================================================
  //  make / unmake
  // =====================================================================

  function makeMove(pos, m) {
    const z = pos.z, me = pos.turn;
    if (mvKind(m) === 0) {
      const to = mvIndex(m), from = pos.pawn[me];
      pos.hashLo ^= z.pawnLo[me][from] ^ z.pawnLo[me][to];
      pos.hashHi ^= z.pawnHi[me][from] ^ z.pawnHi[me][to];
      pos.pawn[me] = to;
      if (((to / pos.cols) | 0) === pos.goalRow[me]) pos.winner = me;
    } else {
      const j = mvIndex(m), o = mvOrient(m);
      addWall(pos, o, j);
      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];
      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];
      pos.hand[me]--;
      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];
    }
    pos.turn = 1 - me;
    pos.hashLo ^= z.turnLo; pos.hashHi ^= z.turnHi;
  }

  function unmakeMove(pos, m, fromCell) {
    const z = pos.z;
    pos.turn = 1 - pos.turn;
    pos.hashLo ^= z.turnLo; pos.hashHi ^= z.turnHi;
    const me = pos.turn;
    if (mvKind(m) === 0) {
      const to = mvIndex(m);
      pos.hashLo ^= z.pawnLo[me][to] ^ z.pawnLo[me][fromCell];
      pos.hashHi ^= z.pawnHi[me][to] ^ z.pawnHi[me][fromCell];
      pos.pawn[me] = fromCell;
      pos.winner = -1;
    } else {
      const j = mvIndex(m), o = mvOrient(m);
      delWall(pos, o, j);
      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];
      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];
      pos.hand[me]++;
      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];
    }
  }

  // =====================================================================
  //  pawn moves (with the jump rules)
  // =====================================================================

  function pawnMoves(pos, player, out) {
    const { cols, adj } = pos;
    const from = pos.pawn[player], other = pos.pawn[1 - player];
    const fr = (from / cols) | 0, fc = from - fr * cols;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      if (!(adj[from] & DBIT[k])) continue;
      const nr = fr + DR[k], nc = fc + DC[k], ni = nr * cols + nc;
      if (ni !== other) { out[n++] = ni; continue; }
      // a pawn is in the way: try to hop straight over it
      const jr = nr + DR[k], jc = nc + DC[k];
      if ((adj[ni] & DBIT[k]) && jr >= 0 && jr < pos.rows && jc >= 0 && jc < cols) {
        out[n++] = jr * cols + jc;
      } else {
        // blocked behind them, so step around the side
        const pr = PERP[k];
        for (let t = 0; t < 2; t++) {
          const d = pr[t];
          if (!(adj[ni] & DBIT[d])) continue;
          const sr = nr + DR[d], sc = nc + DC[d];
          out[n++] = sr * cols + sc;
        }
      }
    }
    // dedupe (a sidestep can coincide with a plain step)
    let w = 0;
    for (let i = 0; i < n; i++) {
      let dup = false;
      for (let t = 0; t < w; t++) if (out[t] === out[i]) { dup = true; break; }
      if (!dup) out[w++] = out[i];
    }
    return w;
  }

  // =====================================================================
  //  evaluation
  // =====================================================================

  // Tuned by logistic regression against self-play outcomes (see tune.js). The units are
  // centi-somethings; evalToWinProb turns a score into a win probability for the eval bar.
  // Playing weights are tuned by self-play match results, not by regression on game
  // outcomes: a regression reads "still holding walls" as a cause of winning when it is
  // mostly a symptom of already being ahead, and an engine that believes that never places
  // a wall at all. W.scale is different — it is pure calibration, fitted afterwards so the
  // eval bar's percentage means what it says.
  const W = {
    dist: 100,        // per step of shortest-path advantage — dominates, as it should
    hand: 130,        // per spare wall. Tuned by match play, and much larger than it looks:
                      // a wall is worth 1.3 steps IN HAND, so the engine only spends one when
                      // it buys more than that. At 18 it dumped all ten walls in the opening
                      // and then had nothing left to answer with.
    tempo: 50,        // side to move. The race identity fixes this: with both players simply
                      // advancing, a full round changes nothing, and that is true only at
                      // dist/2. Any other value makes the engine think plain racing creates
                      // ground out of nothing, which is what drives the even-odd wobble.
    prog: 0,          // row progress: tuned to zero — the path length already says this
    phase: 0,         // path advantage scaled by how spent the wall supply is. The outcome
                      // regression loved this term; match play rejected it at 25-31%, which is
                      // the whole reason playing weights are tuned by playing.
    scale: 440,       // logistic scale for win probability. Fitted separately from the
                      // playing weights, on 13k self-play positions: a position this eval
                      // calls 75% really does win about 77% of the time.
  };

  // ---- is this route beyond reach? ----
  // The counting rule needs one thing: that the route can never be made longer. Having no
  // walls left is the obvious way for that to hold, and it is what the rule used to demand.
  // It is not the only way: a player holding six walls with nowhere legal to put one that
  // touches the runner's route is, for this purpose, out of walls.
  //
  // The test has to be about EVERY shortest route, not the length of the current one. Asking
  // only "does one wall make the route longer" proves a fact about one move and claims a fact
  // about the rest of the game — a wall can cut one shortest route while another survives,
  // and a second wall then finishes the job. Measured, that version lied in 3 of 54 positions.
  //
  // Asking instead "can any legal wall cut ANY step that lies on a shortest route" is sound,
  // and stays sound as the game goes on: a wall placed away from those steps leaves them all
  // open, so the route is still there and the same set of steps still describes it; and a wall
  // that is illegal now stays illegal, because walls only ever accumulate.
  const RACE_FIX_MAX = 4;          // only worth asking about a route this short
  let fixMap = null, fixMark = null, fixSeen = null, fixStack = null;
  function routeFixed(pos, p, d0) {
    if (pos.hand[1 - p] === 0) return true;
    if (d0 < 1 || d0 > RACE_FIX_MAX) return false;
    const { cols, N, JW, JH, JN, adj } = pos;
    if (!fixMap || fixMap.length !== N) fixMap = new Int16Array(N);
    if (!fixMark || fixMark.length !== JN * 2) fixMark = new Uint8Array(JN * 2);
    if (distMap(pos, p, fixMap) < 0) return false;
    fixMark.fill(0);
    // Walk forward from the pawn along steps that reduce the distance. That reaches exactly
    // the squares a shortest route can pass through, and nothing else matters: the distance
    // map alone would have marked the whole goal edge, most of which the runner can never
    // reach, and a legal wall out there would have vetoed every position.
    if (!fixSeen || fixSeen.length !== N) { fixSeen = new Uint8Array(N); fixStack = new Int32Array(N); }
    fixSeen.fill(0);
    let sp = 0;
    fixStack[sp++] = pos.pawn[p]; fixSeen[pos.pawn[p]] = 1;
    while (sp > 0) {
      const i = fixStack[--sp];
      const d = fixMap[i];
      if (d < 1) continue;
      const cr = (i / cols) | 0, cc = i - cr * cols, m = adj[i];
      for (let k = 0; k < 4; k++) {
        if (!(m & DBIT[k])) continue;
        const nr = cr + DR[k], nc = cc + DC[k];
        const ni = nr * cols + nc;
        if (fixMap[ni] !== d - 1) continue;
        if (!fixSeen[ni]) { fixSeen[ni] = 1; fixStack[sp++] = ni; }
        if (k < 2) {                       // up or down: cut by a horizontal wall
          const jr = cr < nr ? cr : nr;
          for (let jc = cc - 1; jc <= cc; jc++)
            if (jc >= 0 && jc < JW && jr >= 0 && jr < JH) fixMark[jr * JW + jc] = 1;
        } else {                           // left or right: cut by a vertical wall
          const jc = cc < nc ? cc : nc;
          for (let jr = cr - 1; jr <= cr; jr++)
            if (jr >= 0 && jr < JH && jc >= 0 && jc < JW) fixMark[JN + jr * JW + jc] = 1;
        }
      }
    }
    for (let o = 0; o < 2; o++) {
      const off = o * JN;
      for (let j = 0; j < JN; j++) {
        if (!fixMark[off + j] || !wallFits(pos, o, j)) continue;
        addWall(pos, o, j);
        const legal = wallLegal(pos, o, j);
        delWall(pos, o, j);
        if (legal) return false;          // they can still touch the route: nothing is settled
      }
    }
    return true;
  }

  function evaluate(pos) {
    const me = pos.turn, opp = 1 - me;
    const dme = pathLen(pos, me), dopp = pathLen(pos, opp);
    if (dme < 0) return -WIN;      // cannot happen in legal play, but be safe
    if (dopp < 0) return WIN;

    // No walls left anywhere: nothing can lengthen either path again, so the game is a pure
    // race and counting decides it -- the mover needs dme moves and goes first, so they win
    // when dme <= dopp.
    //
    // With one caveat, which retrograde analysis of the whole 81x81x2 endgame space turned
    // up: the shortest paths ignore the other pawn, and a jump covers two cells in one move.
    // So a pawn meeting can swing the race by a tempo, and inside a margin of one step the
    // count is wrong about 1.7% of the time. Outside that margin it is exact. So we only
    // claim a proven result when the margin is safe, and otherwise hand back an ordinary
    // heuristic score and let the search play the race out -- which is cheap, because with
    // no walls left only pawn moves remain and the transposition table collapses the
    // position to at most rows*cols*rows*cols*2 distinct states.
    //
    // And it does not take two empty hands, only the right one. A route can only be made
    // longer by the OTHER player's walls, so once they are out, mine is fixed and counting
    // settles my side of the race:
    //
    //   * the opponent cannot wall any more -> my distance can never grow, and theirs can
    //     only grow (I may still wall them), so being ahead by the margin is a proven win;
    //   * I cannot wall any more -> their distance can never grow, and mine can only grow,
    //     so being behind by the margin is a proven loss.
    //
    // Requiring both hands empty left the commonest decided endgame of all — one player out
    // of walls, the other holding a few they can no longer use in time — reported as a
    // percentage when it was already settled.
    const m = dopp - dme;
    if (m >= RACE_SURE && routeFixed(pos, me, dme)) return WIN - 1000 - dme;
    if (m <= -RACE_SURE && routeFixed(pos, opp, dopp)) return -(WIN - 1000 - dopp);
    if (pos.hand[0] === 0 && pos.hand[1] === 0) return W.dist * m + W.tempo;

    // Everything above is exact or a counting identity; only what follows is a guess, so only
    // what follows is the network's business.
    if (netW1 !== null) return netEval(pos);

    const margin = dopp - dme;
    const spent = 1 - (pos.hand[0] + pos.hand[1]) / (2 * pos.wallsEach || 1);
    let s = W.dist * margin + W.hand * (pos.hand[me] - pos.hand[opp]) + W.tempo
          + W.phase * margin * spent;
    // progress tiebreak: being physically closer to the goal row is worth a hair more than
    // the raw step count suggests, because it leaves the opponent fewer useful wall squares
    const rme = (pos.pawn[me] / pos.cols) | 0, ropp = (pos.pawn[opp] / pos.cols) | 0;
    const pme = Math.abs(rme - pos.goalRow[me]), popp = Math.abs(ropp - pos.goalRow[opp]);
    s += W.prog * (popp - pme);
    return s;
  }

  function evalToWinProb(score) {
    if (score >= PROVEN) return 1;
    if (score <= -PROVEN) return 0;
    return 1 / (1 + Math.exp(-score / W.scale));
  }

  // =====================================================================
  //  exact endgames — the tablebase
  // =====================================================================
  //
  // Stockfish stops guessing in simple endings and looks the answer up in a tablebase. The
  // same thing is available here, and it is cheaper, because the hard part of a chess
  // tablebase — there are too many positions to store — does not arise. Once both players
  // are out of walls the board can never change again, so the rest of the game is a pursuit
  // on a fixed graph with exactly (rows*cols)^2 * 2 positions: 13,122 on a 9x9. That is
  // small enough to solve outright, by working backwards from the positions that are
  // already won, in a few milliseconds.
  //
  // The result is not an estimate. It is the game-theoretic value of every position the
  // ending can reach, with the exact number of moves. It supersedes the counting rule in
  // evaluate() in the cases that rule cannot see: shortest paths ignore the other pawn, and
  // a jump covers two cells, so a pawn standing in the way is worth a tempo and inside a
  // one-step margin plain counting is wrong about 1.7% of the time.
  //
  // It also settles how to play a lost ending, for free and correctly. A table that knows
  // the distance to the end picks the move that puts it off longest, which is the most
  // resistance the position allows — the same reason Syzygy stores a distance and not just
  // a win/draw/loss.
  const TB_UNKNOWN = 0, TB_WIN = 1, TB_LOSS = 2;
  const TB_MAX_STATES = 300000;     // a 12x12 board; past that, fall back on the search
  const TB_SUCC = 6;                // most pawn moves a position can offer
  const tbCache = new Map();
  let tbBuilds = 0, tbBuildMs = 0;

  // A position in the ending, from the mover's side: which cells the two pawns are on and
  // whose turn it is.
  const tbState = (N, a, b, turn) => ((a * N + b) << 1) | turn;

  function solveRace(pos) {
    const N = pos.N, S = N * N * 2;
    if (S > TB_MAX_STATES) return null;
    const key = (pos.wLo >>> 0) + ':' + (pos.wHi >>> 0) + ':' + pos.rows + 'x' + pos.cols;
    const hit = tbCache.get(key);
    if (hit) return hit;

    const t0 = now();
    const flag = new Uint8Array(S);
    const dist = new Int16Array(S);
    const succ = new Int32Array(S * TB_SUCC);
    const deg = new Uint8Array(S);
    const buf = new Int32Array(8);
    const g0 = pos.goalRow[0], g1 = pos.goalRow[1], cols = pos.cols;

    // the ending is being solved for a board, not for the position we happen to be in
    const sa = pos.pawn[0], sb = pos.pawn[1], st = pos.turn;

    const queue = new Int32Array(S);
    let qh = 0, qt = 0;

    for (let a = 0; a < N; a++) {
      if (((a / cols) | 0) === g0) continue;           // player 0 already home: game over
      for (let b = 0; b < N; b++) {
        if (b === a) continue;
        if (((b / cols) | 0) === g1) continue;         // player 1 already home
        pos.pawn[0] = a; pos.pawn[1] = b;
        for (let turn = 0; turn < 2; turn++) {
          const s = tbState(N, a, b, turn);
          const goal = turn === 0 ? g0 : g1;
          const np = pawnMoves(pos, turn, buf);
          let won = false, k = 0;
          for (let i = 0; i < np; i++) {
            const to = buf[i];
            if (((to / cols) | 0) === goal) { won = true; break; }   // steps onto the goal row
            if (k < TB_SUCC) succ[s * TB_SUCC + k++] = turn === 0 ? tbState(N, to, b, 1)
                                                                  : tbState(N, a, to, 0);
          }
          if (won) { flag[s] = TB_WIN; dist[s] = 1; queue[qt++] = s; deg[s] = 0; }
          else if (k === 0) { flag[s] = TB_LOSS; dist[s] = 0; queue[qt++] = s; }
          else deg[s] = k;
        }
      }
    }
    pos.pawn[0] = sa; pos.pawn[1] = sb; pos.turn = st;

    // Working backwards needs the edges the other way round: given a position, which
    // positions can reach it. Counting sort over the forward lists builds that in one pass.
    const rstart = new Int32Array(S + 1);
    for (let s = 0; s < S; s++) {
      const k = deg[s];        // resolved positions need no incoming edges: nothing can change them
      for (let i = 0; i < k; i++) rstart[succ[s * TB_SUCC + i] + 1]++;
    }
    for (let i = 0; i < S; i++) rstart[i + 1] += rstart[i];
    const rlist = new Int32Array(rstart[S]);
    const fill = rstart.slice(0, S);
    for (let s = 0; s < S; s++) {
      const k = deg[s];
      for (let i = 0; i < k; i++) rlist[fill[succ[s * TB_SUCC + i]]++] = s;
    }

    // Retrograde analysis. A position is won if any move reaches a position the opponent
    // loses from; it is lost when every move reaches one the opponent wins from. Walking
    // outwards from the already-decided positions in breadth-first order means the first
    // win found for a position is its fastest, and the last loss counted is its slowest.
    while (qh < qt) {
      const s = queue[qh++];
      const sLoses = flag[s] === TB_LOSS;
      for (let e = rstart[s]; e < rstart[s + 1]; e++) {
        const p = rlist[e];
        if (flag[p] !== TB_UNKNOWN) continue;
        if (sLoses) { flag[p] = TB_WIN; dist[p] = dist[s] + 1; queue[qt++] = p; }
        else if (--deg[p] === 0) { flag[p] = TB_LOSS; dist[p] = dist[s] + 1; queue[qt++] = p; }
      }
    }

    const tb = { N, flag, dist, states: S, resolved: qt };
    tbBuilds++; tbBuildMs += now() - t0;
    if (tbCache.size >= 6) tbCache.clear();
    tbCache.set(key, tb);
    return tb;
  }

  // Look the position up. Returns the best move and an exact score for EVERY legal move —
  // the review needs all of them to grade what was actually played — or null when the
  // ending does not apply (walls still in hand) or the board is too big to solve.
  //
  // The scores are arranged so that simply taking the largest is right in both directions:
  // a win scores higher the sooner it comes, and a loss scores higher the longer it takes,
  // so "play the best move" and "hold out as long as possible" are the same instruction.
  let tbNear = null;
  function probeRace(pos) {
    if (pos.hand[0] !== 0 || pos.hand[1] !== 0) return null;
    const tb = solveRace(pos);
    if (!tb) return null;
    const N = pos.N, cols = pos.cols, me = pos.turn;
    const goal = pos.goalRow[me];
    const buf = new Int32Array(8);
    const np = pawnMoves(pos, me, buf);
    const scored = [];
    for (let i = 0; i < np; i++) {
      const to = buf[i], mv = mvPawn(to);
      if (((to / cols) | 0) === goal) { scored.push({ move: mv, score: WIN - 1000 - 1, dist: 1, to }); continue; }
      const child = me === 0 ? tbState(N, to, pos.pawn[1], 1) : tbState(N, pos.pawn[0], to, 0);
      const f = tb.flag[child], d = tb.dist[child] + 1;
      if (f === TB_LOSS) scored.push({ move: mv, score: WIN - 1000 - d, dist: d, to });        // they lose: we win in d
      else if (f === TB_WIN) scored.push({ move: mv, score: -(WIN - 1000 - d), dist: d, to }); // they win: we lose in d
      else scored.push({ move: mv, score: 0, dist: 0, to });                                   // neither can force it
    }
    if (!scored.length) return null;
    // Ties go to the move that ends nearest home. Strict `>` alone left them to move-generation
    // order, which is arbitrary -- and in a lost race EVERY move loses by the same margin, so
    // every move ties and the pawn stayed where it was. Seen against Ishtar over a real game:
    // Path sat on a proven loss for sixty moves, stepping back and forth between two squares.
    // Ishtar then blundered, and Path only won because that shuffle happened not to drift away
    // from the goal; two squares further out and the mistake would have been unpunishable.
    //
    // This cannot cost anything against perfect play -- the score is unchanged and so is the
    // result -- and the opponents that exist are not perfect.
    if (!tbNear || tbNear.length !== N) tbNear = new Int16Array(N);
    distMap(pos, me, tbNear);
    const near = (x) => { const d = tbNear[x.to]; return d < 0 ? 1e9 : d; };
    let bi = 0;
    for (let i = 1; i < scored.length; i++) {
      if (scored[i].score > scored[bi].score) { bi = i; continue; }
      if (scored[i].score === scored[bi].score && near(scored[i]) < near(scored[bi])) bi = i;
    }
    const pick = scored[bi];
    scored.sort((x, y) => y.score - x.score);
    return { best: pick.move, score: pick.score, dist: pick.dist, moves: scored };
  }

  // =====================================================================
  //  transposition table
  // =====================================================================

  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  const NO_EVAL = 0x7fffffff;         // "this slot has no cached static evaluation"
  // 2^21 entries, about 40 MB. Wall placements commute, so the same position is reached an
  // enormous number of ways and this table is where that saving lives -- and it was the largest
  // confirmed lever in the engine. Measured directly against 2^20 with the self-play control
  // printing exactly 50.0%: 2^20 scores 24.6% +/- 7.7 at 150 000 nodes (a phone's budget) and
  // 22.9% at 500 000 (a desktop's), about 200 Elo either way. 2^22 and 2^23 measured level with
  // 2^21, so this is the knee: the memory past here buys nothing.
  let ttBits = 21, ttSize = 1 << ttBits, ttMask = ttSize - 1;
  let ttKey = new Int32Array(ttSize);
  let ttMove = new Int32Array(ttSize);
  let ttScore = new Int32Array(ttSize);
  // The static evaluation of the position, cached beside the score. Two shortest paths is
  // the most expensive thing a node does, and a node is visited far more often than it is
  // searched to a useful depth, so keeping the number is worth the four bytes.
  let ttEval = new Int32Array(ttSize).fill(NO_EVAL);
  // Filled with -1, exactly as clearTable() and setTableBits() do it, and for the reason spelled
  // out there: an untouched slot's key is 0, so the one position in four billion whose hash high
  // word is also 0 matches it, and a depth of 0 would pass the depth test and hand that position
  // a score nobody ever stored. Both other places that build this array knew that; the initial
  // allocation did not, which left the hole open until the first clearTable().
  let ttDepth = new Int8Array(ttSize).fill(-1);
  let ttFlag = new Uint8Array(ttSize);
  let ttGen = new Uint8Array(ttSize);
  let generation = 0;

  function setTableBits(bits) {
    ttBits = bits; ttSize = 1 << bits; ttMask = ttSize - 1;
    ttKey = new Int32Array(ttSize); ttMove = new Int32Array(ttSize);
    ttScore = new Int32Array(ttSize); ttEval = new Int32Array(ttSize).fill(NO_EVAL);
    ttDepth = new Int8Array(ttSize).fill(-1);
    ttFlag = new Uint8Array(ttSize); ttGen = new Uint8Array(ttSize);
  }
  function clearTable() {
    // Depth -1, not 0. An empty slot's key is 0, so the one position in four billion whose
    // hash high word is also 0 matches it — and the probe runs before the depth<=0 return,
    // so a depth of 0 would have let that position read a score nobody ever stored.
    ttKey.fill(0); ttDepth.fill(-1); ttMove.fill(0); ttGen.fill(0); ttEval.fill(NO_EVAL);
    ttScore.fill(0); ttFlag.fill(0);
  }

  // =====================================================================
  //  search
  // =====================================================================

  const MAX_PLY = 64;

  // "I win in 3 moves from here" is measured from the NODE, not from the board, so a score
  // like WIN - ply cannot be stored raw: the same position is reached at different depths
  // all the time (wall placements commute, so transpositions are everywhere here), and a
  // value saved at ply 6 read back at ply 2 would claim a win four moves further away than
  // it is. Stored distances are therefore made absolute on the way in and relative again on
  // the way out. Only true mate scores are touched — a solved race scores WIN - 1000 - d,
  // which is a property of the position and already absolute, and sits well below this line.
  const MATE_FLOOR = WIN - MAX_PLY;
  const ttIn  = (sc, ply) => sc > MATE_FLOOR ? sc + ply : (sc < -MATE_FLOOR ? sc - ply : sc);
  const ttOut = (sc, ply) => sc > MATE_FLOOR ? sc - ply : (sc < -MATE_FLOOR ? sc + ply : sc);
  let nodes = 0, deadline = 0, aborted = false, nodeCap = 0;
  // Verification switches. Alpha-beta and the transposition table must not change the value
  // of the tree at all; reductions and the forward pruning below are allowed to, which is
  // why they can be turned off separately. searchtest.js compares this search against a
  // plain minimax with them off, and that comparison is the only thing keeping the rest of
  // this file honest.
  let useTT = true, useLMR = true, usePrune = true;
  const killers = new Int32Array(MAX_PLY * 2);
  // Butterfly history, one table per side. How often a move caused a cutoff, anywhere in
  // the tree. Kept per side because the two players want opposite walls.
  const HIST_MAX = 12000;
  let history = new Int32Array(2 * 2048);
  // Stockfish's update rule rather than a plain running total: the entry is pulled towards
  // the bonus rather than accumulating without limit, so an early streak cannot pin a move
  // at the top of the ordering for the rest of the search, and a move that stops working
  // decays on its own.
  function histBonus(side, m, bonus) {
    const i = side * 2048 + (m & 2047);
    const b = bonus > HIST_MAX ? HIST_MAX : (bonus < -HIST_MAX ? -HIST_MAX : bonus);
    history[i] += b - ((history[i] * (b < 0 ? -b : b)) / HIST_MAX) | 0;
  }

  const pvTable = [];
  for (let i = 0; i < MAX_PLY; i++) pvTable.push(new Int32Array(MAX_PLY));
  const pvLen = new Int32Array(MAX_PLY);
  const evalStack = new Int32Array(MAX_PLY);     // static eval per ply, for "improving"
  const quietsTried = [];                        // moves that did not cut, for the malus
  for (let i = 0; i < MAX_PLY; i++) quietsTried.push(new Int32Array(64));

  // Late move reductions. Same shape Stockfish uses — log(depth) x log(move number) — so
  // the reduction grows slowly with depth and fast with how late a move is tried. Held in
  // 1024ths of a ply so the history adjustment below can nudge it by less than a whole ply.
  //
  // The shape transferred; WHEN to start did not, and that turned out to be the whole
  // story. Reductions rest on the assumption that if the best move were any good the
  // ordering would have found it by now. Chess ordering earns that after a move or two.
  // This game's does not: around fifty candidates a node, most of them walls, and the
  // heuristics that rank walls cannot tell the one that works from a dozen that look
  // identical. Reducing from the third move on measured 43% against no reductions at all;
  // from the seventh, 55%; from the thirteenth, 58%; and dropping the extra ply that
  // expected-cutoff nodes used to get took it to 60%. Softening the reduction itself
  // barely moved (43% to 47.5%) — it was never how hard, only how soon.
  const LMR_N = 64;
  const lmrTab = new Int32Array(LMR_N * LMR_N);
  let lmrBase = 0.25, lmrScale = 0.48;
  function buildLmr() {
    for (let d = 1; d < LMR_N; d++)
      for (let m = 1; m < LMR_N; m++)
        lmrTab[d * LMR_N + m] = Math.round(1024 * (lmrBase + lmrScale * Math.log(d) * Math.log(m)));
  }
  buildLmr();
  let futMargin = 60, nullBase = 2, lmrHist = 1024, lmrMin = 12;

  // Move-count pruning: past this many tried moves at shallow depth, the rest are not worth
  // looking at at all. The numbers are Stockfish's (3 + depth^2). Note how much later this
  // bites than the reductions above — at depth 3 it is the 13th move, at depth 5 the 29th —
  // which is the same lesson from the other side: cutting off the tail of this game's move
  // list is safe, touching its head is not.
  const LMP = new Int32Array(16);
  for (let d = 0; d < 16; d++) LMP[d] = 3 + d * d;

  // move buffers, one per ply, so generation never allocates inside the search
  const moveBuf = [], scoreBuf = [], pawnBuf = new Int32Array(8);
  for (let i = 0; i < MAX_PLY; i++) { moveBuf.push(new Int32Array(320)); scoreBuf.push(new Int32Array(320)); }
  const pathMap = [];   // per-ply distance map for wall candidate generation

  function ensurePathMaps(N) {
    if (pathMap.length && pathMap[0].length === N) return;
    pathMap.length = 0;
    for (let i = 0; i < MAX_PLY; i++) pathMap.push(new Int16Array(N));
  }

  // Candidate walls: the ones that could plausibly matter. A wall is worth looking at if it
  // sits on the opponent's current shortest path (it costs them time), on our own (the
  // opponent may want it, so we must see it coming), touches a wall already on the board
  // (barriers get extended), or is next to either pawn. That is roughly 25-45 of the ~128
  // walls on an empty 9x9, and the ones left out are almost always irrelevant.
  function genMoves(pos, ply, ttMv, depth) {
    const { cols, rows, JW, JH, JN } = pos;
    const buf = moveBuf[ply], sc = scoreBuf[ply];
    const me = pos.turn, opp = 1 - me;
    let n = 0;

    // --- pawn moves ---
    const np = pawnMoves(pos, me, pawnBuf);
    const goal = pos.goalRow[me];
    const myRow = (pos.pawn[me] / cols) | 0;
    for (let i = 0; i < np; i++) {
      const to = pawnBuf[i];
      const m = mvPawn(to);
      const tr = (to / cols) | 0;
      let s = 100000;
      if (tr === goal) s = 2000000;                                  // wins on the spot
      else s += (Math.abs(myRow - goal) - Math.abs(tr - goal)) * 400; // toward the goal
      if (m === ttMv) s = 9000000;
      else if (m === killers[ply * 2]) s = 1500000;
      else if (m === killers[ply * 2 + 1]) s = 1400000;
      buf[n] = m; sc[n] = s; n++;
    }

    // --- wall moves ---
    if (pos.hand[me] > 0) {
      ensurePathMaps(pos.N);
      const pm = pathMap[ply];
      const onPath = _wallMark;
      onPath.fill(0, 0, JN * 2);

      // walls that lie across the opponent's shortest route
      if (distMap(pos, opp, pm) >= 0) markPathWalls(pos, opp, pm, onPath, 2);
      // and across ours
      if (distMap(pos, me, pm) >= 0) markPathWalls(pos, me, pm, onPath, 1);


      // walls touching an existing wall, and walls beside either pawn
      for (let o = 0; o < 2; o++) {
        for (let j = 0; j < JN; j++) {
          if (!pos.wall[o][j]) continue;
          const jr = (j / JW) | 0, jc = j - jr * JW;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = jr + dr, cc = jc + dc;
            if (rr < 0 || rr >= JH || cc < 0 || cc >= JW) continue;
            const k = rr * JW + cc;
            onPath[k] |= 4; onPath[JN + k] |= 4;
          }
        }
      }
      for (let p = 0; p < 2; p++) {
        const pr = (pos.pawn[p] / cols) | 0, pc = pos.pawn[p] - pr * cols;
        for (let dr = -2; dr <= 1; dr++) for (let dc = -2; dc <= 1; dc++) {
          const rr = pr + dr, cc = pc + dc;
          if (rr < 0 || rr >= JH || cc < 0 || cc >= JW) continue;
          const k = rr * JW + cc;
          onPath[k] |= 4; onPath[JN + k] |= 4;
        }
      }

      for (let o = 0; o < 2; o++) {
        for (let j = 0; j < JN; j++) {
          const tag = onPath[o * JN + j];
          if (!tag) continue;
          if (!wallFits(pos, o, j)) continue;
          const m = mvWall(j, o);
          let s;
          if (m === ttMv) s = 9000000;
          else if (m === killers[ply * 2]) s = 1500000;
          else if (m === killers[ply * 2 + 1]) s = 1400000;
          else {
            s = history[me * 2048 + (m & 2047)];
            if (tag & 2) s += 60000;    // on the opponent's path — the point of walling
            if (tag & 1) s += 8000;     // on ours — usually bad, but must be searched
            if (tag & 4) s += 3000;
          }
          buf[n] = m; sc[n] = s; n++;
          if (n >= 318) break;
        }
        if (n >= 318) break;
      }
    }
    return n;
  }

  const _wallMark = new Uint8Array(4096);

  // Walk the shortest path from a pawn to its goal and mark the walls that would cut each
  // step of it.
  function markPathWalls(pos, player, pm, onPath, bit) {
    const { cols, rows, JW, JH, JN } = pos;
    let cur = pos.pawn[player];
    let d = pm[cur];
    if (d < 0) return;
    let guard = 0;
    while (d > 0 && guard++ < 2 * pos.N) {
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      let nxt = -1, ndir = -1;
      for (let k = 0; k < 4; k++) {
        if (!(pos.adj[cur] & DBIT[k])) continue;
        const ni = (cr + DR[k]) * cols + (cc + DC[k]);
        if (pm[ni] === d - 1) { nxt = ni; ndir = k; break; }
      }
      if (nxt < 0) return;
      const nr = cr + DR[ndir], nc = cc + DC[ndir];
      if (ndir < 2) {
        // a vertical step is cut by a horizontal wall on the row boundary between them
        const jr = Math.min(cr, nr);
        for (let jc = cc - 1; jc <= cc; jc++) {
          if (jc < 0 || jc >= JW || jr < 0 || jr >= JH) continue;
          onPath[jr * JW + jc] |= bit;
        }
      } else {
        const jc = Math.min(cc, nc);
        for (let jr = cr - 1; jr <= cr; jr++) {
          if (jr < 0 || jr >= JH || jc < 0 || jc >= JW) continue;
          onPath[JN + jr * JW + jc] |= bit;
        }
      }
      cur = nxt; d--;
    }
  }

  // A null move: hand the turn over without doing anything. Not a legal move in the game —
  // it is a question. "If I could do nothing at all and still be winning by this much, is
  // there any point searching my real moves?" In chess that question is unsafe in zugzwang,
  // where being forced to move is itself the problem. Detour has a narrower version of the
  // same trap: a player with no walls left has only pawn moves, and in a pocket every one of
  // them can lose ground, so doing nothing really would be better than moving. Null moves
  // are therefore only asked by a player still holding a wall, who always has a quiet move
  // available and so is never in zugzwang.
  function makeNull(pos) {
    pos.turn = 1 - pos.turn;
    pos.hashLo ^= pos.z.turnLo; pos.hashHi ^= pos.z.turnHi;
  }

  function negamax(pos, depth, alpha, beta, ply, nullOk) {
    nodes++;
    if ((nodes & 511) === 0 && (now() > deadline || nodes > nodeCap)) { aborted = true; return 0; }
    pvLen[ply] = 0;

    const alphaOrig = alpha;
    const pvNode = beta - alpha > 1;

    // --- transposition probe ---
    const idx = pos.hashLo & ttMask;
    let ttMv = MOVE_NONE, cachedEval = NO_EVAL;
    if (useTT && ttKey[idx] === (pos.hashHi | 0)) {
      ttMv = ttMove[idx];
      cachedEval = ttEval[idx];
      if (ttDepth[idx] >= depth) {
        const sc = ttOut(ttScore[idx], ply), f = ttFlag[idx];
        // A PV node needs a real value, not a bound that happens to be good enough; cutting
        // here would leave the principal variation with a hole in it.
        if (!pvNode || f === TT_EXACT) {
          if (f === TT_EXACT) return sc;
          if (f === TT_LOWER && sc > alpha) alpha = sc;
          else if (f === TT_UPPER && sc < beta) beta = sc;
          if (alpha >= beta) return sc;
        }
      }
    }

    if (depth <= 0) return evaluate(pos);
    if (ply >= MAX_PLY - 2) return evaluate(pos);

    // With no walls left and a safe margin the race is already decided, so stop. A close
    // race falls through and gets searched out properly instead of being guessed at.
    const staticEval = cachedEval !== NO_EVAL ? cachedEval : evaluate(pos);
    // Writing the evaluation into a slot means CLAIMING that slot. It used to be written on
    // its own, leaving whatever key was already there: a position that missed the probe would
    // still overwrite the eval of the position holding the slot, and when that position came
    // back, its key matched, so it read someone else's evaluation and trusted it. Usually that
    // is a few points of noise. When the stolen number happened to be a settled race it was a
    // PROVEN score, and the position returned it without searching a node — the engine
    // announcing a won game it had never looked at. Measured on one such position: 140 with
    // the table off, a proven win with it on, at the same depth with every reduction disabled,
    // which is precisely the invariant the table is not allowed to break.
    if (useTT && cachedEval === NO_EVAL) {
      if (ttKey[idx] !== (pos.hashHi | 0)) {
        ttKey[idx] = pos.hashHi | 0;
        ttDepth[idx] = -1;                 // no score here yet, only an evaluation
        ttMove[idx] = MOVE_NONE;
        ttFlag[idx] = TT_EXACT;
        ttGen[idx] = generation;
      }
      ttEval[idx] = staticEval;
    }
    // A settled race needs no searching. evaluate() only returns a value this large when it
    // has counted one out, and that count is a property of the position rather than of the
    // path taken to it, so it can be returned as-is.
    if (staticEval >= PROVEN || staticEval <= -PROVEN) return staticEval;
    evalStack[ply] = staticEval;
    // "Improving": are we better off than we were on our previous turn? If so the position
    // is trending our way and we can afford to prune harder; if it is going badly we should
    // look more carefully. Same idea as Stockfish's improving flag.
    const improving = ply >= 2 && staticEval > evalStack[ply - 2];
    const decisive = beta >= PROVEN || beta <= -PROVEN || staticEval >= PROVEN || staticEval <= -PROVEN;

    if (usePrune && !pvNode && !decisive) {
      // Reverse futility. If the position is already so far above beta that the opponent
      // cannot plausibly claw it back in the plies we have left, take the static score.
      // The margin is in the eval's own units: 100 is one step of path, and a good wall
      // buys one to three steps, so about two steps a ply is the honest bound on how fast
      // this game's score can move.
      if (depth <= 6 && staticEval - (futMargin * depth - (improving ? 80 : 0)) >= beta) return staticEval;

      // Null move. Only asked by a side that still holds a wall (see makeNull), never twice
      // in a row, and never in a pure race where a tempo is the whole game.
      // `pos.hand[pos.turn] > 0` is the zugzwang guard and it already implies the hands are
      // not both empty, so the separate race test it used to carry was always true here.
      if (nullOk && depth >= 3 && staticEval >= beta && pos.hand[pos.turn] > 0) {
        const R = nullBase + ((depth / 4) | 0) + (staticEval - beta > 300 ? 1 : 0);
        makeNull(pos);
        const v = -negamax(pos, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        makeNull(pos);
        if (aborted) return 0;
        // A win proved only through a pass is not proved at all — let it be re-searched.
        if (v >= beta && v < PROVEN) return v;
      }
    }

    // Internal iterative reduction: no table move means no idea which move is best, and
    // searching a wide node in the dark to full depth mostly wastes the depth.
    // Gated with the reductions, because that is what it is. Left ungated, the exactness
    // test could not actually switch every reduction off, and would have quietly passed a
    // search that was still reducing.
    if (useLMR && depth >= 4 && ttMv === MOVE_NONE && !pvNode) depth--;

    const me = pos.turn;
    const fromCell = pos.pawn[me];
    const n = genMoves(pos, ply, ttMv, depth);
    if (n === 0) return evaluate(pos);

    let best = -INF, bestMove = MOVE_NONE, searched = 0, nQuiet = 0;
    const qt = quietsTried[ply];

    for (let i = 0; i < n; i++) {
      // selection sort: pull the best remaining move to the front
      let bi = i;
      for (let t = i + 1; t < n; t++) if (scoreBuf[ply][t] > scoreBuf[ply][bi]) bi = t;
      if (bi !== i) {
        const tm = moveBuf[ply][i]; moveBuf[ply][i] = moveBuf[ply][bi]; moveBuf[ply][bi] = tm;
        const ts = scoreBuf[ply][i]; scoreBuf[ply][i] = scoreBuf[ply][bi]; scoreBuf[ply][bi] = ts;
      }
      const m = moveBuf[ply][i];
      const isWall = mvKind(m) === 1;

      // Move-count pruning. The moves are sorted, so once we are this far down the list at
      // shallow depth the rest are walls nothing has ever recommended. Pawn moves are never
      // skipped: there are only a handful and one of them may be the win.
      if (usePrune && isWall && !pvNode && !decisive && depth < 16
          && searched >= LMP[depth] && best > -PROVEN) continue;

      makeMove(pos, m);

      // A wall is only legal if both players still have a route home.
      if (isWall && !wallLegal(pos, mvOrient(m), mvIndex(m))) { unmakeMove(pos, m, fromCell); continue; }

      let val;
      if (pos.winner >= 0) {
        val = WIN - ply;                       // the move we just made wins outright
      } else if (searched === 0) {
        // The first move gets the full window: it is the one we believe in, and its true
        // value is what every later null-window test is measured against.
        val = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Everything after it is first asked a yes/no question — "can you beat the best so
        // far?" — with a null window, which is far cheaper than computing how much better
        // it would be. Only a move that answers yes is searched properly. This is principal
        // variation search, and on a tree this wide it is most of the saving.
        let r = 0;
        if (useLMR && depth >= 2 && isWall && searched >= lmrMin) {
          r = lmrTab[Math.min(depth, LMR_N - 1) * LMR_N + Math.min(searched, LMR_N - 1)];
          r -= (history[me * 2048 + (m & 2047)] * lmrHist / (HIST_MAX / 2)) | 0;   // trusted moves get a longer look
          if (pvNode) r -= 512;
          if (r < 0) r = 0;
        }
        // The clamp is there to stop a REDUCTION from taking the search below one ply. It
        // must not touch the unreduced depth: at a depth-1 node, depth - 1 is 0, and
        // clamping that up to 1 gave every move after the first a whole extra ply that the
        // first one never got. Which move came first is decided by the move ordering, so
        // the value of a depth-1 node depended on the order its moves happened to be tried
        // in — and the transposition table, whose whole job is to change that order, turned
        // it into a search that disagreed with plain minimax about one position in ninety.
        const d = r ? Math.max(1, depth - 1 - (r >> 10)) : depth - 1;
        val = -negamax(pos, d, -alpha - 1, -alpha, ply + 1, true);
        if (val > alpha && d < depth - 1)
          val = -negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (val > alpha && val < beta)
          val = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
      }
      unmakeMove(pos, m, fromCell);
      searched++;

      if (aborted) return 0;

      if (val > best) {
        best = val; bestMove = m;
        if (val > alpha) {
          alpha = val;
          pvTable[ply][0] = m;
          const cl = pvLen[ply + 1];
          for (let t = 0; t < cl; t++) pvTable[ply][t + 1] = pvTable[ply + 1][t];
          pvLen[ply] = cl + 1;
        }
        if (alpha >= beta) {
          // Only walls are remembered. There are a handful of pawn moves and they are
          // ordered by where they go, which is all the information there is about them.
          if (isWall) {
            if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
            // Credit the move that cut, and dock every wall tried before it that did not.
            // Without the penalty a move only ever climbs the ordering; the pair together
            // are what make history mean "better than its siblings", not "seen often".
            const bonus = depth * depth + 2 * depth;
            histBonus(me, m, bonus);
            for (let t = 0; t < nQuiet; t++) histBonus(me, qt[t], -bonus);
          }
          break;
        }
      }
      if (isWall && nQuiet < 64) qt[nQuiet++] = m;
    }

    if (searched === 0) return evaluate(pos);

    // --- store ---
    if (useTT && !aborted && (ttDepth[idx] <= depth || ttGen[idx] !== generation)) {
      ttKey[idx] = pos.hashHi | 0;
      ttScore[idx] = ttIn(best, ply);
      ttEval[idx] = staticEval;
      ttDepth[idx] = depth;
      ttMove[idx] = bestMove;
      ttGen[idx] = generation;
      ttFlag[idx] = best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    }
    return best;
  }

  // When the search has proved the result, whole sets of root moves come back with exactly
  // the same score: in a decided race the count depends only on the winner's distance, so
  // every move the losing side can make is worth the same number and the engine picked among
  // them arbitrarily — including stepping backwards, which is what a lost position looked
  // like from the outside. This picks the tied move that leaves us closest to our own goal:
  // still losing, but as well placed as the position allows, and still there if the opponent
  // later errs.
  //
  // It runs AFTER the search, over moves the search itself rated identically, and only when
  // the score is proven. It cannot change the engine's opinion of any position, cost it a
  // node, or move a score across the aspiration window — which is why it is here and not in
  // the evaluation, where the same idea measured 43.3% over 60 paired games.
  function breakProvenTie(pos, rootMoves, bestScore, fromCell, fallback) {
    if (Math.abs(bestScore) < PROVEN) return fallback;
    const me = pos.turn, opp = 1 - me;
    const losing = bestScore < 0;
    // Winning and losing want opposite things, and using one rule for both is what made a
    // lost position look like a forfeit. Winning: get there in the fewest moves, and among
    // moves that arrive together, leave the opponent furthest away. LOSING: the score is the
    // same however you lose, so the only thing left to play for is time — take the move that
    // puts the winner furthest from their goal, and only then walk toward your own. Ranking
    // a lost position by your own distance instead picks a step forward over a wall that
    // would have held them up for two moves, which is how the engine came to answer a
    // hopeless position with a wall that blocked nothing.
    let pick = fallback, bestA = -Infinity, bestB = -Infinity, tied = 0;
    for (let i = 0; i < rootMoves.length; i++) {
      if (rootMoves[i].score !== bestScore) continue;
      tied++;
      makeMove(pos, rootMoves[i].move);
      const dme = pathLen(pos, me), dopp = pathLen(pos, opp);
      unmakeMove(pos, rootMoves[i].move, fromCell);
      if (dme < 0 || dopp < 0) continue;
      const a = losing ? dopp : -dme;      // the first thing to maximise
      const b = losing ? -dme : dopp;      // the tiebreak within it
      if (a > bestA || (a === bestA && b > bestB)) { bestA = a; bestB = b; pick = rootMoves[i].move; }
    }
    return tied > 1 ? pick : fallback;
  }

  // Root search with iterative deepening and aspiration windows. Returns every root move's
  // score on the final completed iteration, which is what the UI needs to rate a human move
  // against the best one.

  // ---- the Elo scale ----
  // Two honest halves. The TOP is a definition: full strength is called 3200 because that is
  // the top of Stockfish's scale and this is the same idea. Everything BELOW it is measured —
  // every rung played every other nearby rung in paired self-play, the whole table was fitted
  // to Elo at once, and the rungs sit where that fit put them. See README.
  //
  // A rung is two numbers, and it has to be both. Noise alone would make a level that still
  // thinks for two seconds before playing badly; a node cap alone makes a level that is merely
  // short-sighted and never actually errs. A node cap rather than a time cap because Elo has
  // to mean the same thing on a phone as on a desktop — a level measured in milliseconds is a
  // different opponent on different hardware, which is not a rating at all.
  const ELO_MIN = 100, ELO_MAX = 3200;
  // Each rung is [elo, node cap (0 = no cap), noise]. The ORDER and the SPACING are measured:
  // every rung played its neighbours in paired self-play, 1,300-odd games, and the whole table
  // was fitted to Elo at once. The measured span from the full search down to a player that is
  // effectively picking at random is about 1,800 points, so the numbers below stretch that by
  // 1.7x to reach a 100-3200 dial. A number here is a place on Path's own ladder, not a claim
  // about a human rating pool — which is also true of the Stockfish scale it is modelled on.
  //
  // Why the floor is as high as it is: even swamped with noise this engine still solves the
  // ending exactly and still refuses to randomise a *proven* score, so its worst level is a
  // competent racer rather than a random mover. Taking the tablebase away as well was measured
  // and is worth 22 Elo, so it is not done.
  const LEVELS = [
    [3200, 0,      0],        // the whole budget, no cap
    [3000, 50000,  0],
    [2500, 15000,  0],
    [2350, 5000,   0],
    [1950, 1500,   0],
    [1400, 1500,   25],
    [1250, 1500,   50],
    [1050, 1500,   100],
    [650,  1500,   200],
    [500,  1500,   400],
    [300,  1500,   800],
    [200,  1500,   1600],
    [100,  1500,   25600],
  ];
  function levelFor(elo) {
    const e = Math.min(ELO_MAX, Math.max(ELO_MIN, elo));
    if (e >= ELO_MAX) return { maxNodes: 0, noise: 0 };
    for (let i = 0; i + 1 < LEVELS.length; i++) {
      const hi = LEVELS[i], lo = LEVELS[i + 1];
      if (e <= hi[0] && e >= lo[0]) {
        // Interpolate geometrically: both knobs are scale factors, not amounts. "No cap" is
        // interpolated from the budget the top rung was actually measured at, so the levels
        // just below full strength are real intermediate searches rather than a repeat of
        // the rung below them. A noise of 0 likewise interpolates from the smallest noise
        // worth having rather than snapping.
        const UNCAPPED = 500000;
        const t = hi[0] === lo[0] ? 0 : (hi[0] - e) / (hi[0] - lo[0]);
        const geo = (a, b) => Math.round(a * Math.pow(b / a, t));
        const nodes = hi[1] === 0 && lo[1] === 0 ? 0 : geo(hi[1] || UNCAPPED, lo[1] || UNCAPPED);
        return { maxNodes: nodes, noise: hi[2] === 0 && lo[2] === 0 ? 0 : geo(hi[2] || 8, lo[2] || 8) };
      }
    }
    return { maxNodes: LEVELS[LEVELS.length - 1][1], noise: LEVELS[LEVELS.length - 1][2] };
  }
  // one line for the level picker, so a number on a slider means something
  function describeElo(elo) {
    const l = levelFor(elo);
    if (!l.noise && !l.maxNodes) return 'Full strength: the whole search, best move every time.';
    if (!l.noise) return 'Full-strength judgement on a shorter search.';
    if (l.noise <= 100) return 'Sees the position clearly, sometimes takes the second-best road.';
    if (l.noise <= 400) return 'Races sensibly but misjudges walls.';
    if (l.noise <= 1600) return 'Knows where the goal is and little else.';
    return 'Barely picks a direction.';
  }
  function skillPick(rootMoves, spread, fallback) {
    if (spread <= 0 || rootMoves.length < 2) return fallback;
    let pick = fallback, bestNoisy = -INF;
    for (let i = 0; i < rootMoves.length; i++) {
      const rm = rootMoves[i];
      if (rm.score <= -INF) continue;
      // a proven loss is not made worse by playing on, and a proven win must not be thrown
      // away by noise, so decided positions are played straight whatever the level
      const noisy = rm.score + (Math.abs(rm.score) >= PROVEN ? 0 : (Math.random() * 2 - 1) * spread);
      if (noisy > bestNoisy) { bestNoisy = noisy; pick = rm.move; }
    }
    return pick;
  }

  function analyse(pos, opts) {
    const o = opts || {};
    const budget = o.budgetMs == null ? 800 : o.budgetMs;
    const lvl = o.elo == null ? null : levelFor(o.elo);
    const spread = o.noise != null ? o.noise : (lvl ? lvl.noise : 0);
    const maxDepth = o.maxDepth == null ? 40 : o.maxDepth;
    const exactRoot = !!o.exactRoot;
    // Aspiration narrows the root window, which turns every move outside it into a bound
    // rather than a value — fine when all you want is the best move, fatal when you are
    // putting a number on each one. Under exactRoot nothing raises alpha, so a move worse
    // than the window fails low and its recorded score is a fail-soft UPPER bound: measured
    // over 656 root moves, only 27% came back with their true score and 66% came back too
    // high, which rated 342 moves too kindly against 30 too harshly. Turning it off costs
    // 2.3x the nodes, which is the price of a value instead of a bound. So analysis gets
    // it off by default and playing strength keeps it.
    const aspiration = o.aspiration == null ? !exactRoot : !!o.aspiration;
    deadline = now() + budget;
    // A hard node cap alongside the clock: a search on the main thread must not be able to
    // run away if performance.now() stops moving (a throttled background tab, or a headless
    // browser driving virtual time). ~900k nodes/ms is far above what this engine reaches,
    // so on a healthy clock the cap never binds.
    nodeCap = o.maxNodes == null ? Math.max(20000, budget * 900) : o.maxNodes;
    if (lvl && lvl.maxNodes) nodeCap = Math.min(nodeCap, lvl.maxNodes);
    nodes = 0; aborted = false;
    generation = (generation + 1) & 255;
    killers.fill(0);
    if (o.freshHistory !== false) history.fill(0);

    // With no walls left anywhere the rest of the game is a fixed graph small enough to
    // solve exactly, so there is nothing to search: look it up and play perfectly.
    if (o.tablebase !== false) {
      const tb = probeRace(pos);
      if (tb) {
        return {
          best: tb.best, score: tb.score, depth: 0, nodes: 0,
          pv: [tb.best], moves: tb.moves.map(x => ({ move: x.move, score: x.score })),
          proven: Math.abs(tb.score) >= PROVEN, tablebase: true, dist: tb.dist,
        };
      }
    }

    const me = pos.turn;
    const fromCell = pos.pawn[me];
    const n = genMoves(pos, 0, MOVE_NONE, 1);
    const rootMoves = [];
    const seen = new Set();
    const addRoot = m => {
      makeMove(pos, m);
      const ok = mvKind(m) === 0 || wallLegal(pos, mvOrient(m), mvIndex(m));
      const wins = pos.winner >= 0;
      unmakeMove(pos, m, fromCell);
      if (!ok) return;
      seen.add(m);
      rootMoves.push({ move: m, score: -INF, wins });
    };
    for (let i = 0; i < n; i++) addRoot(moveBuf[0][i]);
    // Every legal move at the root, not just the candidates genMoves thinks are worth
    // searching. Only a caller that has to put a number on a move it did not choose needs
    // this; it roughly doubles the root, so playing strength never asks for it.
    if (o.rootAll && pos.hand[me] > 0) {
      for (let orient = 0; orient < 2; orient++)
        for (let j = 0; j < pos.JN; j++) {
          const m = mvWall(j, orient);
          if (!seen.has(m) && wallFits(pos, orient, j)) addRoot(m);
        }
    }
    if (!rootMoves.length) return { best: MOVE_NONE, score: 0, depth: 0, nodes: 0, pv: [], moves: [] };

    // An outright win needs no search — except when the caller asked for a value on every
    // move, which is the whole point of exactRoot. Returning early there handed back a root
    // list where only the winning move had been scored and every other one still carried the
    // -INF it was created with, and the panel duly reported the rest of the board at minus
    // sixteen million. So: play takes the shortcut, analysis searches.
    for (const rm of rootMoves) {
      if (rm.wins && !exactRoot) {
        rm.score = WIN;
        // only the move that was actually scored goes back
        return { best: rm.move, score: WIN, depth: 1, nodes: 1, pv: [rm.move], moves: [rm], proven: true };
      }
    }

    let best = rootMoves[0].move, bestScore = 0, completed = 0, pv = [];
    let prev = 0;
    // Tuning surface only: an odd-depth iteration ends on the side to move's own ply, so it
    // sees its own advance without the reply. `parity: 'even'` answers from the last even
    // iteration instead, trading a ply of depth for the missing reply. See searchtest.
    let evenMove = MOVE_NONE, evenScore = 0, evenDepth = 0, evenPv = [];

    for (let depth = 1; depth <= maxDepth; depth++) {
      // Aspiration window. The score rarely moves far between iterations, so guessing that
      // it lands near the last one and searching a narrow window around the guess prunes
      // hard. Guess wrong and the search fails outside the window and has to be repeated,
      // so the window opens geometrically rather than jumping straight to infinity: a small
      // miss costs one cheap re-search, not a full-width one. 80 is a little under a step
      // of path, which is the smallest amount the score usually moves.
      let delta = 80;
      let alpha = -INF, beta = INF;
      if (depth >= 4 && aspiration) { alpha = prev - delta; beta = prev + delta; }

      let iterBest = -INF, iterMove = MOVE_NONE, iterPv = [];
      const snapshot = rootMoves.map(rm => rm.score);

      for (let pass = 0; pass < 8; pass++) {
        iterBest = -INF; iterMove = MOVE_NONE;
        let a = alpha;
        for (let i = 0; i < rootMoves.length; i++) {
          const rm = rootMoves[i];
          makeMove(pos, rm.move);
          let val;
          if (pos.winner >= 0) val = WIN;
          else if (i === 0 || exactRoot) {
            val = -negamax(pos, depth - 1, -beta, -a, 1, true);
          } else {
            // Root principal variation search: ask the cheap question first and only pay
            // full price for a move that actually threatens to beat the best one.
            val = -negamax(pos, depth - 1, -a - 1, -a, 1, true);
            if (val > a && val < beta) val = -negamax(pos, depth - 1, -beta, -a, 1, true);
          }
          unmakeMove(pos, rm.move, fromCell);
          if (aborted) break;
          rm.score = val;
          if (val > iterBest) {
            iterBest = val; iterMove = rm.move;
            iterPv = [rm.move];
            for (let t = 0; t < pvLen[1]; t++) iterPv.push(pvTable[1][t]);
          }
          // Raising alpha at the root prunes hard, but then every move after the best one
          // only gets an upper bound. Analysis needs true values for each move, so callers
          // that are rating moves ask for exactRoot and pay for it.
          if (val > a && !exactRoot) a = val;
        }
        if (aborted) break;
        if (iterBest <= alpha) { beta = ((alpha + beta) / 2) | 0; alpha = iterBest - delta; delta += delta >> 1; continue; }
        if (iterBest >= beta) { beta = iterBest + delta; delta += delta >> 1; continue; }
        break;
      }

      if (aborted) {
        for (let i = 0; i < rootMoves.length; i++) rootMoves[i].score = snapshot[i];
        break;
      }

      best = iterMove; bestScore = iterBest; completed = depth; prev = iterBest; pv = iterPv;
      if ((depth & 1) === 0) { evenMove = iterMove; evenScore = iterBest; evenDepth = depth; evenPv = iterPv; }
      // search the best move first next time round
      rootMoves.sort((x, y) => y.score - x.score);
      if (Math.abs(iterBest) >= PROVEN) break;      // proven result, no point going deeper
      if (now() > deadline || nodes > nodeCap) break;
    }

    if (o.parity === 'even' && evenMove !== MOVE_NONE && (completed & 1) === 1 && Math.abs(bestScore) < PROVEN) {
      best = evenMove; bestScore = evenScore; completed = evenDepth; pv = evenPv;
    }
    best = breakProvenTie(pos, rootMoves, bestScore, fromCell, best);
    // The score reported is still the search's own: a weaker level plays worse, it does not
    // lie about the position. Review and the eval bar read the score, never the move.
    best = skillPick(rootMoves, spread, best);
    return { best, score: bestScore, depth: completed, nodes, pv, moves: rootMoves.slice(), proven: Math.abs(bestScore) >= PROVEN };
  }

  // The exact value of ONE move, on the same scale as analyse()'s root scores.
  //
  // genMoves is deliberately a CANDIDATE generator: a wall that crosses neither shortest
  // path, touches no wall already down and sits near neither pawn is left out, because
  // searching it wins nothing. Playing strength never misses it. Rating does — the move a
  // player actually chose can be exactly one of those, and a move the search never looked
  // at has no score to compare against the best one, so the review had nothing to say about
  // it. Widening the root to every legal move (analyse's rootAll) fixes that but roughly
  // doubles the root and costs a full ply — 8.83 to 7.75 at review's budget — to rate the
  // occasional move. Searching just the move being asked about costs one root move in sixty
  // and is no less accurate: against a complete-root search, moves scored this way disagreed
  // on the verdict 3.2% of the time, versus 8.2% for moves the candidate root had all along.
  //
  // `depth` must be the depth analyse() reported, and the position must be the one it
  // searched, or the two numbers are not comparable. Returns null if the move is illegal
  // or the search ran out of time before it finished.
  function scoreMove(pos, m, depth, opts) {
    const o = opts || {};
    if (m === MOVE_NONE) return null;
    if (mvKind(m) === 1) {
      if (pos.hand[pos.turn] <= 0) return null;
      if (!wallFits(pos, mvOrient(m), mvIndex(m))) return null;
    }
    const budget = o.budgetMs == null ? 2000 : o.budgetMs;
    deadline = now() + budget;
    // No level here: scoreMove rates a move for the analysis panel, and the panel is always
    // the full-strength engine whatever level the opponent happens to be playing at.
    nodeCap = o.maxNodes == null ? Math.max(20000, budget * 900) : o.maxNodes;
    nodes = 0; aborted = false;

    const fromCell = pos.pawn[pos.turn];
    makeMove(pos, m);
    let val = null;
    if (mvKind(m) === 1 && !wallLegal(pos, mvOrient(m), mvIndex(m))) val = null;
    else if (pos.winner >= 0) val = WIN;
    // the same window analyse() gives every root move under exactRoot: full width, so the
    // value comes back exact rather than as a bound
    else val = -negamax(pos, Math.max(0, depth - 1), -INF, INF, 1, true);
    unmakeMove(pos, m, fromCell);
    return aborted ? null : val;
  }

  // =====================================================================
  //  the learned evaluation
  // =====================================================================
  // A small network trained to predict what a 20,000-node search would say, from the cheap
  // features below. It replaces ONLY the heuristic part of evaluate(): the solved race, the
  // counting rule and the tablebase are exact, and a network has nothing to add to a fact.
  //
  // Trained on the engine's own deep searches, which bounds what it can be: it learns to know
  // immediately what the search took twelve plies to work out, not anything the search was
  // wrong about. On held-out positions it predicts those searches with 19.6% less error than
  // the six hand-tuned weights do (0.00756 against 0.00940). Whether that wins games is a
  // separate question, and the only one that decides if it ships.
  let netW1 = null, netB1 = null, netW2 = null, netB2 = 0, netH = 0, netScale = 440;
  let netAcc = null, netFeat = null;
  function setNet(w) {
    if (!w) { netW1 = null; return; }
    netH = w.hidden; netScale = w.scale || 440;
    netW1 = Float32Array.from(w.w1); netB1 = Float32Array.from(w.b1);
    netW2 = Float32Array.from(w.w2); netB2 = w.b2[0];
    netAcc = new Float32Array(netH);
    netFeat = new Float32Array(w.inputs);
  }
  const hasNet = () => netW1 !== null;
  // back to the engine's own units, so every score in the file stays comparable
  function netEval(pos) {
    const f = netFeat, nin = f.length;
    netFeatures(pos, f);
    let out = netB2;
    for (let j = 0; j < netH; j++) {
      let v = netB1[j];
      const off = j * nin;
      for (let i = 0; i < nin; i++) v += f[i] * netW1[off + i];
      if (v > 0) out += v * netW2[j];
    }
    // The training target was a logistic of the score on this scale, and the inverse of a
    // logistic is the thing the logistic was applied to — so the exp and the log cancel and
    // the network's raw output IS the score, scaled. Computing both cost 4us a call for nothing.
    return (netScale * out) | 0;
  }

  // =====================================================================
  //  features for a learned evaluation
  // =====================================================================
  // A learned evaluation is more accurate per call and slower per call, and in this engine
  // evaluate() runs millions of times a search, so the feature set is chosen for cost first.
  // Everything here is either already computed by evaluate() or O(1) from the position — no
  // extra shortest paths, no scans over the wall grid. Distances are included as inputs rather
  // than left to be learned, because shortest path through walls is a graph algorithm and a
  // small network has no chance of discovering it from wall occupancy.
  //
  // Scaled to roughly unit range so training does not have to undo the units.
  const NET_FEATURES = 14;
  function netFeatures(pos, out) {
    const me = pos.turn, opp = 1 - me;
    const dme = pathLen(pos, me), dopp = pathLen(pos, opp);
    const rows = pos.rows, cols = pos.cols;
    const myCell = pos.pawn[me], opCell = pos.pawn[opp];
    const myR = (myCell / cols) | 0, myC = myCell - myR * cols;
    const opR = (opCell / cols) | 0, opC = opCell - opR * cols;
    const onBoard = (pos.wallsEach * 2) - pos.hand[0] - pos.hand[1];
    const mid = (cols - 1) / 2;
    out[0] = dme / 10;
    out[1] = dopp / 10;
    out[2] = (dopp - dme) / 10;
    out[3] = pos.hand[me] / 10;
    out[4] = pos.hand[opp] / 10;
    out[5] = (pos.hand[me] - pos.hand[opp]) / 10;
    out[6] = (pos.goalRow[me] === 0 ? (rows - 1 - myR) : myR) / (rows - 1);
    out[7] = (pos.goalRow[opp] === 0 ? (rows - 1 - opR) : opR) / (rows - 1);
    out[8] = Math.abs(myC - mid) / mid;
    out[9] = Math.abs(opC - mid) / mid;
    out[10] = onBoard / (pos.wallsEach * 2 || 1);
    out[11] = (myR - opR) / (rows - 1);
    out[12] = (myC - opC) / (cols - 1);
    out[13] = (pos.hand[0] === 0 && pos.hand[1] === 0) ? 1 : 0;
    return out;
  }

  // =====================================================================
  //  interop with rules.js
  // =====================================================================

  // Is this a position the engine actually handles? Everything else falls back to bot.js.
  function supports(s) {
    return !!s && s.players === 2 && !s.race && !s.koth && !s.inverted
      && (s.wallLen || 2) === 2
      && (!s.holes || s.holes.size === 0)
      && (!s.fixedWalls || s.fixedWalls.length === 0)
      && s.goals && s.goals.length === 2
      && s.goals[0] && s.goals[0].axis === 'r' && s.goals[0].at === 0
      && s.goals[1] && s.goals[1].axis === 'r' && s.goals[1].at === s.rows - 1;
  }

  let shared = null;
  function fromRules(s) {
    if (!shared || shared.rows !== s.rows || shared.cols !== s.cols) {
      shared = create({ rows: s.rows, cols: s.cols, walls: s.walls[0] });
    }
    reset(shared, 10);
    const pos = shared;
    // walls
    for (const k of s.hWalls) { const [r, c] = k.split(',').map(Number); addWall(pos, 0, r * pos.JW + c); }
    for (const k of s.vWalls) { const [r, c] = k.split(',').map(Number); addWall(pos, 1, r * pos.JW + c); }
    pos.pawn[0] = s.pawns[0].r * s.cols + s.pawns[0].c;
    pos.pawn[1] = s.pawns[1].r * s.cols + s.pawns[1].c;
    pos.hand[0] = s.walls[0]; pos.hand[1] = s.walls[1];
    pos.turn = s.turn;
    pos.winner = s.winner == null ? -1 : s.winner;
    rehash(pos);
    return pos;
  }

  // How many moves the winning side still needs, or null if the score is not a proven win.
  //
  // Two different kinds of proven score arrive here and they are NOT counted the same way.
  // A mate score is WIN - ply, and ply counts half-moves from the root, so the winner makes
  // half of them. A solved race scores WIN - 1000 - d, where d is already that player's own
  // remaining number of steps. The two ranges do not overlap: a mate score is within MAX_PLY
  // of WIN, a race score is at least a thousand below it.
  function winDistance(score) {
    const a = score < 0 ? -score : score;
    if (a < PROVEN) return null;
    if (a > WIN - 1000) return Math.max(1, Math.ceil((WIN - a) / 2));
    return Math.max(1, WIN - 1000 - a);
  }

  // engine move -> the action objects app.js and rules.js speak
  function toAction(pos, m) {
    if (m === MOVE_NONE) return null;
    if (mvKind(m) === 0) {
      const cell = mvIndex(m);
      return { type: 'move', to: { r: (cell / pos.cols) | 0, c: cell % pos.cols } };
    }
    const j = mvIndex(m);
    return { type: 'wall', orient: mvOrient(m) === 0 ? 'h' : 'v', r: (j / pos.JW) | 0, c: j % pos.JW };
  }
  function fromAction(pos, a) {
    if (!a) return MOVE_NONE;
    if (a.type === 'move') return mvPawn(a.to.r * pos.cols + a.to.c);
    return mvWall(a.r * pos.JW + a.c, a.orient === 'h' ? 0 : 1);
  }

  // The weights ship as their own file so they can be replaced without touching the engine,
  // and so a page that never loads them simply gets the handcrafted evaluation.
  {
    const w = (typeof window !== 'undefined' ? window : self).NetWeights;
    if (w && w.w1) setNet(w);
  }

  (typeof window !== 'undefined' ? window : self).Engine = {
    create, reset, analyse, scoreMove, evaluate, evalToWinProb, winDistance, supports, fromRules, toAction, fromAction,
    distTo, distMap, pawnMoves, wallFits, addWall, delWall, makeMove, unmakeMove, bothHavePath,
    mvPawn, mvWall, mvKind, mvOrient, mvIndex, MOVE_NONE, WIN, PROVEN, W,
    setTableBits, clearTable, genMoves, moveBuf, pathLen, mayCut, wallLegal,
    ELO_MIN, ELO_MAX, levelFor, describeElo,
    NET_FEATURES, netFeatures, setNet, netEval, hasNet,
    solveRace, probeRace, tbStats: () => ({ builds: tbBuilds, ms: tbBuildMs }),
    pathStats: () => ({ hit: dcHit, miss: dcMiss }),
    // Test and tuning surface, not for the app. `tt`, `lmr` and `prune` turn the three
    // inexact layers off so searchtest can compare the search against a plain minimax;
    // the rest are the forward-pruning constants, so a sweep can put several settings
    // against each other without one engine file per setting. Nothing resets these, so a
    // caller that changes them owns them for the life of the page.
    setSearchFlags: (o) => {
      if (o.tt != null) useTT = o.tt;
      if (o.lmr != null) useLMR = o.lmr;
      if (o.prune != null) usePrune = o.prune;
      if (o.lmrBase != null || o.lmrScale != null) {
        if (o.lmrBase != null) lmrBase = o.lmrBase;
        if (o.lmrScale != null) lmrScale = o.lmrScale;
        buildLmr();
      }
      if (o.futMargin != null) futMargin = o.futMargin;
      if (o.nullBase != null) nullBase = o.nullBase;
      if (o.lmrHist != null) lmrHist = o.lmrHist;
      if (o.lmrMin != null) lmrMin = o.lmrMin;
    },
    _internals: { distTo, markPathWalls },
  };
})();
