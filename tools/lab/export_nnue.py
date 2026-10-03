#!/usr/bin/env python3
"""Turn a trained .npz into a weights file the engine can load.

Two decisions are made here and both have a reason.

The accumulator's weights become int16 on a fixed point of 1024. Not for speed -- JavaScript has
no integer SIMD to exploit -- but for EXACTNESS. The accumulator is maintained incrementally
across a search: a column is added when a wall appears and subtracted when the search takes it
back, millions of times per move. In floating point, add-then-subtract does not always return the
original value, so the evaluation of a position would depend on the path the search took to reach
it. That breaks the one property every measurement in this project rests on. Integers add and
subtract exactly, so the accumulator is integers and the question disappears.

The head stays in float32, because it is recomputed from scratch at every evaluation and never
accumulates anything, so there is nothing to drift.

Arrays travel as base64 rather than as JavaScript number literals: 312x256 int16 values written
out as decimal text is roughly half a megabyte of source to parse on every page load, against
213 KB of base64 that decodes in one pass. The decoder is included in the file because the test
harness runs the engine in a sandbox with no atob().

  .venv/bin/python export_nnue.py nnue_board.npz nnue_weights.js
"""
import sys, os, base64
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else 'nnue_board.npz'
DST = sys.argv[2] if len(sys.argv) > 2 else 'nnue_weights.js'
QA = int(os.environ.get('QA', 1024))

here = os.path.dirname(os.path.abspath(__file__))
z = np.load(os.path.join(here, SRC))
keys = list(z.keys())

acc_w = z['acc.weight']              # (inputs+1, H) -- the last row is the padding slot
accb  = z['accb']                    # (H,)
scale = float(z['scale'][0])
NS, H = acc_w.shape[0] - 1, acc_w.shape[1]

# The padding row must be exactly zero, or a position with few walls would quietly receive the
# padding column as many times as it has empty slots.
if np.abs(acc_w[NS]).max() != 0:
    sys.exit(f'la ligne de remplissage n est pas nulle (max {np.abs(acc_w[NS]).max()}): '
             'le reseau a appris quelque chose sur une entree qui n existe pas')

# Deux nommages existent: hidden.N/out pour la tete parametrable, l1/l2/l3 pour la premiere
# version. Les lire tous les deux coute six lignes et evite de reentrainer une heure pour un nom.
hidden = []
if 'out.weight' in keys:
    i = 0
    while f'hidden.{i}.weight' in keys:
        hidden.append((z[f'hidden.{i}.weight'], z[f'hidden.{i}.bias']))
        i += 1
    out_w, out_b = z['out.weight'], z['out.bias']
else:
    i = 1
    while f'l{i + 1}.weight' in keys:          # la derniere couche lN est la SORTIE, pas une cachee
        hidden.append((z[f'l{i}.weight'], z[f'l{i}.bias']))
        i += 1
    out_w, out_b = z[f'l{i}.weight'], z[f'l{i}.bias']

# --- quantisation, and a measurement of what it cost ---
qw = np.rint(acc_w[:NS] * QA).astype(np.int64)
qb = np.rint(accb * QA).astype(np.int64)
if qw.max() > 32767 or qw.min() < -32768 or qb.max() > 32767 or qb.min() < -32768:
    sys.exit(f'depassement int16 a QA={QA}: poids dans [{qw.min()},{qw.max()}], '
             f'biais dans [{qb.min()},{qb.max()}] -- baisser QA')
err = np.abs(qw / QA - acc_w[:NS])
print(f'{NS} entrees x {H} = {qw.size:,} poids d accumulateur en int16 (point fixe {QA})')
print(f'  erreur de quantisation par poids: moyenne {err.mean():.5f}, pire {err.max():.5f}')
# A position has at most 24 active inputs, so this is the worst the accumulator can be off by
# before the clipped ReLU -- expressed in the units the activation lives in, where 1.0 is the cap.
print(f'  ecart maximal possible sur une activation: {24 * err.max():.4f} (pour un plafond a 1.0)')

