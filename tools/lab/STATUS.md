# Campaign state

Written because this machine has rebooted twice mid-campaign. Everything that matters lives in
the repo, not in `/tmp`. Last updated 2026-09-26 midday.

## Read this first: two whole nights of network results were measured against a dead network

`setNet` reads `netB2 = w.b2[0]`. `train.py` wrote `b2` as a **scalar**. `w.b2[0]` on a number is
`undefined`, `undefined` seeded the accumulator, every add produced `NaN`, and
`(netScale * NaN) | 0` is **0** — so every network trained in this project evaluated every
position on the board as exactly equal. The engine played blind. It lost **120-0** and **119-0**,
which reads as "the network is weak" and was really "there is no network".

The shipped `path/netweights.js` was fine: it writes `b2: [-0.113708]`.

The clue was on screen and got explained away: `eval depart reseau: 0, artisanal: 50` was put
down to the start position being symmetric. **`netcheck.js` now exists** and refuses any weights
file whose evaluations take fewer than three distinct values across 150 positions. The shipped
network gives 142; the dead ones gave 1.

Invalidated: every match involving a network trained here. **Not** invalidated: the held-out loss
numbers, which are pure numpy and never touch the engine.

## The overnight queue re-ran itself for six hours

The "already answered" test was `grep -A3`, and the result line sits **four** lines below the
header. The test was always false. Nine questions were answered between 01:02 and 06:45, then the
same nine ran again, same seeds, same numbers, until 12:51. Fixed to `-A6` and checked against
the real log rather than assumed.


## Shipped

**`DC_BITS` 16 -> 22, `dcVal` Int16 -> Int8** (`path/engine.js`). The shortest-path cache held
65 536 entries and hit 48% of the time, and the misses were eviction, not new positions.

| bits | memory | hit rate | BFS/node | nodes/s |
|---|---|---|---|---|
| 16 (was) | 0.4 MB | 48.2% | 0.79 | — |
| 20 | 5 MB | 66.1% | 0.52 | +8.6% |
| **22** | **20 MB** | **80.8%** | **0.29** | **+19.4%** |
| 24 | 80 MB | 87.4% | 0.19 | +16.8% |

24 hits more often and runs slower: 80 MB no longer fits the processor's caches. Verified not to
change what the search concludes — 350 positions, identical best move, score and node count.

**`ttDepth` initialised to -1.** `clearTable()` and `setTableBits()` both filled it with -1 and
said why; the initial allocation did not. An untouched slot's key is 0, so the position in four
billion whose hash high word is 0 matched it, and depth 0 passed the depth test. ~1 move in 8 500
until the first clear, and the app never clears at all.

**Move navigation bar visible from ply 0** (`app.js`). `tbAllowed()` drove both the bar's
visibility *and* the game's `scrubbing` class, and that class changes `--vert-reserve` and
`--cell` — so the first move of every game resized the board. Verified in headless Chrome: board
525x525 at (425,80) identical before and after the first move.

**Live Server no longer reloads the page during tests** (`.vscode/settings.json`). The harness
appends to `tools/lab/data/*.csv` every few seconds.

## Confirmed, not yet shipped

**The transposition table is the biggest lever found: ~+220 Elo.** 2^20 (current) scores
**21.7% +/- 10.6** against 2^22 over 60 games at 500 000 nodes. The control, 2^20 against 2^20,
prints **exactly 50.0%** — so the harness and the `setTableBits` path are sound.

The mechanism is capacity: `clearTable()` runs once per *game* in the harness, so 50 moves x
500 000 nodes push 25 million visits through a one-million-entry table. **The real app never
clears at all** — the `{type:'clear'}` handler in `engine-worker.js` is dead code, nothing sends
it — so the shipped engine is more oversubscribed than the harness, and +220 Elo is conservative.

Open before shipping: 2^22 costs ~76 MB, on top of the 20 MB distance cache. A size ladder
(2^21 vs 2^22, 2^22 vs 2^23) and a replication on a different seed are running. A 4-way bucketed
table would likely capture much of the gain at 2^20's memory and is the better ship if it works.

