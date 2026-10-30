'use strict';
/* Banc de test de admin/admin.js : faux navigateur + fausse horloge + faux GitHub
   (robots compris). Aucun réseau, aucun secret. À lancer après toute modification
   de l'admin :  node .github/tests/test-admin.js */
const vm = require('vm'), fs = require('fs'), path = require('path');
const ADMIN = path.join(__dirname, "..", "..", "admin", "admin.js");

let src = fs.readFileSync(ADMIN, 'utf8');
const hook = 'window.__t = { state: state, markDirty: markDirty, publish: publish, renderRecherche: renderRecherche, dateAjout: dateAjout, render: render, openArticleForm: openArticleForm, nouvelArticle: nouvelArticle, rayonParDefaut: rayonParDefaut, fusionTroisVoies: fusionTroisVoies };\n  if (state.token) start();\n})();';
if (!/if \(state\.token\) start\(\);\s*\}\)\(\);\s*$/.test(src)) throw new Error('fin de fichier inattendue');
src = src.replace(/if \(state\.token\) start\(\);\s*\}\)\(\);\s*$/, hook);

// ---------- horloge ----------
let clock = new Date(2026, 9, 20, 18, 0, 0).getTime();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
  static now() { return clock; }
}

// ---------- DOM minimal ----------
function makeEl(tag, id) {
  const el = {
    tagName: tag, id, children: [], dataset: {}, attrs: {}, listeners: {}, _cls: new Set(),
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    _html: '', textContent: '', value: '', disabled: false, hidden: false, type: '', title: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; },
    get className() { return [...this._cls].join(' '); },
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; },
    prepend(c) { this.children.unshift(c); }, replaceChildren() { this.children = []; }, insertAdjacentHTML() {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    focus() {}, blur() {}, remove() {}, closest() { return null; }, scrollIntoView() {},
    click() { if (this.onclick) this.onclick({ stopPropagation() {}, preventDefault() {} }); },
  };
  el.classList = {
    add: (...c) => c.forEach(x => el._cls.add(x)), remove: (...c) => c.forEach(x => el._cls.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !el._cls.has(c) : !!f; on ? el._cls.add(c) : el._cls.delete(c); return on; },
    contains: c => el._cls.has(c),
  };
  return el;
}
const els = {}, qs = {}, docListeners = {}, winListeners = {};
const $ = id => els[id] || (els[id] = makeEl('div', id));
const document = {
  getElementById: $, createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
  querySelector: s => qs[s] || (qs[s] = makeEl('div')), querySelectorAll: () => [],
  addEventListener: (t, f) => { docListeners[t] = f; }, visibilityState: 'visible', body: makeEl('body'),
};
const store = new Map([['geode-admin-token', 'tok']]);
const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const alerts = [], intervals = [];

