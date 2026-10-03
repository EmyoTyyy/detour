// Comment donne-t-on une position a Ka ? `setposition` est ignore (kaprobe.js: cinq positions
// differentes, meme reponse et meme score au bit pres). Il ne reste que `makemove`. On teste sa
// forme exacte: liste entiere en une commande, ou une commande par coup.
//
// Le signal n'est pas le coup rendu mais le SCORE: si l'etat n'a pas bouge, le score reste
// 0.09301662011844355 au chiffre pres, comme dans les cinq essais de kaprobe.
const WebSocket = require('ws');
const URI = 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 1000);

function essai(cmds) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let done = false, info = null, raw = [];
    const fin = (v) => { if (done) return; done = true; try { ws.close(); } catch (e) {} res({ mv: v, info, raw }); };
    const t = setTimeout(() => fin('(pas de reponse)'), 60000);
    ws.on('error', (e) => { clearTimeout(t); fin('(erreur: ' + e.message + ')'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      ws.send('setoption name visits value ' + VISITS);
      for (const c of cmds) ws.send(c);
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        if (raw.length < 6 && part.trim()) raw.push(part.slice(0, 100));
        if (/^info /.test(part)) info = part.slice(0, 100);
        const bm = /^bestmove (.*)$/.exec(part);
        if (bm) { clearTimeout(t); fin(bm[1].trim()); }
      }
    });
  });
}

(async () => {
  const essais = [
    ['reference: rien',                      []],
    ['makemove e2 (une commande)',           ['makemove e2']],
    ['makemove e2 e8 (liste, une commande)', ['makemove e2 e8']],
    ['makemove e2 puis makemove e8',         ['makemove e2', 'makemove e8']],
    ['move e2',                              ['move e2']],
    ['position moves e2',                    ['position moves e2']],
    ['makemove e2 e8 e3 e7 (liste longue)',  ['makemove e2 e8 e3 e7']],
  ];
  for (const [nom, cmds] of essais) {
    const r = await essai(cmds);
    console.log(nom.padEnd(40) + ' -> ' + String(r.mv).padEnd(8) + ' | ' + (r.info || '-'));
    if (r.raw.length) console.log('      recu: ' + r.raw.join(' ~ ').slice(0, 150));
  }
  process.exit(0);
})();