def b64(arr, dtype):
    return base64.b64encode(np.ascontiguousarray(arr.astype(dtype)).tobytes()).decode('ascii')

parts = []
parts.append('// Genere par tools/lab/export_nnue.py depuis ' + SRC + '. Ne pas editer a la main.')
parts.append('''//
// Les poids de l accumulateur sont des int16 sur un point fixe de %d: la valeur %d compte pour
// 1.0, qui est le plafond de l activation. Ils sont entiers parce que l accumulateur est maintenu
// de facon incrementale pendant la recherche, et qu une addition suivie de sa soustraction doit
// rendre exactement la valeur de depart -- sinon l evaluation d une position dependrait du chemin
// par lequel la recherche y est arrivee. La tete est en float32: elle est recalculee a chaque
// evaluation, elle n accumule rien, elle ne peut pas deriver.''' % (QA, QA))
parts.append('''
(function (root) {
  // Decodeur base64 minimal: le banc de test execute le moteur dans un bac a sable sans atob().
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function bytes(s) {
    var n = s.length, pad = 0;
    while (n > 0 && s.charAt(n - 1) === '=') { n--; pad++; }
    var out = new Uint8Array(((n * 6) >> 3));
    var acc = 0, bits = 0, w = 0;
    for (var i = 0; i < n; i++) {
      acc = (acc << 6) | A.indexOf(s.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; out[w++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, w);
  }
  function i16(s) { var b = bytes(s); return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); }
  function f32(s) { var b = bytes(s); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); }
''')

parts.append('  var W = {')
# Le drapeau voyage avec les poids: le moteur n'a pas a deviner si ce fichier est une evaluation
# ou une correction, et charger l'un pour l'autre serait invisible autrement.
# Lu dans le .npz en priorite: c'est le reseau entraine qui sait s'il a appris une correction ou
# une evaluation entiere, pas la ligne de commande qui l'exporte. RESIDUAL dans l'environnement ne
# sert plus qu'a forcer explicitement, et un .npz muet retombe sur l'ancien defaut.
if 'residual' in z.files:
    RESIDUAL = bool(int(np.asarray(z['residual']).reshape(-1)[0]))
    if 'RESIDUAL' in os.environ:
        RESIDUAL = os.environ['RESIDUAL'] != '0'
else:
    RESIDUAL = os.environ.get('RESIDUAL', '0') != '0'
print('  mode: %s' % ('CORRECTION du fait main' if RESIDUAL else 'evaluation de remplacement'))
parts.append('    inputs: %d, hidden: %d, dense: %d, scale: %.6f, qa: %d, residual: %s,'
             % (NS, H, 4, scale, QA, 'true' if RESIDUAL else 'false'))
parts.append("    acc: i16('%s')," % b64(qw, np.int16))
parts.append("    accb: i16('%s')," % b64(qb, np.int16))
parts.append('    head: [')
for (w, b) in hidden:
    parts.append("      { out: %d, inp: %d, w: f32('%s'), b: f32('%s') }," % (
        w.shape[0], w.shape[1], b64(w, np.float32), b64(b, np.float32)))
parts.append('    ],')
parts.append("    outw: f32('%s'), outb: %.8f," % (b64(out_w.reshape(-1), np.float32), float(out_b[0])))
parts.append('  };')
parts.append('  root.NnueWeights = W;')
parts.append("})(typeof window !== 'undefined' ? window : self);")

text = '\n'.join(parts) + '\n'
open(os.path.join(here, DST), 'w').write(text)
shape = '->'.join([str(H)] + [str(w.shape[0]) for w, _ in hidden] + ['1'])
print(f'ecrit {DST}  ({len(text) / 1024:.0f} Ko, forme {NS}(creux)+4 -> {shape}, echelle {scale:.0f})')
