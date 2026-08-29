/* Tests de la logique de titres du worker IA (aucun reseau, aucun secret).
   Usage : node cloudflare/test-logique-titres.js
   Le script lit worker-ia.js, coupe le fichier avant "export default", evalue
   les fonctions pures dans un bac a sable node:vm, puis deroule les scenarios
   en simulant les reponses JSON de Mistral. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fichier = path.join(__dirname, 'worker-ia.js');
const source = fs.readFileSync(fichier, 'utf8');
const coupe = source.indexOf('export default');
if (coupe === -1) {
  console.error('Marqueur "export default" introuvable dans ' + fichier);
  process.exit(1);
}

const bac = {};
vm.createContext(bac);
vm.runInContext(source.slice(0, coupe), bac, { filename: 'worker-ia-pur.js' });

/* Simule le texte renvoye par Mistral (nouveau format 4 champs ou ancien). */
function ia(objet) { return JSON.stringify(objet); }

let total = 0;
let rates = 0;

function egal(nom, obtenu, attendu) {
  total++;
  const a = JSON.stringify(obtenu);
  const b = JSON.stringify(attendu);
  if (a === b) {
    console.log('OK  ' + nom);
  } else {
    rates++;
    console.log('KO  ' + nom);
    console.log('    attendu : ' + b);
    console.log('    obtenu  : ' + a);
  }
}

function vrai(nom, condition, detail) {
  total++;
  if (condition) {
    console.log('OK  ' + nom);
  } else {
    rates++;
    console.log('KO  ' + nom + (detail ? ' -- ' + detail : ''));
  }
}

const RAYON_DONUTS = ['Amethyste Donut 3cm', 'Hematite Donut 3cm'];
const RAYON_MIXTE = ['Amethyste Donut 3cm', 'Hematite Donut 3cm', 'Quartz rose Boule 5 cm'];

/* S1 (obligatoire) : rayon melange donuts + boules, saisie "boule amethyste 3cm".
   Le titre final contient Boule, suit la gamme boule, et jamais Donut. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '3cm', description: 'Une belle boule violette.' }),
    'boule amethyste 3cm', '', RAYON_MIXTE);
  egal('S1a rayon mixte, saisie boule : format de la gamme boule', r.titre, 'Amethyste Boule 3 cm');
  vrai('S1b le mot Donut n apparait jamais', r.titre.toLowerCase().indexOf('donut') === -1, r.titre);
})();

/* S2 (obligatoire) : rayon vide, gamme nouvelle -> format canonique "3 cm". */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Sodalite', type: 'Donut', dimension: '3cm', description: 'd' }),
    'Sodalite donut 3cm', '', []);
  egal('S2 rayon vide : format canonique avec espace', r.titre, 'Sodalite Donut 3 cm');
})();

/* S3 (obligatoire) : la gamme ecrit "3cm" sans espace -> style compact copie,
   meme si la vendeuse a tape "3 cm" avec espace (et pas de doublon du filet). */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Sodalite', type: 'Donut', dimension: '3 cm', description: 'd' }),
    'Sodalite donut 3 cm', '', RAYON_DONUTS);
  egal('S3 style compact de la gamme copie, sans doublon', r.titre, 'Sodalite Donut 3cm');
})();

/* S4 (obligatoire) : la gamme ecrit "5 cm" avec espace -> style espace copie. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Hematite', type: 'Boule', dimension: '3cm', description: 'd' }),
    'Hematite boule 3cm', '', ['Amethyste Boule 5 cm']);
  egal('S4 style espace de la gamme copie', r.titre, 'Hematite Boule 3 cm');
})();

/* S5 (obligatoire) : casse du mot de type copiee de la gamme (DONUT). */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Sodalite', type: 'Donut', dimension: '3cm', description: 'd' }),
    'sodalite donut 3cm', '', ['Amethyste DONUT 3cm']);
  egal('S5 casse du mot de type copiee de la gamme', r.titre, 'Sodalite DONUT 3cm');
})();

