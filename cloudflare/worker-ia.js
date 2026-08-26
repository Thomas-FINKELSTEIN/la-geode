/* Relais IA « La Géode » — génère un titre + une description d'article à partir
   d'une photo, avec Google Gemini (offre gratuite, autorisée en Europe).
   À coller dans un Worker Cloudflare.

   IMPORTANT : ajouter dans le Worker une variable secrète nommée GEMINI_API_KEY
   (Settings → Variables and Secrets) contenant une clé Google AI Studio gratuite.
   Ce fichier ne contient AUCUN secret : il peut rester public dans le dépôt. */

const ORIGINES_AUTORISEES = [
  'https://lageode66.fr',
  'https://www.lageode66.fr',
  'https://thomas-finkelstein.github.io',
  'http://localhost:8000',
];

const MODELE = 'gemini-2.0-flash';

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
    if (!env.GEMINI_API_KEY) {
      return reponseJson({ erreur: 'Clé Gemini absente (variable GEMINI_API_KEY à définir dans le Worker)' }, 500, origin);
    }

    let corps;
    try { corps = await request.json(); }
    catch (e) { return reponseJson({ erreur: 'Requête invalide' }, 400, origin); }

    const image = corps.image;
    const indice = String(corps.indice || '').slice(0, 200);
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(image || '');
    if (!m) {
      return reponseJson({ erreur: 'Image manquante ou invalide' }, 400, origin);
    }
    const mimeType = m[1];
    const base64 = m[2];

    const consigne =
      'Tu rédiges pour la boutique « La Géode le Showroom », spécialisée en minéraux, ' +
      'cristaux, bijoux en pierres naturelles, encens et décoration. Regarde la photo' +
      (indice ? ' et tiens compte de l\'indice « ' + indice + ' »' : '') +
      '. Propose un titre court (2 à 5 mots) et une description chaleureuse de 1 à 2 phrases, ' +
      'en français, dans un ton doux, naturel et un peu poétique (bien-être, énergie des pierres). ' +
      'N\'invente ni prix ni dimensions. Ne fais aucune promesse de guérison ni allégation médicale.';

    const requete = {
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: consigne },
      ] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            titre: { type: 'STRING' },
            description: { type: 'STRING' },
          },
          required: ['titre', 'description'],
        },
      },
    };

    let data;
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELE +
        ':generateContent?key=' + env.GEMINI_API_KEY;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requete),
      });
      data = await r.json();
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
        return reponseJson({ erreur: 'IA indisponible : ' + msg }, 502, origin);
      }
    } catch (e) {
      return reponseJson({ erreur: 'IA injoignable : ' + (e.message || e) }, 502, origin);
    }

    let texte = '';
    try {
      texte = data.candidates[0].content.parts[0].text || '';
    } catch (e) { /* réponse inattendue */ }

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