**The shipped network is neutral at 500 000 nodes and stays.** Handcrafted 63 - learned 57,
**52.5% +/- 9.1** at *equal time*, so the network's quality exactly pays for its 1.15x cost. It
was worth +230 Elo at a small budget, so it helps phones and does not hurt desktops.

## Negative results (they cost the same to find and are worth as much)

**Feature 11 is not perspective-invariant, and fixing it changes nothing.** It reads +1 for one
player and -1 for the other on the START position, which is the same position up to a colour
swap, so it carried "which player am I" rather than the board fact it is meant to carry. Over
five seeds, on 145 000 positions:

| features | mean val loss |
|---|---|
| v1 shipped (14) | 0.3724 |
| v2 direction-normalised 11 (14) | 0.3729 |
| v3 v2 + side to move (15) | 0.3744 |

Seed noise is 0.002–0.004. None of them is a result.

**The real gap is the function class, not the labels or the features' details.** A 20 000-node
search predicts the same outcomes at loss **0.285**; the network manages **0.363** on 1.3M rows.

## Measured tonight, and it hurts

**The 20-feature network costs 27.8% of the engine's speed.** Measured in CPU time rather than
wall clock — wall clock counts the seconds a process spends descheduled while other jobs run, and
the same comparison came back anywhere from 0.90x to 2.37x before that changed. 27.8% is about
0.47 doublings, so **−25 to −40 Elo**. The held-out loss said the features predict better by
0.0027 across seven paired seeds; whether that is worth 30 Elo is what the equal-time match is
for. An ablation is running to see whether two of the six carry the gain at a fraction of the
cost.

**The wall candidate filter drops 58 of 123 legal walls** in a typical position. That is a
pruning heuristic living in the move *generator*, the one place a mistake cannot be recovered:
a move never generated is a move no depth will find. `engine-allwalls.js` prices it, at 500k and
at 1.5M nodes — if the filter merely spends a small budget well, the gap should close as the
budget grows.

## The harness can now use every core for ONE match

`parmatch.js`. Seven matches sharing eight cores all finish three and a half hours later; the
same work run one at a time, each spread across the cores, delivers the first verdict in forty
minutes and every later one as it lands. Splitting is legitimate because pair `p`'s opening comes
from `rng(seed*7919 + p)` and nothing else, so workers dividing the range play exactly the games
one process would have played — and `VERIFY=1` re-runs it serially and refuses to report unless
they match exactly. They do.

`BNODES` gives the two sides different budgets, which is what an equal-time comparison is.

`server/` holds the runbook and `setup.sh` for the 32-core machine: it reports the box, measures
nodes/second, prints how long each match size will take there, and runs the control that has to
print exactly 50.0% before any other number means anything.

## Running



| job | question | log |
|---|---|---|
| `netmatch` | outcome-labelled net vs handcrafted at 500k | `outcome_500k.log` |
| `ttsize` | 2^21 vs 2^22 | `tt_21v22.log` |
| `ttsize` | 2^22 vs 2^23 | `tt_22v23.log` |
| `ttsize` | 2^20 vs 2^22 again, different seed | `tt_replicate.log` |
| `bigsweep.sh` | 14 features vs 20 with wall geometry, 1.3M rows | `bigsweep.log` |
| `dcinv` | does the distance-MAP cache change results? | background |

## Tools built this session

- `lib.js` `encodePos`/`decodePos`: a position in 39 lossless characters — same features, same
  Zobrist hash, same evaluation after a round trip (`postest.js`, 2 023 positions).
- `gen.js` stores the **position**, so any future feature set is free to try. The first 520 452
  rows stored features only and cannot be re-featurised.
- `refeat.js` recomputes features for stored positions with any engine. Verified to reproduce
  `gen.js` byte for byte.
- `train.py` infers the feature count from the data, treats an empty score as *absent* rather
  than zero, and caches the parsed array as `.npy`.
- `netmatch.js` takes the slowdown ratio within interleaved pairs, median of nine. Summing three
  A timings then three B let load drift between halves: 1.15x quiet, 1.42x busy.
