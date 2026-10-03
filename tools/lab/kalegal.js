// La convention de Ka, lue dans ses refus.
//
// Le serveur annonce lui-meme "this action is impossible" quand il rejette un coup, et il rejette
// bien (un pion qui se teleporte en a1 est refuse). C'est donc un oracle fiable, la ou comparer
// les scores ne l'etait pas: deux essais differents n'ont aucune raison de rendre le meme score.
//
// On lui propose des murs dont la rangee ou la colonne n'existe que dans une convention:
//   8-r (Detour, communaute) : rangees 1..8, colonnes a..h
//   9-r (client Ishtar)      : rangees 2..9, colonnes a..h
// VISITS=1 parce que le coup rendu n'importe pas, seul le refus compte.
const WebSocket = require('ws');
const URI = 'wss://quoridor-ai.com/ka';
const VISITS = Number(process.env.VISITS || 1);
const AVANT = ['e2', 'd9', 'e3', 'c9', 'e4', 'b9', 'e5'];

function ask(huitieme) {
  return new Promise((res) => {
    const ws = new WebSocket(URI);
    let done = false, refus = false, vu = [];
    const fin = () => { if (done) return; done = true; try { ws.close(); } catch (e) {} res({ refus, vu }); };
    const t = setTimeout(fin, 60000);
    ws.on('error', () => { clearTimeout(t); fin(); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      ws.send('setoption name visits value ' + VISITS);
      ws.send('makemove ' + AVANT.concat([huitieme]).join(' '));
      ws.send('go');
    });
    ws.on('message', (d) => {
      for (const part of String(d).split('\n')) {
        const p = part.trim();
        if (/this action is impossible/i.test(p)) refus = true;
        if (/illegal|invalid|error.*move/i.test(p) && !/tensorflow|log Error: WARN/.test(p)) vu.push(p.slice(0, 80));
        if (/^bestmove /.test(p)) { clearTimeout(t); fin(); }
      }
    });
  });
}

// attendu: true = on s'attend a ce que Ka ACCEPTE si sa convention est 8-r
const CAS = [
  ['a9  (temoin: pion legal)',        'a9',   true],
  ['a1  (temoin: pion illegal)',      'a1',   false],
  ['--- rangees, mur horizontal ---', null,   null],
  ['e1h  r=7 en 8-r / impossible 9-r', 'e1h', true],
  ['e8h  r=0 en 8-r / r=1 en 9-r',     'e8h', true],
  ['e9h  impossible 8-r / r=0 en 9-r', 'e9h', false],
  ['e0h  impossible partout',          'e0h', false],
  ['--- colonnes, mur horizontal ---', null,  null],
  ['a1h  colonne a+b',                 'a1h', true],
  ['h1h  colonne h+i, derniere valide','h1h', true],
  ['i1h  colonne i+j, j inexistante',  'i1h', false],
  ['z5h  colonne inexistante',         'z5h', false],
  ['--- mur vertical ---',             null,  null],
  ['e1v  r=7 en 8-r',                  'e1v', true],
  ['e9v  impossible en 8-r',           'e9v', false],
  ['i1v  colonne i',                   'i1v', false],
];

(async () => {
  let accord = 0, total = 0;
  for (const [nom, tok, att] of CAS) {
    if (tok === null) { console.log(nom); continue; }
    const r = await ask(tok);
    const accepte = !r.refus;
    const ok = accepte === att;
    total++; if (ok) accord++;
    console.log('  ' + nom.padEnd(36) + (accepte ? 'ACCEPTE' : 'REFUSE ') +
      '   attendu si 8-r: ' + (att ? 'accepte' : 'refuse') + (ok ? '   ok' : '   <== DESACCORD'));
  }
  console.log('');
  console.log(`accord avec la convention 8-r (celle de Detour): ${accord}/${total}`);
  process.exit(0);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