/* S6 (obligatoire) : produit sans pierre (encens), aucun mot de forme parasite. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Encens sauge blanche', type: '', dimension: '', description: 'd' }),
    'Encens sauge blanche', '', ['Encens lavande', 'Encens patchouli']);
  egal('S6a encens : titre inchange, gamme encens suivie', r.titre, 'Encens sauge blanche');
  vrai('S6b aucun mot de forme parasite', r.titre.toLowerCase().indexOf('boule') === -1 && r.titre.toLowerCase().indexOf('donut') === -1, r.titre);
})();

/* S7 : titre indecomposable, garde entier (test d orphelin). */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Lot de pierres roulees', type: '', dimension: '', description: 'd' }),
    'Lot de 5 pierres roulees', '', []);
  egal('S7 titre indecomposable conserve entier', r.titre, 'Lot de 5 pierres roulees');
})();

/* S8 : "Pierre de lune" jamais decoupee, "lune" jamais promue type. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Pierre de lune', type: 'Boule', dimension: '3cm', description: 'd' }),
    'Pierre de lune boule 3cm', '', ['Amethyste Boule 5 cm']);
  egal('S8 pierre en locution conservee entiere', r.titre, 'Pierre de lune Boule 3 cm');
})();

/* S9 (obligatoire) : l IA change de pierre -> la pierre de la vendeuse gagne. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Citrine', type: 'Boule', dimension: '3cm', description: 'd' }),
    'Amethyste boule 3cm', '', ['Quartz rose Boule 5 cm']);
  vrai('S9a la pierre de la vendeuse est conservee', r.titre.indexOf('Amethyste') !== -1, r.titre);
  vrai('S9b la pierre inventee par l IA est absente', r.titre.indexOf('Citrine') === -1, r.titre);
})();

/* S10 (obligatoire) : garde-fou pierres teste isolement. */
(function () {
  const t = bac.appliquerGardeFous('Citrine Boule 3cm', 'Amethyste boule 3cm');
  egal('S10 garde-fou pierres : retour au titre vendeuse', t, 'Amethyste boule 3cm');
})();

/* S11 (obligatoire) : filet dimensions, re-apposition et absence de doublon. */
(function () {
  egal('S11a filet : dimension disparue remise en fin de titre',
    bac.appliquerGardeFous('Amethyste Boule', 'Amethyste boule 3cm'), 'Amethyste Boule 3cm');
  egal('S11b filet : pas de doublon apres harmonisation 3 cm -> 3cm',
    bac.appliquerGardeFous('Sodalite Donut 3cm', 'Sodalite donut 3 cm'), 'Sodalite Donut 3cm');
})();

/* S12 : consigne Mistral, etiquettes de gammes sans jamais citer un titre entier. */
(function () {
  const c1 = bac.construireConsigne('', '', RAYON_MIXTE);
  vrai('S12a titre vide : la ligne des types du rayon est presente',
    c1.indexOf('Types d objet deja en vente dans ce rayon : Donut, Boule.') !== -1);
  vrai('S12b aucun titre d exemple n est transmis a l IA',
    c1.indexOf('Amethyste Donut 3cm') === -1 && c1.indexOf('Quartz rose Boule 5 cm') === -1);
  const c2 = bac.construireConsigne('Sodalite donut 3cm', '', RAYON_MIXTE);
  vrai('S12c type deja tape par la vendeuse : pas de ligne des types',
    c2.indexOf('Types d objet deja en vente') === -1);
  vrai('S12d le mot JSON figure dans la consigne', c1.indexOf('JSON') !== -1);
})();

/* S13 : titre vide, rayon mixte, l IA classifie Boule -> format de la gamme boule. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '', description: 'Une boule apaisante.' }),
    '', '', RAYON_MIXTE);
  egal('S13a titre vide : type IA au format de la gamme boule', r.titre, 'Amethyste Boule');
  vrai('S13b jamais Donut sur une boule', r.titre.toLowerCase().indexOf('donut') === -1, r.titre);
})();

/* S14 : reponse IA sans JSON -> titre reconstruit et harmonise depuis la saisie. */
(function () {
  const r = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Sodalite donut 3 cm', '', RAYON_DONUTS);
  egal('S14 JSON casse : titre reconstruit depuis la saisie, harmonise', r.titre, 'Sodalite Donut 3cm');
})();

