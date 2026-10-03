// The named openings, from the two places that publish them.
//
// Wikipedia gives move sequences in Glendenning notation, anchored at the square nearest a1.
// The QuoridorStrategy channel gives its community's names with quoridorfansite board codes,
// which encode a POSITION rather than a move order -- so those are matched by position, and a
// game that transposes into one is still recognised.
module.exports = {
  // --- Wikipedia, https://en.wikipedia.org/wiki/Quoridor#Opening -------------------------------
  lines: [
    { name: 'Standard Opening', line: 'e2 e8 e3 e7 e4 e6 e3v',
      note: "Both pawns walk straight up the middle, then a vertical wall goes in beside the opponent. Mirrored plays e6v instead, symmetrical plays d6v." },
    { name: 'Shiller Opening', line: 'e2 e8 e3 e7 e4 e6 c3v',
      note: "Lengthen their route, keep yours short. The wall can sit on c3, d3, e3 or f3." },
    { name: 'The Stonewall', line: 'e2 e8 e3 e7 d2h',
      note: "A wall laid behind your own pawn, to push back an opponent who comes forward. It continues f2h, b2h, h2v." },
    { name: 'Ala Opening', line: 'e2 e8 e3 e7 e4 e6 d5h',
      note: "Keep one easy path for yourself while leaving the opponent choices. Also played as f5h, c4v or g4v." },
    { name: 'Gap Opening', line: 'e2 e8 e3 e7 e4 e6 e3v e6v g6h',
      note: "The mainline continuation of the standard walls. The anti-gap answer is b3h." },
    { name: 'The Sidewall', line: 'e2 e8 d7v',
      note: "A very early wall that forces the second player into wasted moves. The counter is c7h." },
    { name: 'Shatranj Opening', line: 'd1v',
      note: "A wall on the very first move, channelling your own route to the far rank. e1v does the same job." },
    { name: 'Reed Opening', line: 'c3h a3h f3h h3h',
      note: "Two walls on the third row with a single gap left in the middle." },
    // --- not from Wikipedia: played out on this board and exported from it -------------------
    // The Bowl is not in any published list I could find; this one comes from a game of the
    // project's own (assets/bowl_opening.json), converted move for move. The line is the whole
    // game as it was played, because a line has to be legal to be checked -- so the opponent's
    // answer is in it too. What makes it the Bowl is the four walls the first player lays: a cup
    // around their own pawn, closed behind and on both flanks, open only towards the goal.
    // --- from assets/quoridor_strategy_guide.md ------------------------------------------------
    // The guide names four unconventional openers but describes three of them as plans ("push
    // forward, step laterally, then place a vertical wall") rather than squares. Only these two
    // pin down to a line: the Merit's square is given outright, and the Jackob is a wall in front
    // of your own pawn, which leaves only which junction -- the one directly ahead of it. The
    // other two are in the lessons as ideas instead, because inventing a line for them would mark
    // a learner wrong for reading the same sentence differently.
    { name: 'Merit Opener', src: 'g', line: 'e2 e8 e3 e7 e4 e6 e5',
      note: "White walks straight up to e5, right beside the black pawn. It hands Black a jump and the depth that comes with it, and buys White the initiative to shape the board first." },
    { name: 'Jackob Opener', src: 'g', line: 'e2 e8 e3 e7 e4 e6h',
      note: "Black's wall goes in FRONT of their own pawn, not behind it. It stands in the way of White's march as much as their own, so White cannot answer with a straight push without losing tempo." },
    { name: 'The Bowl', src: 'd', line: 'e2 e8 e3 e7 e4 e6 e3h e7h c3h c7h f4v g7h b4v',
      note: "Four walls make a cup around your own pawn: closed behind, walled on both flanks, open only forwards. Nothing can be dropped behind you, and the answer shown is a long wall across the third row." },
  ],
  // --- QuoridorStrategy, "5 Quoridor openers you must know" -------------------------------------
  // The board codes are the ones published in that video's description.
  codes: [
    { name: 'Standard Copy', code: 'j7EUwGwOwCQ',
      note: "Black answers every move of White's in the mirror, walls included." },
    { name: 'Fresh Prince Eric', code: 'j7EUwHMPMCQ',
      note: "The same march up the middle, with Black's wall set one file across." },
    { name: 'Black Rush', code: 'j7oAAXNwBw',
      note: "Black spends the opening running rather than walling, and pays for it with a single wall placed late." },
    { name: 'Cool Story Bro', code: 'i0MAFQNQBQ',
      note: "Black walls early and low, before either pawn has committed." },
    { name: 'X-Black', code: 'j8MAHIXNwBw',
      note: "Black gives up tempo for two walls, crossing White's route in two places." },
  ],
};