// ---------- faux GitHub ----------
function uidAt(d) { return d.getTime().toString(36) + 'abcd'; }
function art(nom, d, extra) { return Object.assign({ id: nom.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uidAt(d), nom: nom, prix: 10, prixBoutique: 9, stock: 1 }, extra || {}); }
const D = (j, h, m) => new Date(2026, 9, j, h, m, 0);
const catalogue0 = { actualites: [], themes: {
  mineraux: { nom: 'Minéraux', familles: [{ id: 'f-min', nom: 'Pierres', articles: [
    art('Amethyste brute', D(20, 10, 5)), art('Labradorite', D(13, 9, 0)), { id: 'pierres', nom: 'Pierres', prix: 12.5 },
  ] }] },
  bijoux: { nom: 'Bijoux', familles: [{ id: 'f-bij', nom: 'Pendentifs', articles: [art('Quartz rose boule', D(19, 16, 0))] }] },
  esoterisme: { nom: 'Ésotérisme & encens', familles: [{ id: 'f-eso', nom: 'Bougies', articles: [art('Bougeoir sel rond', D(20, 17, 30))] }] },
  decoration: { nom: 'Décoration', familles: [] },
} };
const remote = { catalogue: JSON.stringify(catalogue0, null, 2), sha: 'blob-0', commit: 'c0', n: 0 };
const blobs = {}, published = [], calls = [];
let lastTree = null, lastCommit = null, blobN = 0, holdPatch = false, releasePatch = null, failPost = 0;
const ok = b => ({ ok: true, status: 200, json: async () => b });
async function fetchMock(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = new URL(url);
  const p = u.pathname.replace('/repos/Thomas-FINKELSTEIN/la-geode/', '');
  calls.push(method + ' ' + p);
  if (failPost > 0 && method === 'POST') { failPost--; throw new Error('Failed to fetch'); }
  if (method === 'GET' && p === 'contents/data/catalogue.json') {
    // ?ref=main ou ?ref=<commit> : ici le dernier état (les tests ne lisent que la tête)
    return ok({ sha: remote.sha, encoding: 'base64', content: Buffer.from(remote.catalogue, 'utf8').toString('base64') });
  }
  if (method === 'GET' && p === 'git/ref/heads/main') return ok({ object: { sha: remote.commit } });
  if (method === 'GET' && p.startsWith('git/commits/')) return ok({ tree: { sha: 'tree-of-' + p.split('/').pop() } });
  if (method === 'GET' && p.startsWith('git/blobs/')) return ok({ encoding: 'base64', content: blobs[p.split('/').pop()] });
  if (method === 'POST' && p === 'git/blobs') { const b = JSON.parse(opts.body); const sha = 'b' + (++blobN); blobs[sha] = b.content; return ok({ sha }); }
  if (method === 'POST' && p === 'git/trees') { lastTree = JSON.parse(opts.body); return ok({ sha: 't' + blobN }); }
  if (method === 'POST' && p === 'git/commits') { lastCommit = JSON.parse(opts.body); return ok({ sha: 'c' + (++remote.n) }); }
  if (method === 'PATCH' && p === 'git/refs/heads/main') {
    const body = JSON.parse(opts.body);
    const doPatch = () => {
      if (lastCommit.parents[0] !== remote.commit) return { ok: false, status: 422, json: async () => ({ message: 'Update is not a fast forward' }) };
      remote.commit = body.sha;
      const e = lastTree.tree.find(x => x.path === 'data/catalogue.json');
      remote.catalogue = Buffer.from(blobs[e.sha], 'base64').toString('utf8');
      remote.sha = e.sha;
      published.push({ cat: JSON.parse(remote.catalogue), files: lastTree.tree.map(x => x.path), message: lastCommit.message });
      return ok({ object: { sha: body.sha } });
    };
    if (holdPatch) return new Promise(res => { releasePatch = () => res(doPatch()); });
    return doPatch();
  }
  throw new Error('non simulé : ' + method + ' ' + p);
}
// Un robot (Stripe) écrit un champ technique dans le catalogue en ligne.
function robotEcrit(nomArticle, champs) {
  const c = JSON.parse(remote.catalogue);
  for (const k of Object.keys(c.themes)) for (const f of c.themes[k].familles) for (const a of f.articles) if (a.nom === nomArticle) Object.assign(a, champs);
  remote.catalogue = JSON.stringify(c, null, 2); remote.sha = 'blob-robot-' + (++remote.n); remote.commit = 'robot-' + remote.n;
}
// Un humain sur un autre appareil renomme un article en ligne.
function autreAppareil(nomArticle, nouveauNom) {
  const c = JSON.parse(remote.catalogue);
  for (const k of Object.keys(c.themes)) for (const f of c.themes[k].familles) for (const a of f.articles) if (a.nom === nomArticle) a.nom = nouveauNom;
  remote.catalogue = JSON.stringify(c, null, 2); remote.sha = 'blob-humain-' + (++remote.n); remote.commit = 'humain-' + remote.n;
}

// ---------- contexte ----------
const ctx = {
  document, localStorage, location: { reload() {} }, alert: m => alerts.push(m), confirm: () => true,
  fetch: fetchMock, setTimeout, clearTimeout, setInterval: f => { intervals.push(f); return intervals.length; },
  Date: FakeDate, btoa, atob, TextEncoder, TextDecoder, URL, console,
  addEventListener: (t, f) => { winListeners[t] = f; }, scrollTo: () => {}, innerWidth: 1000, innerHeight: 900,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'admin.js' });

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const tick = () => intervals.forEach(f => f());
const avancer = ms => { clock += ms; };
let total = 0, ko = 0;
function check(nom, cond, detail) { total++; if (cond) console.log('OK  ' + nom); else { ko++; console.log('KO  ' + nom + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); } }
const nomsPublies = i => { const n = []; const c = published[i].cat; for (const k of Object.keys(c.themes)) for (const f of c.themes[k].familles) for (const a of f.articles) n.push(a.nom); return n; };
const artPublie = (i, nom) => { const c = published[i].cat; for (const k of Object.keys(c.themes)) for (const f of c.themes[k].familles) for (const a of f.articles) if (a.nom === nom) return a; return null; };
const etat = () => $('etat-txt').textContent, statut = () => $('status-msg').textContent;

