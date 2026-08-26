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
    const indice = String(corps.indice || '').slice(0, 200);
    if (!image || !/^data:image\//.test(image)) {
      return reponseJson({ erreur: 'Image manquante ou invalide' }, 400, origin);
    }

    const consigne =
      'Tu rediges pour la boutique La Geode le Showroom, specialisee en mineraux, ' +
      'cristaux, bijoux en pierres naturelles, encens et decoration. Regarde la photo' +
      (indice ? ' et tiens compte de cet indice : ' + indice : '') +
      '. Propose un titre court (2 a 5 mots) et une description chaleureuse de 1 a 2 phrases, ' +
      'en francais, dans un ton doux, naturel et un peu poetique (bien-etre, energie des pierres). ' +
      'Ne propose ni prix ni dimensions. Ne fais aucune promesse de guerison ni allegation medicale. ' +
      'Reponds uniquement par un objet JSON de la forme {"titre":"...","description":"..."}';

    const requete = {
      model: MODELE,
      max_tokens: 300,
      temperature: 0.7,
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
        titre = String(o.titre || '').trim();
        description = String(o.description || '').trim();
      } catch (e) { /* repli ci-dessous */ }
    }
    if (!titre && !description) {
      description = texte.trim();
    }

    return reponseJson({ titre: titre, description: description }, 200, origin);
  },
};
