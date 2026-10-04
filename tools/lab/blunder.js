// OU Path se trompe-t-il ? Juge par Ishtar, et non par Path lui-meme.
//
// C'est la correction d'une erreur de methode. L'instrument qui declarait le moteur sain mesurait
// l'accord de Path avec UNE RECHERCHE PLUS PROFONDE DE PATH: une evaluation systematiquement
// fausse y obtient un score parfait, puisqu'elle est parfaitement d'accord avec elle-meme. Et tous
// les reseaux entraines l'ont ete sur les recherches de Path, donc aucun ne pouvait le depasser.
// Ishtar, lui, est un arbitre EXTERIEUR, et il rend un score numerique (root_score) pour n'importe
// quelle position qu'on lui envoie.
//
// Pour chaque position ou Path doit jouer:
//   mP = le coup de Path       mI = le coup d'Ishtar
//   on demande a Ishtar son score APRES mP et APRES mI.
// Les deux scores sont du point de vue de CELUI QUI JOUE ENSUITE, donc de l'adversaire: plus il
// est bas, mieux Path s'en sort. Ce que Path concede = score(apres mP) - score(apres mI), positif
// quand le coup de Path laisse l'adversaire mieux place que le coup d'Ishtar.
//
//   PARTIES=4 REF=50000 ADV=50000 node blunder.js > blunder.json
const fs = require('fs');
const L = require('./lib.js'), D = require('./duel.js');
const { Ishtar, parseMove, serialise, lireScore } = require('./qai.js');

const PARTIES = Number(process.env.PARTIES || 4);
const REF = Number(process.env.REF || 50000);      // l'arbitre
const ADV = Number(process.env.ADV || 50000);      // l'adversaire pendant la partie
const NODES = Number(process.env.NODES || 500000); // le budget livre de Path
const SEED = Number(process.env.SEED || 501);
const SORTIE = process.env.SORTIE || 'blunder.json';

const A = L.loadEngine(undefined, { weights: false });
const E = A.Engine, R = A.Rules;
const nomCase = (r, c) => String.fromCharCode(97 + c) + (9 - r);
const nomAction = (a) => a.type === 'move' ? nomCase(a.to.r, a.to.c)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

async function verdict(I, s, timeoutMs) {
  const tok = await I.bestMove(s, timeoutMs || 300000);
  return { move: tok, score: lireScore(I.infos) };
}
function dist(s, p) {
  const dm = R.distanceMap(s, p);
  return dm.get(R.key(s.pawns[p].r, s.pawns[p].c));
}

(async () => {
  const Iadv = new Ishtar(ADV), Iref = new Ishtar(REF);
  const cas = [];
  let parties = 0;
  for (let g = 0; g < PARTIES; g++) {
    const rnd = L.rng(SEED * 7919 + g);
    const base = D.makeOpening(A, L.startState(R), 4, rnd);
    if (base.winner != null) continue;
    // Path joue le camp qui commence une fois sur deux, pour ne pas ne mesurer qu'un seul siege.
    const pathFirst = g % 2 === 0;
    const s = R.deState(R.serState(base));
    const first = s.turn;
    E.clearTable();
    parties++;
    for (let ply = 0; ply < 300 && s.winner == null; ply++) {
      const pathToMove = (s.turn === first) === pathFirst;
      if (!pathToMove) {
        const v = await verdict(Iadv, s);
        const a = parseMove(v.move);
        L.applyAction(R, s, a);
        continue;
      }
      // --- la position qui nous interesse: Path doit jouer ---
      const pos = E.fromRules(s);
      const r = E.analyse(pos, { budgetMs: 1e9, maxNodes: NODES });
      const aP = E.toAction(pos, r.best);
      const avant = await verdict(Iref, s);
      const aI = parseMove(avant.move);
      const memeCoup = nomAction(aP) === nomAction(aI);

      let concede = 0, sApres = null, sIdeal = null;
      if (!memeCoup) {
        const sP = R.deState(R.serState(s)); L.applyAction(R, sP, aP);
        const sI = R.deState(R.serState(s)); L.applyAction(R, sI, aI);
        // Si un coup gagne sur le champ, Ishtar n'a rien a dire: on le note a part.
        sApres = sP.winner != null ? (sP.winner === 'draw' ? 0.5 : 0) : (await verdict(Iref, sP)).score;
        sIdeal = sI.winner != null ? (sI.winner === 'draw' ? 0.5 : 0) : (await verdict(Iref, sI)).score;
        if (sApres != null && sIdeal != null) concede = sApres - sIdeal;
      }
      cas.push({
        partie: g, ply, pos: serialise(s),
        pathMove: nomAction(aP), pathKind: aP.type, pathScore: r.score, pathDepth: r.depth,
        ishtarMove: avant.move, ishtarKind: avant.move.length > 2 ? 'wall' : 'move',
        ishtarScore: avant.score, memeCoup, concede,
        apresPath: sApres, apresIshtar: sIdeal,
        mursPath: s.walls[s.turn], mursAdv: s.walls[1 - s.turn],
        distMoi: dist(s, s.turn), distAdv: dist(s, 1 - s.turn),
      });
      process.stderr.write(`\rpartie ${g + 1}/${PARTIES} coup ${ply}  cas ${cas.length}`);
      L.applyAction(R, s, aP);
    }
    // Ecrire apres CHAQUE partie. Leur serveur coupe les connexions pendant les longs matchs
    // (deux tranches sur huit perdues apres une heure chacune); n'ecrire qu'a la fin, c'est risquer
    // de tout perdre sur la derniere partie.
    fs.writeFileSync(SORTIE, JSON.stringify({ ref: REF, adv: ADV, nodes: NODES, parties, cas }, null, 1));
  }
  process.stderr.write('\r');
  fs.writeFileSync(SORTIE, JSON.stringify({ ref: REF, adv: ADV, nodes: NODES, parties, cas }, null, 1));
  console.log(`${cas.length} positions ecrites dans ${SORTIE} (${parties} parties, arbitre a ${REF} visites)`);
  Iadv.close(); Iref.close();
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
