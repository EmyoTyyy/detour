// La notation de murs de Ka, tranchee par la LEGALITE et non par son jugement.
//
// kawall.js s'appuyait sur le coup choisi, et c'etait faux deux fois: la parite de la sequence
// donnait la main au mauvais pion, et avec un adversaire echoue en b9 Ka gagne la course si
// largement qu'il pose des murs au lieu d'avancer -- "il evite e6" ne prouvait donc rien.
//
// Ici on envoie une rangee de mur qui n'existe QUE dans une des deux conventions:
//   "e9h" -> 9-r donne r=0 (valide)        | 8-r donne r=-1 (impossible)
//   "e1h" -> 9-r donne r=8 (impossible)    | 8-r donne r=7 (valide)
// Celle qu'il accepte est la sienne. Reste a verifier qu'il refuse VRAIMENT l'illegal, sinon le
// test ne vaut rien: d'ou les deux coups absurdes a la fin.
const WebSocket = require('ws');
const URI = 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 5000);

// Sept coups: le pion du bas monte en e5, celui du haut s'ecarte. Apres sept coups la main est au
// SECOND joueur, donc le huitieme coup de chaque essai est le sien -- c'est la que va le mur.
const AVANT = ['e2', 'd9', 'e3', 'c9', 'e4', 'b9', 'e5'];

function ask(cmds, extra) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let done = false, info = null, raw = [];
    const fin = (v) => { if (done) return; done = true; try { ws.close(); } catch (e) {} res({ mv: v, info, raw }); };
    const t = setTimeout(() => fin('(pas de reponse)'), 90000);
    ws.on('error', (e) => { clearTimeout(t); fin('(erreur: ' + e.message + ')'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      ws.send('setoption name visits value ' + VISITS);
      ws.send('makemove ' + cmds.join(' '));
      for (const c of (extra || [])) ws.send(c);
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        const p = part.trim();
        if (p && !/^log Debug|^log Error|tensorflow|^log Info/.test(p)) raw.push(p.slice(0, 120));
        if (/^info /.test(p)) info = p.slice(0, 60);
        const bm = /^bestmove (.*)$/.exec(p);
        if (bm) { clearTimeout(t); fin(bm[1].trim()); }
      }
    });
  });
}

(async () => {
  const essais = [
    ['TEMOIN  ...a9     (huitieme coup anodin)', AVANT.concat(['a9'])],
    ['MUR     ...e9h    valide seulement en 9-r', AVANT.concat(['e9h'])],
    ['MUR     ...e1h    valide seulement en 8-r', AVANT.concat(['e1h'])],
    ['ABSURDE ...a1     pion qui se teleporte',   AVANT.concat(['a1'])],
    ['ABSURDE ...z5h    colonne inexistante',     AVANT.concat(['z5h'])],
  ];
  const vus = {};
  for (const [nom, cmds] of essais) {
    const r = await ask(cmds);
    const sc = r.info || '-';
    vus[nom] = sc;
    console.log(nom);
    console.log('   -> ' + String(r.mv).padEnd(6) + ' | ' + sc);
    if (r.raw.length) console.log('   brut: ' + r.raw.join(' ~ ').slice(0, 160));
  }
  console.log('');
  const t = vus[essais[0][0]];
  console.log('Lecture: un essai qui rend EXACTEMENT le score du temoin a vu son huitieme coup');
  console.log('refuse. Temoin = ' + t);
  for (const [nom] of essais.slice(1)) {
    console.log('  ' + nom.slice(0, 34).padEnd(34) + (vus[nom] === t ? ' REFUSE (identique au temoin)' : ' ACCEPTE (score different)'));
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
