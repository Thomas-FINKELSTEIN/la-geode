/* Relais IA "La Geode" : genere le titre et la description d un article a
   partir de sa photo. A coller dans un Worker Cloudflare (ou a deployer
   automatiquement depuis GitHub, voir wrangler.jsonc).

   Reglages du Worker (Settings > Variables and Secrets / Bindings) :
     - secret GEMINI_API_KEY : cle gratuite Google AI Studio (fournisseur principal)
     - liaison Workers AI nommee AI : secours heberge par Cloudflare, sans cle (facultatif)
     - secret MISTRAL_API_KEY : dernier recours, si le compte Mistral a du credit (facultatif)
   Ce fichier ne contient AUCUN secret : il peut rester public dans le depot.
   Il est ecrit en ASCII pur (accents en \uXXXX) pour supporter le copier-coller. */

const ORIGINES_AUTORISEES = [
  'https://lageode66.fr',
  'https://www.lageode66.fr',
  'https://thomas-finkelstein.github.io',
  'http://localhost:8000',
];

/* Modeles vision essayes dans l ordre : si Mistral retire ou rend payant un
   modele (erreur 401/403/404/422 ou 429), on passe au suivant au lieu de planter.
   Variable optionnelle MISTRAL_MODELE (Cloudflare) pour en imposer un en tete. */
const MODELES = ['mistral-small-latest', 'pixtral-12b-latest', 'pixtral-12b-2409', 'mistral-medium-latest', 'pixtral-large-latest'];

function entetesCors(origin) {
  var ok = ORIGINES_AUTORISEES.indexOf(origin) !== -1 ? origin : ORIGINES_AUTORISEES[0];
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/* Aplati n'importe quelle reponse (texte, tableau, objet imbrique) en texte simple,
   pour ne jamais afficher "[object Object]" dans l'admin. */
function versTexte(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(versTexte).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    return Object.keys(v).map(function (k) { return versTexte(v[k]); }).filter(Boolean).join(' ');
  }
  return String(v);
}

/* Nettoie le texte de l IA : pas de caracteres speciaux ni de mise en forme
   (etoiles, tirets doubles, dieses, puces...), juste des phrases francaises. */
