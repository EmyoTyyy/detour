#!/usr/bin/env python3
"""Fit the learned evaluation on outcome labels, with an optional blend of the deep score.

The first network was trained to predict a 20,000-node search, and was worth +230 Elo at a
shallow budget and exactly nothing at 500,000 nodes: you cannot distil a teacher and then
outrun it. An outcome label has no teacher to outrun -- the label is who actually won -- so it
has no depth ceiling. It is much noisier, which is why a blend with the score is worth trying:
the outcome is unbiased but noisy, the score is biased but precise.

The network outputs a LOGIT. The engine multiplies it by `scale` to get an evaluation, so the
scale is not a free knob: it is the constant that turns a score into a win probability, and it
is fitted here from the rows that carry both a score and an outcome.
"""
import os, sys, glob, numpy as np

H       = int(os.environ.get('H', 16))
LAMBDA  = float(os.environ.get('LAMBDA', 0.0))   # weight on the score target, 0 = outcome only
EPOCHS  = int(os.environ.get('EPOCHS', 40))
BATCH   = int(os.environ.get('BATCH', 4096))
LR      = float(os.environ.get('LR', 3e-3))
SEED    = int(os.environ.get('SEED', 7))
OUT     = os.environ.get('OUT', 'netweights_new.js')
PAT     = os.environ.get('DATA', 'data/out_*.csv')

files = sorted(glob.glob(PAT))
if not files: sys.exit('no data matching ' + PAT)
# An unscored row has an EMPTY score field, not a zero -- and zero is a real score, so testing
# `score != 0` would have thrown away every genuinely balanced position and kept none of the
# distinction. genfromtxt maps the empty field to nan, which says "absent" and nothing else.
#
# It is also slow: minutes on a million rows, paid again on every seed of a sweep. The parsed
# array is cached beside the file and reused while it is newer than the text.
def load(f):
    cache = f + '.npy'
    if os.path.exists(cache) and os.path.getmtime(cache) >= os.path.getmtime(f):
        return np.load(cache)
    a = np.genfromtxt(f, delimiter=',', dtype=np.float32, ndmin=2,
                      missing_values='', filling_values=np.nan)
    try: np.save(cache, a)
    except Exception: pass
    return a
# The newer files carry the POSITION as their first field: 39 hex characters, so that a row can
# be re-featurised later without regenerating the game. genfromtxt does not refuse it -- it
# parses a token made only of digits as a colossal float (which overflows float32 to inf) and
# one containing a letter as nan, so the column arrives as a mixture of inf and nan and is then
# fed to the network as if it were a feature. Nothing errors; the fit is simply poison.
# Detected from the text rather than from the width, because the width also changes when the
# feature set does, and confusing the two is how a 14-feature file got read as 13 features.
def has_pos(f):
    with open(f) as fh:
        first = fh.readline().split(',', 1)[0]
    return len(first) == 39 and all(c in '0123456789abcdef' for c in first)

def load_clean(f):
    a = load(f)
    return a[:, 1:] if has_pos(f) else a

d = np.vstack([load_clean(f) for f in files])
npos = sum(1 for f in files if has_pos(f))
if npos: print(f'{npos}/{len(files)} fichiers portaient la position en tete : colonne retiree')
# A row is [pos?] f0..f13 outcome score. The position column is text, so loadtxt would have
# failed on it -- these are the feature-only files. Width tells us which format we got.
# The feature count comes from the FILE, not a constant: feature sets are the thing under test,
# so hardcoding 14 here would silently mis-parse a 15-feature file as 13 features plus a label.
NF = d.shape[1] - 2
if NF < 4: sys.exit(f'unexpected width {d.shape[1]}')
# FEATS selects a subset of columns, so a feature set can be ablated without touching the engine
# or regenerating anything: the question "which of these six are actually earning their cost" is
# answered by slicing a file that already exists.
# The two label columns are the LAST two, always. They are read out first and by position from
# the end, because FEATS below changes how many feature columns are in play -- and reading the
# labels at `d[:, NF]` after that reassignment took them from a feature column instead. The
# network then learned to predict "walls ahead of me" as if it were the game's outcome, and the
# 14-feature baseline scored 0.506 instead of the 0.363 it had scored seven times before.
y   = d[:, -2]
sc  = d[:, -1]
KEEP = os.environ.get('FEATS', '')
X   = d[:, :NF]
if KEEP:
    cols = [int(c) for c in KEEP.split(',')]
    X = X[:, cols]
    NF = len(cols)
    print(f'features kept: {cols}')
has = ~np.isnan(sc)                # nan = no deep search was run on this row
print(f'{len(d):,} rows from {len(files)} files, {has.sum():,} carry a deep score')

