// L'arbitre est-il stable ? Mesure, sur les positions qui ont SERVI au diagnostic.
//
// Ishtar s'est revele bimodal sur la position de depart: la meme position, les memes 50000
// visites, et il rend soit un mur a 0,41 soit un pas en avant a 0,91 -- deux conclusions, pas du
// bruit. Si cela arrive aussi sur les positions du scan, alors les ecarts que j'ai attribues aux
// erreurs de Path viennent en partie de l'arbitre, et le diagnostic ne tient pas.
const fs = require('fs');
const { Ishtar, lireScore } = require('./qai.js');
const VISITS = Number(process.env.VISITS || 50000);
const N = Number(process.env.N || 3);
const COMBIEN = Number(process.env.COMBIEN || 14);

(async () => {
  const d = JSON.parse(fs.readFileSync('blunder.json', 'utf8'));
  const cas = d.cas.filter(c => c.pos);
  // un echantillon reparti sur toute la partie, pas seulement le debut
  const pas = Math.max(1, Math.floor(cas.length / COMBIEN));
  const ech = [];
  for (let i = 0; i < cas.length && ech.length < COMBIEN; i += pas) ech.push(cas[i]);
  const I = new Ishtar(VISITS);
  let instables = 0, ecartMax = 0, sommeEcart = 0;
  console.log(`${ech.length} positions du scan, ${N} interrogations chacune, ${VISITS} visites`);
  console.log('');
  console.log('coup   coups rendus              scores                     ecart');
  for (const c of ech) {
    const mvs = [], scs = [];
    for (let k = 0; k < N; k++) {
      const mv = await I.ask(c.pos, 300000);
      mvs.push(mv); scs.push(lireScore(I.infos));
    }
    const bons = scs.filter(x => x != null);
    const ecart = bons.length ? Math.max(...bons) - Math.min(...bons) : 0;
    const memeCoup = new Set(mvs).size === 1;
    if (!memeCoup || ecart > 0.1) instables++;
    ecartMax = Math.max(ecartMax, ecart); sommeEcart += ecart;
    console.log(String(c.ply).padStart(4) + '   ' + mvs.join(' ').padEnd(24) + ' ' +
      bons.map(x => x.toFixed(3)).join(' ').padEnd(24) + ' ' + ecart.toFixed(3) +
      (memeCoup ? '' : '   <= coup different') + (ecart > 0.1 ? '  <= score instable' : ''));
  }
  I.close();
  console.log('');
  console.log(`positions instables : ${instables}/${ech.length}`);
  console.log(`ecart de score moyen : ${(sommeEcart / ech.length).toFixed(3)}   maximum : ${ecartMax.toFixed(3)}`);
  console.log(`a comparer a ce que Path "concede" en moyenne dans le diagnostic : 0.037`);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
