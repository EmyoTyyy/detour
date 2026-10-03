#!/usr/bin/env python3
"""Fit an NNUE-shaped evaluation on the sparse board written by nnuedata.js.

What this is testing, and it is one thing: whether the ceiling the old network kept hitting is
the FUNCTION CLASS. Every network trained here so far reads 14 hand-made summaries, none of which
says where a wall is, and it plateaus at 0.3403 held-out loss while a 20,000-node search predicts
the same labels at 0.285. If showing the network the board closes a large part of that gap, the
data and the labels were never the problem. If it does not, the labels are noisier than they look
and no architecture will help.

The comparison is set up so it cannot be an artefact:

  * the rows arrive in the order train.py reads the same files in, and the validation split is cut
    by the same RandomState(7).permutation(N) -- so 0.3403 and the number below are two numbers
    about the SAME held-out positions, not two different tenths of the data.
  * SPARSE=0 runs this exact code, this optimiser, these epochs, with the board inputs removed.
    If the dense-only run also lands far below 0.3403, then torch beat numpy and the board proved
    nothing; that control has to come out near 0.34 for the sparse number to mean anything.

Shape: 312 binary inputs summed into a 256-wide accumulator (that sum is the layer a browser can
update incrementally, one column per move), 4 dense inputs joined AFTER it because a shortest path
is a graph algorithm no small network will rediscover, then 32 -> 32 -> 1.

  .venv/bin/python train_nnue.py                  # the real run
  SPARSE=0 .venv/bin/python train_nnue.py         # the control
"""
import os, sys, json, time
import numpy as np
import torch
import torch.nn as nn

D        = os.environ.get('DATA', 'data/nnue')
H1       = int(os.environ.get('H1', 256))
# La tete, apres l'accumulateur. '32,32' = deux couches cachees; '' = une seule matrice vers la
# sortie. Ce n'est pas un detail de reglage: l'accumulateur se met a jour en quelques additions
# par coup, mais la tete est recalculee a CHAQUE position evaluee. 256->32->32->1 coute ~9 400
# multiplications par evaluation, 256->1 en coute 260. Si la tete courte predit presque aussi
# bien, c'est elle qu'il faut embarquer, et la question se tranche par la mesure.
HEAD     = [int(x) for x in os.environ.get('HEAD', '32,32').replace(' ', '').split(',') if x and int(x) > 0]
DENSE_FILE = os.environ.get('DENSE_FILE', 'dns.f32')
DENSE_N    = int(os.environ.get('DENSE_N', 0))
EPOCHS   = int(os.environ.get('EPOCHS', 20))
BATCH    = int(os.environ.get('BATCH', 8192))
LR       = float(os.environ.get('LR', 1e-3))
SEED     = int(os.environ.get('SEED', 7))
LAMBDA   = float(os.environ.get('LAMBDA', 0.0))
# N'apprendre que sur les positions que evaluate() soumet vraiment au reseau. 30,6 % des lignes
# sont des positions ou le moteur repond AVANT lui -- course prouvee, ou plus un mur en main -- et
# elles sont doublement nuisibles: elles prennent de la capacite, et comme leur issue est presque
# determinee elles gonflent la precision apparente sur des positions dont le reseau ne decidera
# jamais. Le filtre est applique APRES la decoupe, pour que la validation reste un sous-ensemble de
# la validation d'origine et que les chiffres restent comparables a 0.3403.
# N'apprendre QUE la cible de recherche, sur les seules lignes qui portent un score profond.
# La cible d'issue et la cible de recherche ne sont pas la meme chose: l'issue inclut les erreurs
# futures des deux joueurs, la recherche dit ce qu'une recherche plus profonde repondrait -- et
# c'est la seconde qu'un alpha-beta demande a son evaluation de feuille. Mesure a l'appui: le
# reseau entraine sur les issues predit mieux (0.2850 contre 0.3403) et choisit le coup d'une
# recherche profonde deux fois moins souvent (32 % contre 56 %).
# Regression sur le SCORE plutot qu'entropie croisee sur une probabilite de gain.
#
# La cible sigmoid(score/350) sature: au-dela de |score| ~ 1000 elle vaut deja 0,94, le gradient
# s'annule et le reseau n'a plus aucune raison d'ecarter sa sortie. Il apprend donc a dire "un peu
# mieux" la ou la verite est "gagne". Lu dans une partie: le moteur livre evalue sa position a
# +1186, le reseau evalue la meme a +179. Une recherche qui ne distingue pas une ligne gagnante
# d'une ligne legerement meilleure ne va pas vers le gain.
#
# La regression garde toute l'amplitude: la sortie brute EST le score, divise par l'echelle, et
# c'est exactement ce que le moteur en refait en la multipliant par nnScale.
# Residuel: le reseau apprend la CORRECTION a ajouter a l'evaluation faite main, pas la valeur.
# Un reseau qui n'apprend rien rend alors exactement le moteur actuel -- l'echec est inoffensif --
# et il n'a plus a reapprendre ce que la formule sait deja (monter quand on se rapproche du but,
# compter le tempo, rester a l'echelle sur laquelle l'elagage a ete regle). Il ne lui reste que ce
# que la formule ignore: ou sont les murs.
RESIDUAL = os.environ.get('RESIDUAL', '0') != '0'
LOSS = os.environ.get('LOSS', 'bce')
SCORED_ONLY = os.environ.get('SCORED_ONLY', '0') != '0'
# Courbe de donnees. Le residuel n'apprend que sur les positions PORTANT un score profond, soit
# 84 218 lignes sur 1 046 516 -- et avant de payer neuf heures de notation pour en fabriquer
# davantage, il faut savoir si la courbe monte encore. TRAIN_FRAC coupe l'apprentissage et jamais
# la validation, pour que les points se comparent entre eux.
TRAIN_FRAC = float(os.environ.get('TRAIN_FRAC', 1.0))
USE_REACH  = os.environ.get('REACH', '1') != '0'
USE_SPARSE = os.environ.get('SPARSE', '1') != '0'
USE_DENSE  = os.environ.get('DENSE', '1') != '0'
ACT      = os.environ.get('ACT', 'crelu')
THREADS  = int(os.environ.get('THREADS', 8))
OUT      = os.environ.get('OUT', 'nnue_weights.npz')