- `dcsweep.js` compares engine variants by nodes per second at an identical node count, so a
  speedup needs no games at all.
- `browser/uitest.js` drives real Chrome over CDP and asserts measured geometry.
- `dcinv.js` asserts two engines reach the identical move, score and node count.

## Data

`tools/lab/data/pos_*.csv` — 1 316 051 outcome-labelled positions with the position stored.
`tools/lab/data/out_*.csv` — 520 452 older rows, features only, not re-featurisable.

## Not started

- A 4-way bucketed transposition table (memory-neutral alternative to 2^22).
- Re-measuring `DC_BITS` once the table size changes: they compete for the same processor caches.
- Adaptive table sizing from `navigator.deviceMemory`, with the allocation guarded.
- `genMoves` is 14.8% of the profile and still the second-largest item.
- Nothing has been committed to git at any point in this project.

## Where the table decision stands (2026-09-26 afternoon)

**Confirmed, and the apparatus behind it is now controlled twice over.**

| measurement | score for 2^20 |
|---|---|
| vs 2^22, seed 31, 500k | 21.7% |
| vs 2^22, seed 33, 500k | 22.9% |
| vs 2^22, seed 33, 500k (repeat) | 22.9% |
| vs 2^22, seed 77 fixed openings, 150k | 21.3% |
| vs 2^22, seed 77 fixed openings, 500k | 22.5% |

About **-215 Elo** for the shipped size. 2^21, 2^22 and 2^23 are indistinguishable (50.0%, 49.2%),
so the whole gain arrives between 2^20 and 2^21 and **38 MB is enough; 76 buys nothing**.

Two controls, both exactly 50.0%: identical engines, and identical engines where only one side
calls `setTableBits` — the second was missing until today and is what clears `setTableBits` of
being the cause.

**What the table buys is not depth.** On identical positions with the table accumulating across
a game, every size reaches the same depth to within a tenth of a ply (15.82 / 16.00 / 15.82 /
15.82). It buys accuracy at that depth: wall placements commute, so the same position is met by
an enormous number of move orders, and one already searched to depth 12 answers a search
nominally at depth 8. The app never clears the table, so fifty moves accumulate in one.

`variants/engine-tt21.js` carries the change and is proven behaviour-neutral: at the same table
size it reaches the identical move, score and node count as the shipped engine over 168
positions. Allocation is guarded and falls back a size at a time, and the default drops to 2^20
or 2^19 when `navigator.deviceMemory` reports a small device.

## Error bars were too narrow, everywhere

`band()` used the binomial formula on the GAME count. The two games of a pair share an opening,
so they are correlated: an opening that suits one engine tends to hand it both games. The bar is
now computed from the spread of the PAIR scores. The old bars were up to 40% too narrow — a
"+/- 9.2" was really up to +/- 12.9.

## Still unexplained: the bucketed table is intransitive

| pairing | result |
|---|---|
| 2^20 vs 2^22 | 2^22 is +228 |
| 2^20 vs buckets(2^20) | buckets are +168 |
| buckets(2^20) vs 2^22 | buckets are **+255** — transitivity says **-60** |

Same openings, same seed, reproduced at 150k and at 500k. 45 percentage points of gap, far beyond
even the corrected error bar. Both controls pass, so the harness is not the obvious culprit.
`ttinv2.js` now tests the invariant with the table ACCUMULATED rather than cleared per position,
which is the regime `ttinv.js` never covered and the one matches actually run in.

Nothing bucketed will ship until this is understood.

# 2026-09-27 : le plafond etait la classe de fonction

## Quatre bugs, dont un qui invalide une conclusion de la veille

**L'echantillonnage des scores profonds ne repartissait rien** (`gen.js`). Le test
`positions % SCORE_EVERY === 0` lisait un compteur qui n'avance qu'a la FIN d'une partie. Pendant
une partie il ne bouge pas, donc la condition etait constante sur toute la partie: soit chaque
position recevait une recherche a 240 000 noeuds, soit aucune. Mesure sur les 1 675 810 lignes
produites: 137 721 scores ranges en **3 289 blocs contigus de ~42 lignes**, c'est-a-dire des
parties entieres. Le signal de score couvrait 6 % des parties au lieu d'etre partout.