/* S15 : reponse IA sans JSON et aucune saisie -> le texte part en description. */
(function () {
  const r = bac.construireReponse('je ne comprends pas cette image', '', '', []);
  egal('S15a repli ultime : titre vide', r.titre, '');
  egal('S15b repli ultime : texte brut en description', r.description, 'je ne comprends pas cette image');
})();

/* S16 : retro-compatibilite, ancien format {titre, description} decompose. */
(function () {
  const r = bac.construireReponse(
    '{"titre":"Citrine Donut 3cm","description":"Belle piece."}',
    'Citrine donut 3cm', '', RAYON_DONUTS);
  egal('S16a ancien format : titre decompose puis reassemble', r.titre, 'Citrine Donut 3cm');
  egal('S16b ancien format : description conservee', r.description, 'Belle piece.');
})();

/* S17 : dimension proposee par l IA mais absente des donnees -> jamais inventee. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '4 cm', description: 'd' }),
    'Amethyste boule', '', []);
  egal('S17 aucune dimension inventee', r.titre, 'Amethyste Boule');
})();

/* S18 : dimension presente dans la description -> reprise dans le titre. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '3 cm', description: 'Boule de 3 cm.' }),
    'Amethyste boule', 'Boule d environ 3 cm de diametre.', []);
  egal('S18 dimension de la description reprise', r.titre, 'Amethyste Boule 3 cm');
})();

/* S19 : formaterDimension ne casse jamais la valeur ni l unite. */
(function () {
  egal('S19a 3cm -> 3 cm (espace)', bac.formaterDimension('3cm', 'espace'), '3 cm');
  egal('S19b 3 cm -> 3cm (compact)', bac.formaterDimension('3 cm', 'compact'), '3cm');
  egal('S19c 250g -> 250 g', bac.formaterDimension('250g', 'espace'), '250 g');
  egal('S19d 2kg -> 2 kg', bac.formaterDimension('2kg', 'espace'), '2 kg');
  egal('S19e 10x5cm -> 10x5 cm', bac.formaterDimension('10x5cm', 'espace'), '10x5 cm');
  egal('S19f 3,5cm -> 3,5 cm', bac.formaterDimension('3,5cm', 'espace'), '3,5 cm');
})();

/* S20 : contientMot respecte les frontieres de mots et les pluriels. */
(function () {
  vrai('S20a lot ne matche pas charlotte', bac.contientMot('charlotte aux fraises', 'lot') === false);
  vrai('S20b lot matche Lot de pierres', bac.contientMot('Lot de pierres', 'lot') === true);
  vrai('S20c boule ne matche pas bouleau', bac.contientMot('bouleau majestueux', 'boule') === false);
  vrai('S20d boule matche Boules (pluriel)', bac.contientMot('Boules de massage', 'boule') === true);
})();

/* S21 : verrou anti-hybride, le produit IA ne garde aucun type d une autre gamme. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste boule', type: 'Donut', dimension: '', description: 'd' }),
    '', '', RAYON_MIXTE);
  egal('S21 anti-hybride : jamais Amethyste boule + Donut', r.titre, 'Amethyste Donut');
})();

/* S22 : la vendeuse n a tape que le type et la dimension -> produit de l IA. */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '3cm', description: 'd' }),
    'Boule 3cm', '', []);
  egal('S22 titre reduit au type : produit fourni par l IA', r.titre, 'Amethyste Boule 3 cm');
})();

/* S23 : la consigne construite est en ASCII pur (fichier colle a la main). */
(function () {
  const c = bac.construireConsigne('', '', RAYON_MIXTE);
  let horsAscii = -1;
  for (let i = 0; i < c.length; i++) {
    if (c.charCodeAt(i) > 127) { horsAscii = i; break; }
  }
  vrai('S23 consigne 100 pour cent ASCII', horsAscii === -1,
    horsAscii === -1 ? '' : 'caractere hors ASCII en position ' + horsAscii + ' : ' + c.slice(horsAscii - 20, horsAscii + 5));
})();