torch.set_num_threads(THREADS)
here = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(here, D)
meta = json.load(open(os.path.join(d, 'meta.json')))
N, MA, NS, ND = meta['rows'], meta['maxActive'], meta['sparse'], meta['dense']
ABSENT = meta['scAbsent']

idx = np.fromfile(os.path.join(d, 'idx.i16'), dtype=np.int16).reshape(N, MA)
if DENSE_N: ND = DENSE_N
dns = np.fromfile(os.path.join(d, DENSE_FILE), dtype=np.float32).reshape(N, ND)
y   = np.fromfile(os.path.join(d, 'y.i8'),  dtype=np.int8).astype(np.float32)
sc  = np.fromfile(os.path.join(d, 'sc.i16'), dtype=np.int16).astype(np.float32)
has = sc != ABSENT
reach = np.fromfile(os.path.join(d, 'reach.i8'), dtype=np.int8)
hand = np.fromfile(os.path.join(d, 'hand.f32'), dtype=np.float32)
print(f'{N:,} positions, {int(has.sum()):,} avec un score profond, {NS} entrees creuses + {ND} denses')

# -1 is the padding slot. EmbeddingBag ignores padding_idx, so a position with four walls costs
# four column additions and the rest contribute nothing -- which is also exactly what the engine
# will do at run time.
PAD = NS
idx = np.where(idx < 0, PAD, idx).astype(np.int16)

# --- the scale: what divisor turns an evaluation into a win probability? ---
# Same grid and same rows as train.py, because the engine multiplies the network's output by this
# number and a network fitted with one scale and shipped with another is simply mis-scaled.
def nll(s):
    p = 1.0 / (1.0 + np.exp(-sc[has] / s))
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y[has] * np.log(p) + (1 - y[has]) * np.log(1 - p)))
grid = np.arange(80, 1600, 10.0)
scale = float(grid[int(np.argmin([nll(s) for s in grid]))])
print(f'echelle ajustee = {scale:.0f}  (perte {nll(scale):.4f} pour la recherche seule)')

