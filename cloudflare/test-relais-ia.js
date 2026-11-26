/* Tests du relais IA complet (cascade de modeles), sans reseau ni secret.
   Usage : node cloudflare/test-relais-ia.js
   Le script charge worker-ia.js en entier dans un bac a sable node:vm, avec un
   faux Google Gemini, un faux Mistral et une fausse liaison Workers AI. Les
   delais du relais sont divises par 20 pour que tout tourne en quelques secondes. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'worker-ia.js'), 'utf8');
if (source.indexOf('export default') === -1) {
  console.error('Marqueur "export default" introuvable');
  process.exit(1);
}
const script = new vm.Script(source.replace('export default', 'globalThis.RELAIS ='), { filename: 'worker-ia.js' });

const ORIGINE = 'https://lageode66.fr';
const IMAGE = 'data:image/jpeg;base64,QUJDREVGRw==';
const DESC = 'Cette sphère en améthyste aux reflets violets profonds est une pièce lumineuse. En lithothérapie, elle est réputée pour apaiser l\'esprit et favoriser la sérénité. Idéale pour décorer un intérieur tout en profitant de ses vertus apaisantes au quotidien.';
const DESC_SANS_ACCENT = 'Cette sphere en amethyste aux reflets violets profonds est une piece lumineuse. En lithotherapie, elle est reputee pour apaiser l\'esprit et favoriser la serenite. Ideale pour decorer un interieur tout en profitant de ses vertus apaisantes au quotidien.';
const FICHE = JSON.stringify({ produit: 'Améthyste', type: 'Sphère', dimension: '', description: DESC });
const FICHE_SANS_ACCENT = JSON.stringify({ produit: 'Amethyste', type: 'Sphere', dimension: '', description: DESC_SANS_ACCENT });

const LISTE_GOOGLE = ['gemini-4-carbon', 'gemini-4-neon', 'gemini-4-hydrogen', 'gemini-4-argon', 'gemini-3.8-flash',
  'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-omni-1.2-flash',
  'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest', 'gemma-4-27b-it', 'gemma-4-e4b-it',
  'gemma-3-27b-it', 'gemini-nano-banana-2.1', 'gemini-3.5-transcribe', 'gemini-robotics-er-2-preview', 'gemini-decision-1'];

let total = 0;
let rates = 0;
function vrai(nom, condition, detail) {
  total++;
  if (condition) { console.log('OK  ' + nom); }
  else { rates++; console.log('KO  ' + nom + (detail !== undefined ? '\n    ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
}
function egal(nom, obtenu, attendu) {
  vrai(nom, JSON.stringify(obtenu) === JSON.stringify(attendu), 'attendu ' + JSON.stringify(attendu) + ' / obtenu ' + JSON.stringify(obtenu));
}

/* Reponses toutes faites du faux Google. */
const ok = function (texte, ms) { return { status: 200, ms: ms || 5, json: { candidates: [{ content: { parts: [{ text: texte }] }, finishReason: 'STOP' }] } }; };
const sature = function (ms) { return { status: 503, ms: ms || 5, json: { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } } }; };
const quotaJour = { status: 429, ms: 5, json: { error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } } };
const quotaMinute = { status: 429, ms: 5, json: { error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' }] } } };
const cleFausse = { status: 400, ms: 5, json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } };
const optionRefusee = { status: 400, ms: 5, json: { error: { code: 400, message: 'Invalid JSON payload received. Unknown name "responseSchema"', status: 'INVALID_ARGUMENT' } } };
const inconnu = { status: 404, ms: 5, json: { error: { code: 404, message: 'models/x is not found for API version v1beta', status: 'NOT_FOUND' } } };
const MUET = { muet: true };   // ne repond jamais

/* Fabrique un relais neuf (memoire vide) branche sur un faux reseau.
   plan.google(modele, corps, n) -> reponse ; plan.liste -> noms ou null (panne) ;
   plan.mistral(modele) -> reponse ; plan.ia(modele, entree) -> valeur ou throw. */
function nouveauRelais(plan) {
  const appels = [];     // chronologie des appels sortants
  const debut = Date.now();
  const compte = {};
  const attendre = function (ms, signal, valeur) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { resolve(valeur); }, ms);
      if (signal) {
        const stop = function () { clearTimeout(t); const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); };
        if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
      }
    });
  };
  const reponse = function (r) {
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: function () { return Promise.resolve(r.json); } };
  };
  const faux = function (url, options) {
    options = options || {};
    const u = String(url);
    if (u.indexOf('generativelanguage.googleapis.com') !== -1 && u.indexOf(':generateContent') === -1) {
      appels.push({ quoi: 'liste-google', t: Date.now() - debut });
      if (!plan.liste) return attendre(5, options.signal, reponse({ status: 500, json: {} }));
      return attendre(5, options.signal, reponse({ status: 200, json: { models: plan.liste.map(function (n) { return { name: 'models/' + n, supportedGenerationMethods: ['generateContent'] }; }).concat([{ name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] }]) } }));
    }
    const g = /\/models\/([^:]+):generateContent/.exec(u);
    if (g) {
      const modele = g[1];
      compte[modele] = (compte[modele] || 0) + 1;
      const corps = JSON.parse(options.body);
      const trace = { quoi: 'google', modele: modele, t: Date.now() - debut, corps: corps, cle: options.headers['x-goog-api-key'], annule: false };
      appels.push(trace);
      if (options.signal) options.signal.addEventListener('abort', function () { trace.annule = true; }, { once: true });
      const r = (plan.google ? plan.google(modele, corps, compte[modele]) : null) || sature();
      if (r.muet) return attendre(3600000, options.signal, null);
      return attendre(r.ms || 5, options.signal, reponse(r));
    }
    if (u.indexOf('api.mistral.ai/v1/models') !== -1) {
      appels.push({ quoi: 'liste-mistral', t: Date.now() - debut });
      return attendre(5, options.signal, reponse({ status: 200, json: { data: [{ id: 'mistral-small-2609', created: 9, capabilities: { vision: true } }] } }));
    }
    if (u.indexOf('api.mistral.ai/v1/chat/completions') !== -1) {
      const corps = JSON.parse(options.body);
      appels.push({ quoi: 'mistral', modele: corps.model, t: Date.now() - debut, corps: corps });
      const r = (plan.mistral ? plan.mistral(corps.model) : null) || { status: 401, json: { message: 'You need a subscription to access this API.' } };
      return attendre(r.ms || 5, options.signal, reponse(r));
    }
    return Promise.reject(new Error('URL inattendue : ' + u));
  };
  const bac = {
    fetch: faux, AbortController: AbortController, AbortSignal: AbortSignal,
    setTimeout: setTimeout, clearTimeout: clearTimeout, Response: Response, console: console,
  };
  vm.createContext(bac);
  script.runInContext(bac);
  vm.runInContext('REGLAGES.budget = 2000; REGLAGES.appel = 900; REGLAGES.relais = 200; REGLAGES.parallele = 3;', bac);

  const env = {};
  if (plan.cleGoogle !== false) env.GEMINI_API_KEY = 'cle-google-test';
  if (plan.cleMistral) env.MISTRAL_API_KEY = 'cle-mistral-test';
  if (plan.ia) {
    env.AI = { run: function (modele, entree) {
      appels.push({ quoi: 'cloudflare', modele: modele, t: Date.now() - debut, entree: entree });
      return new Promise(function (resolve, reject) {
        setTimeout(function () { try { resolve(plan.ia(modele, entree)); } catch (e) { reject(e); } }, 5);
      });
    } };
  }
  if (plan.env) Object.keys(plan.env).forEach(function (k) { env[k] = plan.env[k]; });

  const demander = async function (corps, options) {
    options = options || {};
    const requete = {
      method: options.method || 'POST',
      headers: { get: function (n) { return n === 'Origin' ? (options.origine === undefined ? ORIGINE : options.origine) : null; } },
      json: function () { return options.corpsInvalide ? Promise.reject(new Error('json')) : Promise.resolve(corps); },
    };
    const t = Date.now();
    const res = await bac.RELAIS.fetch(requete, env);
    let j = null;
    try { j = await res.json(); } catch (e) { /* pas de corps */ }
    return { statut: res.status, j: j, ms: Date.now() - t, entetes: res.headers };
  };
  const generations = function () { return appels.filter(function (a) { return a.quoi !== 'liste-google' && a.quoi !== 'liste-mistral'; }); };
  return { demander: demander, appels: appels, generations: generations, bac: bac };
}

