// Construit une variante du moteur dont le filtre de murs candidats est ELARGI.
//
// Pourquoi un generateur et non une copie. La variante engine-allwalls.js existait deja, mais
// faite a la main et jamais reprise: elle datait d'avant le correctif d'abandon et avant
// breakProvenTie, donc la mesurer aurait melange le filtre avec deux autres changements. Comme
// mknnue.js pour le reseau, celui-ci repart du moteur du jour et verifie que chaque point
// d'insertion apparait exactement une fois -- si le moteur bouge, il echoue bruyamment au lieu de
// coller au mauvais endroit.
//
// Ce qu'on cherche a savoir. Le filtre ne propose qu'environ 25 a 45 des 128 murs: ceux qui
// croisent un des deux plus courts chemins, qui touchent un mur deja pose, ou qui sont dans une
// boite autour d'un pion. Verification faite sur 193 cas repris a 600 000 noeuds: le coup ecarte
// est reellement meilleur 62 fois sur 100, de 100 points en mediane, et cinq fois il cachait un
// gain force. Mais elargir n'est pas gratuit: chaque candidat de plus coute du temps a CHAQUE
// noeud de l'arbre, et le moteur note lui-meme que toucher la tete de sa liste de coups est ce qui
// lui fait le plus de mal. Seules des parties tranchent.
//
//   MODE=all  node mkwalls.js     -> tous les murs legaux sont candidats (la borne haute)
//   MODE=wide node mkwalls.js     -> les memes regles, voisinages elargis d'un cran
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.join(HERE, '..', '..', 'path', 'engine.js');
const MODE = process.env.MODE || 'all';
const DST = path.join(HERE, 'variants', `engine-walls-${MODE}.js`);

let s = fs.readFileSync(SRC, 'utf8');
const need = (a) => {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error(`point d'insertion trouve ${n} fois, attendu 1:\n${a.slice(0, 90)}`); process.exit(1); }
};

if (MODE === 'all') {
  const a = `      for (let o = 0; o < 2; o++) {
        for (let j = 0; j < JN; j++) {
          const tag = onPath[o * JN + j];`;
  need(a);
  s = s.replace(a, `      // VARIANTE: aucun filtre. Tout mur legal est candidat. C'est la borne haute de ce que
      // l'elargissement peut rapporter, et aussi son cout maximal.
      for (let k = 0; k < JN * 2; k++) onPath[k] |= 4;

` + a);
} else if (MODE === 'wide') {
  const a1 = `          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {`;
  const a2 = `        for (let dr = -2; dr <= 1; dr++) for (let dc = -2; dc <= 1; dc++) {`;
  need(a1); need(a2);
  // VARIANTE: un cran de plus autour d'un mur deja pose, et un cran de plus autour des pions.
  s = s.replace(a1, `          for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {`);
  s = s.replace(a2, `        for (let dr = -3; dr <= 2; dr++) for (let dc = -3; dc <= 2; dc++) {`);
} else {
  console.error("MODE doit valoir 'all' ou 'wide'");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, s);
console.log(`${path.relative(path.join(HERE, '..', '..'), DST)} ecrit depuis le moteur du jour (MODE=${MODE})`);
