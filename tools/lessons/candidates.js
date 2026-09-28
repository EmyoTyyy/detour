// Positions to try. Reached by a sequence so they are legal and reachable by construction.
module.exports = [
  { id: 'course-simple',   seq: 'e2 e8 e3 e7 e4 e6 e5' },
  { id: 'apres-standard',  seq: 'e2 e8 e3 e7 e4 e6 e3v' },
  { id: 'apres-shiller',   seq: 'e2 e8 e3 e7 e4 e6 c3v' },
  { id: 'apres-sidewall',  seq: 'e2 e8 d7v' },
  { id: 'apres-stonewall', seq: 'e2 e8 e3 e7 d2h' },
  { id: 'miroir',          seq: 'e2 e8 e3 e7 e4 e6 d4h d6h' },
  { id: 'saut',            seq: 'e2 e8 e3 e7 e4 e6 e5' },
  { id: 'fin-de-course',   seq: 'e2 e8 e3 e7 e4 e6 e5 e5v d4h d6h f4h f6h' },
];
