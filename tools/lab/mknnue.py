#!/usr/bin/env python3
"""Build variants/engine-nnue.js from path/engine.js by inserting the NNUE evaluation.

Generated rather than copied by hand. The shipped engine changes every day in this project, and a
hand-edited 88 KB copy diverges silently: the variant keeps an old bug fix, the match blames the
network, and a week goes by. Re-running this script rebases the variant on whatever the engine is
today, and every insertion point is asserted to appear exactly once -- if the engine moves, this
fails loudly instead of patching the wrong place.

  .venv/bin/python mknnue.py
"""
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'path', 'engine.js')
DST = os.path.join(HERE, 'variants', 'engine-nnue.js')

NNUE_BLOCK = r'''
  // =====================================================================
  //  NNUE — le plateau lui-meme, somme dans un accumulateur
  // =====================================================================
  //
  // L'ancienne evaluation apprise lit 14 nombres faits main et aucun ne dit OU est un mur. Elle
  // plafonne a 0.3403 de perte sur les memes positions de validation; les memes donnees, montrees
  // au reseau sous forme de plateau, donnent 0.2970. Ce qui rend un reseau a 312 entrees payable
  // a l'interieur d'une recherche, c'est que sa premiere couche est une SOMME des colonnes dont
  // l'entree vaut 1, et qu'un coup n'en change qu'une ou deux: un pion quitte une case et arrive
  // sur une autre, un mur apparait et ne bouge plus jamais. La premiere couche n'est donc jamais
  // recalculee, seulement corrigee -- 256 additions par coup au lieu de quatre-vingt mille
  // produits. Quoridor s'y prete mieux que les echecs: rien n'est jamais capture.
  //
  // DEUX accumulateurs, un par joueur. Les donnees d'entrainement sont canonisees pour que le
  // joueur au trait marche toujours vers la ligne 0, donc les indices d'entree dependent de QUI
  // joue -- et le trait change a chaque demi-coup. Garder un accumulateur par point de vue et
  // lire celui du joueur au trait coute deux mises a jour par coup et les garde toutes les deux
  // incrementales. Recalculer a chaque changement de trait couterait exactement ce qu'on essaie
  // d'economiser.
  const NN_MY_PAWN = 0, NN_OP_PAWN = 81, NN_WALL_H = 162, NN_WALL_V = 226,
        NN_MY_HAND = 290, NN_OP_HAND = 301;
  let nnW = null, nnB = null, nnH = 0, nnQA = 1024, nnScale = 440;
  let nnAcc = null, nnX = null, nnHead = null, nnOutW = null, nnOutB = 0;
  let nnOk = false;
  // Le fichier de poids declare s'il contient une evaluation complete ou une CORRECTION a ajouter
  // a l'evaluation faite main. Le moteur n'a pas a le deviner et les deux ne se melangent pas.
  let nnResidual = false;
  // Vrai si le dernier appel a evaluate() est alle jusqu'au branchement du reseau.
  let nnReached = false;
  function nnWasReached() { return nnReached; }

  function setNnue(w) {
    if (!w || !w.acc) { nnOk = false; return; }
    nnH = w.hidden; nnQA = w.qa || 1024; nnScale = w.scale || 440;
    nnW = w.acc; nnB = w.accb; nnResidual = !!w.residual;
    nnAcc = new Int32Array(2 * nnH);
    nnX = new Float32Array(nnH + 4);
    nnHead = [];
    for (let i = 0; i < w.head.length; i++) {
      const l = w.head[i];
      nnHead.push({ out: l.out, inp: l.inp, w: l.w, b: l.b, buf: new Float32Array(l.out) });
    }
    nnOutW = w.outw; nnOutB = w.outb;
    nnOk = true;
  }
  function hasNnue() { return nnOk; }
  // Verification pendant une VRAIE recherche. Le controle ecrit a cote pilote les coups a la main,
  // ce qui ne visite jamais les chemins que la recherche emprunte: sorties anticipees, table de
  // transposition, reductions, coups annules par un elagage. Un accumulateur qui se desynchronise
  // la-dedans fait evaluer une position qui n'est pas sur le plateau, et cela ressemble a un
  // reseau faible et non a un moteur casse. Quand nnVerify est pose, chaque evaluation recompare
  // l'accumulateur incremental a un recalcul complet, puis GARDE le recalcul: chaque ecart est
  // ainsi signale une fois, a l'endroit ou il nait, au lieu de se propager.
  let nnVerify = null;
  function setNnVerify(fn) { nnVerify = fn; }
  function nnAccCopy() { return nnAcc ? Int32Array.from(nnAcc) : null; }

  // L'indice d'un fait, vu par le joueur p. p === 1 marche vers la ligne 8, donc il voit le
  // plateau a l'envers: la case (r,c) devient (8-r,c), et la frontiere entre les lignes r et r+1
  // devient celle entre 7-r et 8-r, soit le creneau 7-r -- la meme transformation pour les deux
  // orientations de mur. Se tromper d'une unite ici ne casse rien de visible: le reseau evalue
  // simplement une autre position que celle sur le plateau.
  function nnCell(p, cell) {
    if (p === 0) return cell;
    const r = (cell / 9) | 0;
    return (8 - r) * 9 + (cell - r * 9);
  }
  function nnSlot(p, j) {
    if (p === 0) return j;
    const r = (j / 8) | 0;
    return (7 - r) * 8 + (j - r * 8);
  }
  function nnCol(p, idx, sign) {
    const h = nnH, base = p * h, off = idx * h, a = nnAcc, w = nnW;
    if (sign > 0) { for (let i = 0; i < h; i++) a[base + i] += w[off + i]; }
    else { for (let i = 0; i < h; i++) a[base + i] -= w[off + i]; }
  }

  // Tout recalculer depuis la position. Appele par rehash(), c'est-a-dire aux deux seuls endroits
  // ou la position change en bloc au lieu de changer d'un coup: reset() et fromRules().
  function nnRefresh(pos) {
    if (!nnOk) return;
    const h = nnH, a = nnAcc;
    for (let p = 0; p < 2; p++) {
      const base = p * h;
      for (let i = 0; i < h; i++) a[base + i] = nnB[i];
      nnCol(p, NN_MY_PAWN + nnCell(p, pos.pawn[p]), 1);
      nnCol(p, NN_OP_PAWN + nnCell(p, pos.pawn[1 - p]), 1);
      for (let o = 0; o < 2; o++) {
        const wl = pos.wall[o], off = o === 0 ? NN_WALL_H : NN_WALL_V;
        for (let j = 0; j < pos.JN; j++) if (wl[j]) nnCol(p, off + nnSlot(p, j), 1);
      }
      nnCol(p, NN_MY_HAND + pos.hand[p], 1);
      nnCol(p, NN_OP_HAND + pos.hand[1 - p], 1);
    }
  }

  function nnPawnMoved(who, from, to) {
    for (let p = 0; p < 2; p++) {
      const off = p === who ? NN_MY_PAWN : NN_OP_PAWN;
      nnCol(p, off + nnCell(p, from), -1);
      nnCol(p, off + nnCell(p, to), 1);
    }
  }
  // Le mur apparait (sign = 1) ou disparait (sign = -1), et la main du poseur passe de oldHand a
  // newHand. Les deux vont ensemble: un mur pose sans decrementer la main laisserait le reseau
  // croire que le joueur en a encore un de plus, ce qui est precisement une des choses qu'il lit.
  function nnWallChanged(who, o, j, oldHand, newHand, sign) {
    const woff = o === 0 ? NN_WALL_H : NN_WALL_V;
    for (let p = 0; p < 2; p++) {
      nnCol(p, woff + nnSlot(p, j), sign);
      const hoff = p === who ? NN_MY_HAND : NN_OP_HAND;
      nnCol(p, hoff + oldHand, -1);
      nnCol(p, hoff + newHand, 1);
    }
  }

  // La tete, recalculee a chaque evaluation: rien d'incremental, donc rien qui puisse deriver.
  // dme et dopp arrivent en arguments parce que evaluate() a deja paye les deux plus courts
  // chemins avant d'arriver ici -- un reseau qui les ferait recalculer paierait ses entrees a
  // l'endroit le plus cher du moteur.
  function nnueEval(pos, dme, dopp) {
    if (nnVerify) {
      const inc = Int32Array.from(nnAcc);
      nnRefresh(pos);
      for (let i = 0; i < inc.length; i++) {
        if (inc[i] !== nnAcc[i]) { nnVerify(i, inc[i], nnAcc[i]); break; }
      }
    }
    const h = nnH, base = pos.turn * h, x = nnX, qa = nnQA;
    for (let i = 0; i < h; i++) {
      const v = nnAcc[base + i];
      x[i] = v <= 0 ? 0 : (v >= qa ? 1 : v / qa);
    }
    x[h] = dme / 10; x[h + 1] = dopp / 10; x[h + 2] = (dopp - dme) / 10;
    x[h + 3] = (20 - pos.hand[0] - pos.hand[1]) / 20;
    let inp = x, nin = h + 4;
    for (let L = 0; L < nnHead.length; L++) {
      const ly = nnHead[L], out = ly.out, wt = ly.w, bs = ly.b, dst = ly.buf;
      for (let o = 0; o < out; o++) {
        let v = bs[o];
        const off = o * nin;
        for (let i = 0; i < nin; i++) v += inp[i] * wt[off + i];
        dst[o] = v <= 0 ? 0 : (v >= 1 ? 1 : v);
      }
      inp = dst; nin = out;
    }
    let z = nnOutB;
    for (let i = 0; i < nin; i++) z += inp[i] * nnOutW[i];
    // Meme convention que netEval: la cible d'entrainement etait une logistique du score sur
    // cette echelle, donc la sortie brute EST le score, a l'echelle pres.
    return (nnScale * z) | 0;
  }
'''

