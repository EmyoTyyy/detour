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

onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === 'clear') { E.clearTable(); return; }
  const id = msg.id;
  try {
    const state = R.deState(msg.snap);
    const pos = E.fromRules(state);
    const res = E.analyse(pos, msg.opts || {});
    // Only plain data crosses back: the caller rebuilds whatever it needs from this. Move
    // scores go as pairs because a Map is rebuilt more cheaply than it is cloned.
    postMessage({
      id, ok: true,
      score: res.score, best: res.best, depth: res.depth, nodes: res.nodes,
      proven: !!res.proven, tablebase: !!res.tablebase, dist: res.dist,
      bestAction: res.best === E.MOVE_NONE ? null : E.toAction(pos, res.best),
      moves: res.moves ? res.moves.map(rm => [rm.move, rm.score]) : [],
      hashLo: pos.hashLo, hashHi: pos.hashHi,
    });
  } catch (err) {
    postMessage({ id, ok: false, err: String((err && err.message) || err) });
  }
};
