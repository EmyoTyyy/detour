// engine-worker.js — the search, off the main thread.
//
// Path runs on the main thread by default because a worker cannot be created from a file://
// page at all: the origin is "null" and the browser refuses the script, and handing the same
// code over as a Blob URL does not get round it either. So this is an upgrade the page takes
// when it can — served over http it gets one, opened from a file it does not — and app.js
// falls back to searching inline. Nothing here is a second copy of the engine: it loads the
// very same files the page does.
//
// The only reason this matters is time. On the main thread the budget is set by how long the
// page may stop responding, which is a few hundred milliseconds; here it is set by how long
// you are willing to wait for a move.
// Paths resolve against this file's own URL, so rules.js — which is the game's, not the
// engine's — is one level up, and the rest are siblings here in path/.
importScripts('../rules.js', 'netweights.js', 'engine.js', 'book.js');

const R = self.Rules, E = self.Engine;

// Only plain data crosses back: the caller rebuilds whatever it needs from this. Move scores go
// as pairs because a Map is rebuilt more cheaply than it is cloned.
function paquet(pos, res) {
  return {
    score: res.score, best: res.best, depth: res.depth, nodes: res.nodes,
    proven: !!res.proven, tablebase: !!res.tablebase, dist: res.dist,
    bestAction: res.best === E.MOVE_NONE ? null : E.toAction(pos, res.best),
    moves: res.moves ? res.moves.map(rm => [rm.move, rm.score]) : [],
    hashLo: pos.hashLo, hashHi: pos.hashHi,
  };
}

// La recherche qui a le droit de continuer. Une nouvelle demande, ou un `stop`, retire ce droit a
// la precedente: elle s'arretera a la fin de son echelon.
let courant = 0;

// Approfondissement DIFFUSE: profondeur 1, on annonce, profondeur 2, on annonce, et ainsi de
// suite sans fin. La revue affiche donc un coup des la premiere profondeur et le remplace chaque
// fois que la recherche trouve mieux -- au lieu de ne rien montrer puis de tout montrer d'un coup.
//
// Pourquoi relancer analyse() a chaque echelon au lieu de lui demander une seule recherche
// profonde: parce qu'une recherche en cours ne peut pas etre interrompue. Le worker n'a qu'un fil,
// il ne lit ses messages que lorsqu'il rend la main, donc un `stop` arrive pendant une recherche
// ne serait vu qu'a la fin. En decoupant par profondeur et en rendant la main entre deux (le
// setTimeout plus bas), on garde un point d'arret a chaque echelon.
//
// Et cela ne coute presque rien: la table de transposition survit d'un appel a l'autre, et une
// sonde ne regarde que la cle et la profondeur -- pas la generation. Refaire les profondeurs deja
// faites se lit donc dans la table, et seule la nouvelle profondeur travaille vraiment.
function diffuse(msg) {
  const id = msg.id;
  let pos;
  try { pos = E.fromRules(R.deState(msg.snap)); }
  catch (err) { postMessage({ id, ok: false, err: String((err && err.message) || err) }); return; }
  const opts = msg.opts || {};
  const jusqua = opts.maxDepth == null ? 40 : opts.maxDepth;
  let d = 1;
  // La profondeur la plus profonde deja annoncee. Une tranche coupee par son temps rend la
  // DERNIERE profondeur terminee, donc une profondeur deja connue: l'annoncer quand meme faisait
  // reculer l'affichage (10, puis 9, puis 7, puis 6). On n'annonce donc que ce qui progresse.
  let annoncee = 0;
  const echelon = () => {
    if (courant !== id) return;                 // une autre position a ete demandee entre-temps
    let res;
    try {
      // Une TRANCHE de temps courte, pas un budget. Ce worker n'a qu'un fil et il sert aussi le
      // premier passage sur le reste de la partie et les changements de position: avec des
      // tranches de 30 s il gardait tout pour lui -- le premier passage restait bloque a 29 % et
      // changer de coup ne repondait pas. En rendant la main chaque seconde, les trois avancent.
      // Une tranche coupee n'est pas du travail perdu: la table de transposition garde ce qui a
      // ete trouve, donc la tranche suivante repart plus loin et finit par atteindre la
      // profondeur demandee.
      res = E.analyse(pos, Object.assign({}, opts, { maxDepth: d, budgetMs: 1100 }));
    } catch (err) { postMessage({ id, ok: false, err: String((err && err.message) || err) }); return; }
    if (courant !== id) return;
    const p = paquet(pos, res);
    // On n'annonce que ce qui progresse en profondeur: une tranche coupee par son temps rend une
    // profondeur deja connue, et l'annoncer faisait reculer l'affichage.
    if (p.depth > annoncee) { annoncee = p.depth; postMessage(Object.assign({ id, ok: true, iter: true }, p)); }
    // Plus rien a chercher: un gain prouve, ou une finale lue dans la table. La RAISON voyage
    // avec la fin de la recherche, et non dans le resultat -- parce que la tranche qui prouve le
    // gain le lit souvent dans la table a profondeur 1, et un resultat de profondeur 1 remplacant
    // celui de profondeur 9 donnerait des notes de coups calculees sur une recherche d'un seul
    // demi-coup. L'etat de la recherche appartient a la recherche, pas a l'evaluation.
    if (d >= jusqua || p.proven || p.tablebase) {
      postMessage({ id, ok: true, fini: true, why: p.tablebase ? 'solved' : p.proven ? 'proven' : 'depth' });
      return;
    }
    // Si l'echelon a ete coupe par son plafond de temps (la profondeur rendue est inferieure a
    // celle demandee), on NE monte pas: on refait la meme profondeur. La table de transposition
    // s'est remplie entre-temps, donc la tentative suivante va plus loin. C'est ce qui manquait:
    // traiter une coupure comme une fin arretait la recherche pour toujours a profondeur 10,
    // alors qu'avec exactRoot sur tous les coups de racine la profondeur 11 depasse simplement le
    // plafond du premier essai.
    if (p.depth >= d) d++;
    setTimeout(echelon, 0);                     // rendre la main: c'est ici qu'un `stop` est vu
  };
  setTimeout(echelon, 0);
}

onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === 'clear') { E.clearTable(); return; }
  if (msg.type === 'stop') { courant = 0; return; }
  if (msg.type === 'stream') { courant = msg.id; diffuse(msg); return; }
  const id = msg.id;
  try {
    const state = R.deState(msg.snap);
    const pos = E.fromRules(state);
    const res = E.analyse(pos, msg.opts || {});
    postMessage(Object.assign({ id, ok: true }, paquet(pos, res)));
  } catch (err) {
    postMessage({ id, ok: false, err: String((err && err.message) || err) });
  }
};