(async () => {
  await flush();
  const t = ctx.__t;
  check('T0 chargement du catalogue', !!t.state.catalogue && etat() === 'Tout est en ligne', etat());
  const fam = () => t.state.catalogue.themes.mineraux.familles[0];
  const ajouter = nom => { fam().articles.push(art(nom, new FakeDate())); t.markDirty(); };

  // T1 : publication auto au bout de 5 min, pas avant, sans alerte
  ajouter('Bougeoir en sel A');
  check('T1a compte à rebours affiché', /mise en ligne auto dans 5 min/.test(etat()), etat());
  avancer(4 * 60000); tick(); await flush();
  check('T1b rien de publié avant 5 min', published.length === 0 && /dans 1 min/.test(etat()), [published.length, etat()]);
  avancer(60000 + 1000); tick(); await flush();
  check('T1c publié tout seul après 5 min', published.length === 1 && nomsPublies(0).includes('Bougeoir en sel A'), published.length);
  check('T1d message de commit « automatique »', published[0] && /automatique/.test(published[0].message));
  check('T1e état revenu à « Tout est en ligne »', etat() === 'Tout est en ligne' && t.state.nbModifs === 0, [etat(), t.state.nbModifs]);
  check('T1f message discret, aucune alerte', /automatiquement/.test(statut()) && alerts.length === 0, [statut(), alerts]);

  // T2 : ajout PENDANT une publication en cours -> gardé en attente, pas perdu
  ajouter('Bougeoir en sel B');
  holdPatch = true;
  document.visibilityState = 'hidden'; docListeners.visibilitychange(); document.visibilityState = 'visible';
  await flush();
  check('T2a onglet quitté -> publication immédiate lancée', t.state.publication === true && typeof releasePatch === 'function');
  ajouter('Bougeoir en sel C');                       // ajouté pendant l'envoi
  check('T2b bouton « Mettre en ligne » bloqué pendant l\'envoi', $('btn-publish').disabled === true && /en cours/.test(etat()), etat());
  holdPatch = false; releasePatch(); await flush();
  check('T2c B publié, C pas encore', nomsPublies(1).includes('Bougeoir en sel B') && !nomsPublies(1).includes('Bougeoir en sel C'));
  check('T2d C reste « à mettre en ligne » (1 changement)', t.state.nbModifs === 1 && /^1 changement/.test(etat()), [t.state.nbModifs, etat()]);
  check('T2e nouveau compte à rebours de 5 min pour C', /dans 5 min/.test(etat()), etat());

  // T3 : un robot écrit un lien de paiement en ligne -> pas effacé par la publication suivante
  robotEcrit('Bougeoir en sel A', { stripe: 'https://buy.stripe.com/A', stripeProductId: 'prod_A' });
  avancer(5 * 60000 + 1000); tick(); await flush();
  const a3 = published[2] && artPublie(2, 'Bougeoir en sel A');
  check('T3a C publié après fusion avec le robot', published.length === 3 && nomsPublies(2).includes('Bougeoir en sel C'), published.length);
  check('T3b lien Stripe du robot CONSERVÉ (pas de doublon)', !!a3 && a3.stripeProductId === 'prod_A' && a3.stripe === 'https://buy.stripe.com/A', a3);
  check('T3c pas de faux conflit, pas d\'alerte', !t.state.autoBloque && alerts.length === 0, [t.state.autoBloque, alerts]);
  check('T3d sha mémorisé = celui du catalogue publié', t.state.sha === remote.sha, [t.state.sha, remote.sha]);

  // T4 : bouton manuel
  ajouter('Bougeoir en sel D');
  $('btn-publish').click(); await flush();
  check('T4 bouton manuel : publication « classique »', published.length === 4 && /mise à jour depuis/.test(published[3].message) && /C'est en ligne/.test(statut()), [published.length, statut()]);

  // T5 : panne réseau en auto -> pas d'alerte, nouvel essai plus tard
  ajouter('Bougeoir en sel E');
  failPost = 1;
  avancer(5 * 60000 + 1000); tick(); await flush();
  check('T5a échec auto silencieux (aucune alerte)', published.length === 4 && alerts.length === 0 && /impossible pour l'instant/.test(statut()), [published.length, alerts, statut()]);
  tick(); await flush();
  check('T5b pas de nouvel essai immédiat', published.length === 4);
  avancer(2 * 60000 + 1000); tick(); await flush();
  check('T5c nouvel essai réussi après 2 min', published.length === 5 && nomsPublies(4).includes('Bougeoir en sel E'), published.length);

  // T6 : modification depuis un autre appareil -> FUSION (rien d'écrasé, rien perdu, pas d'alerte)
  autreAppareil('Labradorite', 'Labradorite (renommée ailleurs)');
  ajouter('Bougeoir en sel F');
  avancer(5 * 60000 + 1000); tick(); await flush();
  check('T6a publié après fusion', published.length === 6, published.length);
  check('T6b mon ajout ET le changement d\'ailleurs sont gardés', nomsPublies(5).includes('Bougeoir en sel F') && nomsPublies(5).includes('Labradorite (renommée ailleurs)'), nomsPublies(5).filter(n => /Labra|sel F/.test(n)));
  check('T6c ni blocage ni alerte', !t.state.autoBloque && alerts.length === 0, [t.state.autoBloque, alerts]);
  // même article modifié des deux côtés : notre version l'emporte
  autreAppareil('Amethyste brute', 'Amethyste (ailleurs)');
  t.state.catalogue.themes.mineraux.familles[0].articles.find(a => a.nom === 'Amethyste brute').nom = 'Amethyste (ici)';
  t.markDirty();
  avancer(5 * 60000 + 1000); tick(); await flush();
  check('T6d même article des deux côtés : notre version gardée', published.length === 7 && nomsPublies(6).includes('Amethyste (ici)') && !nomsPublies(6).includes('Amethyste (ailleurs)'), nomsPublies(6).filter(n => /Amethyste/.test(n)));

  // T7 : tri par date
  const t7 = () => $('resultats-recherche').children[0];
  $('admin-search').value = '';
  t.state.triDate = false;
  $('btn-tri-date').onclick();
  const carte = t7();
  const seps = carte.children.filter(c => c._cls.has('jour-sep')).map(c => c.textContent);
  const rangs = carte.children.filter(c => c._cls.has('art')).map(c => (c.innerHTML.match(/art-nom">([^<]*)</) || [])[1]);
  check('T7a bouton actif + vue univers masquée', $('btn-tri-date')._cls.has('actif') && $('contenu').style.display === 'none');
  check('T7b plus récent en premier', rangs[0] && rangs[0].startsWith('Bougeoir en sel'), rangs.slice(0, 3));
  const iBou = rangs.indexOf('Bougeoir sel rond'), iAme = rangs.findIndex(n => /^Amethyste/.test(n)), iQua = rangs.indexOf('Quartz rose boule'), iLab = rangs.findIndex(n => /^Labradorite/.test(n)), iPie = rangs.indexOf('Pierres');
  check('T7c ordre chronologique inverse', iBou < iAme && iAme < iQua && iQua < iLab && iLab < iPie, rangs);
  check('T7d séparateurs de jours', seps[0].startsWith('Aujourd\'hui') && seps.some(s => s.startsWith('Hier')) && seps.some(s => /13 octobre 2026/.test(s)) && seps[seps.length - 1] === 'Date d\'ajout inconnue', seps);
  const rowBou = carte.children.find(c => c._cls.has('art') && /Bougeoir sel rond/.test(c.innerHTML));
  check('T7e heure d\'ajout affichée', !!rowBou && /ajouté à 17h30/.test(rowBou.innerHTML), rowBou && rowBou.innerHTML.slice(0, 200));
  // recherche + tri
  $('admin-search').value = 'bougeoir';
  t.renderRecherche('bougeoir');
  const r2 = t7().children.filter(c => c._cls.has('art')).map(c => (c.innerHTML.match(/art-nom">([^<]*)</) || [])[1]);
  check('T7f recherche + tri : que des bougeoirs, récents d\'abord', r2.length > 0 && r2.every(n => /bougeoir/i.test(n)) && r2[r2.length - 1] === 'Bougeoir sel rond', r2);
  // pagination
  for (let i = 0; i < 230; i++) fam().articles.push(art('Lot ' + i, new FakeDate(2026, 8, 1 + (i % 28), 12, i % 60)));
  $('admin-search').value = '';
  t.state.limiteDate = 100; t.renderRecherche('');
  let rows = t7().children.filter(c => c._cls.has('art')).length;
  const btn = t7().children.find(c => c._cls.has('voir-plus'));
  check('T7g 100 premiers + bouton « suivants »', rows === 100 && !!btn && /Afficher les 100 suivants/.test(btn.textContent), [rows, btn && btn.textContent]);
  btn.onclick(); rows = t7().children.filter(c => c._cls.has('art')).length;
  check('T7h « suivants » -> 200 affichés', rows === 200, rows);
  // Échap : retour à la vue normale
  const lst = $('admin-search').listeners.keydown[0]; lst({ key: 'Escape' });
  check('T7i Échap -> tri coupé, vue normale', t.state.triDate === false && !$('btn-tri-date')._cls.has('actif') && $('contenu').style.display === '', [t.state.triDate]);
  check('T7j date d\'un id', t.dateAjout({ id: 'x-' + uidAt(new Date(2026, 0, 2, 3, 4)) }) === new Date(2026, 0, 2, 3, 4).getTime() && t.dateAjout({ id: 'pierres' }) === 0);

  // T8 : refonte — gros rayon par 50, plus récents d'abord, filtre, fiche
  const famMin = fam();                                   // « Pierres » : > 200 articles à ce stade
  const famBij = t.state.catalogue.themes.bijoux.familles[0];
  t.state.univers = 'mineraux';
  t.state.rayonsOuverts[famMin.id] = true;
  t.render();
  const carteMin = $('contenu').children.find(c => c._cls.has('rayon'));
  const corps = carteMin.children.find(c => c._cls.has('rayon-corps'));
  const filtreEl = corps.children.find(c => c._cls.has('filtre-rayon'));
  const liste = corps.children[corps.children.length - 1];
  const lignes = () => liste.children.filter(c => c._cls.has('art'));
  const noms = () => lignes().map(c => (c.innerHTML.match(/art-nom">([^<]*)</) || [])[1]);
  check('T8a gros rayon : 50 articles + bouton « suivants » + filtre', lignes().length === 50 && liste.children.some(c => c._cls.has('voir-plus')) && !!filtreEl, lignes().length);
  check('T8b les plus récents en premier', /^Bougeoir en sel/.test(noms()[0]), noms().slice(0, 3));
  liste.children.find(c => c._cls.has('voir-plus')).onclick();
  check('T8c « suivants » -> 100 articles', lignes().length === 100, lignes().length);
  filtreEl.value = 'lot 12'; filtreEl.listeners.input[0]();
  check('T8d filtre dans le rayon', lignes().length > 0 && noms().every(n => /lot/i.test(n) && /12/.test(n)), noms());
  filtreEl.value = ''; filtreEl.listeners.input[0]();

  const dernierOverlay = () => { const k = $('modal-root').children; return k[k.length - 1].children[0].innerHTML; };
  const soumettre = () => $('article-form').onsubmit({ preventDefault() {} });

  // Déplacer un article vers un autre rayon depuis sa fiche
  const aDeplacer = famMin.articles.find(a => /^Labradorite/.test(a.nom));
  t.openArticleForm(famMin, aDeplacer);
  $('af-nom').value = aDeplacer.nom; $('af-prix').value = '15'; $('af-stock').value = '2'; $('af-desc').value = '';
  $('af-rayon').value = famBij.id;
  soumettre();
  check('T8e changement de rayon : article déplacé', !famMin.articles.includes(aDeplacer) && famBij.articles.includes(aDeplacer));

  // « Ajouter et en faire un autre » : ajoute puis rouvre une fiche (même rayon, prix et quantité gardés)
  const avant = famBij.articles.length;
  t.openArticleForm(famBij, null);
  $('af-nom').value = 'Pendentif test série'; $('af-prix').value = '12,50'; $('af-stock').value = '4'; $('af-desc').value = 'd';
  $('af-rayon').value = famBij.id;
  $('af-suite').onclick();
  soumettre();
  const suiv = dernierOverlay();
  check('T8f « Ajouter et en faire un autre »', famBij.articles.length === avant + 1 && /Nouvel article</.test(suiv) &&
    /id="af-prix"[^>]*value="12,50"/.test(suiv) && /id="af-stock"[^>]*value="4"/.test(suiv) && new RegExp('value="' + famBij.id + '" selected').test(suiv));

  // Dupliquer : fiche pré-remplie, rien n'est créé avant « Ajouter »
  const modele = famBij.articles.find(a => a.nom === 'Pendentif test série');
  t.openArticleForm(famBij, null, modele);
  const dup = dernierOverlay();
  check('T8g Dupliquer : fiche pré-remplie, rien de créé', /Nouvel article \(copie\)/.test(dup) && /value="Pendentif test série"/.test(dup) && famBij.articles.length === avant + 1);
  $('af-nom').value = 'Pendentif test série 2'; $('af-prix').value = '12,50'; $('af-stock').value = '4'; $('af-rayon').value = famBij.id;
  soumettre();
  const copie = famBij.articles.find(a => a.nom === 'Pendentif test série 2');
  check('T8h copie créée, distincte du modèle', !!copie && copie !== modele && copie.id !== modele.id && copie.prixBoutique === 12.5 && copie.stock === 4, copie);

  // Rayon proposé par « ＋ Nouvel article »
  t.state.univers = 'esoterisme'; t.state.rayonsOuverts = {};
  check('T8i rayon par défaut = rayon de l\'univers affiché', t.rayonParDefaut() === t.state.catalogue.themes.esoterisme.familles[0]);
  t.state.univers = 'bijoux';
  check('T8j … ou le dernier rayon utilisé s\'il est dans cet univers', t.rayonParDefaut() === famBij);
  check('T8k aucune alerte pendant ces manipulations', alerts.length === 0, alerts);

  // T9 : fusion à trois voies (cas unitaires)
  const mk = (arts, aff) => ({ actualites: aff || [], themes: { m: { nom: 'M', familles: [{ id: 'r1', nom: 'R1', articles: arts }, { id: 'r2', nom: 'R2', articles: [] }] } } });
  const A = (id, nom, extra) => Object.assign({ id: id, nom: nom, prix: 1 }, extra || {});
  const cl = o => JSON.parse(JSON.stringify(o));
  const noms9 = c => c.themes.m.familles.map(f => f.id + ':' + f.articles.map(a => a.nom).join(',')).join(' | ');
  { const base = mk([A('a', 'A'), A('b', 'B')]), loc = cl(base), dis = cl(base);
    loc.themes.m.familles[0].articles.push(A('n', 'Nouveau ici'));
    dis.themes.m.familles[0].articles[1].nom = 'B modifié ailleurs';
    dis.themes.m.familles[0].articles.push(A('x', 'Nouveau ailleurs'));
    t.fusionTroisVoies(base, loc, dis);
    check('T9a ajout ici + modif ailleurs + ajout ailleurs', noms9(loc) === 'r1:A,B modifié ailleurs,Nouveau ici,Nouveau ailleurs | r2:', noms9(loc)); }
  { const base = mk([A('a', 'A'), A('b', 'B')]), loc = cl(base), dis = cl(base);
    dis.themes.m.familles[0].articles.splice(1, 1);            // B supprimé ailleurs
    loc.themes.m.familles[0].articles[0].nom = 'A ici';         // A modifié ici
    t.fusionTroisVoies(base, loc, dis);
    check('T9b suppression ailleurs appliquée, modif ici gardée', noms9(loc) === 'r1:A ici | r2:', noms9(loc)); }
  { const base = mk([A('a', 'A')]), loc = cl(base), dis = cl(base);
    loc.themes.m.familles[0].articles[0].nom = 'A ici';
    dis.themes.m.familles[0].articles.splice(0, 1);            // supprimé ailleurs mais modifié ici
    t.fusionTroisVoies(base, loc, dis);
    check('T9c supprimé ailleurs mais modifié ici : gardé', noms9(loc) === 'r1:A ici | r2:', noms9(loc)); }
  { const base = mk([A('a', 'A')]), loc = cl(base), dis = cl(base);
    const art = dis.themes.m.familles[0].articles.splice(0, 1)[0]; dis.themes.m.familles[1].articles.push(art);   // déplacé ailleurs
    t.fusionTroisVoies(base, loc, dis);
    check('T9d article déplacé ailleurs : suivi', noms9(loc) === 'r1: | r2:A', noms9(loc)); }
  { const base = mk([A('a', 'A')]), loc = cl(base), dis = cl(base);
    dis.themes.m.familles[0].articles[0].stripe = 'https://buy/a';   // robot seulement
    const avantF = JSON.stringify(loc);
    const n = t.fusionTroisVoies(base, loc, dis);
    check('T9e changement de robot seul : rien de « récupéré » côté contenu', n === 0 && JSON.stringify(loc) === avantF); }

  console.log('\n' + (ko ? ko + ' ÉCHEC(S) sur ' + total : 'TOUS LES TESTS PASSENT (' + total + ')'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(2); });
