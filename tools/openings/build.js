// Builds path/openings.js from two sources, and refuses to emit anything it cannot play out
// legally on Detour's own board.
//
//   - Wikipedia's named openings, given as Glendenning move sequences.
//   - quoridorfansite board codes, which the QuoridorStrategy channel publishes for the names
//     its community uses. Those encode a POSITION, not a move order.
//
// Both are reduced to the same thing: a position signature, which is what the matcher compares
// against during a game. Matching on the position rather than the move order means a line that
// transposes into a named opening is still recognised as that opening.
const fs = require('fs'), path = require('path');
const L = require('../lab/lib.js');
const R = L.loadEngine().Rules;

// --- Glendenning, the notation both Wikipedia and quoridor-ai.com use ------------------------
// Column is 'a'+c and row is 9-r for a SQUARE. A wall is the trap: Wikipedia states the rule --
// "a wall move is denoted by the closest square to a1" -- so e3v is the vertical wall between
// columns e and f spanning rows 3 and 4, and its Detour junction row is 8-row, not 9-row.
//
// quoridor-ai.com anchors walls at the opposite corner, which is why tools/lab/qai.js uses
// 9-row and this uses 8-row. Both were established from evidence rather than assumed: the
// server echoes the board it received, and the Shatranj opening's 1.d1v is off the board under
// the other anchor. Getting this backwards makes seven of eight published openings still look
// legal, so it fails quietly.
function fromGlendenning(tok) {
  const m = /^([a-i])([1-9])([hv])?$/.exec(tok);
  if (!m) throw new Error('coup illisible: ' + tok);
  const c = m[1].charCodeAt(0) - 97, row = Number(m[2]);
  return m[3] ? { type: 'wall', orient: m[3], r: 8 - row, c } : { type: 'move', to: { r: 9 - row, c } };
}

// --- quoridorfansite codes -------------------------------------------------------------------
// 6 bits per base64 character. bin[0] flags a stored state; then two 7-bit cell indices for the
// pawns, then four lists (white horizontal, white vertical, black horizontal, black vertical),
// each a 4-bit count followed by that many 6-bit junction indices.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeCode(code) {
  const bin = [];
  for (const ch of String(code)) {
    const n = B64.indexOf(ch);
    if (n < 0) continue;
    for (let k = 5; k >= 0; k--) bin.push((n >>> k) & 1);
  }
  const num = (s, l) => { let v = 0; for (let i = 0; i < l; i++) v = (v << 1) | (bin[s + i] || 0); return v; };
  if (!bin[0]) throw new Error('le code ne porte pas de position');
  let p = 2;
  const wCell = num(p, 7); p += 7;
  const bCell = num(p, 7); p += 7;
  const lists = {};
  for (const key of ['wh', 'wv', 'bh', 'bv']) {
    const n = num(p, 4); p += 4;
    const a = [];
    for (let i = 0; i < n; i++) { a.push(num(p, 6)); p += 6; }
    lists[key] = a;
  }
  // Their row 0 is white's home, which is Detour's row 8. A wall at their junction row wr sits
  // between their rows wr and wr+1, so it is Detour's junction 7-wr.
  const cell = i => ({ r: 8 - ((i / 9) | 0), c: i % 9 });
  const wall = i => ({ r: 7 - ((i / 8) | 0), c: i % 8 });
  return {
    pawns: [cell(wCell), cell(bCell)],
    hWalls: [...lists.wh, ...lists.bh].map(wall),
    vWalls: [...lists.wv, ...lists.bv].map(wall),
  };
}

// --- signatures -------------------------------------------------------------------------------
const sig = (s) => [
  [...s.hWalls].sort().join(' '),
  [...s.vWalls].sort().join(' '),
  s.pawns.map(p => p.r + ',' + p.c).join(' '),
].join('|');

function playLine(tokens) {
  const s = L.startState(R);
  for (const t of tokens) {
    const a = fromGlendenning(t);
    if (a.type === 'move') {
      if (!R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c))
        throw new Error(`coup illegal "${t}" au trait ${s.turn}`);
    } else if (!R.canPlaceWall(s, s.turn, a.orient, a.r, a.c)) {
      throw new Error(`mur illegal "${t}" au trait ${s.turn}`);
    }
    L.applyAction(R, s, a);
  }
  return s;
}

function fromDecoded(d) {
  const s = L.startState(R);
  s.hWalls = new Set(d.hWalls.map(w => w.r + ',' + w.c));
  s.vWalls = new Set(d.vWalls.map(w => w.r + ',' + w.c));
  s.pawns = d.pawns.map(p => ({ ...p }));
  s.walls = [10 - d.hWalls.length, 10 - d.vWalls.length];   // refined below per source
  return s;
}

module.exports = { fromGlendenning, decodeCode, sig, playLine, fromDecoded, R, L };