# --- fit the scale: what divisor makes sigmoid(score/scale) match the real win rate? ---
def nll(s):
    p = 1.0 / (1.0 + np.exp(-sc[has] / s))
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -np.mean(y[has] * np.log(p) + (1 - y[has]) * np.log(1 - p))
grid = np.arange(80, 1600, 10.0)
scale = float(grid[np.argmin([nll(s) for s in grid])])
print(f'fitted scale = {scale:.0f}  (loss {nll(scale):.4f}; the shipped net used 440)')

# --- targets ---
t = y.copy()
if LAMBDA > 0:
    ps = 1.0 / (1.0 + np.exp(-sc[has] / scale))
    t[has] = LAMBDA * ps + (1 - LAMBDA) * y[has]
print(f'lambda = {LAMBDA}  (weight on the score target)')

rs = np.random.RandomState(SEED)
perm = rs.permutation(len(X))
X, t, y = X[perm], t[perm], y[perm]
ntr = int(len(X) * 0.9)
Xtr, ttr = X[:ntr], t[:ntr]
Xva, tva, yva = X[ntr:], t[ntr:], y[ntr:]

# --- a 14 -> H -> 1 net with ReLU, trained with Adam on cross-entropy ---
W1 = rs.randn(NF, H).astype(np.float64) * np.sqrt(2.0 / NF)
b1 = np.zeros(H); W2 = rs.randn(H).astype(np.float64) * np.sqrt(1.0 / H); b2 = 0.0
P = [W1, b1, W2, np.array([b2])]
M = [np.zeros_like(p) for p in P]; V = [np.zeros_like(p) for p in P]
step = 0

def fwd(x, P):
    a = x @ P[0] + P[1]
    h = np.maximum(a, 0)
    z = h @ P[2] + P[3][0]
    return a, h, z

def loss_of(x, tt, P):
    _, _, z = fwd(x, P)
    # log(1+exp(z)) computed without overflow
    return float(np.mean(np.logaddexp(0, z) - tt * z))

best, bestP = 1e9, None
for ep in range(EPOCHS):
    idx = rs.permutation(ntr)
    for s in range(0, ntr, BATCH):
        b = idx[s:s + BATCH]
        x, tt = Xtr[b], ttr[b]
        a, h, z = fwd(x, P)
        dz = (1.0 / (1.0 + np.exp(-z)) - tt) / len(b)
        g = [x.T @ (np.outer(dz, P[2]) * (a > 0)),
             ((np.outer(dz, P[2]) * (a > 0))).sum(0),
             h.T @ dz,
             np.array([dz.sum()])]
        step += 1
        for i in range(4):
            M[i] = 0.9 * M[i] + 0.1 * g[i]
            V[i] = 0.999 * V[i] + 0.001 * g[i] ** 2
            mh = M[i] / (1 - 0.9 ** step); vh = V[i] / (1 - 0.999 ** step)
            P[i] -= LR * mh / (np.sqrt(vh) + 1e-8)
    lv = loss_of(Xva, tva, P)
    if lv < best: best, bestP = lv, [p.copy() for p in P]
    if ep % 5 == 0 or ep == EPOCHS - 1:
        _, _, zv = fwd(Xva, bestP)
        acc = np.mean((zv > 0) == (yva > 0.5))
        print(f'  epoch {ep:3d}  val loss {lv:.4f}  best {best:.4f}  sign accuracy {acc*100:.1f}%')

P = bestP
_, _, zv = fwd(Xva, P)
print(f'final: val loss {best:.4f}, sign accuracy {np.mean((zv>0)==(yva>0.5))*100:.1f}%')
print(f'       a constant predictor would score {max(yva.mean(), 1-yva.mean())*100:.1f}%')

# engine layout: w1 is row-major [hidden][inputs]
w1 = P[0].T.reshape(-1)
js = ('// Generated by tools/lab/train.py -- outcome-labelled, lambda=%g, H=%d.\n' % (LAMBDA, H)
      + 'var NetWeights = {\n  inputs: %d, hidden: %d, scale: %.0f,\n' % (NF, H, scale)
      + '  w1: [' + ','.join('%.5f' % v for v in w1) + '],\n'
      + '  b1: [' + ','.join('%.5f' % v for v in P[1]) + '],\n'
      + '  w2: [' + ','.join('%.5f' % v for v in P[2]) + '],\n'
      + '  b2: [%.5f]\n};\n' % P[3][0]   # an ARRAY: setNet reads w.b2[0], and a scalar makes it undefined
      + '(typeof window !== "undefined" ? window : self).NetWeights = NetWeights;\n')
open(OUT, 'w').write(js)
print(f'wrote {OUT}  ({len(js)} bytes)')
