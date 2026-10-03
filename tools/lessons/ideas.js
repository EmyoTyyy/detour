// The written lessons: the ideas from assets/quoridor_strategy_guide.md.
//
// They are not drills. A drill asks for one move and the engine says whether you found it, which
// only works when a position has one clearly best move. These are plans and habits -- "price every
// wall by the steps it adds", "whoever commits to a route first is the one who can be blocked" --
// and there is no single move that marks you right or wrong on them. So they are read, and the
// card remembers you have read it, and that is all they claim to be.
//
// `from` names the section of the guide each one comes from, so a wording that drifts can be
// checked against its source.
module.exports = [
  // ---- openings the guide describes as plans rather than as lines -------------------------------
  { id: 'dual-path', title: 'Dual-path opening', from: 'Openings & early game',
    summary: 'Push forward, step sideways, then wall: never say which corridor you are using.',
    body: [
      'Black steps forward, then sideways, and only then places a vertical wall. Nothing in those three moves says which side of the board Black means to go home by.',
      'That costs White real walls. A wall covering one corridor is wasted if you walk the other, so White either spends two to cover both or waits — and waiting is how an opening is lost.',
      'The same habit later in the game is on this list as making them commit first.',
    ] },

  { id: 'retreat-bait', title: 'Retreat bait', from: 'Openings & early game',
    summary: 'Run at them, let them spend walls stopping you, then walk back out.',
    body: [
      'Black pushes hard into the centre. White answers with walls, because a pawn arriving at your back rank is the one threat you cannot ignore.',
      'Then Black turns round and leaves. The walls are still on the board, but they are stopping a pawn that is no longer going that way.',
      'What you traded is your tempo for their wall count: you are a few steps behind, they are two or three walls poorer. A good trade only while the board is still open enough for those walls to have mattered.',
    ] },

  // ---- the core ideas --------------------------------------------------------------------------
  { id: 'wall-math', title: 'What a wall is worth', from: 'Core strategies',
    summary: 'Count the steps it adds to their route, less the ones it adds to yours.',
    body: [
      'A wall is worth the number of steps it adds to the opponent’s shortest route. One that adds none is worth none, however good it looks on the board.',
      'A wall in your own half that does not slow them at all can still be worth placing, because it stops a wall of theirs landing there later. Price that as losing one, not as nothing.',
      'Before any attacking wall, look for their answer. A wall worth two that invites a reply worth two has bought you nothing and cost you a wall.',
    ] },

  { id: 'canvas', title: 'Walls need room', from: 'Core strategies',
    summary: 'Eight walls in hand are worth nothing if there is nowhere left to put them.',
    body: [
      'Walls only work where there is open board to put them on. A nine-to-four lead on a board already carved into corridors is not a lead.',
      'So never read the wall count on its own: read it with how much open space is left. Spending walls early to keep the board open for yours is sometimes the better side of the trade.',
      'The matching mistake is hoarding. If the board is closing while you are still saving, the walls in your hand are quietly turning into nothing.',
    ] },

  { id: 'ambiguity', title: 'Make them commit first', from: 'Core strategies',
    summary: 'Whoever settles on one route first is the one who can be blocked.',
    body: [
      'Keep two ways home open through the early and middle game. Build lines that work for either of them rather than lines that only make sense if you go left.',
      'Then the pressure is on the other side: they have to spend walls on a route you have not chosen yet, or let you choose freely.',
      'The reverse is the test for your own moves. If a wall of yours announces which way you are going, it has told them where to aim.',
    ] },

  // ---- patterns worth recognising --------------------------------------------------------------
  { id: 'exit-seal', title: 'Seal the exit, not the entrance', from: 'Traps & tactical patterns',
    summary: 'Wall behind them, then close the way out: a short detour becomes a lap of the board.',
    body: [
      'While they are inside a narrow corridor, a wall at the entrance costs them almost nothing — they were going forward anyway.',
      'The pair is what works: one behind them, then one across the exit they were heading for. Four to six steps, which is more than any single wall buys on an open board.',
      'It needs two walls and one quiet move in between, so it is a middle-game pattern and not an opening one.',
    ] },

  { id: 'anchor-bait', title: 'The anchor wall', from: 'Traps & tactical patterns',
    summary: 'A quiet wall in your own half, left there until their attack runs into it.',
    body: [
      'Against someone throwing walls at you early, place one that looks passive in your own rear area, and leave it.',
      'As they wrap walls around your main route, their own escape route narrows. The wall you placed for no visible reason is the one that closes it.',
      'This is the useful case of the wall priced at minus one: it did nothing the turn it was played, and it decided the sequence four moves later.',
    ] },

  { id: 'corner-box', title: 'Corners are traps', from: 'Traps & tactical patterns',
    summary: 'A pawn in a three-by-three corner can be shut in by a single wall.',
    body: [
      'Near a corner the board runs out on two sides at once, so the number of walls needed to pen you in drops to one.',
      'Count before you go in: if one wall can close the square you are standing in, you are not taking a shortcut, you are walking into a long way back.',
      'If you have to go near a corner, build the line that protects the exit before you get there, not after.',
    ] },

  // ---- the mistakes ----------------------------------------------------------------------------
  { id: 'early-close', title: 'Do not close a side too early', from: 'Common mistakes',
    summary: 'Shutting one route early hands them the open half of the board.',
    body: [
      'Closing a side to lock someone in reads as progress and usually is not. They answer with one wall, and now you are the one in the open half with nothing left to cut.',
      'The board you leave behind matters as much as the step you took away. A wall that opens a wide region for them to delay you in has cost you more than it gained.',
    ] },

  { id: 'jump-loop', title: 'Do not let them jump you', from: 'Common mistakes',
    summary: 'Every jump is a free step for them and none for you.',
    body: [
      'A pawn that can be jumped repeatedly near a wall structure is handing out forward steps for nothing, while you shuffle sideways to get out of the way.',
      'So count the jump before you step beside them, especially with walls behind you: the square that looks like contact is often the square that gives them a free move.',
    ] },

  { id: 'over-defend', title: 'Defence without a threat', from: 'Common mistakes',
    summary: 'Two defensive walls in a row, and the game is theirs to shape.',
    body: [
      'Walls that only protect you do not move you forward and do not slow them down. Playing two of them back to back gives away both the initiative and the wall count.',
      'Put a step or a real threat between them. If you cannot find one, the defensive wall probably was not needed yet either.',
    ] },

  // ---- the endgame -----------------------------------------------------------------------------
  { id: 'jump-race', title: 'Count the race', from: 'Endgame',
    summary: 'When the walls are gone it is arithmetic: count both routes and run.',
    body: [
      'With few or no walls left, the position is a sum. Count your shortest route and theirs, remembering whose turn it is.',
      'If the count is in your favour by even one step, stop placing walls and run. A wall you place is a step you did not take, and that is exactly the margin you were ahead by.',
    ] },

  { id: 'keep-a-wall', title: 'Keep one wall back', from: 'Endgame',
    summary: 'The last wall is for their last corridor, or their last jump.',
    body: [
      'Arriving at the finish with no walls means there is nothing you can do about the one-cell corridor they walk down, or the jump that saves them a move.',
      'One or two held back are enough. More than that and you are hoarding — the board near the baseline is narrow, and narrow boards take few walls to decide.',
    ] },

  { id: 'simplify', title: 'Close what nobody is using', from: 'Endgame',
    summary: 'Sealing dead space turns a tangle into a count you can do.',
    body: [
      'In a complicated position, walls that shut off board nobody is going to use do not slow anyone down — they reduce the number of routes either player has to think about.',
      'That is worth something on its own: a position with one route each is a position you can count exactly, and counting beats judging.',
    ] },
];
