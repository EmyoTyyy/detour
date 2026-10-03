// Quelle notation de murs Ka attend-il ? On ne le deduit pas, on le demande -- et cette fois par
// `makemove`, puisque kaprobe.js a montre que `setposition` est purement ignore.
//
// Un mur mal converti reste legal presque partout: il n'est simplement pas ou on voulait, et rien
// ne le signale. Donc on construit une position ou la RANGEE du mur change le bon coup: le pion a
// jouer est en e5 et un mur horizontal lui barre le pas tout droit. S'il lit le mur la ou nous
// l'avons mis, il doit aller de cote. Si sa rangee est decalee d'un cran, e6 est libre et un
// moteur de course le prendra.
const WebSocket = require('ws');
const L = require('./lib.js');
const { parseMove } = require('./qai.js');
const A = L.loadEngine('path/engine.js', { weights: false });
const R = A.Rules;

const URI = 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 5000);

// Le pion du bas monte au centre; celui du haut s'ecarte lateralement pour ne jamais devenir
// adjacent (l'adjacence declenche le saut et brouillerait le test) et sans repeter une case.
const AVANT = ['e2', 'd9', 'e3', 'c9', 'e4', 'b9', 'e5'];
// La jonction horizontale qui barre (4,4)->(3,4), c'est-a-dire e5 -> e6.
const WR = 3, WC = 4;
const NOMS = {
  'e6h': "9 - r  (la convention du client Ishtar)",
  'e5h': "8 - r  (celle de Detour et de la communaute)",
};

// 1. Ce que Detour dit de la position. On l'etablit en appliquant les coups, pas en le supposant.
function construire(avecMur) {
  const s = L.startState(R);
  for (const tok of AVANT) {
    const a = parseMove(tok);
    const ok = R.legalMoves(s, s.turn).some(m => m.r === a.to.r && m.c === a.to.c);
    if (!ok) throw new Error(`notre propre sequence est illegale a "${tok}"`);
    L.applyAction(R, s, a);
  }
  if (avecMur) {
    if (!R.canPlaceWall(s, s.turn, 'h', WR, WC)) throw new Error('le mur du test est illegal');
    L.applyAction(R, s, { type: 'wall', orient: 'h', r: WR, c: WC });
  }
  return s;
}

function ask(cmds) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let done = false, info = null;
    const fin = (v) => { if (done) return; done = true; try { ws.close(); } catch (e) {} res({ mv: v, info }); };
    const t = setTimeout(() => fin('(pas de reponse)'), 90000);
    ws.on('error', (e) => { clearTimeout(t); fin('(erreur: ' + e.message + ')'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      ws.send('setoption name visits value ' + VISITS);
      ws.send('makemove ' + cmds.join(' '));
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        if (/^info /.test(part)) info = part.slice(0, 60);
        const bm = /^bestmove (.*)$/.exec(part);
        if (bm) { clearTimeout(t); fin(bm[1].trim()); }
      }
    });
  });
}

(async () => {
  const sans = construire(false), avec = construire(true);
  const nom = (s) => R.legalMoves(s, s.turn).map(m => String.fromCharCode(97 + m.c) + (9 - m.r)).sort().join(' ');
  console.log('sequence : ' + AVANT.join(' '));
  console.log('sans mur -> pion a jouer en e5, coups legaux : ' + nom(sans));
  console.log('avec mur -> coups legaux : ' + nom(avec) + '   (e6 ' + (nom(avec).includes('e6') ? 'LIBRE ?!' : 'barre') + ')');
  console.log('');

  const ctl = await ask(AVANT);
  console.log('TEMOIN, aucun mur                 -> Ka joue ' + String(ctl.mv).padEnd(5) + ' | ' + (ctl.info || '-'));
  console.log('   (on attend e6: la course est libre)');
  console.log('');
  for (const tok of Object.keys(NOMS)) {
    const r = await ask(AVANT.concat([tok]));
    const droit = r.mv === 'e6';
    console.log(`mur envoye "${tok}"  ${NOMS[tok]}`);
    console.log('   -> Ka joue ' + String(r.mv).padEnd(5) + ' | ' + (r.info || '-'));
    console.log('   ' + (droit ? 'tout droit: il N A PAS vu le mur ici' : 'il evite e6: il A vu le mur ici'));
    console.log('');
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