PATCHES = [
    # 1. the block itself, right after the old network's accessor
    ('const hasNet = () => netW1 !== null;',
     'const hasNet = () => netW1 !== null;\n' + NNUE_BLOCK,
     'bloc NNUE'),

    # 2. evaluate() prefers the NNUE when it is loaded, and records that it got this far
    ('    if (netW1 !== null) return netEval(pos);',
     '    nnReached = true;\n'
     '    if (nnOk && !nnResidual) return nnueEval(pos, dme, dopp);\n'
     '    if (netW1 !== null && !nnOk) return netEval(pos);',
     'branchement dans evaluate'),

    # En residuel, le reseau ne remplace pas la formule: il la corrige. Toutes les proprietes de
    # l'evaluation faite main -- elle monte quand on se rapproche du but, elle compte le tempo,
    # elle est a l'echelle sur laquelle les marges d'elagage ont ete reglees -- sont conservees par
    # construction, et le reseau n'a plus qu'a apprendre ce qu'elle ignore: ou sont les murs.
    ('    s += W.prog * (popp - pme);\n    return s;',
     '    s += W.prog * (popp - pme);\n'
     '    return nnOk && nnResidual ? s + nnueEval(pos, dme, dopp) : s;',
     'addition residuelle'),

    # 2b. Le temoin est remis a faux a l'entree d'evaluate. Il sert a l'extraction: le reseau n'est
    #     appele que sur les positions qui arrivent jusqu'au branchement, et s'entrainer sur les
    #     autres -- course prouvee, deux mains vides -- depense de la capacite sur des positions
    #     que le moteur ne lui soumettra jamais. Le temoin est pose a l'endroit du branchement
    #     plutot que reconstitue ailleurs, parce qu'une copie de la chaine de sorties anticipees
    #     derive des que evaluate() change, et sans rien signaler.
    ('  function evaluate(pos) {\n    const me = pos.turn, opp = 1 - me;',
     '  function evaluate(pos) {\n    nnReached = false;\n    const me = pos.turn, opp = 1 - me;',
     'temoin remis a faux'),

    # 3. rehash() is the only place the position changes wholesale
    ('    pos.hashLo = lo | 0; pos.hashHi = hi | 0;',
     '    pos.hashLo = lo | 0; pos.hashHi = hi | 0;\n'
     '    if (nnOk) nnRefresh(pos);',
     'rafraichissement dans rehash'),

    # 4. makeMove, pawn
    ('      pos.pawn[me] = to;\n'
     '      if (((to / pos.cols) | 0) === pos.goalRow[me]) pos.winner = me;',
     '      pos.pawn[me] = to;\n'
     '      if (nnOk) nnPawnMoved(me, from, to);\n'
     '      if (((to / pos.cols) | 0) === pos.goalRow[me]) pos.winner = me;',
     'makeMove pion'),

    # 5. makeMove, wall: inserted AFTER hand[me] was decremented, so the old value is +1
    ('      addWall(pos, o, j);\n'
     '      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      pos.hand[me]--;\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];',
     '      addWall(pos, o, j);\n'
     '      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      pos.hand[me]--;\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      if (nnOk) nnWallChanged(me, o, j, pos.hand[me] + 1, pos.hand[me], 1);',
     'makeMove mur'),

    # 6. unmakeMove, pawn
    ('      pos.pawn[me] = fromCell;\n'
     '      pos.winner = -1;',
     '      pos.pawn[me] = fromCell;\n'
     '      if (nnOk) nnPawnMoved(me, to, fromCell);\n'
     '      pos.winner = -1;',
     'unmakeMove pion'),

    # 7. unmakeMove, wall: inserted AFTER hand[me] was incremented, so the value during the move
    #    was -1 from where it now stands
    ('      delWall(pos, o, j);\n'
     '      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      pos.hand[me]++;\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];',
     '      delWall(pos, o, j);\n'
     '      pos.hashLo ^= z.wallLo[o][j]; pos.hashHi ^= z.wallHi[o][j];\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      pos.hand[me]++;\n'
     '      pos.hashLo ^= z.handLo[me][pos.hand[me]]; pos.hashHi ^= z.handHi[me][pos.hand[me]];\n'
     '      if (nnOk) nnWallChanged(me, o, j, pos.hand[me] - 1, pos.hand[me], -1);',
     'unmakeMove mur'),

    # 8. exports, so the checker can reach inside
    ('    NET_FEATURES, netFeatures, setNet, netEval, hasNet,',
     '    NET_FEATURES, netFeatures, setNet, netEval, hasNet,\n'
     '    setNnue, hasNnue, nnRefresh, nnueEval, nnAccCopy, nnWasReached, setNnVerify,',
     'exports'),

    # 9. load the weights the same way the old ones are loaded
    ("""  {
    const w = (typeof window !== 'undefined' ? window : self).NetWeights;
    if (w && w.w1) setNet(w);
  }""",
     """  {
    const w = (typeof window !== 'undefined' ? window : self).NetWeights;
    if (w && w.w1) setNet(w);
  }
  {
    const w = (typeof window !== 'undefined' ? window : self).NnueWeights;
    if (w && w.acc) setNnue(w);
  }""",
     'chargement des poids'),
]

src = io.open(SRC, encoding='utf-8').read()
for old, new, why in PATCHES:
    n = src.count(old)
    if n != 1:
        sys.exit(f'ABANDON: le point d insertion "{why}" apparait {n} fois (attendu 1).\n'
                 f'path/engine.js a bouge; corriger mknnue.py plutot que la variante.')
    src = src.replace(old, new)

os.makedirs(os.path.dirname(DST), exist_ok=True)
io.open(DST, 'w', encoding='utf-8').write(src)
print(f'ecrit {os.path.relpath(DST, HERE)}  ({len(src) / 1024:.0f} Ko, {len(PATCHES)} insertions)')