function nettoyer(t) {
  return t
    .replace(/[*_`#>]+/g, '')                          // gras, italique, markdown
    .replace(/\s*(?:--+|[\u2013\u2014])\s*/g, ', ')    // -- et tirets longs -> virgule (echappements \uXXXX : fichier colle a la main)
    .replace(/^\s*[-\u2022]\s+/gm, '')            // puces en debut de ligne
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .trim();
}

/* Pierres connues de la boutique : garde-fou pour que l IA ne remplace jamais
   la pierre nommee par la vendeuse par une autre (confusions frequentes). */
const PIERRES = ['amethyste', 'agate', 'aventurine', 'citrine', 'quartz rose', 'quartz fume',
  'cristal de roche', 'labradorite', 'lapis lazuli', 'malachite', 'obsidienne', 'oeil de tigre',
  'oeil de faucon', 'oeil de taureau', 'hematite', 'jaspe', 'onyx', 'opale', 'pyrite', 'selenite',
  'shungite', 'sodalite', 'tourmaline', 'turquoise', 'fluorite', 'calcite', 'celestine',
  'cornaline', 'grenat', 'howlite', 'jade', 'kunzite', 'larimar', 'moldavite', 'morganite',
  'peridot', 'pierre de lune', 'pierre de soleil', 'prehnite', 'rhodochrosite', 'rhodonite',
  'serpentine', 'topaze', 'unakite', 'amazonite', 'angelite', 'apatite', 'aigue marine',
  'azurite', 'bronzite', 'charoite', 'chrysocolle', 'chrysoprase', 'dumortierite', 'epidote',
  'iolite', 'kyanite', 'lepidolite', 'magnesite', 'mokaite', 'pietersite', 'septaria',
  'seraphinite', 'sugilite', 'tanzanite', 'emeraude', 'rubis', 'saphir', 'ambre', 'nacre'];

function normalise(t) {
  return String(t || '').toLowerCase().replace(/\u0153/g, 'oe')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

function pierresDans(texte) {
  const n = normalise(texte);
  return PIERRES.filter(function (p) { return n.indexOf(normalise(p)) !== -1; });
}

/* Motif de dimension : source unique de verite, partagee par le filet de
   securite et toute la logique de titres (3cm, 3 cm, 10x5cm, 250g, 2kg...). */
const DIM_MOTIF_SRC = '\\d+(?:[.,]\\d+)?(?:\\s*x\\s*\\d+(?:[.,]\\d+)?)*\\s*(?:cm|mm|m|g|kg|ct|carats?|pouces?)\\b';

/* Familles de synonymes de types d objet : liste de SECOURS uniquement, le
   mecanisme principal derive les types des articles deja en rayon. Un type
   inconnu de cette liste reste parfaitement utilisable tel quel. */
const TYPES_SECOURS = [
  ['donut', 'anneau'], ['boule', 'sphere'], ['pyramide'], ['pendentif'],
  ['bracelet'], ['collier'], ['coeur'], ['galet'], ['pointe', 'obelisque'],
  ['druse', 'geode'], ['pierre roulee'], ['statuette', 'statue', 'figurine'], ['lot']
];

/* Mots jamais candidats au role de type : connecteurs, qualificatifs, couleurs. */
const MOTS_IGNORES = ['de', 'du', 'des', 'le', 'la', 'les', 'l', 'un', 'une', 'en', 'et',
  'a', 'au', 'aux', 'pour', 'avec', 'sur', 'sans', 'tres', 'pierre', 'pierres',
  'naturel', 'naturelle', 'naturels', 'naturelles', 'veritable', 'petit', 'petite',
  'grand', 'grande', 'joli', 'jolie', 'beau', 'belle', 'brut', 'brute', 'poli', 'polie',
  'rose', 'roses', 'violet', 'violette', 'bleu', 'bleue', 'vert', 'verte', 'rouge',
  'noir', 'noire', 'blanc', 'blanche', 'jaune', 'orange', 'gris', 'grise', 'dore', 'doree', 'modele'];

/* Sous-liste des connecteurs (test de titre indecomposable dans choisirProduit). */
const CONNECTEURS = ['de', 'du', 'des', 'le', 'la', 'les', 'l', 'un', 'une', 'en', 'et', 'a', 'au', 'aux', 'pour', 'avec', 'sur', 'sans', 'd'];

/* Toutes les dimensions presentes dans un texte (new RegExp a chaque appel :
   evite le piege du lastIndex avec le flag g). */
function dimensionsDans(texte) {
  return String(texte || '').match(new RegExp(DIM_MOTIF_SRC, 'gi')) || [];
}

/* Comme normalise() mais PRESERVE les frontieres de mots (normalise() reste
   utilisee par pierresDans, elle n est pas touchee). */
function normaliseMots(t) {
  return String(t || '').toLowerCase().replace(/[\u0152\u0153]/g, 'oe')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Forme compacte d un texte : minuscules, sans aucun espace (comparaisons
   de dimensions et de titres insensibles au style 3 cm / 3cm). */
function compacte(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, '');
}

/* Racine grossiere d un mot : supprime un s ou x final pour rapprocher
   Boule/Boules, Donut/Donuts. */
function racine(m) {
  return m.length > 3 ? m.replace(/[sx]$/, '') : m;
}

/* Sequence de jetons normalises et racinises : la monnaie de comparaison
   de tout le matching. */
function jetonsCles(t) {
  return normaliseMots(t).split(' ').filter(Boolean).map(racine);
}

/* Vrai si la sequence de jetons de mot apparait comme jetons CONSECUTIFS de
   texte. Comparaison de tableaux, jamais d indexOf de chaine : lot ne matche
   pas charlotte, boule ne matche pas bouleau. */
function contientMot(texte, mot) {
  const cible = jetonsCles(mot);
  if (!cible.length) return false;
  const toks = jetonsCles(texte);
  for (let i = 0; i + cible.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < cible.length; j++) {
      if (toks[i + j] !== cible[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/* Decoupe le texte ORIGINAL en mots avec leurs positions (graphie conservee). */
function jetons(texteOriginal) {
  const texte = String(texteOriginal || '');
  const motif = /[A-Za-z0-9\u00C0-\u00FF\u0152\u0153]+/g;
  const liste = [];
  let m = motif.exec(texte);
  while (m !== null) {
    liste.push({ mot: m[0], debut: m.index, fin: m.index + m[0].length });
    m = motif.exec(texte);
  }
  return liste;
}

/* Retrouve dans le texte original la tranche correspondant a mot (accents et
   casse d origine), ou chaine vide si absente. */
function trouveMot(texteOriginal, mot) {
  const texte = String(texteOriginal || '');
  const cible = jetonsCles(mot);
  if (!cible.length) return '';
  const toks = jetons(texte);
  for (let i = 0; i + cible.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < cible.length; j++) {
      if (racine(normaliseMots(toks[i + j].mot)) !== cible[j]) { ok = false; break; }
    }
    if (ok) return texte.slice(toks[i].debut, toks[i + cible.length - 1].fin);
  }
  return '';
}

/* Retire une occurrence de mot du texte original, espaces compactes. */
function retireMot(texteOriginal, mot) {
  const texte = String(texteOriginal || '');
  const tranche = trouveMot(texte, mot);
  if (!tranche) return texte;
  const pos = texte.indexOf(tranche);
  const t = texte.slice(0, pos) + ' ' + texte.slice(pos + tranche.length);
  return t.replace(/\s+/g, ' ').trim();
}

/* Retire toutes les dimensions d un texte (premiere occurrence de chacune). */
function retireDimensions(texte) {
  let t = String(texte || '');
  const dims = dimensionsDans(t);
  for (let i = 0; i < dims.length; i++) {
    const pos = t.indexOf(dims[i]);
    if (pos !== -1) t = t.slice(0, pos) + ' ' + t.slice(pos + dims[i].length);
  }
  return t.replace(/\s+/g, ' ').trim();
}

/* Famille de synonymes d une cle de type : la famille entiere si la cle est
   dans TYPES_SECOURS, sinon la cle seule. */
function familleDe(cle) {
  const cleNorm = jetonsCles(cle).join(' ');
  for (let i = 0; i < TYPES_SECOURS.length; i++) {
    for (let j = 0; j < TYPES_SECOURS[i].length; j++) {
      if (jetonsCles(TYPES_SECOURS[i][j]).join(' ') === cleNorm) return TYPES_SECOURS[i];
    }
  }
  return [cle];
}

/* Vrai si la cle correspond a un membre de TYPES_SECOURS. */
function estTypeSecours(cle) {
  return TYPES_SECOURS.indexOf(familleDe(cle)) !== -1;
}

/* Jetons appartenant aux pierres detectees dans un titre : ces mots ne sont
   jamais candidats au role de type (parole de la vendeuse). */
function pierresJetons(titre) {
  const resultat = [];
  const pierres = pierresDans(titre);
  for (let i = 0; i < pierres.length; i++) {
    const cles = jetonsCles(pierres[i]);
    for (let j = 0; j < cles.length; j++) {
      if (resultat.indexOf(cles[j]) === -1) resultat.push(cles[j]);
    }
  }
  return resultat;
}

/* Mots de type d un titre : tout ce qui n est ni pierre connue, ni chiffre,
   ni mot ignore. Sert aux etiquettes du prompt et au verrou anti-hybride. */
function motsTypeDe(titre) {
  let t = ' ' + normaliseMots(titre) + ' ';
  const pierresNorm = PIERRES.map(function (p) { return normaliseMots(p); })
    .sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < pierresNorm.length; i++) {
    const p = ' ' + pierresNorm[i] + ' ';
    while (t.indexOf(p) !== -1) t = t.split(p).join(' ');
  }
  const mots = t.split(' ').filter(Boolean);
  const resultat = [];
  const vues = [];
  for (let i = 0; i < mots.length; i++) {
    const m = mots[i];
    if (/[0-9]/.test(m)) continue;
    const r = racine(m);
    if (r.length < 3) continue;
    if (MOTS_IGNORES.indexOf(m) !== -1 || MOTS_IGNORES.indexOf(r) !== -1) continue;
    if (vues.indexOf(r) !== -1) continue;
    vues.push(r);
    resultat.push({ cle: r, mot: trouveMot(titre, m) || m });
  }
  return resultat;
}

/* Cles de type PLAUSIBLES d un rayon : un mot n est retenu que s il figure
   dans la liste de secours OU revient dans au moins DEUX articles distincts.
   Ecarte les mots de produit isoles (sauge, bouddha, lavande...) qui ne sont
   pas des types d objet. Renvoie [{cle, mot}] avec la graphie d origine. */
function clesTypesPlausibles(exemples) {
  const entrees = [];
  for (let i = 0; i < exemples.length; i++) {
    const mots = motsTypeDe(exemples[i]);
    const vusIci = [];
    for (let j = 0; j < mots.length; j++) {
      if (vusIci.indexOf(mots[j].cle) !== -1) continue;
      vusIci.push(mots[j].cle);
      let entree = null;
      for (let k = 0; k < entrees.length; k++) {
        if (entrees[k].cle === mots[j].cle) { entree = entrees[k]; break; }
      }
      if (entree) entree.nb = entree.nb + 1;
      else entrees.push({ cle: mots[j].cle, mot: mots[j].mot, nb: 1 });
    }
  }
  const resultat = [];
  for (let i = 0; i < entrees.length; i++) {
    if (entrees[i].nb >= 2 || estTypeSecours(entrees[i].cle)) {
      resultat.push({ cle: entrees[i].cle, mot: entrees[i].mot });
    }
  }
  return resultat;
}

/* Etiquettes de types du rayon pour le prompt : cles plausibles uniquement
   (jamais un mot de produit comme sauge), graphies d origine, plafonnees a 8
   (anti-derive du modele 12B). */
function etiquettesGammes(exemples) {
  const plausibles = clesTypesPlausibles(exemples);
  const resultat = [];
  for (let i = 0; i < plausibles.length && resultat.length < 8; i++) {
    resultat.push(plausibles[i].mot);
  }
  return resultat;
}

/* Choisit le type d objet. Un mot du titre saisi n est promu type que s il
   est connu du rayon, de la liste de secours ou confirme par l IA, ET que
   son retrait ne scinde pas la phrase de la vendeuse (test de bordure).
   A defaut seulement, classification IA seule. */
function choisirType(titreActuel, typeIA, exemples) {
  const toks = jetons(titreActuel);
  const interdits = pierresJetons(titreActuel);

  /* Mot qui bloque la bordure : tout mot plein (ni connecteur, ni nombre,
     ni pierre du titre). Les couleurs et qualificatifs bloquent aussi :
     blanche empeche de promouvoir sauge dans Encens sauge blanche. */
  function bloquant(mot) {
    const n = normaliseMots(mot);
    if (!n || /^[0-9]+$/.test(n)) return false;
    const r = racine(n);
    if (CONNECTEURS.indexOf(n) !== -1 || CONNECTEURS.indexOf(r) !== -1) return false;
    if (interdits.indexOf(r) !== -1) return false;
    return true;
  }

  /* Test de bordure : un candidat n est acceptable que s il est en TETE ou
     en QUEUE de la sequence de mots du titre saisi, dimensions retirees
     (aucun mot bloquant a la fois avant ET apres lui). Retirer un mot du
     MILIEU scinderait la phrase (Encens sauge blanche, Pendentif arbre de
     vie amethyste ne sont jamais decoupes). */
  function enBordure(label) {
    const seq = jetons(retireDimensions(titreActuel));
    const cible = jetonsCles(label);
    if (!cible.length) return true;
    for (let i = 0; i + cible.length <= seq.length; i++) {
      let trouve = true;
      for (let j = 0; j < cible.length; j++) {
        if (racine(normaliseMots(seq[i + j].mot)) !== cible[j]) { trouve = false; break; }
      }
      if (!trouve) continue;
      let avant = false;
      for (let k = 0; k < i && !avant; k++) { if (bloquant(seq[k].mot)) avant = true; }
      let apres = false;
      for (let k = i + cible.length; k < seq.length && !apres; k++) { if (bloquant(seq[k].mot)) apres = true; }
      if (!avant || !apres) return true;
    }
    return false;
  }

  /* Test de residu : un candidat est rejete si, une fois le type et les
     dimensions retires, il ne reste que des mots creux (evite de promouvoir
     sauge dans Sauge blanche). Les mots de pierres comptent comme pleins. */
  function residuOk(label) {
    let residu = retireDimensions(titreActuel);
    residu = retireMot(residu, label);
    const mots = normaliseMots(residu).split(' ').filter(Boolean);
    if (!mots.length) return true;
    for (let i = 0; i < mots.length; i++) {
      const m = mots[i];
      if (/[0-9]/.test(m)) continue;
      const r = racine(m);
      if (interdits.indexOf(r) !== -1) return true;
      if (MOTS_IGNORES.indexOf(m) === -1 && MOTS_IGNORES.indexOf(r) === -1) return true;
    }
    return false;
  }

  /* Candidats de gauche a droite, bigrammes avant unigrammes. */
  const candidats = [];
  for (let i = 0; i < toks.length; i++) {
    if (i + 1 < toks.length) {
      const tranche = String(titreActuel).slice(toks[i].debut, toks[i + 1].fin);
      const cles2 = jetonsCles(tranche);
      let ok = estTypeSecours(tranche);
      for (let j = 0; ok && j < cles2.length; j++) {
        if (/[0-9]/.test(cles2[j]) || interdits.indexOf(cles2[j]) !== -1) ok = false;
      }
      if (ok) candidats.push(tranche);
    }
    const norm = normaliseMots(toks[i].mot);
    const rac = racine(norm);
    if (!/[0-9]/.test(norm) && rac.length >= 3 && interdits.indexOf(rac) === -1 &&
        MOTS_IGNORES.indexOf(norm) === -1 && MOTS_IGNORES.indexOf(rac) === -1) {
      candidats.push(toks[i].mot);
    }
  }

  /* Balayage unique gauche-droite : un candidat est eligible s il est connu
     du rayon (mecanisme principal, derive des donnees) OU de la liste de
     secours OU egal a la classification IA, avec residu plein et bordure.
     Parmi les eligibles, un candidat aussi PLAUSIBLE comme type (liste de
     secours ou IA) passe avant un simple mot partage avec le rayon :
     Collier gagne sur perles, Pendentif gagne sur arbre. */
  const eligibles = [];
  for (let i = 0; i < candidats.length; i++) {
    const c = candidats[i];
    let auRayon = false;
    for (let j = 0; j < exemples.length && !auRayon; j++) {
      if (contientMot(exemples[j], c)) auRayon = true;
    }
    const memeQueIA = typeIA && jetonsCles(c).join(' ') === jetonsCles(typeIA).join(' ');
    const plausible = estTypeSecours(c) || memeQueIA;
    if ((auRayon || plausible) && residuOk(c) && enBordure(c)) {
      eligibles.push({ label: c, plausible: plausible });
    }
  }
  for (let i = 0; i < eligibles.length; i++) {
    if (eligibles[i].plausible) {
      return { label: eligibles[i].label, cle: jetonsCles(eligibles[i].label).join(' '), origine: 'vendeuse' };
    }
  }
  if (eligibles.length) {
    return { label: eligibles[0].label, cle: jetonsCles(eligibles[0].label).join(' '), origine: 'vendeuse' };
  }
  /* Dernier recours : classification IA seule (le veto de construireReponse
     l ecarte si elle devait s accoler aux mots de la vendeuse). */
  const tIA = String(typeIA || '').trim();
  if (tIA) return { label: tIA, cle: jetonsCles(tIA).join(' '), origine: 'ia' };
  return { label: '', cle: '', origine: '' };
}

/* Choisit le champ produit : vocabulaire de la vendeuse d abord, IA sinon.
   typeValide passe a false quand le titre saisi est indecomposable.
   origine dit d ou viennent les mots du produit (vendeuse ou ia). */
function choisirProduit(titreActuel, produitIA, type, exemples) {
  /* Nettoie le produit propose par l IA : dimensions, type choisi, et verrou
     anti-hybride (aucun mot de type d une AUTRE gamme ne doit rester, pour
     ne jamais produire Amethyste boule + Donut). La purge anti-hybride ne
     tourne que si un type a ete choisi : sans type, pas d hybride possible,
     et les produits sans forme (Encens lavande, Statuette bouddha, Lot de 5
     pierres roulees) restent entiers. */
  function nettoieIA(p) {
    let t = String(p || '');
    const dims = dimensionsDans(t);
    for (let i = 0; i < dims.length; i++) {
      const pos = t.indexOf(dims[i]);
      if (pos !== -1) t = t.slice(0, pos) + ' ' + t.slice(pos + dims[i].length);
    }
    if (type.label) t = retireMot(t, type.label);
    t = t.replace(/\s+/g, ' ').trim();
    if (type.cle) {
      const avantPurge = t;
      const cles = [];
      const plausibles = clesTypesPlausibles(exemples);
      for (let i = 0; i < plausibles.length; i++) {
        if (cles.indexOf(plausibles[i].cle) === -1) cles.push(plausibles[i].cle);
      }
      for (let i = 0; i < TYPES_SECOURS.length; i++) {
        for (let j = 0; j < TYPES_SECOURS[i].length; j++) {
          const c = jetonsCles(TYPES_SECOURS[i][j]).join(' ');
          if (cles.indexOf(c) === -1) cles.push(c);
        }
      }
      for (let i = 0; i < cles.length; i++) {
        if (cles[i] !== type.cle && contientMot(t, cles[i])) t = retireMot(t, cles[i]);
      }
      t = t.replace(/\s+/g, ' ').trim();
      /* Filet : la purge ne vide jamais un produit qui ne l etait pas. */
      if (!t) t = avantPurge;
    }
    return t;
  }

  if (!titreActuel) {
    return { produit: nettoieIA(produitIA), typeValide: true, origine: 'ia' };
  }

  let candidat = retireDimensions(titreActuel);
  if (type.label) candidat = retireMot(candidat, type.label);
  candidat = candidat.replace(/\s+/g, ' ').trim();

  if (candidat) {
    /* Test d orphelin : si le reste commence ou finit par un connecteur, ou
       devient trop court, le titre saisi est indecomposable et reste entier
       (Lot de 5 pierres roulees ne devient jamais de 5 pierres roulees). */
    const mots = normaliseMots(candidat).split(' ').filter(Boolean);
    const premier = mots[0] || '';
    const dernier = mots[mots.length - 1] || '';
    const compact = normaliseMots(candidat).replace(/ /g, '');
    if (CONNECTEURS.indexOf(premier) !== -1 || CONNECTEURS.indexOf(dernier) !== -1 || compact.length < 3) {
      return { produit: retireDimensions(titreActuel), typeValide: false, origine: 'vendeuse' };
    }
    if (normaliseMots(candidat) === normaliseMots(produitIA)) {
      return { produit: String(produitIA || '').trim(), typeValide: true, origine: 'vendeuse' };
    }
    return { produit: candidat, typeValide: true, origine: 'vendeuse' };
  }
  /* La vendeuse n a tape que le type et/ou la dimension : produit de l IA.
     Si l IA s est trompee de pierre, le garde-fou pierres en aval veille. */
  return { produit: nettoieIA(produitIA), typeValide: true, origine: 'ia' };
}

/* Choisit la dimension : celle du titre saisi d abord ; celle de l IA
   seulement si elle figure deja dans le titre ou la description (jamais
   d invention ; une dimension visible seulement sur la photo est ignoree). */
function choisirDimension(titreActuel, descActuelle, dimIA) {
  const dims = dimensionsDans(titreActuel);
  if (dims.length) return dims[0].trim();
  const d = String(dimIA || '').trim();
  if (!d) return '';
  if (!new RegExp('^' + DIM_MOTIF_SRC + '$', 'i').test(d)) return '';
  /* Egalite stricte contre les dimensions reellement presentes : 5 cm n est
     jamais accepte au motif que 15 cm contient la sous-chaine 5cm. */
  const reelles = dimensionsDans(String(titreActuel || '') + ' ' + String(descActuelle || ''));
  const compact = compacte(d);
  for (let i = 0; i < reelles.length; i++) {
    if (compacte(reelles[i]) === compact) return d;
  }
  return '';
}

/* Vote majoritaire, egalite tranchee par la premiere valeur vue. */
function voteMajoritaire(valeurs) {
  if (!valeurs.length) return null;
  const vues = [];
  const comptes = [];
  for (let i = 0; i < valeurs.length; i++) {
    const pos = vues.indexOf(valeurs[i]);
    if (pos === -1) { vues.push(valeurs[i]); comptes.push(1); }
    else { comptes[pos] = comptes[pos] + 1; }
  }
  let meilleur = 0;
  for (let i = 1; i < vues.length; i++) {
    if (comptes[i] > comptes[meilleur]) meilleur = i;
  }
  return vues[meilleur];
}

/* Format d une gamme : seuls les articles du rayon contenant le MEME type
   (ou un synonyme) contribuent ; les autres gammes sont ignorees, c est le
   coeur du correctif anti-Donut. Renvoie null si la gamme est nouvelle. */
function formatDeGamme(exemples, cle) {
  const famille = familleDe(cle);
  const retenus = [];
  for (let i = 0; i < exemples.length; i++) {
    for (let j = 0; j < famille.length; j++) {
      if (contientMot(exemples[i], famille[j])) {
        retenus.push({ e: exemples[i], typeEcrit: trouveMot(exemples[i], famille[j]) });
        break;
      }
    }
  }
  if (!retenus.length) return null;

  const votesEcrit = [];
  const votesAvant = [];
  const votesDim = [];
  for (let i = 0; i < retenus.length; i++) {
    const sansDim = retireDimensions(retenus[i].e);
    const clesSans = jetonsCles(sansDim);
    const clesType = jetonsCles(retenus[i].typeEcrit);
    let avant = clesType.length > 0 && clesSans.length >= clesType.length;
    for (let j = 0; avant && j < clesType.length; j++) {
      if (clesSans[j] !== clesType[j]) avant = false;
    }
    votesEcrit.push(retenus[i].typeEcrit);
    votesAvant.push(avant);
    const dims = dimensionsDans(retenus[i].e);
    if (dims.length) {
      votesDim.push(/\d\s+(?:cm|mm|m|g|kg|ct|carats?|pouces?)\s*$/i.test(dims[0]) ? 'espace' : 'compact');
    }
  }
  return {
    typeEcrit: voteMajoritaire(votesEcrit),
    typeAvant: voteMajoritaire(votesAvant),
    dimStyle: voteMajoritaire(votesDim),
  };
}

/* Reecrit une dimension au style de la gamme sans jamais changer sa valeur.
   Ordre de l alternance : unites longues avant g et m (sinon 3cm -> 3c m). */
function formaterDimension(dim, style) {
  const compact = String(dim).replace(/\s+/g, '');
  if (style === 'compact') return compact;
  return compact.replace(/([0-9])(cm|mm|kg|ct|carats?|pouces?|g|m)$/i, '$1 $2');
}

function majuscule(t) {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/* Convention unique de toute la boutique : une espace entre le nombre et l unite
   (3 cm, pas 3cm). Applique en dernier sur le titre assemble, tous chemins
   confondus, pour que tous les articles soient ecrits pareil. */
function normaliserDimensionsTitre(t) {
  return String(t || '')
    .replace(new RegExp(DIM_MOTIF_SRC, 'gi'), function (d) { return formaterDimension(d, 'espace'); })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* Assemble le titre par concatenation : l IA ne redige jamais le titre.
   Gamme existante : graphie, position et style de dimension de la gamme.
   Gamme nouvelle avec mots de la vendeuse : son ordre de mots est conserve,
   seuls la majuscule du type et le style de la dimension choisie (3 cm avec
   espace) sont harmonises. Gamme nouvelle sans titre saisi : format
   canonique sobre produit puis type, dimension avec espace (3 cm). */
function assemblerTitre(produit, type, dim, fmt, titreActuel, produitVendeuse) {
  const p = String(produit || '').trim();
  const saisie = String(titreActuel || '').trim();
  const depuisSaisie = produitVendeuse && saisie !== '';
  let t;
  if (!type.label) {
    if (depuisSaisie) {
      /* Aucun type retenu et mots de la vendeuse : titre saisi intact. */
      t = saisie;
      if (dim && compacte(t).indexOf(compacte(dim)) === -1) {
        t = t + ' ' + formaterDimension(dim, 'espace');
      }
    } else {
      t = p + (dim ? ' ' + formaterDimension(dim, 'espace') : '');
    }
  } else if (fmt) {
    const memeMot = jetonsCles(type.label).join(' ') === jetonsCles(fmt.typeEcrit).join(' ');
    const motType = (type.origine === 'vendeuse' && !memeMot) ? majuscule(type.label) : fmt.typeEcrit;
    const corps = fmt.typeAvant ? motType + ' ' + p : p + ' ' + motType;
    t = corps + (dim ? ' ' + formaterDimension(dim, fmt.dimStyle || 'espace') : '');
  } else if (type.origine === 'vendeuse' && depuisSaisie) {
    /* Gamme nouvelle, type et produit tapes par la vendeuse : ordre saisi. */
    t = saisie;
    const ecrit = trouveMot(t, type.label);
    if (ecrit) {
      const pos = t.indexOf(ecrit);
      t = t.slice(0, pos) + majuscule(ecrit) + t.slice(pos + ecrit.length);
    }
    if (dim) {
      const posDim = t.indexOf(dim);
      if (posDim !== -1) {
        t = t.slice(0, posDim) + formaterDimension(dim, 'espace') + t.slice(posDim + dim.length);
      } else if (compacte(t).indexOf(compacte(dim)) === -1) {
        t = t + ' ' + formaterDimension(dim, 'espace');
      }
    }
  } else {
    t = p + ' ' + majuscule(type.label) + (dim ? ' ' + formaterDimension(dim, 'espace') : '');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/* Construit la consigne envoyee a Mistral. Les titres des autres articles ne
   sont JAMAIS transmis a l IA : au plus des mots de type isoles (etiquettes),
   et uniquement quand la vendeuse n a pas deja tape un type. */
function construireConsigne(titreActuel, descActuelle, exemples) {
  /* Les etiquettes du rayon ne sont proposees que si la vendeuse n a tape ni
     type reconnu ni mot candidat au type (chevaliere...) : sinon le modele
     serait pousse a plaquer un type du rayon sur la parole de la vendeuse. */
  const typeProbe = choisirType(titreActuel, '', exemples);
  const etiquettes = (!typeProbe.label && !motsTypeDe(titreActuel).length && exemples.length)
    ? etiquettesGammes(exemples) : [];

  /* Texte en francais correct (accents, apostrophes), ecrit en echappements
     \uXXXX : le modele imite la langue de la consigne, donc une consigne sans
     accents donne des descriptions sans accents. */
  let consigne =
    "Tu pr\u00e9pares la fiche produit d'une boutique de min\u00e9raux, cristaux, bijoux en pierres naturelles, encens et d\u00e9coration (La G\u00e9ode le Showroom). " +
    "Regarde la photo et r\u00e9ponds UNIQUEMENT par un objet JSON exactement de cette forme : " +
    "{\"produit\":\"...\",\"type\":\"...\",\"dimension\":\"...\",\"description\":\"...\"}. " +
    "Champ produit : le nom de la pierre ou du produit, sans la forme et sans la taille (par exemple Am\u00e9thyste, Quartz rose, Encens sauge blanche, Statuette bouddha). " +
    "Champ type : la forme ou le type d'objet visible, en un ou deux mots (par exemple Boule, Pyramide, Pendentif, Bracelet). ";
  if (etiquettes.length) {
    consigne +=
      "Types d'objet d\u00e9j\u00e0 en vente dans ce rayon : " + etiquettes.join(', ') + '. ' +
      "Si l'objet de la photo est d'un de ces types, \u00e9cris exactement ce mot dans le champ type. " +
      "Sinon, si l'objet n'a pas de forme particuli\u00e8re, mets une cha\u00eene vide \"\". ";
  } else {
    consigne +=
      "Si le produit n'a pas de forme particuli\u00e8re (encens, lot, statuette, d\u00e9coration), mets une cha\u00eene vide \"\". ";
  }
  consigne +=
    "Champ dimension : la taille ou le poids d\u00e9j\u00e0 \u00e9crit dans le titre actuel ou la description actuelle de la fiche, recopi\u00e9 tel quel (par exemple 3 cm, 250 g). " +
    "Si aucune taille ni aucun poids n'est \u00e9crit, mets une cha\u00eene vide \"\". " +
    "N'invente JAMAIS de taille ni de poids. ";
  if (titreActuel) {
    consigne +=
      "Titre actuel de la fiche : " + titreActuel + '. ' +
      "Le nom de pierre ou de produit \u00e9crit dans ce titre vient de la vendeuse : c'est la r\u00e9f\u00e9rence exacte. " +
      "Recopie ce nom dans le champ produit, ne le remplace JAMAIS par un autre nom, m\u00eame si la photo ressemble \u00e0 autre chose. " +
      "La photo sert seulement \u00e0 voir la forme et les couleurs. ";
  }
  if (descActuelle) {
    consigne +=
      "Description actuelle de la fiche : " + descActuelle +
      " /// Am\u00e9liore cette description existante (garde ses informations justes) pour remplir le champ description : ";
  } else {
    consigne += "La fiche n'a pas encore de description, cr\u00e9e-la pour remplir le champ description : ";
  }
  consigne +=
    "3 phrases en langage naturel et simple (pas sophistiqu\u00e9), accrocheuses, qui pr\u00e9sentent le produit et les propri\u00e9t\u00e9s qui lui sont traditionnellement associ\u00e9es en lithoth\u00e9rapie (bien-\u00eatre, \u00e9nergie, \u00e9motions, usage courant). " +
    /* La trame des fiches deja en boutique, pour que toutes les descriptions se ressemblent. */
    "Suis toujours la m\u00eame trame que les autres fiches de la boutique, pour environ 350 \u00e0 420 caract\u00e8res au total : " +
    "la premi\u00e8re phrase commence par Ce, Cet, Cette ou Ces suivi du nom du produit et d\u00e9crit son aspect ; " +
    "la deuxi\u00e8me donne les propri\u00e9t\u00e9s qui lui sont traditionnellement associ\u00e9es ; " +
    "la troisi\u00e8me dit \u00e0 quoi ou \u00e0 qui il convient. " +
    "Voici deux fiches de la boutique, \u00e0 imiter pour la trame, le ton et la longueur, sans jamais recopier leur contenu : " +
    "\u00ab Cet \u0153uf de fluorite aux reflets verts et dor\u00e9s est une pierre naturelle aux multiples facettes. En lithoth\u00e9rapie, elle est souvent utilis\u00e9e pour stimuler la concentration, \u00e9quilibrer les \u00e9motions et favoriser la clart\u00e9 mentale. Son \u00e9nergie apaisante en fait un alli\u00e9 pr\u00e9cieux pour le bien-\u00eatre au quotidien. \u00bb " +
    "\u00ab Cette statuette bouddha noire incarne une \u00e9nergie apaisante et une pr\u00e9sence bienveillante dans votre espace. Traditionnellement associ\u00e9e \u00e0 la s\u00e9r\u00e9nit\u00e9 et \u00e0 l'\u00e9quilibre \u00e9motionnel, elle est souvent utilis\u00e9e pour favoriser la m\u00e9ditation et la connexion \u00e0 soi. Son allure douce et rassurante en fait un objet d\u00e9coratif id\u00e9al pour cultiver un environnement harmonieux et paisible. \u00bb " +
    "Garde les dimensions pr\u00e9sentes dans la description actuelle ; si aucune dimension n'est indiqu\u00e9e, n'en mentionne aucune. " +
    "\u00c9cris uniquement des phrases fran\u00e7aises normales, avec tous les accents, sans aucun caract\u00e8re sp\u00e9cial ni mise en forme : pas d'\u00e9toiles, pas de tirets doubles, pas de listes, pas de gras. " +
    "R\u00e9ponds uniquement par l'objet JSON demand\u00e9.";
  return consigne;
}

/* Applique les deux garde-fous existants, dans cet ordre. */
function appliquerGardeFous(titre, titreActuel) {
  /* Garde-fou anti-confusion : uniquement si la vendeuse avait nomme une pierre
     CONNUE dans son titre et que l IA en a mis une autre, on garde le titre de
     la vendeuse. Les autres produits (encens, bijoux, deco...) ne sont pas
     concernes : ce filet ne se declenche pas pour eux. */
  if (titre && titreActuel) {
    const avant = pierresDans(titreActuel);
    if (avant.length) {
      const apres = pierresDans(titre);
      const conserve = apres.some(function (p) { return avant.indexOf(p) !== -1; });
      if (!conserve) titre = nettoyer(titreActuel);
    }
  }

  /* Filet de securite : si le titre actuel contenait une dimension ou un poids
     (3cm, 10x5cm, 250g...) et que le nouveau titre l a fait disparaitre, on le
     remet automatiquement a la fin. */
  if (titre && titreActuel) {
    const dims = dimensionsDans(titreActuel);
    for (let i = 0; i < dims.length; i++) {
      const compact = dims[i].toLowerCase().replace(/\s+/g, '');
      if (titre.toLowerCase().replace(/\s+/g, '').indexOf(compact) === -1) {
        titre = titre + ' ' + dims[i].trim();
      }
    }
  }
  return titre;
}

/* Coeur deterministe : transforme la reponse brute de l IA et les donnees de
   la vendeuse en {titre, description}. L IA a seulement classifie produit,
   type et dimension ; le titre est assemble ici, par le code. */
function construireReponse(texte, titreActuel, descActuelle, exemples) {
  let produitIA = '', typeIA = '', dimIA = '', descIA = '';
  const bloc = String(texte || '').match(/\{[\s\S]*\}/);
  if (bloc) {
    try {
      const o = JSON.parse(bloc[0]);
      produitIA = versTexte(o.produit);
      typeIA = versTexte(o.type);
      dimIA = versTexte(o.dimension);
      descIA = versTexte(o.description);
      /* Retro-compatibilite : ancien prompt encore en ligne (reponse au format
         {titre, description}), le code decompose lui-meme le titre. */
      if (!produitIA && o.titre) {
        const ancien = versTexte(o.titre);
        for (let i = 0; i < TYPES_SECOURS.length && !typeIA; i++) {
          for (let j = 0; j < TYPES_SECOURS[i].length && !typeIA; j++) {
            if (contientMot(ancien, TYPES_SECOURS[i][j])) {
              typeIA = trouveMot(ancien, TYPES_SECOURS[i][j]);
            }
          }
        }
        if (!dimIA) dimIA = (dimensionsDans(ancien)[0] || '');
        let reste = retireDimensions(ancien);
        if (typeIA) reste = retireMot(reste, typeIA);
        produitIA = reste;
        if (!descIA) descIA = versTexte(o.description);
      }
    } catch (e) { /* champs IA vides : le pipeline tourne sur les seules donnees vendeuse */ }
  }

  /* Pipeline deterministe, toujours execute, meme si les champs IA sont vides. */
  let type = choisirType(titreActuel, typeIA, exemples);
  let resP = choisirProduit(titreActuel, produitIA, type, exemples);
  if (!resP.typeValide) type = { label: '', cle: '', origine: '' };
  /* Veto sur la classification IA seule : si le produit vient du titre saisi
     et contient encore un mot candidat au type (chevaliere...), le type IA
     n est jamais accole aux mots de la vendeuse (jamais d hybride du style
     Amethyste chevaliere Donut). */
  if (type.origine === 'ia' && resP.origine === 'vendeuse' && motsTypeDe(resP.produit).length > 0) {
    type = { label: '', cle: '', origine: '' };
    resP = choisirProduit(titreActuel, produitIA, type, exemples);
  }
  const produit = resP.produit;
  const dim = choisirDimension(titreActuel, descActuelle, dimIA);
  const fmt = type.cle ? formatDeGamme(exemples, type.cle) : null;
  let titre = (produit || type.label || dim)
    ? nettoyer(assemblerTitre(produit, type, dim, fmt, titreActuel, resP.origine === 'vendeuse'))
    : '';
  let description = nettoyer(descIA);

  /* Repli ultime : jamais de reponse totalement vide si l IA a parle. */
  if (!titre && !description) {
    description = nettoyer(versTexte(texte));
  }
  if (!titre && titreActuel) {
    titre = nettoyer(titreActuel);
  }

  titre = appliquerGardeFous(titre, titreActuel);
  titre = normaliserDimensionsTitre(titre);   // "3 cm" partout, jamais "3cm"
  titre = majuscule(titre);   // un titre produit commence toujours par une capitale
  return { titre: titre, description: description };
}

/* =====================================================================
   APPELS AUX IA
   Plusieurs modeles GRATUITS sont essayes en cascade : le premier qui rend
   une fiche exploitable gagne. Si un modele est sature, a court de quota ou
   retire par son editeur, le relais passe au suivant tout seul, sans que la
   vendeuse ne voie rien.
     1. Google Gemini "Flash-Lite" le plus recent : rapide, gros quota gratuit.
     2. Mistral heberge par Cloudflare (liaison "AI" du Worker, sans cle).
     3. Autres modeles gratuits de Google (Gemma, puis Flash).
     4. Gemma heberge par Cloudflare, puis l API Mistral si la cle a du credit.
   Les listes de modeles sont lues chez l editeur : un nouveau modele est
   utilise des sa sortie, sans toucher a ce fichier.
   ===================================================================== */

const REGLAGES = {
  budget: 40000,     // ms : au-dela, on rend la main a la vendeuse
  appel: 18000,      // ms : duree maximale d un appel a un modele
  relais: 4000,      // ms : sans reponse au bout de ce delai, le modele suivant part aussi
  parallele: 3,      // appels simultanes au maximum
};

/* Memoire du Worker (perdue quand Cloudflare le redemarre, sans gravite) :
   modeles a laisser de cote un moment apres une erreur. Un modele en pause
   n est jamais exclu : il passe seulement en fin de liste. */
const pauses = {};
function enPause(nom) { return (pauses[nom] || 0) > Date.now(); }
function pauser(nom, ms) { pauses[nom] = Date.now() + ms; }

/* Erreur d un essai : pause = duree pendant laquelle eviter ce modele ;
   hs = tout le fournisseur est hors service (cle refusee...). */
function echec(message, pauseMs, hs) {
  const e = new Error(String(message || 'erreur').replace(/\s+/g, ' ').slice(0, 180));
  e.pause = pauseMs || 0;
  e.hs = !!hs;
  return e;
}

/* ---------------------------------------------------------------------
   Reponse d une IA : exploitable ou non ?
   --------------------------------------------------------------------- */
function lireObjetIA(texte) {
  const bloc = String(texte || '').match(/\{[\s\S]*\}/);
  if (!bloc) return null;
  try {
    const o = JSON.parse(bloc[0]);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  } catch (e) { return null; }
}
/* Exploitable = un objet JSON lisible avec une vraie description. Une reponse
   vide, coupee ou hors format fait passer au modele suivant. */
function reponseExploitable(texte) {
  const o = lireObjetIA(texte);
  return !!(o && versTexte(o.description).length >= 40);
}
/* Vrai si la description est ecrite sans aucun accent (defaut deja vu) : on
   tente alors un autre modele avant de se resigner. */
function descriptionSansAccents(texte) {
  const o = lireObjetIA(texte);
  const d = o ? versTexte(o.description) : '';
  return d.length >= 120 && !/[\u00e0\u00e2\u00e7\u00e8\u00e9\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u0153]/i.test(d);
}

/* ---------------------------------------------------------------------
   Google Gemini (cle gratuite AI Studio, secret GEMINI_API_KEY)
   --------------------------------------------------------------------- */
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
/* Noms de secours, utilises seulement si Google ne fournit pas sa liste. */
const GEMINI_SECOURS = {
  lite: ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  fort: ['gemini-flash-latest', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash'],
};
const SCHEMA_FICHE = {
  type: 'OBJECT',
  properties: {
    produit: { type: 'STRING' },
    type: { type: 'STRING' },
    dimension: { type: 'STRING' },
    description: { type: 'STRING' },
  },
  required: ['produit', 'type', 'dimension', 'description'],
  propertyOrdering: ['produit', 'type', 'dimension', 'description'],
};
/* Modeles qui refusent les options (schema, reflexion) : corps minimal. */
const modeSimple = {};

function familleGemini(nom) {
  if (/^gemma/.test(nom)) return 'gemma';
  if (/lite/.test(nom)) return 'lite';
  return 'fort';
}

/* Range les modeles proposes par Google en familles, du plus RECENT au plus
   ancien. "lite" passe en premier : c est la seule famille dont le quota
   gratuit couvre une journee de boutique, et la plus rapide. */
function classerGemini(noms) {
  const version = function (n) { const v = /^[a-z]+-(\d+(?:\.\d+)?)/.exec(n); return v ? parseFloat(v[1]) : 0; };
  const taille = function (n) { const v = /-e?(\d+)b(?:-|$)/.exec(n); return v ? parseInt(v[1], 10) : 0; };
  const recent = function (a, b) { return (version(b) - version(a)) || (taille(b) - taille(a)) || (a < b ? -1 : 1); };
  const uniques = noms.filter(function (n, i, t) { return n && t.indexOf(n) === i; });
  const garde = function (re) { return uniques.filter(function (n) { return re.test(n); }).sort(recent); };
  const hors = /tts|image|live|audio|embed|transcri|translat|robot|computer|omni|genie|decision|lyria|veo|imagen|aqa|learnlm|banana|research|preview|exp|tuning|search|latest|pro|carbon|neon|argon/;

  let lite = garde(/^gemini-\d+(?:\.\d+)?-flash-lite$/);
  let fort = garde(/^gemini-\d+(?:\.\d+)?-(?:flash|hydrogen)$/);
  const gemma = garde(/^gemma-\d.*-it$/).slice(0, 2);
  /* Modeles au nom inconnu (future gamme) : filet de securite en fin de liste. */
  const autres = uniques.filter(function (n) {
    return /^gemini-/.test(n) && !hors.test(n) && lite.indexOf(n) === -1 && fort.indexOf(n) === -1;
  }).sort(recent).slice(0, 3);

  if (!lite.length) lite = uniques.indexOf('gemini-flash-lite-latest') !== -1 ? ['gemini-flash-lite-latest'] : (uniques.length ? [] : GEMINI_SECOURS.lite.slice());
  if (!fort.length) fort = uniques.indexOf('gemini-flash-latest') !== -1 ? ['gemini-flash-latest'] : (uniques.length ? [] : GEMINI_SECOURS.fort.slice());
  return { lite: lite.slice(0, 2), gemma: gemma, fort: fort.slice(0, 4), autres: autres };
}

let cacheGemini = { t: 0, familles: null };
async function modelesGemini(env) {
  if (cacheGemini.familles && Date.now() - cacheGemini.t < 6 * 3600 * 1000) return cacheGemini.familles;
  try {
    const r = await fetch(GEMINI_API + '?pageSize=200', { signal: AbortSignal.timeout(2500), headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const noms = (j.models || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
      .map(function (m) { return String(m.name || '').replace(/^models\//, ''); });
    if (!noms.length) throw new Error('liste vide');
    cacheGemini = { t: Date.now(), familles: classerGemini(noms) };
    return cacheGemini.familles;
  } catch (e) {
    /* Liste indisponible : noms de secours, et nouvelle lecture au prochain appel. */
    return classerGemini([]);
  }
}

/* Corps de la requete Gemini, fabrique une seule fois par variante :
   lite (reglages par defaut), fort (reflexion reduite), simple (sans option).
   Pas de "temperature" : les modeles recents la refusent. */
function fabriqueCorpsGemini(consigne, image) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(image.slice(0, 80)) || [];
  const donnees = image.slice(image.indexOf(',') + 1);
  const cache = {};
  return function (variante) {
    if (!cache[variante]) {
      const config = { maxOutputTokens: 4000 };
      if (variante !== 'simple') {
        config.responseMimeType = 'application/json';
        config.responseSchema = SCHEMA_FICHE;
        if (variante === 'fort') config.thinkingConfig = { thinkingLevel: 'low' };
      }
      cache[variante] = JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: m[1] || 'image/jpeg', data: donnees } }, { text: consigne }] }],
        generationConfig: config,
      });
    }
    return cache[variante];
  };
}

async function appelGemini(env, nom, corps, signal) {
  const famille = familleGemini(nom);
  let variante = (famille === 'gemma' || modeSimple[nom]) ? 'simple' : famille;
  let repli = false;
  for (let tour = 0; tour < 2; tour++) {
    const r = await fetch(GEMINI_API + '/' + nom + ':generateContent', {
      method: 'POST',
      signal: signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: corps(variante),
    });
    const j = await r.json().catch(function () { return {}; });
    if (r.ok) {
      if (repli) modeSimple[nom] = true;   // ce modele ne veut que la version minimale : on s en souvient
      const candidat = (j.candidates || [])[0] || {};
      const parts = (candidat.content || {}).parts || [];
      const texte = parts.filter(function (p) { return p && !p.thought; })
        .map(function (p) { return p.text || ''; }).join('').trim();
      if (!texte) throw echec('reponse vide' + (candidat.finishReason ? ' (' + candidat.finishReason + ')' : ''), 0);
      return texte;
    }
    const brut = JSON.stringify(j);
    const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
    if (/API_KEY_INVALID|API key not valid|API key expired|API_KEY_SERVICE_BLOCKED/i.test(brut) || r.status === 401) {
      throw echec(msg, 0, true);                        // cle refusee : inutile d insister sur Gemini
    }
    if (r.status === 400) {
      /* Option refusee par ce modele ? Un nouvel essai en version minimale.
         Si elle est refusee aussi, c est la demande elle-meme (photo illisible...) :
         aucune pause, le modele n y est pour rien. */
      if (variante !== 'simple') { variante = 'simple'; repli = true; continue; }
      throw echec(msg, 0);
    }
    if (r.status === 429) {
      /* Quota : celui du jour (pause longue) ou celui de la minute (pause courte). */
      const duJour = /PerDay|per day|daily/i.test(brut);
      const attente = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(brut);
      const sec = attente ? parseFloat(attente[1]) : 60;
      throw echec(msg, duJour ? 3600000 : Math.min(300000, Math.max(15000, sec * 1000)));
    }
    if (r.status >= 500) throw echec(msg, 90000);       // sature : on le laisse souffler
    if (r.status === 404) throw echec(msg, 6 * 3600000); // modele retire ou inconnu
    throw echec(msg, 3600000);                          // autre refus propre a ce modele
  }
  throw echec('options refusees', 3600000);
}

/* ---------------------------------------------------------------------
   Workers AI : modeles heberges par Cloudflare (liaison "AI", sans cle,
   10 000 neurones gratuits par jour). Facultatif : sans liaison, ignore.
   --------------------------------------------------------------------- */
const MODELES_CF = ['@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/google/gemma-4-26b-a4b-it'];

function texteDeMessage(contenu) {
  if (typeof contenu === 'string') return contenu;
  if (Array.isArray(contenu)) return contenu.map(function (p) { return (p && p.text) || ''; }).join('');
  return '';
}

async function appelCloudflare(env, nom, consigne, image) {
  const entree = {
    messages: [{ role: 'user', content: [{ type: 'text', text: consigne }, { type: 'image_url', image_url: { url: image } }] }],
  };
  if (/gemma-4/.test(nom)) {
    entree.max_completion_tokens = 700;
    entree.response_format = { type: 'json_object' };
    entree.chat_template_kwargs = { enable_thinking: false };
  } else {
    entree.max_tokens = 700;
    entree.temperature = 0.3;
  }
  let r;
  try { r = await env.AI.run(nom, entree); }
  catch (e) {
    const msg = String((e && e.message) || e);
    throw echec(msg, /neuron|quota|limit|allocation|capacity|429/i.test(msg) ? 3600000 : 5 * 60000);
  }
  let texte = '';
  if (r && typeof r.response === 'string') texte = r.response;
  else if (r && r.response && typeof r.response === 'object') texte = JSON.stringify(r.response);
  else if (r && r.choices && r.choices[0] && r.choices[0].message) texte = texteDeMessage(r.choices[0].message.content);
  else if (typeof r === 'string') texte = r;
  texte = String(texte || '').trim();
  if (!texte) throw echec('reponse vide', 5 * 60000);
  return texte;
}

/* ---------------------------------------------------------------------
   API Mistral (secret MISTRAL_API_KEY) : dernier recours, utile seulement
   si le compte Mistral a du credit.
   --------------------------------------------------------------------- */
let cacheModeles = { t: 0, liste: [] };
async function modelesVisionRecents(env) {
  if (Date.now() - cacheModeles.t < 6 * 3600 * 1000) return cacheModeles.liste;
  try {
    const r = await fetch('https://api.mistral.ai/v1/models', { signal: AbortSignal.timeout(3000), headers: { 'Authorization': 'Bearer ' + env.MISTRAL_API_KEY } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const liste = (j.data || [])
      .filter(function (m) { return m && m.id && m.capabilities && m.capabilities.vision && m.capabilities.completion_chat !== false && !m.deprecation && !/ocr|embed|moderation/i.test(m.id); })
      .sort(function (a, b) { return (b.created || 0) - (a.created || 0); })
      .map(function (m) { return m.id; })
      .slice(0, 6);
    cacheModeles = { t: Date.now(), liste: liste };
  } catch (e) {
    cacheModeles = { t: Date.now() - 5 * 3600 * 1000, liste: [] };  // reessai dans 1 h
  }
  return cacheModeles.liste;
}

async function appelMistral(env, consigne, image, signal) {
  const base = {
    max_tokens: 500,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [{ type: 'text', text: consigne }, { type: 'image_url', image_url: image }] }],
  };
  const recents = await modelesVisionRecents(env);
  const modeles = (env.MISTRAL_MODELE ? [env.MISTRAL_MODELE] : []).concat(recents, MODELES)
    .filter(function (m, i, t) { return t.indexOf(m) === i; }).slice(0, 4);
  let derniere = 'aucun modele';
  for (let i = 0; i < modeles.length; i++) {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      signal: signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.MISTRAL_API_KEY },
      body: JSON.stringify(Object.assign({ model: modeles[i] }, base)),
    });
    const j = await r.json().catch(function () { return {}; });
    if (r.ok) {
      const texte = texteDeMessage((((j.choices || [])[0] || {}).message || {}).content).trim();
      if (texte) return texte;
      derniere = 'reponse vide [' + modeles[i] + ']';
      continue;
    }
    derniere = (j.message || (j.error && j.error.message) || ('HTTP ' + r.status)) + ' [' + modeles[i] + ']';
    if (r.status === 401 && /invalid|unauthori/i.test(derniere) && !/subscription/i.test(derniere)) break;  // cle fausse
  }
  throw echec(derniere, 10 * 60000);
}

/* ---------------------------------------------------------------------
   Liste ordonnee des candidats pour une demande
   --------------------------------------------------------------------- */
async function preparerCandidats(env, consigne, image) {
  const liste = [];
  const ajouter = function (nom, fournisseur, appel) {
    if (nom && !liste.some(function (c) { return c.nom === nom; })) liste.push({ nom: nom, f: fournisseur, appel: appel });
  };
  let gemini = null;
  let corps = null;
  const g = function (nom) {
    ajouter(nom, 'gemini', function (signal) { return appelGemini(env, nom, corps, signal); });
  };
  const cf = function (nom) {
    ajouter(nom, 'cloudflare', function () { return appelCloudflare(env, nom, consigne, image); });
  };
  const aLiaisonIA = !!(env.AI && typeof env.AI.run === 'function');

  if (env.GEMINI_API_KEY) {
    gemini = await modelesGemini(env);
    corps = fabriqueCorpsGemini(consigne, image);
    if (env.GEMINI_MODELE) g(String(env.GEMINI_MODELE));
    gemini.lite.forEach(g);
  }
  if (aLiaisonIA) cf(MODELES_CF[0]);
  if (gemini) {
    gemini.gemma.forEach(g);
    gemini.fort.forEach(g);
    gemini.autres.forEach(g);
  }
  if (aLiaisonIA) cf(MODELES_CF[1]);
  if (env.MISTRAL_API_KEY) {
    ajouter('mistral-api', 'mistral', function (signal) { return appelMistral(env, consigne, image, signal); });
  }
  /* Les modeles en pause passent en fin de liste (jamais exclus). */
  const repos = function (c) { return enPause(c.nom) || enPause('f:' + c.f); };
  return liste.filter(function (c) { return !repos(c); }).concat(liste.filter(repos));
}

/* ---------------------------------------------------------------------
   La course : les candidats partent dans l ordre. Le suivant demarre des
   qu un essai echoue, ou au bout de REGLAGES.relais si le precedent n a pas
   encore repondu. La premiere reponse valable gagne, le reste est annule.
   valide(texte) renvoie '' si la reponse convient, sinon la raison du refus.
   --------------------------------------------------------------------- */
function course(candidats, budgetMs, journal, hs, valide) {
  return new Promise(function (resolve) {
    let suivant = 0;
    let enCours = 0;
    let fini = false;
    let relais = null;
    let garde = null;
    const controleurs = [];
    const finir = function (gagnant) {
      if (fini) return;
      fini = true;
      clearTimeout(relais);
      clearTimeout(garde);
      controleurs.forEach(function (c) { try { c.abort(); } catch (e) { /* deja termine */ } });
      resolve(gagnant);
    };
    const lancer = function () {
      if (fini) return;
      clearTimeout(relais);
      while (suivant < candidats.length && hs[candidats[suivant].f]) suivant++;
      if (suivant >= candidats.length) { if (enCours === 0) finir(null); return; }
      if (enCours >= REGLAGES.parallele) return;
      const c = candidats[suivant++];
      const ctrl = new AbortController();
      controleurs.push(ctrl);
      const debut = Date.now();
      let clos = false;
      let delai = null;
      enCours++;
      const terminer = function (erreur, texte) {
        if (clos) return;
        clos = true;
        clearTimeout(delai);
        enCours--;
        if (fini) return;
        if (!erreur) {
          const refus = valide(texte);
          if (refus) erreur = echec(refus, 2 * 60000);
        }
        if (erreur) {
          if (erreur.pause) pauser(c.nom, erreur.pause);
          if (erreur.hs) { hs[c.f] = true; pauser('f:' + c.f, 5 * 60000); }
          journal.push({ modele: c.nom, ms: Date.now() - debut, erreur: erreur.message });
          lancer();
          return;
        }
        journal.push({ modele: c.nom, ms: Date.now() - debut, ok: true });
        finir({ nom: c.nom, texte: texte });
      };
      delai = setTimeout(function () {
        terminer(echec('pas de reponse en ' + Math.round(REGLAGES.appel / 1000) + ' s', 90000));
        try { ctrl.abort(); } catch (e) { /* deja termine */ }
      }, REGLAGES.appel);
      let p;
      try { p = Promise.resolve(c.appel(ctrl.signal)); } catch (e) { p = Promise.reject(e); }
      p.then(
        function (texte) { terminer(null, texte); },
        function (e) { terminer((e && typeof e.message === 'string') ? e : echec(String(e), 0)); }
      );
      relais = setTimeout(lancer, REGLAGES.relais);
    };
    garde = setTimeout(function () { finir(null); }, Math.max(0, budgetMs));
    lancer();
  });
}

function reponseJson(obj, statut, origin) {
  return new Response(JSON.stringify(obj), {
    status: statut,
    headers: Object.assign({ 'Content-Type': 'application/json' }, entetesCors(origin)),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: entetesCors(origin) });
    }
    if (request.method !== 'POST') {
      return reponseJson({ erreur: 'M\u00e9thode non autoris\u00e9e' }, 405, origin);
    }
    if (ORIGINES_AUTORISEES.indexOf(origin) === -1) {
      return reponseJson({ erreur: 'Origine non autoris\u00e9e' }, 403, origin);
    }
    env = env || {};
    const aLiaisonIA = !!(env.AI && typeof env.AI.run === 'function');
    if (!env.GEMINI_API_KEY && !env.MISTRAL_API_KEY && !aLiaisonIA) {
      return reponseJson({ erreur: 'Aucune IA configur\u00e9e dans le Worker (secret GEMINI_API_KEY, liaison AI ou secret MISTRAL_API_KEY).' }, 500, origin);
    }

    let corps;
    try { corps = await request.json(); }
    catch (e) { return reponseJson({ erreur: 'Requ\u00eate invalide' }, 400, origin); }
    corps = corps || {};

    /* Diagnostic (sans appel a une IA) : modeles prevus, dans l ordre, et pauses. */
    if (corps.diag) {
      const prevus = await preparerCandidats(env, '', 'data:image/jpeg;base64,');
      const maintenant = Date.now();
      const enRepos = {};
      Object.keys(pauses).forEach(function (k) { if (pauses[k] > maintenant) enRepos[k] = Math.round((pauses[k] - maintenant) / 1000); });
      return reponseJson({ candidats: prevus.map(function (c) { return c.nom; }), pauses_s: enRepos, liaison_ai: aLiaisonIA }, 200, origin);
    }

    const image = corps.image;
    // Donnees d entree : le titre et la description actuels de la fiche (peuvent etre vides).
    const titreActuel = versTexte(corps.titre || corps.indice).slice(0, 200);
    const descActuelle = versTexte(corps.description).slice(0, 1200);
    // Titres des autres articles du meme rayon : sert de modele de format.
    const exemples = Array.isArray(corps.exemples)
      ? corps.exemples.map(versTexte).filter(Boolean).slice(0, 12)
      : [];
    if (typeof image !== 'string' || !/^data:image\//.test(image)) {
      return reponseJson({ erreur: 'Image manquante ou invalide' }, 400, origin);
    }

    const consigne = construireConsigne(titreActuel, descActuelle, exemples);
    const t0 = Date.now();
    let candidats = await preparerCandidats(env, consigne, image);
    /* Mesure d un modele precis (parmi les candidats seulement) : {"essai":"nom"}. */
    if (typeof corps.essai === 'string' && corps.essai) {
      candidats = candidats.filter(function (c) { return c.nom === corps.essai; });
      if (!candidats.length) return reponseJson({ erreur: 'Mod\u00e8le inconnu pour un essai' }, 400, origin);
    }

    const journal = [];
    const hs = {};
    const exploitable = function (t) { return reponseExploitable(t) ? '' : 'reponse inexploitable'; };
    let gagnant = await course(candidats, REGLAGES.budget, journal, hs, exploitable);

    /* Description sans accents : on laisse une chance aux modeles restants. */
    if (gagnant && descriptionSansAccents(gagnant.texte)) {
      const dejaVus = journal.map(function (e) { return e.modele; });
      const reste = candidats.filter(function (c) { return dejaVus.indexOf(c.nom) === -1; });
      const marge = Math.min(REGLAGES.budget * 0.3, REGLAGES.budget - (Date.now() - t0));
      if (reste.length && marge > 0) {
        const mieux = await course(reste, marge, journal, hs, function (t) {
          return exploitable(t) || (descriptionSansAccents(t) ? 'description sans accents' : '');
        });
        if (mieux) gagnant = mieux;
      }
    }

    if (!gagnant) {
      return reponseJson({
        erreur: 'elle est momentan\u00e9ment satur\u00e9e. R\u00e9essayez dans une minute, ou remplissez le nom et la description \u00e0 la main.',
        detail: journal,
        ms: Date.now() - t0,
      }, 502, origin);
    }

    const resultat = construireReponse(gagnant.texte, titreActuel, descActuelle, exemples);
    return reponseJson({
      titre: resultat.titre,
      description: resultat.description,
      modele: gagnant.nom,
      ms: Date.now() - t0,
      essais: journal,
    }, 200, origin);
  },
};
