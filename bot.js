// bot.js — AI opponents for Detour.
// easy: advances on its shortest path, places weak walls occasionally.
// hard: knows both shortest paths, places the wall that best widens the tempo gap, else advances.

(function () {
  const R = window.Rules;

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

  // Walls worth considering: only those touching the opponent's shortest-path corridor are cheap-ish to scan,
  // but the board is tiny so we just score every legal placement.
  function scoreWalls(state, me, opp, limit) {
    const myBefore = R.pathLength(state, me);
    const oppBefore = R.pathLength(state, opp);
    const out = [];
    for (let r = 0; r < R.SIZE - 1; r++) {
      for (let c = 0; c < R.SIZE - 1; c++) {
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

  function chooseHard(state, me) {
    const opp = 1 - me;
    const myDist = R.pathLength(state, me);
    const oppDist = R.pathLength(state, opp);
    const advance = bestAdvance(state, me);

    // Comfortably ahead → just run.
    if (myDist - oppDist <= -2 || state.walls[me] <= 0) {
      return { type: 'move', to: advance };
    }
    const walls = scoreWalls(state, me, opp, 1);
    if (walls.length) {
      const w = walls[0];
      const moveMargin = oppDist - (myDist - 1);              // tempo gap if we step forward
      const wallMargin = (oppDist + w.score);                 // gap delta if we wall (relative)
      // Place a wall when it widens the gap at least as much as advancing and we aren't ahead.
      if (w.score >= 1 && wallMargin >= moveMargin && oppDist <= myDist + 1) {
        return { type: 'wall', orient: w.orient, r: w.r, c: w.c };
      }
    }
    return { type: 'move', to: advance };
  }

  function chooseEasy(state, me) {
    const opp = 1 - me;
    const myDist = R.pathLength(state, me);
    const oppDist = R.pathLength(state, opp);
    const advance = bestAdvance(state, me);

    // Occasionally wall when behind or even; otherwise mostly race forward (and sometimes wander).
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

  function chooseAction(state, me, difficulty) {
    return difficulty === 'hard' ? chooseHard(state, me) : chooseEasy(state, me);
  }

  window.Bot = { chooseAction };
})();
