#!/usr/bin/env bash
# The same three pairings, the same openings, at 500 000 nodes -- the budget the app uses and the
# budget at which last night's numbers were not transitive. At 150 000 with these openings they
# ARE transitive, so either the budget changes the answer (which has happened before in this
# project and is the reason results are taken at 500k) or last night's runs were measuring
# something other than what they claimed.
cd "$(dirname "$0")"
while pgrep -f 'bash \./rr3\.sh' > /dev/null; do sleep 30; done
P=${P:-40}; N=500000; S=77; W=${W:-7}
run() { echo "=== $1  ($(date +%H:%M)) ==="; shift; env "$@" PAIRS=$P NODES=$N SEED=$S WORKERS=$W node parmatch.js 2>/dev/null | tail -2; echo; }
run "direct 2^20  vs  direct 2^22" A=path/engine.js B=path/engine.js BBITS=22
run "direct 2^20  vs  godets 2^20" A=path/engine.js B=tools/lab/variants/engine-tt4way.js
run "godets 2^20  vs  direct 2^22" A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22
run "direct 2^20  vs  direct 2^21" A=path/engine.js B=path/engine.js BBITS=21
