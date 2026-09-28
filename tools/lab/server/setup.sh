#!/usr/bin/env bash
# Run this FIRST on the server, before trusting any number it produces.
#
# It reports the machine, then runs the one check that makes every later result meaningful:
# two identical engines playing a paired match must score exactly 50.0%. If it does not, the
# harness is biased and nothing measured on this box means anything.
set -u
cd "$(dirname "$0")/.."

echo "=== machine ==="
printf "cores      : %s\n" "$(nproc)"
printf "arch       : %s\n" "$(uname -m)"
printf "memory     : %s\n" "$(free -h 2>/dev/null | awk 'NR==2{print $2" total, "$7" available"}')"
printf "node       : %s\n" "$(node -v 2>/dev/null || echo 'MISSING - install node 18 or newer')"
printf "disk (repo): %s\n" "$(df -h . | awk 'NR==2{print $4" free"}')"
printf "uptime     : %s\n" "$(uptime -p 2>/dev/null || uptime)"

command -v node >/dev/null || { echo; echo "node is required. Stopping."; exit 1; }

echo
echo "=== engine loads, and the control ==="
node -e '
const L = require("./lib.js");
const e = L.loadEngine();
if (!e.Engine || !e.Rules) { console.log("FAIL: engine did not load"); process.exit(1); }
console.log("engine ok :", e.Engine.NET_FEATURES, "features, network", e.Engine.hasNet() ? "loaded" : "absent");
' || exit 1

NODES=20000 PAIRS=8 node duel.js

echo
echo "=== speed, for sizing matches ==="
node -e '
const L = require("./lib.js");
const { Engine: E, Rules: R } = L.loadEngine(undefined, { weights: false });
const s = L.startState(R);
const one = n => { E.clearTable(); const t = process.hrtime.bigint();
  const r = E.analyse(E.fromRules(s), { budgetMs: 1e9, maxNodes: n });
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, nodes: r.nodes }; };
one(50000);
let ms = 0, nd = 0;
for (let i = 0; i < 3; i++) { const r = one(500000); ms += r.ms; nd += r.nodes; }
const nps = nd / (ms / 1000);
const perMove = 500000 / nps, perGame = perMove * 55 / 60;
console.log(`${(nps/1000).toFixed(0)}k nodes/s -> ${perMove.toFixed(1)}s per move, about ${perGame.toFixed(1)} min per game at 500k nodes`);
const cores = require("os").cpus().length, w = Math.max(1, cores - 2);
for (const games of [240, 1000, 2000, 4000, 8000]) {
  const band = 2 * Math.sqrt(0.25 / games) * 100;
  console.log(`  ${String(games).padStart(5)} games = +/-${band.toFixed(1)}pp (+/-${(band*7).toFixed(0)} Elo)  ${(games*perGame/w/60).toFixed(1)} h on ${w} workers`);
}
'
echo
echo "If the control above did not say exactly 50.0%, stop and fix that before anything else."
