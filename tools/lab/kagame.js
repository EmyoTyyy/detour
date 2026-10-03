// Une seule partie contre Ka, coup par coup, pour REGARDER au lieu de supposer.
//
// Path marque exactement 50 % contre Ka a 1 visite, et chaque paire se partage 1-1: le resultat ne
// depend donc que de qui commence, pas de la force. Soit Ka est fort, soit les deux plateaux ne
// sont pas le meme. On imprime donc, a chaque coup, la distance de chaque pion a son but selon
// NOTRE plateau: si Ka joue de facon coherente la-dessus, les plateaux concordent.
const L = require('./lib.js'), D = require('./duel.js');
const { Ka, parseMove, nameAction } = require('./kaai.js');

const VISITS = Number(process.env.VISITS || 1);
const NODES = Number(process.env.NODES || 500000);
const PAIR = Number(process.env.PAIR || 0);
const PATHFIRST = process.env.PATHFIRST !== '0';
const A = L.loadEngine(undefined, { weights: false });
const E = A.Engine, R = A.Rules;

const sqn = (r, c) => String.fromCharCode(97 + c) + (9 - r);
function dist(s, p) {
  const dm = R.distanceMap(s, p);
  return dm.get(R.key(s.pawns[p].r, s.pawns[p].c));
}

(async () => {
  const rnd = L.rng(77 * 7919 + PAIR);
  const ouverture = [];
  const base = D.makeOpening(A, L.startState(R), 4, rnd, ouverture);
  const s = R.deState(R.serState(base));
  const first = s.turn;
  E.clearTable();
  const K = new Ka(VISITS);
  for (const a of ouverture) K.push(a);
  console.log('ouverture : ' + ouverture.map(nameAction).join(' '));
  console.log('apres ouverture: pions ' + s.pawns.map((p, i) => i + '=' + sqn(p.r, p.c)).join(' ') +
    '  au tour de ' + first + '   Path est le joueur ' + (PATHFIRST ? first : 1 - first));
  console.log('');
  for (let ply = 0; ply < 300; ply++) {
    if (s.winner != null) { console.log('>>> fin: winner=' + s.winner + ' apres ' + ply + ' coups'); break; }
    const pathToMove = (s.turn === first) === PATHFIRST;
    let tok, a;
    if (pathToMove) {
      const pos = E.fromRules(s);
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
      a = E.toAction(pos, r.best); tok = nameAction(a); K.push(a);
    } else {
      tok = await K.bestMove(60000);
      a = parseMove(tok);
      const ok = a.type === 'move'
        ? R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c)
        : R.canPlaceWall(s, s.turn, a.orient, a.r, a.c);
      if (!ok) { console.log('!!! coup illegal de Ka: ' + tok); break; }
      K.push(tok);
    }
    L.applyAction(R, s, a);
    const d0 = dist(s, 0), d1 = dist(s, 1);
    console.log(String(ply + 1).padStart(3) + ' ' + (pathToMove ? 'PATH' : 'KA  ') + ' joue ' + tok.padEnd(5) +
      ' | pions ' + s.pawns.map(p => sqn(p.r, p.c)).join(' ') +
      ' | distances ' + d0 + '/' + d1 + ' | murs restants ' + s.walls.join('/'));
  }
  K.close();
  process.exit(0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
