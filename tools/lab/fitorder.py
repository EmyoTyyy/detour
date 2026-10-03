# -*- coding: utf-8 -*-
# Apprend les poids de l'ORDRE des coups, pas une evaluation.
#
# Le moteur ordonne ses coups avec un score lineaire dont trois constantes ont ete posees a la
# main: +60000 si le mur croise le chemin adverse, +8000 s'il croise le notre, +3000 s'il touche un
# mur ou longe un pion. On les remplace par des poids ajustes sur les positions dont on connait le
# coup qu'une recherche a 60 000 noeuds a fini par choisir.
#
# Le modele est LINEAIRE et c'est voulu: il tourne a chaque noeud, donc il doit couter quelques
# additions. Un reseau serait plus juste et beaucoup trop lent -- ce projet a deja paye pour
# apprendre que la justesse gagnee ne rattrape pas la profondeur perdue.
#
# L'apprentissage est un CLASSEMENT par position (softmax sur les candidats): on ne demande pas une
# valeur, seulement que le bon coup passe devant. Se tromper n'y coute que du temps.
#
# Premiere version: descente de gradient a pas fixe. Elle oscillait sans converger -- perte 5,17
# quand le hasard donne 4,11 -- et rendait 10,9 % la ou les constantes a la main donnent 35,6 %.
# Le defaut etait l'optimiseur, pas les traits. Ici le softmax par groupes est vectorise avec
# reduceat et c'est L-BFGS qui cherche le minimum.
import sys, numpy as np
from scipy.optimize import minimize

SRC = sys.argv[1] if len(sys.argv) > 1 else 'order_feat.csv'
NF = 14
NOMS = ['estMur','versBut','atteintBut','croiseChemAdv','croiseNotre','colleMur',
        'vertical','distAdv','distNous','bordColonne','bordRangee','devantAdv','nosMurs','sesMurs']

raw = np.loadtxt(SRC, delimiter=',', dtype=np.float64)
pos = raw[:, 0].astype(np.int64)
best = raw[:, 1].astype(np.int8)
X = raw[:, 2:2 + NF]
print('%d lignes, %d positions' % (len(X), len(np.unique(pos))))

# Bornes des groupes contigus
starts = np.concatenate([[0], np.flatnonzero(np.diff(pos)) + 1])
lens = np.diff(np.concatenate([starts, [len(pos)]]))
tgt = np.flatnonzero(best == 1)
bon = (np.add.reduceat(best.astype(np.int64), starts) == 1) & (lens > 1)
starts, lens = starts[bon], lens[bon]
# un seul vrai par groupe garde: on realigne les cibles
keep_rows = np.concatenate([np.arange(s, s + l) for s, l in zip(starts, lens)])
X = X[keep_rows]; best = best[keep_rows]
starts = np.concatenate([[0], np.cumsum(lens)[:-1]])
tgt = np.flatnonzero(best == 1)
G = len(starts)
print('%d groupes utilisables, %d lignes' % (G, len(X)))

rng = np.random.default_rng(7)
perm = rng.permutation(G)
cut = int(G * 0.8)

def sous(idx):
    rows = np.concatenate([np.arange(starts[i], starts[i] + lens[i]) for i in idx])
    nl = lens[idx]
    ns = np.concatenate([[0], np.cumsum(nl)[:-1]])
    sx, sb = X[rows], best[rows]
    return sx, ns, nl, np.flatnonzero(sb == 1)

Xtr, Str, Ltr, Ttr = sous(perm[:cut])
Xte, Ste, Lte, Tte = sous(perm[cut:])
print('%d groupes d entrainement, %d de test' % (len(Str), len(Ste)))

mu, sd = Xtr.mean(0), Xtr.std(0)
sd[sd < 1e-9] = 1.0
Xtr = (Xtr - mu) / sd
Xte = (Xte - mu) / sd

def softmax_seg(z, S, Lg):
    m = np.repeat(np.maximum.reduceat(z, S), Lg)
    e = np.exp(z - m)
    return e / np.repeat(np.add.reduceat(e, S), Lg)

def perte_grad(w, Xg, S, Lg, T, l2=1e-6):
    z = Xg @ w
    p = softmax_seg(z, S, Lg)
    n = len(S)
    loss = -np.log(np.maximum(p[T], 1e-15)).sum() / n + 0.5 * l2 * w @ w
    g = (Xg.T @ p - Xg[T].sum(0)) / n + l2 * w
    return loss, g

def stats(Xg, S, Lg, T, w):
    z = Xg @ w
    # rang du vrai coup dans chaque groupe
    rangs = np.empty(len(S), dtype=np.int64)
    for i, (s, l) in enumerate(zip(S, Lg)):
        zz = z[s:s + l]
        rangs[i] = int((zz > zz[T[i] - s]).sum())
    return (100 * (rangs == 0).mean(), 100 * (rangs < 3).mean(),
            100 * (rangs < 5).mean(), rangs.mean())

res = minimize(perte_grad, np.zeros(NF), args=(Xtr, Str, Ltr, Ttr),
               jac=True, method='L-BFGS-B', options={'maxiter': 500})
w = res.x
print('L-BFGS: %s, perte finale %.4f (hasard = %.2f)' % (res.message.strip()[:40], res.fun, np.log(Ltr.mean())))
print('')
t1, t3, t5, rm = stats(Xte, Ste, Lte, Tte, w)
print('APPRIS (test, jamais vu)        premier %.1f%%   dans 3 %.1f%%   dans 5 %.1f%%   rang moyen %.2f' % (t1, t3, t5, rm))
print('A BATTRE (constantes a la main) premier 35.6%%   dans 3 59.0%%   dans 5 66.0%%   rang moyen 6.12')
print('')
np.save('order_w.npy', np.vstack([w, mu, sd]))
print('poids -> order_w.npy')
for i, n in enumerate(NOMS):
    print('  %-16s %+8.4f   (echelle reelle %+10.2f)' % (n, w[i], w[i] / sd[i]))
