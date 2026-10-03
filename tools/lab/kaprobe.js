// Ka accepte-t-il seulement `setposition` ? On enleve les murs du test pour ne garder qu'une
// question: deplace-t-il le pion qu'on lui donne, ou repond-il depuis la position de depart ?
const WebSocket = require('ws');
const URI = process.env.QAI_URI || 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 1000);

function ask(pos, opts) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let done = false, info = null, raw = [];
    const fin = (v) => { if (done) return; done = true; try { ws.close(); } catch (e) {} res({ mv: v, info, raw }); };
    const t = setTimeout(() => fin('(pas de reponse)'), 45000);
    ws.on('error', (e) => { clearTimeout(t); fin('(erreur: ' + e.message + ')'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      if (!opts || !opts.noOption) ws.send('setoption name visits value ' + VISITS);
      if (pos !== null) ws.send('setposition ' + pos);
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        if (raw.length < 4) raw.push(part.slice(0, 90));
        if (/^info /.test(part)) info = part.slice(0, 90);
        const bm = /^bestmove (.*)$/.exec(part);
        if (bm) { clearTimeout(t); fin(bm[1].trim()); }
      }
    });
  });
}

(async () => {
  const essais = [
    ['aucune position envoyee (reference)', null, {}],
    ['depart explicite, pions e1 e9', ' /  / e1 e9 / 10 10 / 1', {}],
    ['pion avance en e5, aucun mur', ' /  / e5 e9 / 10 10 / 1', {}],
    ['pion avance en e5, sans setoption', ' /  / e5 e9 / 10 10 / 1', { noOption: true }],
    ['pion en e5, au tour du second joueur', ' /  / e5 e9 / 10 10 / 2', {}],
  ];
  for (const [nom, pos, o] of essais) {
    const r = await ask(pos, o);
    console.log(nom.padEnd(38) + ' -> ' + String(r.mv).padEnd(6) + '  | ' + (r.info || '-'));
  }
  process.exit(0);
})();
