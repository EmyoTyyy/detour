// The position lessons. Prefixes are Glendenning, so they are legal and reachable by
// construction; the engine decides what the answer is.
module.exports = [
  { id: 'keep-pace', expect: 'move',
    prefix: 'e2 e8 e3 e7 e4',
    title: 'Keep pace',
    prompt: 'Both pawns are marching up the middle and you are a step behind. What now?',
    why: "Walling here costs you a move and buys almost nothing: the opponent simply walks round it, and you are the one who fell a step behind. In a race that is even, the walls are worth more later, when there is a path worth cutting." },

  { id: 'answer-standard', expect: 'wall',
    prefix: 'e2 e8 e3 e7 e4 e6 e3v',
    title: 'Answering the Standard Opening',
    prompt: 'Your opponent has just played the Standard Opening wall beside you. Find the reply.',
    why: "The wall beside your pawn only matters if you have to go round it. The answer is a wall of your own that makes THEIR detour longer than yours — the exchange is about which player ends up paying more steps, not about who placed a wall first." },
];
