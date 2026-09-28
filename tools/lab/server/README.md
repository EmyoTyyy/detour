# Running Path's test harness on the 32-core server

## Why the server matters

Not because training is slow — fitting the network takes seconds, and a GPU would be useless
for it. Because **measuring** is slow, and measuring badly is how this project has lost time.

A match's error bar is `2*sqrt(p(1-p)/n)`, about 7 Elo per percentage point:

| games | error bar | on 30 workers |
|---|---|---|
| 240 | ±45 Elo | 16 min |
| 1 000 | ±22 Elo | 1.1 h |
| 2 000 | ±16 Elo | 2.2 h |
| 8 000 | ±8 Elo | 8.7 h |

Every match run so far sits in the first row. Inside ±45 Elo, three separate results have already
reversed when re-measured: aspiration windows read **+180 Elo** at 60k nodes and **−250** at 150k;
`nullBase: 3` read **+340 Elo** and was actually neutral; the first network read **+230 Elo** and
is worth nothing at the budget people play at. The server does not make Path smarter. It makes
the difference between tuning and guessing.

## Setup

```bash
git clone <this repo> detour && cd detour/tools/lab
./server/setup.sh
```

`setup.sh` prints the machine, checks the engine loads, measures nodes/second so match durations
can be predicted, and runs the control. **The control must print exactly `50.0%`.** Two identical
engines playing paired openings can score nothing else. If it prints anything else the harness is
biased and no other number from this box means anything — fix that first.

Node 18 or newer. No build step, no dependencies. `npm install ws` only if you want the headless
Chrome UI tests.

## The tool

`parmatch.js` splits one match across cores. It is the same match, not an approximation: pair `p`
draws its opening from `rng(seed*7919 + p)` and nothing else, so workers dividing the range play
exactly the games one process would have played. `VERIFY=1` re-runs it serially and refuses to
report unless the two agree exactly.

```bash
A=path/engine.js \
B=tools/lab/variants/engine-tt4way.js \
NODES=500000 PAIRS=1000 WORKERS=30 SEED=11 \
node parmatch.js
```

`PAIRS` is pairs, so games are twice that. Options: `AW`/`BW` weight files (`0` for none),
`ABITS`/`BBITS` table size, `SEED`, `OPEN` opening plies.

## What to run, in order

Everything below is at `NODES=500000`, the budget the app actually uses.

**1. Settle the transposition table. ~2 h each, and this is worth ~220 Elo.**

`2^20` scored 21.7% ± 10.6 against `2^22` over 60 games. The control was clean, but 60 games is
±63 Elo and the claim is large. Three questions, in this order:

```bash
# is the 4-way bucketed table as good as four times the memory?
A=tools/lab/variants/engine-tt4way.js B=path/engine.js BBITS=22 \
  NODES=500000 PAIRS=1000 WORKERS=30 SEED=31 node parmatch.js

# does bucketing help at all at the same memory?
A=path/engine.js B=tools/lab/variants/engine-tt4way.js \
  NODES=500000 PAIRS=1000 WORKERS=30 SEED=32 node parmatch.js

# and confirm the headline on a fresh seed
A=path/engine.js B=path/engine.js BBITS=22 \
  NODES=500000 PAIRS=1000 WORKERS=30 SEED=33 node parmatch.js
```

If the bucketed table at 19 MB matches the direct-mapped one at 76 MB, ship the bucket: the same
strength without asking a phone for 76 MB.

**2. Settle the wall-geometry features. ~2 h.**

Seven paired seeds all say the 20-feature set predicts better (mean −0.0027 in held-out loss,
sign accuracy 79.8% → 80.1%). Held-out loss is a screen, not Elo:

```bash
A=path/engine.js B=tools/lab/variants/engine-feat5.js BW=tools/lab/netweights_v4.js \
  NODES=500000 PAIRS=1000 WORKERS=30 SEED=41 node parmatch.js
```

This is at **equal nodes**, so it is an upper bound: it does not charge the features their cost.
That cost is still unmeasured — the same timing came back between 0.90x and 2.37x on a machine
running seven matches. Measure it on the quiet server first:

```bash
VARIANTS=path/engine.js,tools/lab/variants/engine-feat5.js NODES=200000 POSN=12 REPS=6 \
  node dcsweep.js
```

**3. Generate training data. Embarrassingly parallel, ~118 000 positions per core-hour.**

```bash
for i in $(seq 1 30); do
  GAMES=20000 PLAY_NODES=6000 SCORE_EVERY=12 SEED=$((100+i)) OUT=data/srv_$i.csv \
    nohup node gen.js > data/srv_$i.log 2>&1 &
done
```

Rows store the **position**, so any future feature set can be tried on them with `refeat.js`
without playing the games again. The 520 452 oldest rows stored features only and are a dead end.

**4. Train and iterate.**

```bash
ENGINE=tools/lab/variants/engine-feat5.js IN='data/srv_*.csv' OUT=data/feat5.csv node refeat.js
DATA=data/feat5.csv LAMBDA=0 SEED=3 EPOCHS=60 OUT=netweights_new.js python3 train.py
```

numpy only; no torch, no GPU. The network is ~350 parameters.

## Surviving a reboot

This machine rebooted twice mid-campaign and `/tmp` took the training data with it both times.
On the server, write into the repo and let systemd restart the work:

```ini
# /etc/systemd/system/path-gen@.service
[Unit]
Description=Path self-play generation, worker %i
[Service]
Type=simple
User=YOURUSER
WorkingDirectory=/home/YOURUSER/detour/tools/lab
Environment=GAMES=1000000 PLAY_NODES=6000 SCORE_EVERY=12
Environment=SEED=%i
Environment=OUT=data/srv_%i.csv
ExecStart=/usr/bin/node gen.js
Restart=always
RestartSec=5
Nice=5
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now path-gen@{1..30}
```

`Nice=5` so the box stays usable. Generation appends, so a restart costs at most one game.

## Rules that were learned the hard way

1. **The control comes first.** A strength number means nothing until self-play prints 50.0%.
2. **One engine instance per side.** A shared instance is a shared transposition table, and the
   side with the smaller budget silently reads work the other side paid for. This invalidated an
   entire ladder: k50000 "scored" 20.8% against k5000, and 93.8% once each had its own engine.
3. **Node budgets, not clocks.** A move must be a pure function of the position, or machine load
   becomes part of the result.
4. **Clear the table between games**, or the second game of a pair starts with the first game's
   work and the control drifts to 43.8%.
5. **One change at a time.** `setSearchFlags` keeps previous values; resetting only one side let
   four changes accumulate and be reported as one worth +340 Elo. It was worth nothing.
6. **Never kill by pattern in the same command that launches.** `pkill -f "node x.js"` matches
   the launch further along its own command line and kills the shell. Cost three silent
   no-op patches. Kill by PID, in a separate command.
7. **A result that reverses with the node budget is not a result.** Measure at 500 000.