# --- targets, and the identical split ---
t = y.copy()
if SCORED_ONLY and LOSS == 'mse' and RESIDUAL:
    # La cible est ce qui MANQUE a l'evaluation faite main pour atteindre le score de la recherche.
    t = ((sc - hand) / scale).astype(np.float32)
    m = np.abs(sc[has] - hand[has])
    print(f'cible = CORRECTION du fait main, sur {int(has.sum()):,} lignes '
          f'(ecart moyen a corriger: {m.mean():.0f} points, median {np.median(m):.0f})')
elif SCORED_ONLY and LOSS == 'mse':
    # La cible est le score lui-meme, en unites de sortie du reseau (score / echelle).
    t = (sc / scale).astype(np.float32)
    print(f'cible = score de recherche EN REGRESSION, sur {int(has.sum()):,} lignes '
          f'(amplitude {sc[has].min():.0f} a {sc[has].max():.0f} points)')
elif SCORED_ONLY:
    # La cible devient la probabilite de gain que la recherche annonce, et non l'issue jouee.
    t[has] = 1.0 / (1.0 + np.exp(-sc[has] / scale))
    print(f'cible = score de recherche seul, sur {int(has.sum()):,} lignes')
elif LAMBDA > 0:
    ps = 1.0 / (1.0 + np.exp(-sc[has] / scale))
    t[has] = LAMBDA * ps + (1 - LAMBDA) * y[has]
    print(f'lambda = {LAMBDA} (poids de la cible score, sur {int(has.sum()):,} lignes)')

rs = np.random.RandomState(SEED)
perm = rs.permutation(N)
# sc et has suivent la permutation comme les autres. Sans ca, toute comparaison faite APRES ce
# point met en face l'une de l'autre la ligne i permutee et la ligne i d'origine: mon propre
# recapitulatif annoncait 2.2869 pour la recherche au lieu de 0.3081, ce qui est exactement
# l'erreur que train.py documente sur ses colonnes d'etiquettes, refaite trente lignes plus bas.
idx, dns, t, y, sc, has, reach, hand = (idx[perm], dns[perm], t[perm], y[perm], sc[perm],
                                        has[perm], reach[perm], hand[perm])
ntr = int(N * 0.9)
tr_rows = np.arange(ntr)
va_all = np.arange(ntr, N)
va_rows = va_all
if USE_REACH:
    tr_rows = tr_rows[reach[:ntr] == 1]
    va_rows = va_all[reach[ntr:] == 1]
if SCORED_ONLY:
    # La validation reste un sous-ensemble de la validation d'origine, donc les chiffres restent
    # comparables -- mais elle ne porte plus que sur des lignes notees, ce qui est une autre
    # population: a lire comme "predit le score de recherche", pas comme "predit l'issue".
    tr_rows = tr_rows[has[tr_rows]]
    va_rows = va_rows[has[va_rows]]
if TRAIN_FRAC < 1.0:
    # tr_rows sort deja d'un tableau permute, donc un prefixe est un echantillon au hasard.
    tr_rows = tr_rows[:max(1, int(len(tr_rows) * TRAIN_FRAC))]
print(f'decoupe: {ntr:,} / {N - ntr:,} (identique a train.py)')
print(f'retenu:  {len(tr_rows):,} pour l apprentissage, {len(va_rows):,} pour la validation'
      + (' (positions soumises au reseau seulement)' if USE_REACH else ' (toutes)'))


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.acc = nn.EmbeddingBag(NS + 1, H1, mode='sum', padding_idx=PAD) if USE_SPARSE else None
        if self.acc is not None:
            nn.init.normal_(self.acc.weight, std=0.05)
            with torch.no_grad():
                self.acc.weight[PAD].zero_()
            self.accb = nn.Parameter(torch.full((H1,), 0.5))
        width = (H1 if USE_SPARSE else 0) + (ND if USE_DENSE else 0)
        if width == 0:
            sys.exit('ni entrees creuses ni denses: rien a apprendre')
        dims = [width] + HEAD
        self.hidden = nn.ModuleList([nn.Linear(dims[i], dims[i + 1]) for i in range(len(HEAD))])
        self.out = nn.Linear(dims[-1], 1)

    def act(self, x):
        # Clipped ReLU rather than ReLU: it is what lets the accumulator live in fixed-point later
        # (a value that cannot exceed 1 fits in a known number of bits), and it costs nothing here.
        return torch.clamp(x, 0.0, 1.0) if ACT == 'crelu' else torch.relu(x)

    def forward(self, ii, dd):
        parts = []
        if self.acc is not None:
            parts.append(self.act(self.acc(ii) + self.accb))
        if USE_DENSE:
            parts.append(dd)
        x = torch.cat(parts, dim=1) if len(parts) > 1 else parts[0]
        for l in self.hidden:
            x = self.act(l(x))
        return self.out(x).squeeze(1)