/* S24 : un mot partage avec le rayon (sauge) ne scinde JAMAIS la phrase de la
   vendeuse : pas de promotion d un mot du MILIEU du titre (test de bordure). */
(function () {
  const r1 = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Encens sauge blanche', '', ['Sauge blanche 50 g', 'Palo santo 3 batons']);
  egal('S24a Encens sauge blanche jamais scinde par sauge', r1.titre, 'Encens sauge blanche');
  const r2 = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Bougie sauge et lavande', '', ['Sauge blanche 50 g']);
  egal('S24b Bougie sauge et lavande jamais scinde', r2.titre, 'Bougie sauge et lavande');
})();

/* S25 : un mot decoratif partage (arbre) ne bat jamais un vrai mot de type
   (Pendentif, liste de secours) tape par la vendeuse. */
(function () {
  const r = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Pendentif arbre de vie amethyste', '', ['Collier arbre de vie', 'Bracelet perles citrine']);
  egal('S25 Pendentif prefere au mot decoratif arbre, ordre conserve', r.titre, 'Pendentif arbre de vie amethyste');
})();

/* S26 : residu non contigu jamais produit (Coffret chakras sept interdit). */
(function () {
  const r = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Coffret sept chakras', '', ['Bracelet sept chakras', 'Collier sept chakras']);
  egal('S26 Coffret sept chakras : ordre des mots conserve', r.titre, 'Coffret sept chakras');
})();

/* S27 : veto sur la priorite 3 : le type IA du rayon n est jamais accole a un
   titre vendeuse portant un type inconnu (chevaliere). */
(function () {
  const r1 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Donut', dimension: '', description: 'd' }),
    'Amethyste chevaliere 3cm', '', RAYON_DONUTS);
  egal('S27a chevaliere : titre vendeuse intact, jamais Donut', r1.titre, 'Amethyste chevaliere 3cm');
  const r2 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Anneau', dimension: '', description: 'd' }),
    'Amethyste chevaliere 3cm', '', RAYON_DONUTS);
  vrai('S27b idem avec le synonyme Anneau', r2.titre === 'Amethyste chevaliere 3cm' &&
    r2.titre.toLowerCase().indexOf('anneau') === -1, r2.titre);
})();

/* S28 : flux photo seule (titre vide), produits sans forme jamais amputes. */
(function () {
  const r1 = bac.construireReponse(
    ia({ produit: 'Statuette bouddha', type: '', dimension: '', description: 'd' }),
    '', '', ['Statuette bouddha jade']);
  egal('S28a Statuette bouddha entier (titre vide)', r1.titre, 'Statuette bouddha');
  const r2 = bac.construireReponse(
    ia({ produit: 'Encens lavande', type: '', dimension: '', description: 'd' }),
    '', '', ['Encens sauge blanche', 'Encens bois de santal']);
  egal('S28b Encens lavande entier (titre vide)', r2.titre, 'Encens lavande');
  const r3 = bac.construireReponse(
    ia({ produit: 'Lot de 5 pierres roulees', type: '', dimension: '', description: 'd' }),
    '', '', []);
  egal('S28c Lot de 5 pierres roulees entier', r3.titre, 'Lot de 5 pierres roulees');
  const r4 = bac.construireReponse(
    ia({ produit: 'Coeur en quartz rose', type: '', dimension: '', description: 'd' }),
    '', '', []);
  egal('S28d Coeur en quartz rose entier', r4.titre, 'Coeur en quartz rose');
})();

/* S29 : une dimension IA n est validee que par egalite stricte : 5 cm n est
   jamais accepte au motif que 15 cm le contient. */
(function () {
  const r1 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '5 cm', description: 'd' }),
    'Amethyste boule', 'Belle boule de 15 cm de diametre.', []);
  egal('S29a 5 cm rejete (seul 15 cm existe)', r1.titre, 'Amethyste Boule');
  const r2 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '3 cm', description: 'd' }),
    'Amethyste boule', 'Piece de 13 cm environ.', []);
  egal('S29b 3 cm rejete (seul 13 cm existe)', r2.titre, 'Amethyste Boule');
})();

