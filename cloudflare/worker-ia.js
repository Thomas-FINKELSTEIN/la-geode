/* Relais IA « La Géode » — génère un titre + une description d'article à partir
   d'une photo, avec Mistral (entreprise française, offre gratuite, modèle Pixtral).
   À coller dans un Worker Cloudflare.

   IMPORTANT : ajouter dans le Worker une variable secrète nommée MISTRAL_API_KEY
   (Settings → Variables and Secrets) contenant une clé Mistral (console.mistral.ai).
   Ce fichier ne contient AUCUN secret : il peut rester public dans le dépôt. */

const ORIGINES_AUTORISEES = [
  'https://lageode66.fr',
  'https://www.lageode66.fr',
  'https://thomas-finkelstein.github.io',
  'http://localhost:8000',
];

const MODELE = 'pixtral-12b-2409';

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
    .replace(/\s*(?:--+|[–—])\s*/g, ', ')    // -- et tirets longs -> virgule
    .replace(/^\s*[-•]\s+/gm, '')                 // puces en debut de ligne
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .trim();
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
      return reponseJson({ erreur: 'Méthode non autorisée' }, 405, origin);
    }
    if (ORIGINES_AUTORISEES.indexOf(origin) === -1) {
      return reponseJson({ erreur: 'Origine non autorisée' }, 403, origin);
    }
    if (!env.MISTRAL_API_KEY) {
      return reponseJson({ erreur: 'Clé Mistral absente (variable MISTRAL_API_KEY à définir dans le Worker)' }, 500, origin);
    }

    let corps;
    try { corps = await request.json(); }
    catch (e) { return reponseJson({ erreur: 'Requête invalide' }, 400, origin); }

    const image = corps.image;
    // Donnees d entree : le titre et la description actuels de la fiche (peuvent etre vides).
    const titreActuel = versTexte(corps.titre || corps.indice).slice(0, 200);
    const descActuelle = versTexte(corps.description).slice(0, 1200);
    // Titres des autres articles du meme rayon : sert de modele de format.
    const exemples = Array.isArray(corps.exemples)
      ? corps.exemples.map(versTexte).filter(Boolean).slice(0, 12)
      : [];
    if (!image || !/^data:image\//.test(image)) {
      return reponseJson({ erreur: 'Image manquante ou invalide' }, 400, origin);
    }

    let consigne =
      'Tu rediges la fiche produit pour la boutique La Geode le Showroom, specialisee en ' +
      'mineraux, cristaux, bijoux en pierres naturelles, encens et decoration. ' +
      'Identifie la pierre ou le produit visible sur la photo.';
    if (titreActuel) consigne += ' Titre actuel de la fiche : ' + titreActuel + '.';
    if (descActuelle) {
      consigne += ' Description actuelle de la fiche : ' + descActuelle +
        ' /// Ameliore cette description existante (garde ses informations justes) : ';
    } else {
      consigne += ' La fiche n a pas encore de description, cree-la : ';
    }
    consigne +=
      'en langage naturel et simple (pas sophistique), accrocheuse et pas trop longue (2 a 3 phrases), ' +
      'elle presente le produit et les proprietes qui lui sont traditionnellement associees en ' +
      'lithotherapie (bien-etre, energie, emotions, usage courant). ' +
      'Propose aussi un titre court (2 a 5 mots) avec le nom de la pierre ou du produit ; ' +
      'si le titre actuel contient une dimension ou un poids (par exemple 3cm, 10x5cm, 250g), ' +
      'tu dois OBLIGATOIREMENT reprendre cette mention telle quelle dans le nouveau titre. ';
    if (exemples.length) {
      consigne +=
        'Titres des autres articles du meme rayon : ' + exemples.join(' | ') + '. ' +
        'Le nouveau titre doit suivre EXACTEMENT le meme format que ces titres : ' +
        'meme ordre des mots (nom de la pierre d abord), memes mots communs (par exemple Donut), ' +
        'meme facon d ecrire les dimensions (par exemple 3cm en minuscules). ' +
        'Seul le nom de la pierre change. ';
    }
    consigne +=
      'De meme, garde les dimensions presentes dans la description actuelle ; ' +
      'si aucune dimension n est indiquee, ne mentionne aucune dimension. ' +
      'Ecris uniquement des phrases francaises normales, sans aucun caractere special ni mise en forme : ' +
      'pas d etoiles, pas de tirets doubles, pas de listes, pas de gras. ' +
      'Reponds en francais, uniquement par un objet JSON de la forme {"titre":"...","description":"..."}';

    const requete = {
      model: MODELE,
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: consigne },
          { type: 'image_url', image_url: image },
        ],
      }],
    };

    let data;
    try {
      const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.MISTRAL_API_KEY,
        },
        body: JSON.stringify(requete),
      });
      data = await r.json();
      if (!r.ok) {
        const msg = (data && (data.message || (data.error && data.error.message))) || ('HTTP ' + r.status);
        return reponseJson({ erreur: 'IA indisponible : ' + msg }, 502, origin);
      }
    } catch (e) {
      return reponseJson({ erreur: 'IA injoignable : ' + (e.message || e) }, 502, origin);
    }

    let texte = '';
    try { texte = data.choices[0].message.content || ''; }
    catch (e) { /* réponse inattendue */ }

    let titre = '', description = '';
    const bloc = texte.match(/\{[\s\S]*\}/);
    if (bloc) {
      try {
        const o = JSON.parse(bloc[0]);
        titre = versTexte(o.titre);
        description = versTexte(o.description);
      } catch (e) { /* repli ci-dessous */ }
    }
    if (!titre && !description) {
      description = versTexte(texte);
    }
    titre = nettoyer(titre);
    description = nettoyer(description);

    /* Filet de securite : si le titre actuel contenait une dimension ou un poids
       (3cm, 10x5cm, 250g...) et que l IA l a fait disparaitre, on le remet
       automatiquement a la fin du nouveau titre. */
    if (titre && titreActuel) {
      const motifDim = /\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)*\s*(?:cm|mm|m|g|kg|ct|carats?|pouces?)\b/gi;
      const dims = titreActuel.match(motifDim) || [];
      for (let i = 0; i < dims.length; i++) {
        const compact = dims[i].toLowerCase().replace(/\s+/g, '');
        if (titre.toLowerCase().replace(/\s+/g, '').indexOf(compact) === -1) {
          titre = titre + ' ' + dims[i].trim();
        }
      }
    }

    return reponseJson({ titre: titre, description: description }, 200, origin);
  },
};