net = Net()
nparam = sum(p.numel() for p in net.parameters())
shape = '->'.join([str(H1) if USE_SPARSE else str(ND)] + [str(h) for h in HEAD] + ['1'])
# Le cout d'une evaluation, en multiplications-additions: l'accumulateur est incremental (il ne
# compte pas), tout le reste est recalcule a chaque position.
width = (H1 if USE_SPARSE else 0) + (ND if USE_DENSE else 0)
dims = [width] + HEAD + [1]
macs = sum(dims[i] * dims[i + 1] for i in range(len(dims) - 1))
print(f'reseau: {"creux+dense" if USE_SPARSE and USE_DENSE else ("dense seul" if USE_DENSE else "creux seul")}, '
      f'{shape}, {nparam:,} parametres, activation {ACT}, {THREADS} fils')
print(f'        cout par evaluation hors accumulateur: {macs:,} multiplications-additions')

opt = torch.optim.Adam(net.parameters(), lr=LR)
# Huber plutot que MSE: les scores prouves sont ecretes a +/-3000 et forment une masse aux deux
# bouts; une erreur quadratique dessus ecraserait tout le milieu, qui est justement la ou la
# recherche a besoin de finesse.
lossf = nn.HuberLoss(delta=2.0) if LOSS == 'mse' else nn.BCEWithLogitsLoss()

def evaluate(rows):
    net.eval()
    tot, n, correct = 0.0, 0, 0
    with torch.no_grad():
        for s in range(0, len(rows), 32768):
            b = rows[s:s + 32768]
            ii = torch.from_numpy(idx[b].astype(np.int64))
            dd = torch.from_numpy(dns[b])
            z = net(ii, dd)
            tot += float(lossf(z, torch.from_numpy(t[b]))) * len(b)
            correct += int((((z > 0).numpy()) == ((t[b] > 0) if LOSS == 'mse' else (y[b] > 0.5))).sum())
            n += len(b)
    net.train()
    return tot / n, correct / n


best, bestState, t0 = 1e9, None, time.time()
for ep in range(EPOCHS):
    order = tr_rows[np.random.RandomState(1000 + ep).permutation(len(tr_rows))]
    run, nb = 0.0, 0
    for s in range(0, len(order), BATCH):
        b = order[s:s + BATCH]
        ii = torch.from_numpy(idx[b].astype(np.int64))
        dd = torch.from_numpy(dns[b])
        tt = torch.from_numpy(t[b])
        opt.zero_grad()
        loss = lossf(net(ii, dd), tt)
        loss.backward()
        opt.step()
        run += float(loss); nb += 1
    vl, acc = evaluate(va_rows)
    if vl < best:
        best = vl
        bestState = {k: v.detach().clone() for k, v in net.state_dict().items()}
    print(f'  epoque {ep:3d}  apprentissage {run / nb:.4f}  validation {vl:.4f}  best {best:.4f}  '
          f'signe {acc * 100:.1f}%  ({(time.time() - t0) / 60:.1f} min)')

