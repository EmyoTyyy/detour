// Quelle notation de murs Ka attend-il ? On ne le deduit pas, on le demande.
//
// Le site declare notation:"official" pour Ka et "glendenning" pour Ishtar, et son code ne fait
// qu'un decalage d'une rangee entre les deux. Mais une convention de murs fausse reste legale
// presque partout: le mur n'est simplement pas la ou on voulait, et rien ne le signale. Donc on
// construit une position ou la rangee du mur CHANGE le bon coup, et on regarde ce que Ka repond.
//
// La position: le pion a jouer est en e5 et un mur horizontal lui barre le pas tout droit. S'il
// lit le mur la ou nous l'avons mis, il doit aller de cote. Si sa rangee est decalee d'un cran, le
// pas tout droit est libre et un moteur de course le prendra.
const WebSocket = require('ws');
const L = require('./lib.js');
const E = L.loadEngine('path/engine.js', { weights: false });
const R = E.Rules;

const URI = 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 1000);

// Le mur barre (4,4)->(3,4): jonction horizontale r=3, colonnes 4-5.
const WR = 3, WC = 4;
const nom = (r, c, dec) => String.fromCharCode(97 + c) + (dec - r);
const sq = (r, c) => String.fromCharCode(97 + c) + (9 - r);

// Ce que Detour dit de la position, pour savoir quoi attendre.
const st = R.createState({ size: 9, walls: 10, players: 2 });
st.pawns = [{ r: 4, c: 4 }, { r: 0, c: 4 }];
st.walls = [9, 10];
st.hWalls = new Set([WR + ',' + WC]);
st.turn = 0;
const legaux = R.legalMoves(st, 0).map(m => sq(m.r, m.c)).sort();
console.log('mur pose par Detour : jonction h(' + WR + ',' + WC + ')');
console.log('  nomme 8-r (notre affichage, = "officielle" supposee) : ' + nom(WR, WC, 8));
console.log('  nomme 9-r (ce que le client Ishtar envoie)           : ' + nom(WR, WC, 9));
console.log('pion a jouer en e5, pas tout droit = e6' + (legaux.includes('e6') ? '' : ' (BARRE)'));
console.log('coups legaux selon Detour : ' + legaux.join(' '));
console.log('');

function ask(pos, label) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let info = null, done = false;
    const fin = (v) => { if (done) return; done = true; try { ws.close(); } catch (e) {} res(v); };
    const t = setTimeout(() => fin('(pas de reponse)'), 60000);
    ws.on('error', (e) => { clearTimeout(t); fin('(erreur: ' + e.message + ')'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      ws.send('setoption name visits value ' + VISITS);
      ws.send('setposition ' + pos);
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        if (/^info /.test(part)) info = part.slice(0, 110);
        const bm = /^bestmove (.*)$/.exec(part);
        if (bm) { clearTimeout(t); console.log('    info: ' + (info || '-')); fin(bm[1].trim()); }
      }
    });
  });
}

(async () => {
  for (const dec of [8, 9]) {
    const pos = `${nom(WR, WC, dec)} /  / ${sq(4, 4)} ${sq(0, 4)} / 9 10 / 1`;
    console.log(`--- mur envoye comme "${nom(WR, WC, dec)}" (${dec} - r) ---`);
    console.log('    position: ' + pos);
    const mv = await ask(pos, dec);
    const droit = mv === 'e6';
    console.log('    Ka joue : ' + mv + (droit ? '   <- tout droit: il N A PAS vu le mur' : '   <- pas tout droit'));
    console.log('');
  }
  process.exit(0);
})();
