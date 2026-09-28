#!/usr/bin/env bash
# Three configurations, the same openings for every pairing, one seed. Last night's results are
# not transitive -- buckets beat 2^22, 2^22 beats 2^20, and buckets tie 2^20 -- and at least one
# of those has to be wrong. Holding the openings fixed removes seed variance as an explanation.
cd "$(dirname "$0")"
P=${P:-40}; N=${N:-150000}; S=${S:-77}; W=${W:-7}
run() { echo "=== $1 ==="; shift; env "$@" PAIRS=$P NODES=$N SEED=$S WORKERS=$W node parmatch.js 2>/dev/null | tail -2; echo; }
run "direct 2^20  vs  direct 2^22" A=path/engine.js B=path/engine.js BBITS=22
run "direct 2^20  vs  godets 2^20" A=path/engine.js B=tools/lab/variants/engine-tt4way.js
run "godets 2^20  vs  direct 2^22" A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22