Ce que cela invalide: le balayage `lambda = 0 / 0,3 / 0,5` du 27 au matin, qui concluait que melanger
le score a la cible n'apporte rien (0.3403 / 0.3414 / 0.3418). La conclusion n'est pas fausse, elle
n'est pas **etablie**: elle a ete mesuree avec un signal de score concentre sur 3 289 parties.
Le cout total en calcul etait le meme dans les deux cas, seule la repartition changeait.
Corrige, et verifie sur un lot neuf: 22 scores en 22 blocs distincts, 1 position sur 12.

**`parmatch.js` cachait les poids par defaut.** `loadEngine` charge `path/netweights.js` quand on
ne lui dit rien, mais la ligne de resultat n'affichait `AW` que s'il avait ete passe. Tous les
matchs des deux derniers jours opposaient donc le moteur AVEC son reseau embarque au candidat, en
imprimant `A path/engine.js`. Le comportement est defendable (A = le moteur tel qu'il est livre);
le libelle etait faux, et il a deja trompe une lecture. Il affiche maintenant les poids reels.

**`watchnight.js` pouvait lancer une ferme par-dessus un match.** `genfarm` et `parmatch` ecrivent
le meme `queue_status.json`: un battement perime ne dit pas laquelle des deux s'est arretee. La
veille demarrait cinq ouvriers en plein match -- le resultat du match reste bon (il compte des
noeuds) mais toute mesure de temps devient fausse. Elle verifie maintenant les processus.

**`genfarm.js` pouvait rejouer une graine.** `SEED0=auto` ne regarde que son propre dossier de
sortie, donc deux machines prenant chacune "mon maximum + 100" finissent par choisir le meme
nombre -- et une graine rejouee regenere les memes parties sans que rien ne le signale. Le local
etait a cinq redemarrages de la plage du Lenovo. Il refuse maintenant de demarrer si la graine
apparait ou que ce soit sous `data/`.

## Le moteur, lui, est propre : `rulescheck.js`

Tout le banc comparait le moteur a LUI-MEME (dcinv compare deux variantes, le controle de match
oppose un moteur a sa copie), ce qui ne peut pas attraper une regle mal codee: les deux cotes se
trompent ensemble. `rules.js` est l'implementation independante, celle dont l'app se sert.

| verification | comparaisons | ecarts |
|---|---|---|
| regles de saut, **toutes** les paires de cases adjacentes, avec murs autour | 50 004 | 0 |
| legalite des murs, tous les emplacements, sur positions jouees | 3 328 | 0 |
| `makeMove`/`unmakeMove` restaure la position | 1 121 | 0 |
| reproductibilite, avec d'autres recherches intercalees | 12 | 0 |

Le chemin rapide `mayCut()` dit exactement la meme chose que le BFS complet, partout. Le filtre de
murs candidats ecarte 48 a 49 % des murs legaux (confirme la mesure de 58/123).

## Le reseau qui voit le plateau

L'hypothese a verifier etait: le plafond n'est ni les etiquettes ni la quantite de donnees, c'est
que 14 nombres faits main ne disent pas OU sont les murs. Les 1 675 810 positions deja sur le
disque ont ete re-encodees (`nnuedata.js`) en **312 entrees binaires** -- case de chaque pion, 128
creneaux de mur, murs en main -- plus 4 entrees denses pour les distances, qu'un petit reseau ne
redecouvrirait pas d'une occupation de murs. Tout est tourne pour que le joueur au trait aille
toujours vers la ligne 0.

L'extraction rend les lignes **dans l'ordre ou `train.py` lit les memes fichiers**, donc la meme
`RandomState(7).permutation(N)` decoupe la meme validation: les pertes ci-dessous portent sur les
memes positions, ce ne sont pas deux mesures sur deux echantillons.

| entrees | code | perte val | signe | MAC / evaluation |
|---|---|---|---|---|
| 14 faites main | numpy | 0.3403 | 81.6 % | 240 |
| 14 faites main | **torch, meme boucle** | 0.3430 | 81.6 % | 240 |
| 4 denses seules | torch | 0.4139 | 75.4 % | ~70 |
| plateau, tete 256->32->32->1 | torch, 24 epoques | 0.2970 | 84.3 % | 9 400 |
| **plateau, tete 256->1** | torch, 24 epoques | **0.3044** | **84.4 %** | **260** |

Les deux controles comptent autant que le resultat. torch sur les 14 anciennes entrees redonne
0.3430 contre 0.3403 en numpy: **l'outil n'explique rien**, c'est ce que le reseau voit qui paie.
Et les 4 entrees denses seules font 0.4139, donc la boucle d'entrainement ne fabrique pas de
performance a partir de rien.

La tete COURTE est le resultat qui compte. Un accumulateur suivi d'une seule matrice vers la sortie
coute 260 multiplications par position -- autant que l'ancien reseau a 14 entrees -- et predit
nettement mieux. Sur les lignes qui portent un score profond, elle atteint 0.2830 la ou la
recherche a 240 000 noeuds qui a produit ces scores fait 0.3095.

**Pourquoi 312 entrees sont payables dans un navigateur.** La premiere couche est une SOMME des
colonnes dont l'entree vaut 1, et un coup n'en change qu'une ou deux: un pion quitte une case et
arrive sur une autre, un mur apparait et ne bouge plus jamais. Elle n'est donc jamais recalculee,
seulement corrigee. Deux accumulateurs, un par point de vue, parce que l'encodage depend de qui
joue et que le trait change a chaque demi-coup; les maintenir tous les deux coute deux corrections
par coup et evite de tout recalculer a chaque changement de trait.

`variants/engine-nnue.js` est **genere** par `mknnue.py` depuis `path/engine.js`, chaque point
d'insertion etant verifie unique -- une copie editee a la main de 88 Ko divergerait en silence.

### Ce qui est verifie sur l'implementation (`nnuecheck.js`)

| verification | resultat |
|---|---|
| derive: accumulateur incremental contre recalcul, en make/unmake imbriques | 1 168 coups, 0 ecart |
| encodage: accumulateur du moteur contre les indices d'entrainement | 500 positions, 0 ecart |
| entrees denses du moteur contre celles de l'extraction | 0 ecart |
| tete JS contre le reseau Python, 1 296 positions | ecart moyen **1.75** point de score (pire 20) sur une amplitude -2449..3195 |

L'accumulateur est en entiers (point fixe 1024) et non en flottants, pour une raison precise: il
est maintenu par corrections successives pendant des millions de coups, et en flottant une addition
suivie de sa soustraction ne rend pas toujours la valeur de depart -- l'evaluation d'une position
dependrait du chemin par lequel la recherche y arrive. Les entiers rendent la question sans objet.

## Ce qui n'est PAS encore mesure

**Aucun Elo.** Une meilleure prediction n'est pas un meilleur joueur: le reseau doit valoir plus
que ce que son cout retire de profondeur. Restent a faire, dans cet ordre: noeuds/s de la variante
(en temps CPU, pas en temps mur, et pas pendant qu'un entrainement tourne), puis `parmatch` a
**temps egal** via `BNODES`. C'est la seule mesure qui decide.

## Aussi

- Le Lenovo genere a nouveau (11 flux, ~2 180 parties/h) avec le `gen.js` corrige, et enregistre
  desormais le **meilleur coup** de chaque recherche profonde dans `pos_<graine>_pol.csv`: la
  recherche le trouvait depuis toujours et il etait jete. C'est le jeu de donnees d'un reseau de
  politique, qui ameliorerait l'ORDRE des coups -- donc la profondeur -- sans rien couter a
  l'evaluation, et qui remplacerait le filtre de murs candidats.
- Sept boucles de surveillance `pwsh while($true)` tournaient a vide sur le Lenovo, dont quatre
  depuis dix-sept heures, a relire un fichier d'etat deux fois par seconde. `killtails.ps1` les
  arrete. Quatre Chrome headless faisaient de meme ici depuis seize heures: une epoque
  d'entrainement est passee de 1,3 min a 0,25 min apres leur arret.
- Le point a 20 000 noeuds du balayage de la veille (32 % quand ses deux voisins donnent 62 % et
  91 %) reste inexplique et non rejoue.

## Le verdict en Elo : le reseau predit beaucoup mieux et joue beaucoup plus mal

C'est le resultat de la journee et il est net. Aucune ambiguite a lever, seulement une cause a
trouver.

| match | resultat | Elo |
|---|---|---|
| moteur livre 100 000 noeuds contre NNUE 32 000 (**temps egal**) | A 116 - B 4 sur 120 | **585** pour le moteur livre |
| moteur livre 32 000 contre NNUE 32 000 (**noeuds egaux**) | A 117 - B 3 sur 120 | **636** pour le moteur livre |

La deuxieme ligne est celle qui compte: **a noeuds egaux, le handicap est encore PIRE**. La lenteur
n'explique donc rien du tout -- elle est reelle (voir ci-dessous) mais accessoire. C'est
l'evaluation qui est mauvaise a l'interieur d'une recherche.

### Vitesse, pour memoire (dcsweep, machine au repos, chronometrages entrelaces)

| moteur | noeuds/s | vs base |
|---|---|---|
| `path/engine.js` livre | 290 k | -- |
| NNUE, tete courte (256->1) | 93 k | -67,9 % |
| NNUE, tete longue (256->32->32->1) | 58 k | -80,1 % |

Le cout dominant n'est pas la tete mais l'accumulateur: un coup de mur met a jour 3 colonnes x 2
points de vue x 256 entiers, paye deux fois par noeud (coup joue puis annule), soit 2 000 a 3 000
operations par noeud. C'etait reparable -- mains en entree dense au lieu de creuse, encodage absolu
pour n'avoir qu'un accumulateur, mises a jour paresseuses. **Inutile de le reparer avant de
comprendre le resultat a noeuds egaux.**

### La prediction, sur la population qui compte

Les chiffres precedents (0.2850 etc.) portaient sur toute la validation, or le moteur ne soumet au
reseau que 69,4 % des positions -- et celles-la sont beaucoup plus dures. Mesure sur les 116 401
positions de validation que `evaluate()` lui soumet reellement, toutes conditions identiques
(80 epoques, meme decoupe, meme graine):

| reseau | perte | signe | toute la validation |
|---|---|---|---|
| 14 entrees faites main (torch, meme boucle) | 0.4881 | 73,8 % | 0.3437 |
| plateau, accumulateur 128 | 0.4312 | 77,6 % | 0.3108 |
| plateau, accumulateur 256 | 0.4042 | 79,0 % | 0.2912 |
| plateau, accumulateur **512** | **0.3656** | **81,3 %** | 0.2636 |
| plateau, cible de recherche (12x moins de lignes) | 0.4978 | 74,8 % | 0.4062 |

La largeur paie encore a 512. Et l'ecart avec les 14 entrees est massif: 0.3656 contre 0.4881.
**Donc le reseau de plateau est un bien meilleur predicteur ET un bien plus mauvais joueur.**

### Le diagnostic qui explique peut-etre tout (`evaldiag.js`)

Predire l'issue d'une partie et SEPARER les coups d'une position sont deux choses differentes.
25 positions, coup de reference = celui d'une recherche a 100 000 noeuds, choix a un demi-coup:

| evaluation | choisit le coup de la recherche | ecart-type sur les coups | amplitude |
|---|---|---|---|
| reseau livre (distille d'une recherche a 20 000) | 56 % | 65 | 389 |
| faite main, aucun reseau | 52 % | 54 | 341 |
| **NNUE entraine sur les issues** | **32 %** | **293** | **1407** |

Le NNUE n'est pas plat: il separe les coups quatre fois plus que les deux autres, et il se trompe.
Confiant et faux. Les deux references etant au meme niveau (52 et 56 %), 32 % n'est pas un plafond
de l'exercice.

## Trois pistes pour la suite, dans cet ordre

**1. L'echelle, et le fait que `evaluate()` en melange deux dans une meme recherche.** C'est le
suspect le moins coute-teux a tester et le plus vraisemblable. Les marges d'elagage de la recherche
(futility, razoring, LMR) ont ete reglees sur les grandeurs de l'evaluation faite main, dont
l'amplitude entre coups est de ~390; celle du NNUE est de ~1400. Pire, dans la meme recherche, la
branche "plus un mur en main" retourne `W.dist * m + W.tempo`, en unites faites main, tandis que les
autres positions retournent des unites reseau: deux echelles differentes cohabitent, et une position
a mains vides se retrouve systematiquement comparee a une position evaluee sur une autre echelle.
Le reseau livre, lui, a ete ajuste pour tomber a peu pres sur la meme echelle (amplitude 389 contre
341 pour le fait main), ce qui expliquerait pourquoi lui ne casse rien.
*Test*: choisir `scale` pour que l'ecart-type du reseau sur des coups legaux egale celui de
l'evaluation faite main, puis rejouer le match a noeuds egaux. Cinq lignes.

**2. La cible.** Un alpha-beta demande a son evaluation de feuille d'approximer ce qu'une recherche
plus profonde repondrait. L'issue d'une partie est autre chose: elle inclut les erreurs futures des
deux joueurs. Le reseau livre, lui, a ete distille d'une recherche -- d'ou ses 56 %. Le test mene
ici (cible de recherche seule) est **non concluant**: il n'a que 84 218 lignes d'apprentissage au
lieu de 1 046 516, parce que seules 8,2 % des positions portent un score profond. Pour le trancher
il faut plus de positions notees, pas une autre boucle d'entrainement. `SCORE_EVERY=3` ou une passe
de notation sur des positions deja stockees y suffiraient.

**3. La vitesse**, seulement si 1 et 2 aboutissent. Les trois reparations sont identifiees et
chiffrees plus haut.

## Ce qui n'a pas ete mesure

**La valeur d'un doublement de noeuds.** `calib_doublement.sh` est ecrit et pret (meme moteur des
deux cotes, seul le budget change) mais ne s'est jamais lance: son declenchement etait chaine sur
une attente `pgrep` qui se reconnaissait dans sa propre ligne de commande. Ce taux de change manque
a tout ce fichier, qui convertit des ecarts de vitesse en Elo avec une valeur supposee.

## Outils et donnees de la journee

- `rulescheck.js` -- le moteur contre `rules.js` (sauts, murs, make/unmake, reproductibilite).
- `nnuedata.js` -- re-encode les positions stockees en 312 entrees creuses + 4 denses + les 14
  anciennes features + le temoin "evaluate() irait-il jusqu au reseau". Ordre identique a celui que
  `train.py` lit, pour que la decoupe de validation soit la meme.
- `train_nnue.py` -- torch CPU (`.venv/`), tete parametrable (`HEAD=`), `REACH`, `SCORED_ONLY`.
- `mknnue.py` -- **genere** `variants/engine-nnue.js` depuis `path/engine.js`, 10 insertions
  verifiees uniques. A relancer apres toute modification du moteur.
- `export_nnue.py` -- npz vers fichier de poids JS (accumulateur en int16, point fixe 1024, tete en
  float32, base64 avec decodeur embarque pour le bac a sable).
- `nnuecheck.js` / `nnuecheck.py` -- derive, encodage, et la tete JS contre le reseau Python.
- `evaldiag.js` -- accord avec une recherche profonde a un demi-coup.
- `killtails.ps1` -- arrete les boucles de surveillance laissees sur le Lenovo.
- `data/nnue/` -- 1 675 810 lignes re-encodees (108 Mo + f14 + reach).
- `data/new_lenovo/` -- la generation du 27: **114 327 positions** et **9 533 cibles de politique**,
  scores profonds enfin repartis 1 sur 12 (873 scores en 873 blocs distincts sur un fichier).
  Ce dossier ne correspond pas au motif `data/deep*`, donc il n'entre pas dans les extractions qui
  doivent rester figees.
