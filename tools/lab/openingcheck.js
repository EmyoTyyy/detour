// Les ouvertures nommees du livre sont-elles bonnes ? On demande a Ishtar, pas a Path.
//
// Elles viennent de Wikipedia et de la chaine QuoridorStrategy, donc d'humains: il n'y a aucune
// raison de les croire mauvaises, et c'est bien pour ca qu'il faut MESURER avant de toucher a
// quoi que ce soit. Pour chaque ouverture qui est une SUITE de coups, on la rejoue coup par coup
// et on demande a Ishtar, a chaque position, ce qu'il jouerait. On note:
//   - s'il joue le meme coup que l'ouverture (accord)
//   - ce qu'il pense de la position a la fin de la ligne (du point de vue de celui qui joue)
// Une ouverture dont la ligne finit au-dessus de 0,5 pour son auteur est bonne pour lui.
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const { Ishtar, parseMove, lireScore } = require('./qai.js');

const VISITS = Number(process.env.VISITS || 50000);
const SORTIE = process.env.SORTIE || 'openingcheck.json';
const racine = path.join(__dirname, '..', '..');

// openings.js s'attache a window ou self; en node il n'y a ni l'un ni l'autre.
global.self = global;
eval(fs.readFileSync(path.join(racine, 'path/openings.js'), 'utf8'));
const OP = global.Openings;

const A = L.loadEngine(undefined, { weights: false });
const R = A.Rules;
const nomCase = (r, c) => String.fromCharCode(97 + c) + (9 - r);
const nomAction = (a) => a.type === 'move' ? nomCase(a.to.r, a.to.c)
  : String.fromCharCode(97 + a.c) + (8 - a.r) + a.orient;

(async () => {
  const I = new Ishtar(VISITS);
  const res = [];
  const avecLigne = OP.list.filter(o => o.line);
  console.log(`${OP.list.length} ouvertures, dont ${avecLigne.length} sous forme de suite de coups`);
  console.log(`arbitre: Ishtar a ${VISITS} visites`);
  console.log('');
  for (const o of avecLigne) {
    const toks = o.line.split(' ');
    const s = L.startState(R);
    const etapes = [];
    let accord = 0, dernierScore = null, ok = true;
    for (let i = 0; i < toks.length; i++) {
      const a = OP.actionOf(toks[i]);
      const legal = a.type === 'move'
        ? R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c)
        : R.canPlaceWall(s, s.turn, a.orient, a.r, a.c);
      if (!legal) { etapes.push({ i, erreur: 'coup illegal dans la ligne: ' + toks[i] }); ok = false; break; }
      const v = await I.bestMove(s, 300000);
      const sc = lireScore(I.infos);
      const veut = nomAction(parseMove(v));
      const joue = nomAction(a);
      if (veut === joue) accord++;
      etapes.push({ i, joue, ishtar: veut, meme: veut === joue, score: sc, tour: s.turn });
      L.applyAction(R, s, a);
      dernierScore = sc;
    }
    // apres la ligne: que pense Ishtar de la position atteinte ?
    let apres = null;
    if (ok && s.winner == null) {
      await I.bestMove(s, 300000);
      apres = lireScore(I.infos);
    }
    const ligne = { nom: o.name, src: o.src, coups: toks.length, accord, etapes, apres, tourApres: s.turn };
    res.push(ligne);
    console.log(`${o.name.padEnd(22)} ${String(accord) + '/' + toks.length} coups joues par Ishtar aussi` +
      (apres != null ? `   apres la ligne: ${apres.toFixed(3)} pour le joueur ${s.turn + 1}` : '   (interrompue)'));
    fs.writeFileSync(SORTIE, JSON.stringify({ visits: VISITS, lignes: res }, null, 1));
  }
  I.close();
  console.log('');
  console.log('ecrit dans ' + SORTIE);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
