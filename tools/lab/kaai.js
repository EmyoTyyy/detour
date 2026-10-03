// Un client pour le moteur Ka de quoridor-ai.com.
//
//   wss://quoridor-ai.com/ka
//   on open:  {"token":"rbt_token_*","version":"0.0.0"}
//   ->        setoption name visits value N
//   ->        makemove <coups>        (AJOUTE a la partie, voir plus bas)
//   ->        go
//   <-        info root_score X / info score X
//   <-        bestmove <coup>
//   <-        "<coup>" puis "this action is impossible"   si un coup est refuse
//
// Deux differences avec Ishtar, toutes deux etablies par l'experience et non par lecture du site:
//
// 1. `setposition` est PUREMENT IGNORE. Cinq positions differentes rendent la meme reponse et le
//    meme score au dernier chiffre (kaprobe.js). L'etat ne s'obtient donc que par `makemove`.
// 2. `makemove` AJOUTE a la partie en cours, il ne la remplace pas: sur une connexion neuve,
//    `makemove e2 e8` donne exactement `makemove e2` puis `makemove e8`, meme coup et meme score
//    (kamove.js). On n'envoie donc que les coups NOUVEAUX, jamais la liste entiere -- la renvoyer
//    la jouerait une seconde fois. Et comme rien ne remet la partie a zero, chaque partie prend
//    une connexion neuve.
//
// La notation des murs est celle de Detour (8 - r), pas celle du client Ishtar (9 - r). Verifie par
// les refus du serveur, qui est son propre juge: "e1h" et "e8h" sont acceptes, "e9h" est refuse,
// et le serveur refuse bien pour de vrai puisqu'un pion qui se teleporte en a1 l'est aussi
// (kalegal.js). Les cases de pions, elles, se nomment pareil dans les deux conventions.
const WebSocket = require('ws');

const URI = process.env.KA_URI || 'wss://quoridor-ai.com/ka';
const sq = (r, c) => String.fromCharCode(97 + c) + (9 - r);
const wallSq = (r, c) => String.fromCharCode(97 + c) + (8 - r);

function nameAction(a) {
  if (a.type === 'move') return sq(a.to.r, a.to.c);
  return wallSq(a.r, a.c) + (a.orient === 'h' ? 'h' : 'v');
}

// "e3" / "e3h" -> ce que Detour appelle ainsi
function parseMove(tok) {
  const c = tok.charCodeAt(0) - 97;
  const row = Number(tok[1]);
  if (tok.length > 2) return { type: 'wall', orient: tok[2] === 'h' ? 'h' : 'v', r: 8 - row, c };
  return { type: 'move', to: { r: 9 - row, c } };
}

class Ka {
  constructor(visits) {
    this.visits = visits || 1000;
    this.ws = null; this.pending = null; this.aJouer = []; this.refus = null; this.lastInfo = null;
    // `histoire` garde TOUS les coups de la partie, pas seulement ceux qui restent a envoyer.
    // Son serveur ferme la connexion ou cesse de repondre des qu'on ouvre plusieurs parties a la
    // fois (quatre tranches a 20000 visites sont mortes ensemble sur "connexion fermee"), et comme
    // rien ne remet l'etat a zero, une connexion perdue perd la partie. On la rejoue donc.
    this.histoire = [];
  }
  // Une connexion = une partie, parce qu'aucune commande ne remet l'etat a zero.
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((res, rej) => {
      const ws = new WebSocket(URI);
      this.ws = ws;
      ws.on('error', (e) => rej(new Error('ka: ' + (e && e.message || 'connexion echouee'))));
      ws.on('open', () => {
        ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
        ws.send(`setoption name visits value ${this.visits}`);
        res(true);
      });
      ws.on('message', (d) => this.onMessage(String(d)));
      ws.on('close', () => { if (this.pending) { this.pending.rej(new Error('connexion fermee')); this.pending = null; } });
    });
    return this.ready;
  }
  onMessage(line) {
    for (const part of line.split('\n')) {
      const p = part.trim();
      // Un coup refuse arrive en deux lignes: le coup, puis la raison. On garde la trace: un refus
      // veut dire que les deux plateaux ont divergé, et il faut s'arreter la plutot que continuer
      // a jouer contre un adversaire qui ne voit pas la meme partie.
      if (/this action is impossible/i.test(p)) this.refus = this.dernier || '(inconnu)';
      const inf = /^info (.*)$/.exec(p);
      if (inf) { this.lastInfo = inf[1]; continue; }
      const bm = /^bestmove (.*)$/.exec(p);
      if (bm && this.pending) { const q = this.pending; this.pending = null; q.res(bm[1].trim()); }
    }
  }
  // Declarer un coup joue sur le plateau, le notre ou le sien.
  push(action) {
    const tok = typeof action === 'string' ? action : nameAction(action);
    this.aJouer.push(tok); this.histoire.push(tok);
  }
  // Une tentative: envoyer les coups en attente, puis demander le coup.
  demande(timeoutMs) {
    return new Promise((res, rej) => {
      if (this.pending) return rej(new Error('une recherche est deja en cours'));
      this.pending = { res, rej };
      const t = setTimeout(() => { if (this.pending) { this.pending = null; rej(new Error('depassement en attendant bestmove')); } }, timeoutMs || 120000);
      this.pending.res = (v) => {
        clearTimeout(t);
        if (this.refus) { const r = this.refus; this.refus = null; return rej(new Error(`Ka a refuse notre coup "${r}": les deux plateaux ont diverge`)); }
        res(v);
      };
      this.pending.rej = (e) => { clearTimeout(t); rej(e); };
      if (this.aJouer.length) {
        this.dernier = this.aJouer[this.aJouer.length - 1];
        this.ws.send('makemove ' + this.aJouer.join(' '));
        this.aJouer = [];
      }
      this.ws.send('go');
    });
  }
  async bestMove(timeoutMs, essais) {
    const max = essais == null ? 3 : essais;
    for (let n = 0; ; n++) {
      try {
        await this.connect();
        return await this.demande(timeoutMs);
      } catch (e) {
        // Un refus de coup n'est pas un incident de reseau: les plateaux ont vraiment diverge et
        // rejouer n'y changerait rien. On ne reessaie que sur une panne de transport.
        if (/a refuse notre coup/.test(e.message) || n >= max) throw e;
        this.rouvrir();
      }
    }
  }
  // Repartir d'une connexion neuve en rejouant toute la partie: c'est la seule facon de retrouver
  // l'etat, puisque `makemove` ajoute et que rien ne reinitialise.
  rouvrir() {
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null; this.ready = null; this.pending = null; this.refus = null;
    this.aJouer = this.histoire.slice();
  }
  close() { if (this.ws) this.ws.close(); }
}

module.exports = { Ka, nameAction, parseMove, sq, wallSq };
