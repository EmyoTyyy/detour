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
