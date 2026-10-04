// L'arbitre est-il stable LA OU j'ai conclu ? Le diagnostic dit que Path se trompe dans les dix
// premiers coups. Or c'est precisement la que les positions ressemblent le plus a la position de
// depart, la seule ou l'arbitre s'est montre bimodal (mur a 0,41 ou pas en avant a 0,91). Si les
// positions de debut de partie sont instables, le resultat principal ne tient pas.
const fs = require('fs');
const { Ishtar, lireScore } = require('./qai.js');
const VISITS = Number(process.env.VISITS || 50000);
const N = Number(process.env.N || 3);
const PLYMAX = Number(process.env.PLYMAX || 10);
const COMBIEN = Number(process.env.COMBIEN || 10);

(async () => {
  const d = JSON.parse(fs.readFileSync('blunder.json', 'utf8'));
  const tot = d.cas.filter(c => c.pos && c.ply <= PLYMAX);
  const pas = Math.max(1, Math.floor(tot.length / COMBIEN));
  const ech = [];
  for (let i = 0; i < tot.length && ech.length < COMBIEN; i += pas) ech.push(tot[i]);
  const I = new Ishtar(VISITS);
  let coupsDifferents = 0, sommeEcart = 0, ecartMax = 0;
  console.log(`${ech.length} positions de DEBUT de partie (coups 0-${PLYMAX}), ${N} interrogations chacune`);
  console.log('');
  for (const c of ech) {
    const mvs = [], scs = [];
    for (let k = 0; k < N; k++) { const mv = await I.ask(c.pos, 300000); mvs.push(mv); scs.push(lireScore(I.infos)); }
    const bons = scs.filter(x => x != null);
    const ecart = bons.length ? Math.max(...bons) - Math.min(...bons) : 0;
    const memeCoup = new Set(mvs).size === 1;
    if (!memeCoup) coupsDifferents++;
    sommeEcart += ecart; ecartMax = Math.max(ecartMax, ecart);
    console.log('coup ' + String(c.ply).padStart(2) + '   ' + mvs.join(' ').padEnd(22) +
      bons.map(x => x.toFixed(3)).join(' ').padEnd(22) + 'ecart ' + ecart.toFixed(3) +
      (memeCoup ? '' : '   <= IL CHANGE D AVIS'));
  }
  I.close();
  console.log('');
  console.log(`il change de coup sur ${coupsDifferents}/${ech.length} positions de debut de partie`);
  console.log(`ecart de score moyen ${(sommeEcart / ech.length).toFixed(3)}, maximum ${ecartMax.toFixed(3)}`);
  console.log(`(ce que Path concede en moyenne dans le diagnostic: 0.071 en debut de partie)`);
})().catch(e => { console.log('ERREUR', e.message); process.exit(1); });