/* S30 : etiquettes filtrees (mots de produit ecartes) et consigne sans
   contradiction entre le bloc des types et l exception sans forme. */
(function () {
  const RAYON_ENCENS = ['Encens sauge blanche', 'Encens bois de santal', 'Encens lavande'];
  egal('S30a rayon encens : etiquette unique Encens',
    bac.etiquettesGammes(RAYON_ENCENS), ['Encens']);
  egal('S30b rayon statuettes : etiquette unique Statuette',
    bac.etiquettesGammes(['Statuette bouddha', 'Statuette elephant']), ['Statuette']);
  const c = bac.construireConsigne('', '', RAYON_ENCENS);
  vrai('S30c la ligne des types ne cite que Encens',
    c.indexOf('Types d objet deja en vente dans ce rayon : Encens.') !== -1);
  vrai('S30d pas de contradiction : l exception (encens, lot, statuette, decoration) est retiree',
    c.indexOf('(encens, lot, statuette, decoration)') === -1);
  let horsAscii = -1;
  for (let i = 0; i < c.length; i++) {
    if (c.charCodeAt(i) > 127) { horsAscii = i; break; }
  }
  vrai('S30e consigne encens 100 pour cent ASCII', horsAscii === -1);
})();

/* S31 : un mot de produit partage (perles) ne bat jamais le mot de type
   Collier tape en tete par la vendeuse. */
(function () {
  const r = bac.construireReponse(
    'desole, je ne peux pas repondre',
    'Collier perles quartz rose', '', ['Bracelet perles amethyste']);
  egal('S31 Collier perles quartz rose : ordre et gamme collier', r.titre, 'Collier perles quartz rose');
})();

/* S32 : gamme nouvelle, l ordre des mots du titre saisi est conserve (seuls
   la majuscule du type et le style de la dimension sont harmonises). */
(function () {
  const r1 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '3cm', description: 'd' }),
    'Boule amethyste sur support 3cm', '', []);
  egal('S32a gamme nouvelle : ordre saisi conserve, dimension 3 cm', r1.titre, 'Boule amethyste sur support 3 cm');
  const r2 = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Pendentif', dimension: '2cm', description: 'd' }),
    'Pendentif amethyste 2cm cordon 45cm', '', []);
  egal('S32b gamme nouvelle : cordon 45cm reste a sa place', r2.titre, 'Pendentif amethyste 2 cm cordon 45cm');
})();

/* S33 : titre avec mot de type inconnu (chevaliere) : la consigne ne pousse
   pas le modele vers les types du rayon. */
(function () {
  const c = bac.construireConsigne('Amethyste chevaliere 3cm', '', RAYON_DONUTS);
  vrai('S33 pas de ligne des types quand la vendeuse a tape un type inconnu',
    c.indexOf('Types d objet deja en vente') === -1);
})();

/* S34 : controle positif du veto : titre reduit a la pierre seule, le type IA
   reste utilise (comportement legitime conserve). */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Amethyste', type: 'Boule', dimension: '', description: 'd' }),
    'amethyste', '', ['Quartz rose Boule 5 cm']);
  egal('S34 pierre seule : le type IA complete le titre', r.titre, 'Amethyste Boule');
})();

/* S35 : le titre final commence toujours par une majuscule, meme quand la
   vendeuse a tape en minuscules une pierre nue sans gamme a copier
   (cas reel "shungite 3cm" du rayon Pendentifs). */
(function () {
  const r = bac.construireReponse(
    ia({ produit: 'Shungite', type: '', dimension: '3cm', description: 'd' }),
    'shungite 3cm', '', []);
  egal('S35 titre pierre nue en minuscules : capitale initiale', r.titre, 'Shungite 3cm');
})();

console.log('');
console.log(rates === 0
  ? 'TOUS LES TESTS PASSENT (' + total + ' verifications)'
  : rates + ' echec(s) sur ' + total + ' verifications');
process.exit(rates === 0 ? 0 : 1);
