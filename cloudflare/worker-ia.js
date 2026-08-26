/* Relais IA « La Géode » — génère un titre + une description d'article à partir
   d'une photo, avec Cloudflare Workers AI (gratuit). À coller dans un Worker
   Cloudflare. Le binding Workers AI doit être ajouté au Worker sous le nom "AI".

   Ce fichier ne contient AUCUN secret : il peut rester public dans le dépôt. */

const ORIGINES_AUTORISEES = [
  'https://lageode66.fr',
  'https://www.lageode66.fr',
  'https://thomas-finkelstein.github.io',
  'http://localhost:8000',
];

const MODELE = '@cf/meta/llama-3.2-11b-vision-instruct';

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

    let corps;
    try { corps = await request.json(); }
    catch (e) { return reponseJson({ erreur: 'Requête invalide' }, 400, origin); }

    const image = corps.image;
    const indice = String(corps.indice || '').slice(0, 200);
    if (!image || !/^data:image\//.test(image)) {
      return reponseJson({ erreur: 'Image manquante ou invalide' }, 400, origin);
    }

    const consigne =
      'Tu rédiges pour la boutique « La Géode le Showroom », spécialisée en minéraux, ' +
      'cristaux, bijoux en pierres naturelles, encens et décoration. À partir de la photo' +
      (indice ? ' et de l\'indice « ' + indice + ' »' : '') +
      ', propose un TITRE court (2 à 5 mots) et une DESCRIPTION chaleureuse de 1 à 2 phrases, ' +
      'dans un ton doux, naturel et un peu poétique (bien-être, énergie des pierres). ' +
      'N\'invente ni prix ni dimensions. Ne fais AUCUNE promesse de guérison ni allégation ' +
      'médicale. Réponds UNIQUEMENT par un objet JSON exactement de cette forme, en français, ' +
      'sans aucun autre texte : {"titre":"...","description":"..."}';

    let texte = '';
    try {
      const r = await env.AI.run(MODELE, {
        image,
        messages: [
          { role: 'system', content: 'Rédacteur d\'une boutique de minéraux. Tu réponds toujours en français et uniquement par du JSON.' },
          { role: 'user', content: consigne },
        ],
        max_tokens: 300,
      });
      texte = (r && (r.response || r.result || r.text)) || '';
    } catch (e) {
      return reponseJson({ erreur: 'IA indisponible : ' + (e.message || e) }, 502, origin);
    }

    // Extraction robuste du JSON même si le modèle ajoute du texte autour.
    let titre = '', description = '';
    const bloc = texte.match(/\{[\s\S]*\}/);
    if (bloc) {
      try {
        const o = JSON.parse(bloc[0]);
        titre = String(o.titre || '').trim();
        description = String(o.description || '').trim();
      } catch (e) { /* on retombe sur le repli ci-dessous */ }
    }
    if (!titre && !description) {
      description = texte.trim();
    }

    return reponseJson({ titre: titre, description: description }, 200, origin);
  },
};
