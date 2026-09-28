// bot.js — AI opponents for Detour.
// easy:   pure random — a random legal step, the odd random wall.
// medium: races on its shortest path, walls semi-randomly when even/behind.
// hard:   an expert engine — negamax + alpha-beta, iterative deepening to a
//         time budget, shortest-path evaluation, walls pruned to the
//         opponent's shortest-path corridor (the standard strong-Quoridor
//         approach). It looks several plies ahead and plays to win the race.

(function () {
  const R = window.Rules;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function bestAdvance(state, player) {
    const moves = R.legalMoves(state, player);
    if (!moves.length) return null;
    const dist = R.distanceMap(state, player);
    let best = null, bestD = Infinity;
    for (const m of moves) {
      const d = dist.get(R.key(m.r, m.c));
      const dd = d === undefined ? Infinity : d;
      if (dd < bestD) { bestD = dd; best = m; }
    }
    return best || moves[0];
  }

  // ---- shared wall scan (medium uses this) ----
  function scoreWalls(state, me, opp, limit) {
    const myBefore = R.pathLength(state, me);
    const oppBefore = R.pathLength(state, opp);
    const out = [];
    for (let r = 0; r < state.rows - 1; r++) {
      for (let c = 0; c < state.cols - 1; c++) {
        for (const orient of ['h', 'v']) {
          if (!R.canPlaceWall(state, me, orient, r, c)) continue;
          const set = orient === 'h' ? state.hWalls : state.vWalls;
          set.add(R.key(r, c));
          const myAfter = R.pathLength(state, me);
          const oppAfter = R.pathLength(state, opp);
          set.delete(R.key(r, c));
          const score = (oppAfter - oppBefore) - (myAfter - myBefore);
          if (score > 0) out.push({ orient, r, c, score });
        }
      }
    }
    out.sort((a, b) => b.score - a.score);
    return limit ? out.slice(0, limit) : out;
  }

  // =====================================================================
  //  EXPERT ENGINE (hard)
  // =====================================================================
  const WIN = 1e6;          // terminal score magnitude
  const INF = 1e9;
  const BUDGET_MS = 700;    // per-move thinking budget
  const MAX_DEPTH = 6;      // iterative-deepening ceiling (budget usually caps first)
  const WALL_CAND_CAP = 16; // keep the best N wall candidates per node

  const distAt = (dmap, p) => { const d = dmap.get(R.key(p.r, p.c)); return d === undefined ? Infinity : d; };

  // Evaluation from the perspective of the side to move at state s.
  function evaluateToMove(s) {
    const me = s.turn, opp = 1 - me;
    const dme = R.pathLength(s, me);
    const dopp = R.pathLength(s, opp);
    if (s.inverted) {
      // misère: reaching your goal loses, so you want to stay FAR from yours and push the
      // opponent toward theirs. Being unable to reach your goal at all is safest of all.
      if (dme === Infinity) return WIN;
      if (dopp === Infinity) return -WIN;
      return (dme - dopp) * 10 + (s.walls[me] - s.walls[opp]) * 3 + 1;
    }
    if (dme === Infinity) return -WIN;
    if (dopp === Infinity) return WIN;
    // Path difference dominates; walls in hand are a real asset; tiny tempo nudge.
    return (dopp - dme) * 10 + (s.walls[me] - s.walls[opp]) * 3 + 1;
  }

  function applyTo(s, mv) {
    if (mv.type === 'move') R.applyMove(s, mv.to);
    else R.applyWall(s, mv.orient, mv.r, mv.c);
    return s;
  }

  // Walls that block the orthogonal step a->b (the two anchors that cover that edge).
  function pushEdgeWalls(rows, cols, L, a, b, seen, cand) {
    const add = (orient, r, c) => {
      if (r < 0 || c < 0) return;
      if (orient === 'h' && (r > rows - 2 || c > cols - L)) return;
      if (orient === 'v' && (r > rows - L || c > cols - 2)) return;
      const k = orient + r + ',' + c;
      if (!seen.has(k)) { seen.add(k); cand.push({ orient, r, c }); }
    };
    if (a.r === b.r) {                       // horizontal step -> a vertical wall blocks it
      const lc = Math.min(a.c, b.c);
      for (let ar = a.r - L + 1; ar <= a.r; ar++) add('v', ar, lc);
    } else {                                 // vertical step -> a horizontal wall blocks it
      const tr = Math.min(a.r, b.r);
      for (let ac = a.c - L + 1; ac <= a.c; ac++) add('h', tr, ac);
    }
  }

  // Collect candidate walls along the target's current shortest path.
  function addPathWalls(s, target, seen, cand) {
    const dmap = R.distanceMap(s, target);
    let cur = s.pawns[target];
    let d = dmap.get(R.key(cur.r, cur.c));
    if (d === undefined) return;
    let guard = 0;
    while (d > 0 && guard++ < 2 * s.rows * s.cols) {
      let nxt = null;
      for (const [dr, dc] of R.DIRS) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (!R.inBounds(s, nr, nc) || R.edgeBlocked(s, cur.r, cur.c, nr, nc)) continue;
        if (dmap.get(R.key(nr, nc)) === d - 1) { nxt = { r: nr, c: nc }; break; }
      }
      if (!nxt) break;
      pushEdgeWalls(s.rows, s.cols, s.wallLen || 2, cur, nxt, seen, cand);
      cur = nxt; d--;
    }
  }

  // Ordered move list for the side to move. Each entry is a plain action object.
  // Ordering: by the change it makes to the race margin (dopp - dme), best first,
  // so alpha-beta prunes hard. Walls are pruned to the opponent's corridor.
  function generateMoves(s) {
    const me = s.turn, opp = 1 - me;
    const dmap = R.distanceMap(s, me);
    const dmeB = distAt(dmap, s.pawns[me]);
    const doppB = R.pathLength(s, opp);
    const list = [];

    for (const m of R.legalMoves(s, me)) {
      const nd = dmap.get(R.key(m.r, m.c));
      const newDme = nd === undefined ? Infinity : nd;
      list.push({ mv: { type: 'move', to: m }, ord: dmeB - newDme });
    }

    if (s.walls[me] > 0 && doppB !== Infinity) {
      const seen = new Set(), cand = [];
      addPathWalls(s, opp, seen, cand);   // walls that lengthen the opponent's route
      const walls = [];
      for (const w of cand) {
        if (R.wallConflict(s, w.orient, w.r, w.c)) continue;
        const set = w.orient === 'h' ? s.hWalls : s.vWalls;
        const k = w.r + ',' + w.c;
        set.add(k);
        const dmeA = R.pathLength(s, me), doppA = R.pathLength(s, opp);
        set.delete(k);
        if (dmeA === Infinity || doppA === Infinity) continue; // illegal: traps a player
        const ord = (doppA - doppB) - (dmeA - dmeB);
        walls.push({ mv: { type: 'wall', orient: w.orient, r: w.r, c: w.c }, ord });
      }
      walls.sort((a, b) => b.ord - a.ord);
      for (let i = 0; i < walls.length && i < WALL_CAND_CAP; i++) list.push(walls[i]);
    }

    list.sort((a, b) => b.ord - a.ord);
    return list.map(x => x.mv);
  }

  function negamax(s, depth, alpha, beta, deadline) {
    if (depth === 0 || now() > deadline) return evaluateToMove(s);
    let best = -INF;
    const mover = s.turn;
    const moves = generateMoves(s);
    for (const mv of moves) {
      const child = applyTo(R.cloneState(s), mv);
      // applyMove leaves turn on whoever the move decided, so a terminal move is scored from THIS
      // node's mover — a win if the mover won, a loss if it didn't (inverted makes reaching lose).
      const val = child.winner !== null
        ? (child.winner === mover ? WIN + depth : -(WIN + depth))
        : -negamax(child, depth - 1, -beta, -alpha, deadline);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
      if (now() > deadline) break;
    }
    return best;
  }

  function chooseExpert(state) {
    const deadline = now() + BUDGET_MS;
    let moves = generateMoves(state);
    if (!moves.length) { const a = bestAdvance(state, state.turn); return a ? { type: 'move', to: a } : null; }
    let bestMove = moves[0];
    const mover = state.turn;

    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      let alpha = -INF, localBest = -INF, localMove = null, aborted = false;
      for (const mv of moves) {
        const child = applyTo(R.cloneState(state), mv);
        const val = child.winner !== null
          ? (child.winner === mover ? WIN + depth : -(WIN + depth))
          : -negamax(child, depth - 1, -INF, -alpha, deadline);
        if (now() > deadline) { aborted = true; break; }
        if (val > localBest) { localBest = val; localMove = mv; }
        if (localBest > alpha) alpha = localBest;
      }
      if (localMove && !aborted) {
        bestMove = localMove;
        moves = [localMove, ...moves.filter(m => m !== localMove)]; // PV-first next iteration
      }
      if (aborted || localBest >= WIN) break;  // out of time, or forced win found
    }
    return bestMove;
  }

  // =====================================================================
  function chooseMedium(state, me) {
    const opp = 1 - me;
    const myDist = R.pathLength(state, me);
    const oppDist = R.pathLength(state, opp);
    const advance = bestAdvance(state, me);

    const wantWall = state.walls[me] > 0 && oppDist <= myDist && Math.random() < 0.35;
    if (wantWall) {
      const walls = scoreWalls(state, me, opp, 6);
      if (walls.length) {
        const w = walls[Math.floor(Math.random() * walls.length)];
        return { type: 'wall', orient: w.orient, r: w.r, c: w.c };
      }
    }
    if (Math.random() < 0.12) {
      const moves = R.legalMoves(state, me);
      if (moves.length) return { type: 'move', to: moves[Math.floor(Math.random() * moves.length)] };
    }
    return { type: 'move', to: advance };
  }

  function chooseRandom(state, me) {
    if (state.walls[me] > 0 && Math.random() < 0.18) {
      for (let t = 0; t < 8; t++) {
        const orient = Math.random() < 0.5 ? 'h' : 'v';
        const r = Math.floor(Math.random() * (state.rows - 1));
        const c = Math.floor(Math.random() * (state.cols - 1));
        if (R.canPlaceWall(state, me, orient, r, c)) return { type: 'wall', orient, r, c };
      }
    }
    const moves = R.legalMoves(state, me);
    return { type: 'move', to: moves[Math.floor(Math.random() * moves.length)] };
  }

  // 4-player: the negamax search is zero-sum (2 players only), so free-for-alls use a fast
  // heuristic — race on your own shortest path, and now and then wall whoever's closest to winning.
  function choose4p(state, me, difficulty) {
    if (difficulty === 'easy') return chooseRandom(state, me);
    const advance = bestAdvance(state, me);
    const wallChance = difficulty === 'hard' ? 0.4 : 0.22;
    if (state.walls[me] > 0 && Math.random() < wallChance) {
      let target = -1, best = Infinity;
      for (let i = 0; i < state.pawns.length; i++) {
        if (i === me) continue;
        const d = R.pathLength(state, i);
        if (d < best) { best = d; target = i; }
      }
      if (target >= 0) {
        const walls = scoreWalls(state, me, target, 5);
        if (walls.length) { const w = walls[0]; return { type: 'wall', orient: w.orient, r: w.r, c: w.c }; }
      }
    }
    return advance ? { type: 'move', to: advance } : chooseRandom(state, me);
  }

  function chooseAction(state, me, difficulty) {
    if (state.pawns.length > 2) return choose4p(state, me, difficulty);
    if (difficulty === 'easy') return chooseRandom(state, me);
    if (difficulty === 'hard') return chooseExpert(state);
    return chooseMedium(state, me);
  }

  window.Bot = { chooseAction };
})();