net.load_state_dict(bestState)
vl, acc = evaluate(va_rows)
vl_all, acc_all = evaluate(va_all)
const = max(float(y[va_rows].mean()), 1 - float(y[va_rows].mean()))
if LOSS == 'mse':
    # La perte de Huber ne se compare a rien de connu. L'erreur en POINTS DE SCORE, si.
    net.eval()
    with torch.no_grad():
        zz = net(torch.from_numpy(idx[va_rows].astype(np.int64)), torch.from_numpy(dns[va_rows])).numpy()
    err = np.abs(zz - t[va_rows]) * scale
    print(f'\nerreur moyenne {err.mean():.0f} points de score, mediane {np.median(err):.0f}, '
          f'pire {err.max():.0f}')
    if RESIDUAL:
        # Ce qui compte en residuel: l'evaluation corrigee est-elle plus proche de la recherche que
        # le fait main tout seul ? Si non, le reseau ne sert a rien, et il faut le dire ici.
        base = np.abs(sc[va_rows] - hand[va_rows])
        corr = np.abs(sc[va_rows] - (hand[va_rows] + zz * scale))
        print(f'  fait main seul      : {base.mean():.0f} points d ecart a la recherche')
        print(f'  fait main + reseau  : {corr.mean():.0f} points'
              f'   ({100 * (1 - corr.mean() / base.mean()):.0f}% de mieux)')
        print(f'  correction apportee : de {(zz.min() * scale):.0f} a {(zz.max() * scale):.0f} points')
    else:
        print(f'  amplitude predite: {(zz.min() * scale):.0f} a {(zz.max() * scale):.0f} '
              f'(la recherche: {sc[va_rows].min():.0f} a {sc[va_rows].max():.0f})')
print(f'\nfinal: perte de validation {best:.4f}, precision de signe {acc * 100:.1f}%'
      + (f'   [positions soumises au reseau, {len(va_rows):,} lignes]' if USE_REACH else ''))
print(f'       sur TOUTE la validation ({len(va_all):,} lignes): {vl_all:.4f} / {acc_all * 100:.1f}%'
      f'   <- le chiffre comparable a 0.3403')
print(f'       un predicteur constant ferait {const * 100:.1f}%')
print(f'       reference 14 entrees (train.py, memes lignes, meme decoupe): 0.3403 / 81.6%')
# La recherche comme predicteur, sur CE jeu de donnees: c'est la ligne "echelle ajustee" plus haut.
# Le 0.285 cite dans STATUS.md venait d'un jeu anterieur de 1,3 M lignes etiquetees a 20 000
# noeuds, donc d'autres positions et d'autres etiquettes -- le comparer a un chiffre d'ici serait
# comparer deux choses differentes, et c'est exactement le genre de rapprochement qui a deja
# envoye ce projet dans le mur. La reference interne est la seule qui compte.
# La seule comparaison honnete avec la recherche: les MEMES lignes des deux cotes. Le reseau est
# juge sur toute la validation (167 581 lignes), la recherche seulement sur celles qui portent un
# score (une sur douze). Rapprocher les deux chiffres bruts reviendrait a comparer deux mesures
# faites sur deux echantillons differents, et ce projet s'est deja fait avoir comme ca.
vhas = has[ntr:]
if vhas.sum() > 100:
    vsc = sc[ntr:][vhas]
    p = np.clip(1.0 / (1.0 + np.exp(-vsc / scale)), 1e-6, 1 - 1e-6)
    yy = y[ntr:][vhas]
    search_loss = float(-np.mean(yy * np.log(p) + (1 - yy) * np.log(1 - p)))
    net.eval()
    with torch.no_grad():
        zi = torch.from_numpy(idx[ntr:][vhas].astype(np.int64))
        zd = torch.from_numpy(dns[ntr:][vhas])
        zz = net(zi, zd)
        net_loss = float(nn.BCEWithLogitsLoss()(zz, torch.from_numpy(yy)))
        net_acc = float((((zz > 0).float()) == (torch.from_numpy(yy) > 0.5)).float().mean())
    print(f'\n  sur les {int(vhas.sum()):,} lignes de validation qui portent un score profond:')
    print(f'    la recherche a 240 000 noeuds : {search_loss:.4f}')
    print(f'    ce reseau                     : {net_loss:.4f}  (signe {net_acc * 100:.1f}%)')

w = {k: v.numpy() for k, v in net.state_dict().items()}
w['scale'] = np.array([scale], dtype=np.float32)
# Le drapeau voyage DANS le .npz. Il y etait annonce comme voyageant avec les poids, mais
# export_nnue.py le lisait en fait dans sa propre variable d'environnement: un export lance sur
# une autre ligne de script, sans RESIDUAL=1, a produit un fichier marque "remplacement" alors
# que le reseau avait appris une CORRECTION. Le moteur a alors rendu la correction comme si
# c'etait le score entier, et rien ne l'a signale.
w['residual'] = np.array([1 if RESIDUAL else 0], dtype=np.int8)
np.savez(os.path.join(here, OUT), **w)
print(f'ecrit {OUT}  ({nparam:,} parametres)')
