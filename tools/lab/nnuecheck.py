#!/usr/bin/env python3
"""Compare les scores du moteur JS a ceux du reseau Python, sur les memes lignes.

Ce qui reste a verifier apres nnuecheck.js: la tete (recopiee a la main en JavaScript) et le prix
de la quantisation de l accumulateur en int16. Le reste -- que le moteur encode bien ce qui a ete
entraine -- est deja etabli, ce qui permet a ce script de partir des indices extraits sans savoir
decoder une position.

Un ecart nul serait suspect: l accumulateur du moteur est entier, celui de l entrainement est
flottant. Ce qu on veut voir est un ecart de l ordre de quelques unites de score, pas de cent.

  .venv/bin/python nnuecheck.py nnue_board.npz
"""
import sys, os, json
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else 'nnue_board.npz'
here = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(here, 'data/nnue')
meta = json.load(open(os.path.join(d, 'meta.json')))
N, MA, ND, PAD = meta['rows'], meta['maxActive'], meta['dense'], meta['sparse']

js = np.loadtxt(os.path.join(here, 'nnue_js_scores.csv'), delimiter=',', dtype=np.int64, ndmin=2)
rows, jsc = js[:, 0], js[:, 1]

idx = np.fromfile(os.path.join(d, 'idx.i16'), dtype=np.int16, count=(rows.max() + 1) * MA).reshape(-1, MA)[rows]
dns = np.fromfile(os.path.join(d, 'dns.f32'), dtype=np.float32, count=(rows.max() + 1) * ND).reshape(-1, ND)[rows]
idx = np.where(idx < 0, PAD, idx)

z = np.load(os.path.join(here, SRC))
keys = list(z.keys())
accw, accb, scale = z['acc.weight'], z['accb'], float(z['scale'][0])
hidden = []
if 'out.weight' in keys:
    i = 0
    while f'hidden.{i}.weight' in keys:
        hidden.append((z[f'hidden.{i}.weight'], z[f'hidden.{i}.bias'])); i += 1
    out_w, out_b = z['out.weight'].reshape(-1), float(z['out.bias'][0])
else:
    i = 1
    while f'l{i + 1}.weight' in keys:
        hidden.append((z[f'l{i}.weight'], z[f'l{i}.bias'])); i += 1
    out_w, out_b = z[f'l{i}.weight'].reshape(-1), float(z[f'l{i}.bias'][0])

acc = accw[idx].sum(axis=1) + accb          # (n, H) en flottant, comme a l entrainement
x = np.concatenate([np.clip(acc, 0, 1), dns], axis=1)
for (w, b) in hidden:
    x = np.clip(x @ w.T + b, 0, 1)
logit = x @ out_w + out_b
py = np.trunc(scale * logit).astype(np.int64)   # (nnScale * z) | 0 tronque vers zero

diff = np.abs(py - jsc)
print(f'{len(rows)} positions comparees')
print(f'  ecart moyen {diff.mean():.2f} points de score, median {np.median(diff):.0f}, pire {diff.max()}')
print(f'  amplitude des scores: {jsc.min()} a {jsc.max()}')
print(f'  signe identique: {(np.sign(py) == np.sign(jsc)).mean() * 100:.2f}%')
worst = int(np.argmax(diff))
print(f'  pire cas: ligne {rows[worst]}, moteur {jsc[worst]}, python {py[worst]}')
tol = float(os.environ.get('TOL', 12))
print('OK - la tete JS reproduit le reseau Python a la quantisation pres'
      if diff.mean() < tol else f'ECHEC - ecart moyen au-dela de {tol} points')