const FICHE_VIDE = { image: IMAGE, titre: '', description: '', exemples: [] };

(async function () {
  /* R1 : cas normal. Le Flash-Lite le plus recent repond, un seul appel part. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? ok(FICHE, 20) : sature(); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R1a reponse 200', rep.statut, 200);
    egal('R1b modele utilise = Flash-Lite le plus recent', rep.j.modele, 'gemini-3.5-flash-lite');
    egal('R1c un seul appel de generation', r.generations().length, 1);
    egal('R1d titre assemble par le code', rep.j.titre, 'Améthyste Sphère');
    egal('R1e description rendue telle quelle', rep.j.description, DESC);
    const c = r.generations()[0].corps;
    egal('R1f image envoyee en premier, sans prefixe data:', c.contents[0].parts[0].inlineData, { mimeType: 'image/jpeg', data: 'QUJDREVGRw==' });
    vrai('R1g consigne accentuee envoyee ensuite', c.contents[0].parts[1].text.indexOf('Tu prépares la fiche produit') === 0);
    vrai('R1h pas de temperature (refusee par les modeles recents)', !('temperature' in c.generationConfig) && !('topP' in c.generationConfig));
    vrai('R1i sortie JSON avec schema', c.generationConfig.responseMimeType === 'application/json' && c.generationConfig.responseSchema.required.length === 4);
    vrai('R1j Flash-Lite : aucun reglage de reflexion', !('thinkingConfig' in c.generationConfig));
    egal('R1k la cle part dans l en-tete', r.generations()[0].cle, 'cle-google-test');
    vrai('R1l en-tete CORS pour le site', rep.entetes.get('Access-Control-Allow-Origin') === ORIGINE);
  })();

  /* R2 : le premier modele est sature (503) : le suivant part aussitot. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.1-flash-lite' ? ok(FICHE, 20) : sature(10); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R2a reponse 200 malgre la saturation', rep.statut, 200);
    egal('R2b le deuxieme Flash-Lite a repondu', rep.j.modele, 'gemini-3.1-flash-lite');
    vrai('R2c bascule immediate (sans attendre le relais)', rep.ms < 150, rep.ms + ' ms');
    egal('R2d journal : un echec puis un succes', rep.j.essais.map(function (e) { return e.modele + (e.ok ? ':ok' : ':ko'); }), ['gemini-3.5-flash-lite:ko', 'gemini-3.1-flash-lite:ok']);
    /* Demande suivante : le modele sature est mis de cote, on commence par celui qui marche. */
    const rep2 = await r.demander(FICHE_VIDE);
    egal('R2e demande suivante : commence par le modele sain', r.generations()[2].modele, 'gemini-3.1-flash-lite');
    egal('R2f et reussit du premier coup', rep2.j.essais.length, 1);
  })();

  /* R3 : le premier modele ne repond pas : au bout du delai de relais le suivant
     part en parallele, gagne, et l appel muet est annule. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? MUET : ok(FICHE, 20); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R3a reponse 200 malgre un modele muet', rep.statut, 200);
    egal('R3b le relais a gagne', rep.j.modele, 'gemini-3.1-flash-lite');
    vrai('R3c reponse des le delai de relais (pas le delai max)', rep.ms >= 200 && rep.ms < 600, rep.ms + ' ms');
    vrai('R3d l appel muet est annule', r.generations()[0].annule === true);
  })();

  /* R4 : tout Google est sature : le Mistral heberge par Cloudflare prend le relais. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return sature(10); }, ia: function () { return { response: FICHE }; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R4a reponse 200 sans Google', rep.statut, 200);
    egal('R4b modele Cloudflare (Mistral)', rep.j.modele, '@cf/mistralai/mistral-small-3.1-24b-instruct');
    egal('R4c ordre : les deux Flash-Lite, puis Cloudflare', r.generations().map(function (a) { return a.modele; }), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', '@cf/mistralai/mistral-small-3.1-24b-instruct']);
    const e = r.generations()[2].entree;
    vrai('R4d Cloudflare recoit le texte et la photo', e.messages[0].content[0].text.indexOf('Tu prépares') === 0 && e.messages[0].content[1].image_url.url === IMAGE);
  })();

  /* R5 : tout est en panne : message clair pour la vendeuse, detail pour le depannage. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, cleMistral: true, google: function () { return sature(5); }, ia: function () { throw new Error('you have used up your daily free allocation of 10,000 neurons'); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R5a statut 502', rep.statut, 502);
    vrai('R5b message lisible', /Réessayez dans une minute/.test(rep.j.erreur) && !/gemini|503|undefined/i.test(rep.j.erreur), rep.j.erreur);
    vrai('R5c detail technique fourni a part', Array.isArray(rep.j.detail) && rep.j.detail.length >= 8, rep.j.detail);
    vrai('R5d tous les fournisseurs ont ete essayes', ['google', 'cloudflare', 'mistral'].every(function (q) { return r.appels.some(function (a) { return a.quoi === q; }); }));
    vrai('R5e pas de titre ni de description inventes', rep.j.titre === undefined && rep.j.description === undefined);
  })();

  /* R6 : un modele refuse une option (schema) : nouvel essai en version minimale, memorise. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m, corps) { return corps.generationConfig.responseSchema ? optionRefusee : ok(FICHE, 10); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R6a reponse 200', rep.statut, 200);
    egal('R6b meme modele, deuxieme essai sans option', r.generations().map(function (a) { return a.modele + ':' + (a.corps.generationConfig.responseSchema ? 'complet' : 'simple'); }), ['gemini-3.5-flash-lite:complet', 'gemini-3.5-flash-lite:simple']);
    await r.demander(FICHE_VIDE);
    egal('R6c demande suivante : directement la version minimale', r.generations().length, 3);
    vrai('R6d version minimale = sans schema ni type de sortie', !r.generations()[2].corps.generationConfig.responseMimeType);
  })();

  /* R7 : cle Google refusee : on n insiste pas sur Google. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return cleFausse; }, ia: function () { return { response: FICHE }; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R7a reponse 200 grace au secours', rep.statut, 200);
    egal('R7b un seul appel a Google', r.generations().filter(function (a) { return a.quoi === 'google'; }).length, 1);
    egal('R7c secours Cloudflare', rep.j.modele, '@cf/mistralai/mistral-small-3.1-24b-instruct');
  })();

  /* R8 : description sans accents : on tente le modele suivant, et on garde la
     version accentuee si elle arrive ; sinon on rend quand meme la premiere. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? ok(FICHE_SANS_ACCENT, 10) : ok(FICHE, 10); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R8a la version accentuee est retenue', rep.j.description, DESC);
    egal('R8b elle vient du modele suivant', rep.j.modele, 'gemini-3.1-flash-lite');
    const r2 = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? ok(FICHE_SANS_ACCENT, 10) : sature(5); } });
    const rep2 = await r2.demander(FICHE_VIDE);
    egal('R8c sans mieux, la premiere reponse est rendue (jamais d echec pour ca)', [rep2.statut, rep2.j.description], [200, DESC_SANS_ACCENT]);
  })();

  /* R9 : reponse coupee ou hors format : modele suivant. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? ok('{"produit":"Améthyste","type":"Sph', 10) : ok('```json\n' + FICHE + '\n```', 10); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R9a la reponse coupee est ecartee', rep.j.modele, 'gemini-3.1-flash-lite');
    egal('R9b une reponse entouree de balises est acceptee', rep.j.description, DESC);
    const r2 = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? { status: 200, ms: 5, json: { candidates: [{ finishReason: 'MAX_TOKENS', content: {} }] } } : ok(FICHE, 10); } });
    const rep2 = await r2.demander(FICHE_VIDE);
    egal('R9c reponse vide (MAX_TOKENS) : modele suivant', rep2.j.modele, 'gemini-3.1-flash-lite');
  })();

  /* R10 : Google ne donne pas sa liste : noms de secours. */
  await (async function () {
    const r = nouveauRelais({ liste: null, google: function (m) { return m === 'gemini-flash-lite-latest' ? ok(FICHE, 10) : sature(); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R10 liste en panne : alias « latest » de secours', [rep.statut, rep.j.modele], [200, 'gemini-flash-lite-latest']);
  })();

  /* R11 : quota du jour atteint sur le premier modele : il est mis de cote. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? quotaJour : ok(FICHE, 10); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R11a reponse 200 malgre le quota', [rep.statut, rep.j.modele], [200, 'gemini-3.1-flash-lite']);
    const diag = await r.demander({ diag: true });
    vrai('R11b pause longue (environ 1 h) pour un quota du jour', diag.j.pauses_s['gemini-3.5-flash-lite'] > 3000, diag.j.pauses_s);
    egal('R11c le modele en pause passe en fin de liste', diag.j.candidats[diag.j.candidats.length - 1], 'gemini-3.5-flash-lite');
    const r2 = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? quotaMinute : ok(FICHE, 10); } });
    await r2.demander(FICHE_VIDE);
    const diag2 = await r2.demander({ diag: true });
    vrai('R11d pause courte (delai conseille par Google) pour un quota a la minute', diag2.j.pauses_s['gemini-3.5-flash-lite'] > 15 && diag2.j.pauses_s['gemini-3.5-flash-lite'] <= 21, diag2.j.pauses_s);
  })();

  /* R12 : classement des modeles de Google (gamme reelle de novembre 2026). */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE });
    const f = r.bac.classerGemini(LISTE_GOOGLE);
    egal('R12a Flash-Lite : les deux plus recents', f.lite, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    egal('R12b modeles forts gratuits, du plus recent au plus ancien', f.fort, ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
    egal('R12c Gemma : version la plus recente, plus gros d abord', f.gemma, ['gemma-4-27b-it', 'gemma-4-e4b-it']);
    egal('R12d ni payants, ni audio, ni image dans le filet', f.autres, []);
    const futur = r.bac.classerGemini(['gemini-5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-5-helium', 'gemini-5-flash-tts', 'gemini-4-carbon']);
    egal('R12e un nouveau Flash-Lite passe en tete tout seul', futur.lite[0], 'gemini-5-flash-lite');
    egal('R12f un modele au nom inconnu sert de filet', futur.autres, ['gemini-5-helium']);
    const sansLite = r.bac.classerGemini(['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-9-neon']);
    egal('R12g gamme renommee : on se rabat sur les alias de Google', [sansLite.lite, sansLite.fort], [['gemini-flash-lite-latest'], ['gemini-flash-latest']]);
  })();

  /* R13 : reglages par famille (reflexion reduite sur les modeles forts, corps minimal pour Gemma). */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-4-hydrogen' ? ok(FICHE, 10) : sature(5); } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R13a un modele fort finit par repondre', rep.j.modele, 'gemini-4-hydrogen');
    const fort = r.generations().filter(function (a) { return a.modele === 'gemini-4-hydrogen'; })[0].corps.generationConfig;
    egal('R13b modele fort : reflexion au minimum', fort.thinkingConfig, { thinkingLevel: 'low' });
    const gemma = r.generations().filter(function (a) { return a.modele === 'gemma-4-27b-it'; })[0].corps.generationConfig;
    vrai('R13c Gemma : corps minimal', !gemma.responseMimeType && !gemma.thinkingConfig && gemma.maxOutputTokens > 0);
    egal('R13d ordre complet des essais', r.generations().map(function (a) { return a.modele; }), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-27b-it', 'gemma-4-e4b-it', 'gemini-4-hydrogen']);
  })();

  /* R14 : tout le monde est muet : on rend la main au bout du budget, pas avant, pas apres. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return MUET; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R14a statut 502', rep.statut, 502);
    vrai('R14b rendu au bout du budget (2 s ici)', rep.ms >= 1900 && rep.ms < 2500, rep.ms + ' ms');
    vrai('R14c jamais plus de 3 appels en meme temps', r.generations().length <= 9, r.generations().length);
  })();

  /* R15 : outils de diagnostic. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, cleMistral: true, google: function () { return ok(FICHE, 5); }, ia: function () { return { response: FICHE }; } });
    const d = await r.demander({ diag: true });
    egal('R15a ordre des candidats', d.j.candidats, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', '@cf/mistralai/mistral-small-3.1-24b-instruct',
      'gemma-4-27b-it', 'gemma-4-e4b-it', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash',
      '@cf/google/gemma-4-26b-a4b-it', 'mistral-api']);
    egal('R15b le diagnostic ne lance aucune generation', r.generations().length, 0);
    const e = await r.demander({ image: IMAGE, essai: 'gemini-3.8-flash' });
    egal('R15c essai d un modele precis', [e.statut, e.j.modele, r.generations().length], [200, 'gemini-3.8-flash', 1]);
    const x = await r.demander({ image: IMAGE, essai: 'gemini-4-carbon' });
    egal('R15d essai refuse hors de la liste (pas de modele payant)', x.statut, 400);
  })();

  /* R16 : garde-fous d entree inchanges. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return ok(FICHE, 5); } });
    egal('R16a OPTIONS accepte', (await r.demander(null, { method: 'OPTIONS' })).statut, 200);
    egal('R16b GET refuse', (await r.demander(null, { method: 'GET' })).statut, 405);
    egal('R16c origine inconnue refusee', (await r.demander(FICHE_VIDE, { origine: 'https://exemple.com' })).statut, 403);
    egal('R16d corps illisible', (await r.demander(null, { corpsInvalide: true })).statut, 400);
    egal('R16e image manquante', (await r.demander({ titre: 'x' })).statut, 400);
    egal('R16f aucun appel sortant pour ces refus', r.generations().length, 0);
    const vide = nouveauRelais({ cleGoogle: false });
    egal('R16g aucune IA configuree', (await vide.demander(FICHE_VIDE)).statut, 500);
  })();

  /* R17 : API Mistral seule (cle avec credit). */
  await (async function () {
    const r = nouveauRelais({ cleGoogle: false, cleMistral: true, mistral: function () { return { status: 200, json: { choices: [{ message: { content: FICHE } }] } }; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R17a Mistral repond', [rep.statut, rep.j.modele, rep.j.description], [200, 'mistral-api', DESC]);
    egal('R17b modele Mistral le plus recent d abord', r.generations()[0].modele, 'mistral-small-2609');
  })();

  /* R18 : formes de reponse de Workers AI. */
  await (async function () {
    const formes = [{ response: FICHE }, { response: JSON.parse(FICHE) }, { choices: [{ message: { content: FICHE } }] }, { choices: [{ message: { content: [{ type: 'text', text: FICHE }] } }] }];
    for (let i = 0; i < formes.length; i++) {
      const r = nouveauRelais({ cleGoogle: false, ia: function () { return formes[i]; } });
      const rep = await r.demander(FICHE_VIDE);
      egal('R18.' + (i + 1) + ' forme de reponse Cloudflare comprise', [rep.statut, rep.j.description], [200, DESC]);
    }
    const r = nouveauRelais({ cleGoogle: false, ia: function (m) { if (/mistral/.test(m)) throw new Error('capacity temporarily exceeded'); return { choices: [{ message: { content: FICHE } }] }; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R18.5 Mistral Cloudflare en panne : Gemma Cloudflare repond', rep.j.modele, '@cf/google/gemma-4-26b-a4b-it');
    const e = r.generations()[1].entree;
    vrai('R18.6 Gemma Cloudflare : reflexion coupee, sortie JSON', e.chat_template_kwargs.enable_thinking === false && e.response_format.type === 'json_object');
  })();

  /* R19 : la saisie de la vendeuse reste prioritaire, quel que soit le modele. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return ok(JSON.stringify({ produit: 'Citrine', type: 'Boule', dimension: '', description: DESC }), 5); } });
    const rep = await r.demander({ image: IMAGE, titre: 'Améthyste boule 3cm', description: '', exemples: ['Quartz rose Boule 5 cm'] });
    vrai('R19a la pierre tapee par la vendeuse est conservee', /Améthyste/.test(rep.j.titre) && !/Citrine/.test(rep.j.titre), rep.j.titre);
    vrai('R19b dimension normalisee', /3 cm/.test(rep.j.titre), rep.j.titre);
    const c = r.generations()[0].corps.contents[0].parts[1].text;
    vrai('R19c le titre saisi est transmis au modele', c.indexOf('Titre actuel de la fiche : Améthyste boule 3cm.') !== -1);
  })();

  /* R20 : modele retire par Google (404) : ecarte pour longtemps, sans bloquer. */
  await (async function () {
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function (m) { return m === 'gemini-3.5-flash-lite' ? inconnu : ok(FICHE, 5); } });
    const rep = await r.demander(FICHE_VIDE);
    const diag = await r.demander({ diag: true });
    vrai('R20 modele retire : pause de plusieurs heures', rep.statut === 200 && diag.j.pauses_s['gemini-3.5-flash-lite'] > 20000, diag.j.pauses_s);
  })();

  /* R21 : photo refusee par Google (400 meme en version minimale) : ce n est pas
     la faute du modele, donc AUCUNE pause, et le secours repond. */
  await (async function () {
    const photoRefusee = { status: 400, ms: 5, json: { error: { code: 400, message: 'Unable to process input image.', status: 'INVALID_ARGUMENT' } } };
    let panne = true;
    const r = nouveauRelais({ liste: LISTE_GOOGLE, google: function () { return panne ? photoRefusee : ok(FICHE, 5); }, ia: function () { return { response: FICHE }; } });
    const rep = await r.demander(FICHE_VIDE);
    egal('R21a le secours repond', [rep.statut, rep.j.modele], [200, '@cf/mistralai/mistral-small-3.1-24b-instruct']);
    const diag = await r.demander({ diag: true });
    egal('R21b aucun modele Google mis en pause pour une photo refusee', Object.keys(diag.j.pauses_s).filter(function (k) { return /gemini|gemma/.test(k); }), []);
    panne = false;
    const avant = r.generations().length;
    const rep2 = await r.demander(FICHE_VIDE);
    egal('R21c photo suivante : Flash-Lite reprend en premier', [rep2.j.modele, r.generations().length - avant], ['gemini-3.5-flash-lite', 1]);
    vrai('R21d et toujours avec ses options completes', !!r.generations()[avant].corps.generationConfig.responseSchema);
  })();

  console.log('');
  console.log(rates === 0
    ? 'TOUS LES TESTS PASSENT (' + total + ' verifications)'
    : rates + ' echec(s) sur ' + total + ' verifications');
  process.exit(rates === 0 ? 0 : 1);
})().catch(function (e) { console.error('ERREUR DU BANC DE TEST', e); process.exit(2); });
