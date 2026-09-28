// explain.js — why a move is a move, in words and in something to draw.
//
// Every sentence here is attached to a number the engine computed, never to a guess about what
// a move "looks like". The numbers are all shortest-path lengths, because that is what this game
// is made of: a wall is worth exactly the steps it adds to somebody, and a pawn move is worth
// exactly the step it takes off your own route.
//
// Four quantities are measured for a candidate move, by playing it on a copy of the board:
//
//   dMe    how much longer MY route became
//   dOpp   how much longer THEIRS became
//   threat the most steps a single wall could still take from them  (before, and after)
//   risk   the most steps a single wall could still take from ME    (before, and after)
//
// threat and risk are what make "a trap" and "a defence" sayable rather than hand-waved: a move
// that raises threat without costing anything today is setting one up, and a move that drops
// risk is answering one. They cost about a hundred and twenty short searches to compute, which
// is far too much inside a search and nothing at all once per move.
(function () {
  const NOPE = { text: '', path: null, wall: null, kind: 'none', seat: null };

  // E.fromRules returns a SHARED buffer: two calls hand back the same object, so the second
  // silently overwrites the first. Nothing here may hold two positions at once, and nothing may
  // hold one across a call that might build another. Getting this wrong measured the board
  // AFTER the move and called it "before", which made a trap look like an idle wall.
  function lens(E, state) {
    const pos = E.fromRules(state);
    return { me: E.pathLen(pos, state.turn), opp: E.pathLen(pos, 1 - state.turn) };
  }

  // The route itself, walked downhill through the distance map, so it can be drawn.
  function route(R, E, state, player) {
    const pos = E.fromRules(state);
    const map = new Int16Array(pos.N);
    if (E.distMap(pos, player, map) < 0) return null;
    const cols = pos.cols;
    let cur = pos.pawn[player];
    const cells = [{ r: (cur / cols) | 0, c: cur % cols }];
    let guard = 0;
    while (map[cur] > 0 && guard++ < pos.N * 2) {
      const cr = (cur / cols) | 0, cc = cur - cr * cols;
      let next = -1;
      const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1], BIT = [1, 2, 4, 8];
      for (let k = 0; k < 4; k++) {
        if (!(pos.adj[cur] & BIT[k])) continue;
        const nr = cr + DR[k], nc = cc + DC[k];
        if (nr < 0 || nr >= pos.rows || nc < 0 || nc >= cols) continue;
        const ni = nr * cols + nc;
        if (map[ni] === map[cur] - 1) { next = ni; break; }
      }
      if (next < 0) break;
      cur = next;
      cells.push({ r: (cur / cols) | 0, c: cur % cols });
    }
    return cells.length > 1 ? cells : null;
  }

  // The single most damaging wall still available against `victim`, and how many steps it costs
  // them. Returns 0 when the placer holds none, which is what makes a pure race sayable.
  //
  // Walls go on and come off the engine's own board rather than onto a hundred and twenty-eight
  // copies of the Rules state. The first version cloned, and cost 200-670 ms per explanation;
  // add/delete in place is the same pair the search itself uses and leaves the board exactly as
  // it found it, and the shortest paths it asks for are already memoised.
  function worstWall(R, E, state, placer, victim, posIn) {
    if (!state.walls[placer]) return { steps: 0, wall: null };
    const pos = posIn || E.fromRules(state);
    const base = E.pathLen(pos, victim);
    if (base < 0) return { steps: 0, wall: null };
    let best = 0, bw = null;
    for (let o = 0; o < 2; o++) {
      for (let j = 0; j < pos.JN; j++) {
        if (!E.wallFits(pos, o, j)) continue;
        E.addWall(pos, o, j);
        if (E.bothHavePath(pos)) {
          const d = E.pathLen(pos, victim);
          if (d - base > best) { best = d - base; bw = { orient: o ? 'v' : 'h', r: (j / pos.JW) | 0, c: j % pos.JW }; }
        }
        E.delWall(pos, o, j);
      }
    }
    return { steps: best, wall: bw };
  }

  const steps = n => n === 1 ? 'a step' : n + ' steps';
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);

  // The one sentence that fits, and what to draw with it.
  //
  // Every measurement below is about the side to move, because that is whose move is being
  // explained. Who is READING is a separate question, and the two are not the same person half
  // the time: the analysis panel keeps running while the opponent thinks. Written only in the
  // mover's voice, it said "you are 2 steps ahead" about the opponent, directly under an
  // evaluation bar that had correctly put the same position at 39% for you. `opts.viewer` is
  // the seat the words are written for; it changes the pronouns and nothing else.
  //
  // `seat` in the result says whose route `path` is, so the caller can colour it from its own
  // chair instead of guessing from the kind -- which is how a green "your way home" ended up
  // drawn over the opponent's route.
  function explain(R, E, state, action, opts) {
    if (!R || !E || !state || !action) return NOPE;
    const deep = !opts || opts.deep !== false;
    const me = state.turn, opp = 1 - me;
    const viewer = opts && opts.viewer != null ? opts.viewer : me;
    const own = viewer === me;            // the reader is the one moving
    // Second person plural and third person plural share their verb forms in English ("you are",
    // "they are"; "you have", "they have"), so only the pronouns have to move.
    const P = own
      ? { meSub: 'you', meObj: 'you', my: 'your', mine: 'yours', theirSub: 'they', theirObj: 'them', their: 'their', theirs: 'theirs' }
      : { meSub: 'they', meObj: 'them', my: 'their', mine: 'theirs', theirSub: 'you', theirObj: 'you', their: 'your', theirs: 'yours' };

    // The routes first, and separately: each builds its own position and finishes with it.
    const theirRoute = route(R, E, state, opp);
    const myRoute = route(R, E, state, me);

    // Then everything about BEFORE, on one position, before any other is built.
    const before = lens(E, state);
    if (before.me < 0 || before.opp < 0) return NOPE;
    let riskBefore = { steps: 0 }, threatBefore = { steps: 0 };
    if (deep) {
      const posB = E.fromRules(state);
      riskBefore = worstWall(R, E, state, opp, me, posB);
      threatBefore = worstWall(R, E, state, me, opp, posB);
    }

    // Then everything about AFTER, on a fresh one. The order matters: the shared buffer means
    // "before" cannot survive past here.
    const after0 = R.cloneState(state);
    if (action.type === 'wall') R.applyWall(after0, action.orient, action.r, action.c);
    else R.applyMove(after0, action.to);
    const after = lens(E, after0);
    const dMe = (state.turn === after0.turn ? after.me : after.opp) - before.me;
    const dOpp = (state.turn === after0.turn ? after.opp : after.me) - before.opp;
    const lead = before.opp - before.me;              // + means I am nearer home than they are
    let riskAfter = { steps: 0 }, threatAfter = { steps: 0 };
    if (deep) {
      const posA = E.fromRules(after0);
      riskAfter = worstWall(R, E, after0, opp, me, posA);
      threatAfter = worstWall(R, E, after0, me, opp, posA);
    }

    const noWalls = !state.walls[0] && !state.walls[1];

    if (action.type === 'wall') {
      if (dOpp >= 1 && dMe === 0)
        return { kind: 'cut', path: theirRoute, seat: opp, wall: action,
          text: `Cuts ${P.their} route: ${steps(dOpp)} added to ${P.their} way home, and none to ${P.mine}.` };
      if (dOpp >= 1 && dMe >= 1)
        // "cuts N off their route" said the opposite of what the number means: the wall ADDS
        // steps. Read quickly it turned a good wall into a reason not to play it.
        return { kind: 'cut', path: theirRoute, seat: opp, wall: action,
          text: `Adds ${steps(dOpp)} to ${P.their} route and ${steps(dMe)} to ${P.my} own — worth it only while ${P.meSub} come out ahead.` };
      if (dOpp === 0 && riskBefore.steps >= 2 && riskAfter.steps < riskBefore.steps)
        return { kind: 'defend', path: myRoute, seat: me, wall: riskBefore.wall,
          text: `Defends. It costs ${P.theirObj} nothing today, but it takes away the wall that would have cost ${P.meObj} ${steps(riskBefore.steps)}.` };
      if (dOpp === 0 && threatAfter.steps > threatBefore.steps)
        return { kind: 'trap', path: theirRoute, seat: opp, wall: action,
          text: `Sets a trap: nobody loses a step yet, but one more wall would now cost ${P.theirObj} ${steps(threatAfter.steps)}.` };
      if (dOpp === 0 && dMe === 0)
        return { kind: 'shape', path: theirRoute, seat: opp, wall: action,
          text: `Costs nobody a step today — a wall placed for the route it takes away later, not the one it blocks now.` };
      return { kind: 'cost', path: myRoute, seat: me, wall: action,
        text: `Lengthens ${P.my} own route by ${steps(dMe)} and leaves ${P.theirs} alone.` };
    }

    // pawn moves
    const jumped = Math.abs(action.to.r - state.pawns[me].r) + Math.abs(action.to.c - state.pawns[me].c) > 1;
    if (jumped)
      return { kind: 'jump', path: myRoute, seat: me, wall: null,
        text: 'Jumps the other pawn — the rule that turns standing face to face into a free step.' };
    if (noWalls)
      return { kind: 'race', path: myRoute, seat: me, wall: null,
        text: lead > 0 ? `No walls left on either side: a pure race, and ${P.meSub} are ${steps(lead)} ahead.`
          : lead < 0 ? `No walls left on either side: a pure race, and ${P.meSub} are ${steps(-lead)} behind.`
          : 'No walls left on either side: a pure race, dead level, and whoever is to move wins it.' };
    if (dMe < 0 && lead >= 0)
      return { kind: 'run', path: myRoute, seat: me, wall: null,
        text: lead > 0 ? `Advances. ${cap(P.meSub)} are ${steps(lead)} ahead, and a wall would cost the move that keeps ${P.meObj} there.`
          : 'Advances. The race is level, so a move is worth more than a wall.' };
    if (dMe < 0)
      return { kind: 'run', path: myRoute, seat: me, wall: null,
        text: `Advances, ${steps(-lead)} behind. ${cap(P.meSub)} have to close the gap before the walls run out.` };
    if (dMe === 0)
      return { kind: 'side', path: myRoute, seat: me, wall: null,
        text: `Steps sideways: no closer to home, but off the file ${P.theirSub} were building against.` };
    return { kind: 'back', path: myRoute, seat: me, wall: null,
      text: `Steps back, ${steps(dMe)} further from home — the way round a wall that is already there.` };
  }

  (typeof window !== 'undefined' ? window : self).Explain = { explain, route, worstWall };
})();
