/* Administration du catalogue La Géode — interface simplifiée « magasin ».
   Vocabulaire côté gérante : univers → rayon (= famille dans le JSON) → article.
   Lit et écrit data/catalogue.json + images/ dans le dépôt GitHub via l'API
   Contents, entièrement côté navigateur. Les modifications sont accumulées
   puis envoyées en une fois avec « Mettre en ligne ». */

(function () {
  'use strict';

  var OWNER = 'Thomas-FINKELSTEIN';
  var REPO = 'la-geode';
  var BRANCH = 'main';
  var SITE = 'https://lageode66.fr';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  var GITAPI = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/';
  var RAW = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/';
  var CATALOGUE_PATH = 'data/catalogue.json';
  var ACCES_PATH = 'admin/acces.json';
  var PBKDF2_ITERATIONS = 1000000;
  var PHOTO_MAX = 1200;
  var PHOTO_QUALITY = 0.82;

  // Frais de paiement en ligne : on couvre la commission Stripe la plus élevée
  // (carte étrangère : 3,25 % + 0,25 €) pour ne jamais perdre, quelle que soit
  // la carte du client. Le prix en ligne est le même pour tout le monde (légal ;
  // ce n'est pas un supplément selon la carte, interdit en France).
  var COMMISSION_PCT = 0.0325;
  var COMMISSION_FIXE = 0.25;

  // Adresse du relais IA Cloudflare (voir cloudflare/README.md). Vide = bouton masqué.
  var IA_WORKER_URL = 'https://geode-ia.lageodeshowroom.workers.dev/';

  // Prix à afficher/encaisser en ligne pour toucher net le prix boutique.
  function prixSite(pb) {
    if (pb === null || pb === undefined || pb === '' || isNaN(Number(pb))) return null;
    var n = Number(pb);
    if (n <= 0) return null;
    return Math.ceil((n + COMMISSION_FIXE) / (1 - COMMISSION_PCT) * 100) / 100;
  }

  // Les 4 univers, dans l'ordre, avec leur couleur et leur page sur le site.
  var UNIVERS = [
    { key: 'mineraux', nom: 'Minéraux', court: 'Minéraux', path: 'mineraux', couleur: '#b795e3' },
    { key: 'bijoux', nom: 'Bijoux', court: 'Bijoux', path: 'bijoux', couleur: '#e0a3a8' },
    { key: 'esoterisme', nom: 'Ésotérisme & encens', court: 'Ésotérisme', path: 'esoterisme', couleur: '#85c9ab' },
    { key: 'decoration', nom: 'Décoration du monde', court: 'Décoration', path: 'decoration', couleur: '#cdb289' },
    { key: '__actus', nom: 'Affiches & promos', court: 'Affiches', path: '', couleur: '#c9a86a' }
  ];

  var state = {
    token: localStorage.getItem('geode-admin-token') || '',
    catalogue: null,
    sha: null,
    univers: 'mineraux',
    nbModifs: 0,
    pendingPhotos: {},
    rayonsOuverts: {},
    rev: 0,               // compteur de modifications (jamais remis à zéro)
    premiereModif: null,  // heure de la 1re modification pas encore en ligne
    publication: false,   // une mise en ligne est en cours
    autoBloque: false,    // mise en ligne auto suspendue (modif. depuis un autre appareil)
    autoEssaiApres: 0,    // après un échec, pas de nouvel essai auto avant cette heure
    autoEchecs: 0,
    triDate: false,       // vue « tous les articles, du plus récent au plus ancien »
    limiteDate: 100,
    limiteRayon: {},      // nombre d'articles affichés par rayon (par paquets de 50)
    filtreRayon: {},      // texte du filtre de chaque gros rayon
    dernierFamId: null    // rayon de la dernière fiche (rayon par défaut de « ＋ Nouvel article »)
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- API GitHub ---------- */

  function gh(path, options) {
    options = options || {};
    options.headers = {
      'Authorization': 'Bearer ' + state.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    return fetch(API + path + (options.method ? '' : '?ref=' + BRANCH + '&t=' + Date.now()), options);
  }

  function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64DecodeUtf8(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))); }

  function putFile(path, base64Content, message, sha) {
    var body = { message: message, content: base64Content, branch: BRANCH };
    if (sha) body.sha = sha;
    return gh(path, { method: 'PUT', body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('Erreur ' + r.status)); });
        return r.json();
      });
  }

  /* ---------- API Git Data (pour les fichiers > 1 Mo) ----------
     L'API Contents (ci-dessus) plafonne à 1 Mo en lecture comme en écriture.
     Le catalogue peut dépasser cette taille (toute la boutique) : on lit alors
     le contenu via les « blobs » et on écrit via blob → arbre → commit → ref.
     Ça n'a pas de limite pratique (jusqu'à 100 Mo). */

  function ghg(endpoint, options) {
    options = options || {};
    options.headers = {
      'Authorization': 'Bearer ' + state.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var sep = endpoint.indexOf('?') === -1 ? '?' : '&';
    return fetch(GITAPI + endpoint + (options.method ? '' : sep + 't=' + Date.now()), options);
  }

  function okJson(r) {
    if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('Erreur ' + r.status)); });
    return r.json();
  }

  /* Rend le contenu texte d'un fichier à partir de sa fiche Contents. Si le
     contenu est inline (< 1 Mo) on le décode ; sinon on lit le blob par sha. */
  function contenuDepuisMeta(meta) {
    if (meta.content && meta.encoding === 'base64') {
      return Promise.resolve(b64DecodeUtf8(meta.content));
    }
    return ghg('git/blobs/' + meta.sha).then(okJson).then(function (b) {
      return b64DecodeUtf8(b.content);
    });
  }

  /* Crée un blob Git à partir d'un contenu déjà encodé en base64. */
  function creerBlob(base64Content) {
    return ghg('git/blobs', { method: 'POST', body: JSON.stringify({ content: base64Content, encoding: 'base64' }) })
      .then(okJson).then(function (b) { return b.sha; });
  }

  /* Écrit plusieurs fichiers en UN commit (photos + catalogue), sans limite de
     taille. Échoue proprement si la branche a bougé entre-temps (fast-forward).
     attendu = { path, sha } : refuse d'écrire (erreur PAS_A_JOUR) si ce fichier
     a changé en ligne depuis notre dernière lecture — sinon on effacerait ce
     qu'un robot (liens de paiement, stock) y a écrit entre-temps.
     Renvoie { shas : { chemin: sha du blob écrit } }. */
  function committerFichiers(fichiers, message, attendu) {
    var parentSha, baseTreeSha, shas = {};
    return ghg('git/ref/heads/' + BRANCH).then(okJson).then(function (ref) {
      parentSha = ref.object.sha;
      if (!attendu) return null;
      return ghg('contents/' + attendu.path + '?ref=' + parentSha).then(okJson).then(function (meta) {
        if (meta.sha !== attendu.sha) throw new Error('PAS_A_JOUR');
      });
    }).then(function () {
      return ghg('git/commits/' + parentSha).then(okJson);
    }).then(function (commit) {
      baseTreeSha = commit.tree.sha;
      var arbre = [];
      var chaine = Promise.resolve();
      fichiers.forEach(function (f) {
        chaine = chaine.then(function () { return creerBlob(f.base64); }).then(function (sha) {
          shas[f.path] = sha;
          arbre.push({ path: f.path, mode: '100644', type: 'blob', sha: sha });
        });
      });
      return chaine.then(function () { return arbre; });
    }).then(function (arbre) {
      return ghg('git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTreeSha, tree: arbre }) }).then(okJson);
    }).then(function (tree) {
      return ghg('git/commits', { method: 'POST', body: JSON.stringify({ message: message, tree: tree.sha, parents: [parentSha] }) }).then(okJson);
    }).then(function (commit) {
      return ghg('git/refs/heads/' + BRANCH, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) }).then(okJson);
    }).then(function () {
      return { shas: shas };
    });
  }

  /* ---------- Connexion par mot de passe (AES-GCM + PBKDF2) ---------- */

  function bytesToB64(b) { var s = ''; new Uint8Array(b).forEach(function (x) { s += String.fromCharCode(x); }); return btoa(s); }
  function b64ToBytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

  function deriveKey(password, salt, iterations) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function chiffrerToken(token, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, PBKDF2_ITERATIONS).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(token));
    }).then(function (data) {
      return { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data) };
    });
  }

  function dechiffrerToken(acces, password) {
    return deriveKey(password, b64ToBytes(acces.salt), acces.iterations).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(acces.iv) }, key, b64ToBytes(acces.data));
    }).then(function (buf) { return new TextDecoder().decode(buf); });
  }

  /* ---------- Utilitaires ---------- */

  function slug(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40) || 'x';
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 6); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function prixLabel(prix) { return (prix === null || prix === undefined || prix === '') ? 'Prix en boutique' : Number(prix).toLocaleString('fr-FR') + ' €'; }
  function prixFr(prix) { return prix === null || prix === undefined ? '' : String(prix).replace('.', ','); }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function markDirty() {
    if (!state.nbModifs) state.premiereModif = Date.now();
    state.nbModifs++;
    state.rev++;
    updateStatusbar();
    sauverBrouillon();
  }

  /* ---------- Brouillon automatique ----------
     Chaque modification est gardée dans le navigateur : si la page est rechargée
     (F5, plantage, onglet fermé) avant la mise en ligne, rien n'est perdu. */
  var BROUILLON_KEY = 'geode-brouillon';

  function sauverBrouillon() {
    try {
      if (!state.nbModifs) { localStorage.removeItem(BROUILLON_KEY); return; }
      localStorage.setItem(BROUILLON_KEY, JSON.stringify({
        date: Date.now(),
        nbModifs: state.nbModifs,
        empreinte: state.empreinte,
        catalogue: state.catalogue,
        pendingPhotos: state.pendingPhotos
      }));
    } catch (e) { /* stockage plein : on garde le brouillon précédent */ }
  }

  function restaurerBrouillon() {
    var brut = null;
    try { brut = localStorage.getItem(BROUILLON_KEY); } catch (e) {}
    if (!brut) return;
    var b = null;
    try { b = JSON.parse(brut); } catch (e) {}
    if (!b || !b.nbModifs || !b.catalogue) { try { localStorage.removeItem(BROUILLON_KEY); } catch (e) {} return; }
    var quand = new Date(b.date).toLocaleString('fr-FR');
    if (!confirm('Bonne nouvelle : vos modifications non mises en ligne (' + b.nbModifs +
      ' changement' + (b.nbModifs > 1 ? 's' : '') + ', le ' + quand + ') ont été retrouvées.\n\n' +
      'Voulez-vous les récupérer ?')) {
      // Un clic trop rapide ne doit pas jeter le travail : on redemande.
      if (confirm('Supprimer DÉFINITIVEMENT ces ' + b.nbModifs + ' modification(s) non mises en ligne ?\n\n' +
        '« Annuler » = finalement les récupérer.')) {
        try { localStorage.removeItem(BROUILLON_KEY); } catch (e) {}
        return;
      }
    }
    var frais = state.catalogue;
    var empreinteFrais = empreinteSansRobot(frais);
    if (b.empreinte) {
      // Fusion avec la version en ligne : rien de ce qui a été fait ailleurs n'est écrasé.
      fusionTroisVoies(JSON.parse(b.empreinte), b.catalogue, frais);
    }
    // Champs des robots (ventes, stocks) de la version fraîche : aucune vente n'est perdue.
    grefferRobots(b.catalogue, frais);
    state.catalogue = b.catalogue;
    if (!state.catalogue.actualites) state.catalogue.actualites = [];
    state.pendingPhotos = b.pendingPhotos || {};
    state.nbModifs = b.nbModifs;
    state.premiereModif = Date.now();
    state.empreinte = empreinteFrais;
    // state.sha reste celui qui vient d'être chargé : la mise en ligne passera.
  }

  /* ---------- Mise en ligne automatique ----------
     Filet de sécurité : des changements qui attendent depuis 5 minutes sont mis
     en ligne tout seuls, en arrière-plan (aucune fenêtre, la fiche ouverte n'est
     pas touchée). Le bouton « Mettre en ligne » reste utilisable à tout moment. */
  var AUTO_DELAI = 5 * 60 * 1000;

  function infoAuto() {
    if (state.autoBloque || !state.premiereModif) return '';
    var cible = Math.max(state.premiereModif + AUTO_DELAI, state.autoEssaiApres);
    var reste = cible - Date.now();
    if (reste <= 0) return 'mise en ligne auto imminente';
    return 'mise en ligne auto dans ' + Math.ceil(reste / 60000) + ' min';
  }

  function updateStatusbar() {
    var dirty = state.nbModifs > 0;
    $('dot').className = 'dot' + (dirty ? ' dirty' : '');
    var txt;
    if (state.publication) {
      txt = 'Mise en ligne en cours…';
    } else if (dirty) {
      txt = state.nbModifs + ' changement' + (state.nbModifs > 1 ? 's' : '') + ' en attente';
      var info = infoAuto();
      if (info) txt += ' · ' + info;
    } else {
      txt = 'Tout est en ligne';
    }
    $('etat-txt').textContent = txt;
    $('btn-publish').disabled = !dirty || state.publication;
  }

  function verifierAutoPublication(immediat) {
    if (!state.catalogue || !state.nbModifs || state.publication || state.autoBloque) return;
    if (Date.now() < state.autoEssaiApres) return;
    if (!state.premiereModif) state.premiereModif = Date.now();
    if (immediat || Date.now() - state.premiereModif >= AUTO_DELAI) publish(true);
  }

  function setStatus(msg, ok) {
    var e = $('status-msg');
    e.textContent = msg || '';
    e.className = 'msg' + (ok ? ' ok' : '');
    e.style.margin = '0';
  }

  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('illisible')); };
      img.src = url;
    });
  }

  function alertePhoto() {
    alert('Cette photo n\'a pas pu être lue. Utilisez une photo JPG ou PNG.\n' +
      'Sur iPhone : Réglages → Appareil photo → Formats → « Le plus compatible ».');
  }

  // Outil de recadrage : la gérante choisit la zone visible (cadre 4:3, comme
  // les vignettes du site). Renvoie le base64 JPEG recadré, ou null si annulé.
  var CROP_W = 1200, CROP_H = 900;

  function cropImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { construireCropper(img, url, resolve); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('illisible')); };
      img.src = url;
    });
  }

  function construireCropper(img, url, resolve) {
    var natW = img.naturalWidth, natH = img.naturalHeight;

    var overlay = document.createElement('div');
    overlay.className = 'crop-modal';
    overlay.innerHTML =
      '<div class="crop-box">' +
      '<h2>Cadrez votre photo</h2>' +
      '<p class="hint" style="margin:0 0 4px">Glissez la photo pour la déplacer, et utilisez le curseur pour zoomer. La zone dans le cadre sera affichée sur le site.</p>' +
      '<div class="crop-viewport" id="crop-vp"></div>' +
      '<div class="crop-zoom">🔍 <input type="range" id="crop-zoom" min="1" max="4" step="0.01" value="1"></div>' +
      '<div class="form-actions"><button type="button" class="primary" id="crop-ok">Valider le cadrage</button>' +
      '<button type="button" id="crop-cancel">Annuler</button></div>' +
      '</div>';
    $('modal-root').appendChild(overlay);

    var vp = $('crop-vp');
    img.className = 'crop-img';
    img.draggable = false;
    vp.appendChild(img);

    var FW = vp.clientWidth, FH = vp.clientHeight;
    var cover = Math.max(FW / natW, FH / natH);
    var zoom = 1, posX = 0, posY = 0;

    function dispW() { return natW * cover * zoom; }
    function dispH() { return natH * cover * zoom; }
    function clamp() {
      posX = Math.min(0, Math.max(FW - dispW(), posX));
      posY = Math.min(0, Math.max(FH - dispH(), posY));
    }
    function apply() {
      img.style.width = dispW() + 'px';
      img.style.height = dispH() + 'px';
      img.style.left = posX + 'px';
      img.style.top = posY + 'px';
    }
    // Centrage initial
    posX = (FW - dispW()) / 2;
    posY = (FH - dispH()) / 2;
    apply();

    $('crop-zoom').addEventListener('input', function () {
      var cx = (FW / 2 - posX) / dispW();
      var cy = (FH / 2 - posY) / dispH();
      zoom = Number(this.value);
      posX = FW / 2 - cx * dispW();
      posY = FH / 2 - cy * dispH();
      clamp(); apply();
    });

    var dragging = false, sx = 0, sy = 0;
    vp.addEventListener('pointerdown', function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY;
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      posX += e.clientX - sx; posY += e.clientY - sy;
      sx = e.clientX; sy = e.clientY;
      clamp(); apply();
    });
    vp.addEventListener('pointerup', function () { dragging = false; });
    vp.addEventListener('pointercancel', function () { dragging = false; });

    function fermer() { URL.revokeObjectURL(url); overlay.remove(); }

    $('crop-ok').onclick = function () {
      var s = dispW() / natW; // échelle natif → affiché
      var srcX = (-posX) / s, srcY = (-posY) / s, srcW = FW / s, srcH = FH / s;
      var canvas = document.createElement('canvas');
      canvas.width = CROP_W; canvas.height = CROP_H;
      canvas.getContext('2d').drawImage(img, srcX, srcY, srcW, srcH, 0, 0, CROP_W, CROP_H);
      var b64 = canvas.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1];
      fermer(); resolve(b64);
    };
    $('crop-cancel').onclick = function () { fermer(); resolve(null); };
  }

  function photoSrcAdmin(photo) {
    if (!photo) return null;
    if (state.pendingPhotos[photo]) return 'data:image/jpeg;base64,' + state.pendingPhotos[photo];
    if (/^https?:/.test(photo)) return photo;
    return '../' + photo;
  }

  function uInfo(key) {
    for (var i = 0; i < UNIVERS.length; i++) if (UNIVERS[i].key === key) return UNIVERS[i];
    return UNIVERS[0];
  }

  /* ---------- Chargement ---------- */

  function loadCatalogue() {
    setStatus('Chargement…');
    return gh(CATALOGUE_PATH).then(function (r) {
      if (r.status === 401) throw new Error('Code d\'accès refusé — vérifiez-le.');
      if (!r.ok) throw new Error('Impossible de charger la boutique (erreur ' + r.status + ')');
      return r.json();
    }).then(function (j) {
      state.sha = j.sha;
      return contenuDepuisMeta(j);
    }).then(function (txt) {
      state.catalogue = JSON.parse(txt);
      if (!state.catalogue.actualites) state.catalogue.actualites = [];
      state.empreinte = empreinteSansRobot(state.catalogue);
      setStatus('');
    });
  }

  /* ---------- Fusion automatique avec les robots ----------
     Pendant que la gérante travaille, les robots (ventes Stripe, stock) peuvent
     modifier le catalogue sur GitHub. Ils ne touchent qu'à ces champs-là : */
  var CHAMPS_ROBOT = ['stripe', 'stripeProductId', 'stripePriceId', 'stripeLinkId',
    'stripePrix', 'stripeMode', 'stripeNom', 'stripeDesc', 'stripeStock', 'epuise'];

  function chaqueArticle(cat, cb) {
    Object.keys(cat.themes || {}).forEach(function (t) {
      (cat.themes[t].familles || []).forEach(function (f) {
        (f.articles || []).forEach(cb);
      });
    });
  }

  /* Photographie du catalogue sans les champs robots : sert à savoir si un
     changement distant vient d'un robot (fusion sans risque) ou d'un humain. */
  function empreinteSansRobot(cat) {
    var copie = JSON.parse(JSON.stringify(cat));
    chaqueArticle(copie, function (a) {
      CHAMPS_ROBOT.forEach(function (c) { delete a[c]; });
    });
    return JSON.stringify(copie);
  }

  /* Fusion à trois voies, article par article (comme Git) :
     base    = dernière version en ligne connue (celle dont notre copie est partie)
     local   = notre copie, modifiée SUR PLACE (les fiches ouvertes restent valides)
     distant = la version en ligne actuelle
     Règles : tout ce qui a été fait ici est gardé ; ce qui a changé ailleurs sur
     ce qu'on n'a pas touché est récupéré ; même article modifié des deux côtés :
     notre version l'emporte. Plus jamais de refus en bloc.
     Renvoie le nombre de changements récupérés d'ailleurs. */
  function fusionTroisVoies(base, local, distant) {
    var recup = 0;
    function humain(a) {
      var c = {};
      Object.keys(a).sort().forEach(function (k) { if (CHAMPS_ROBOT.indexOf(k) === -1) c[k] = a[k]; });
      return JSON.stringify(c);
    }
    function indexer(cat) {
      var fams = {}, arts = {};
      Object.keys(cat.themes || {}).forEach(function (t) {
        (cat.themes[t].familles || []).forEach(function (f) {
          fams[f.id] = { t: t, f: f };
          (f.articles || []).forEach(function (a) { arts[a.id] = { fam: f.id, a: a, sig: humain(a) + '@' + f.id }; });
        });
      });
      return { fams: fams, arts: arts };
    }
    function metaRayon(f) { return JSON.stringify([f.nom, f.slogan || '']); }
    var B = indexer(base), L = indexer(local), D = indexer(distant);

    // 1) Rayons créés ou modifiés ailleurs
    Object.keys(D.fams).forEach(function (id) {
      var d = D.fams[id], l = L.fams[id], b = B.fams[id];
      if (!l && !b) {
        if (!local.themes[d.t]) local.themes[d.t] = { nom: distant.themes[d.t].nom, familles: [] };
        if (!local.themes[d.t].familles) local.themes[d.t].familles = [];
        var nf = JSON.parse(JSON.stringify(d.f));
        nf.articles = [];
        local.themes[d.t].familles.push(nf);
        L.fams[id] = { t: d.t, f: nf };
        recup++;
      } else if (l && b && metaRayon(l.f) === metaRayon(b.f) && metaRayon(d.f) !== metaRayon(b.f)) {
        l.f.nom = d.f.nom; l.f.slogan = d.f.slogan;
        recup++;
      }
    });

    // 2) Articles
    function retirer(e) { var arr = L.fams[e.fam].f.articles; var i = arr.indexOf(e.a); if (i !== -1) arr.splice(i, 1); }
    function placer(a, famId) {
      var lf = L.fams[famId];
      if (!lf) return false;
      if (!lf.f.articles) lf.f.articles = [];
      lf.f.articles.push(a);
      return true;
    }
    var ids = {};
    [B.arts, L.arts, D.arts].forEach(function (x) { Object.keys(x).forEach(function (k) { ids[k] = 1; }); });
    Object.keys(ids).forEach(function (id) {
      var b = B.arts[id], l = L.arts[id], d = D.arts[id];
      if (!b) {                                               // nouvel article
        if (d && !l && placer(JSON.parse(JSON.stringify(d.a)), d.fam)) recup++;   // ajouté ailleurs
        return;                                               // ajouté ici : gardé
      }
      if (!l) return;                                         // supprimé ici : on garde la suppression
      var changeIci = l.sig !== b.sig;
      var changeAilleurs = !d || d.sig !== b.sig;
      if (!changeAilleurs || changeIci) return;               // rien ailleurs, ou notre version prime
      if (!d) { retirer(l); recup++; return; }                // supprimé ailleurs, intact ici
      Object.keys(l.a).forEach(function (k) { if (CHAMPS_ROBOT.indexOf(k) === -1) delete l.a[k]; });
      Object.keys(d.a).forEach(function (k) { if (CHAMPS_ROBOT.indexOf(k) === -1) l.a[k] = d.a[k]; });
      if (d.fam !== l.fam && L.fams[d.fam]) { retirer(l); placer(l.a, d.fam); }
      recup++;
    });

    // 3) Rayons supprimés ailleurs, restés intacts et vides ici
    Object.keys(B.fams).forEach(function (id) {
      var l = L.fams[id];
      if (!D.fams[id] && l && metaRayon(l.f) === metaRayon(B.fams[id].f) && !(l.f.articles || []).length) {
        var arr = local.themes[l.t].familles;
        arr.splice(arr.indexOf(l.f), 1);
        recup++;
      }
    });

    // 4) Affiches
    function idxAff(cat) { var m = {}; (cat.actualites || []).forEach(function (a) { m[a.id] = a; }); return m; }
    var bA = idxAff(base), lA = idxAff(local), dA = idxAff(distant);
    if (!local.actualites) local.actualites = [];
    var idsA = {};
    [bA, lA, dA].forEach(function (x) { Object.keys(x).forEach(function (k) { idsA[k] = 1; }); });
    Object.keys(idsA).forEach(function (id) {
      var b = bA[id], l = lA[id], d = dA[id];
      if (!b) { if (d && !l) { local.actualites.push(JSON.parse(JSON.stringify(d))); recup++; } return; }
      if (!l) return;
      var sb = JSON.stringify(b);
      if (JSON.stringify(l) !== sb) return;
      if (!d) { local.actualites.splice(local.actualites.indexOf(l), 1); recup++; return; }
      if (JSON.stringify(d) !== sb) {
        Object.keys(l).forEach(function (k) { delete l[k]; });
        Object.assign(l, JSON.parse(JSON.stringify(d)));
        recup++;
      }
    });
    return recup;
  }

  // Greffe les champs des robots (ventes, liens de paiement, stock) de « source » dans « cible ».
  function grefferRobots(cible, source) {
    var parId = {};
    chaqueArticle(source, function (a) { parId[a.id] = a; });
    chaqueArticle(cible, function (a) {
      var d = parId[a.id];
      if (!d) return;
      CHAMPS_ROBOT.forEach(function (c) { if (d[c] === undefined) delete a[c]; else a[c] = d[c]; });
    });
  }

  /* Récupère la dernière version en ligne et la fusionne avec notre copie
     (voir fusionTroisVoies), puis met à jour le sha pour republier. */
  function fusionnerRobots() {
    var shaDistant;
    return gh(CATALOGUE_PATH).then(function (r) {
      if (!r.ok) throw new Error('Erreur ' + r.status);
      return r.json();
    }).then(function (j) {
      shaDistant = j.sha;
      return contenuDepuisMeta(j);
    }).then(function (txt) {
      var distant = JSON.parse(txt);
      if (!distant.actualites) distant.actualites = [];
      var base = state.empreinte ? JSON.parse(state.empreinte) : distant;
      var recup = fusionTroisVoies(base, state.catalogue, distant);
      grefferRobots(state.catalogue, distant);
      state.empreinte = empreinteSansRobot(distant);
      state.sha = shaDistant;
      if (recup) render();
    });
  }

  /* ---------- Fenêtre modale ---------- */

  /* classe : '' (fenêtre simple) ou 'fiche' (fiche article : boutons collés en
     bas, plein écran sur téléphone). */
  function openModal(html, classe) {
    closeModal();
    fermerMenu();
    var overlay = document.createElement('div');
    overlay.className = 'modal' + (classe === 'fiche' ? ' modal-fiche' : ''); overlay.id = 'modal';
    var box = document.createElement('div');
    box.className = 'modal-box' + (classe ? ' ' + classe : '');
    box.innerHTML = html;
    overlay.appendChild(box);
    $('modal-root').appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return box;
  }
  function closeModal() { var m = $('modal'); if (m) m.remove(); document.body.style.overflow = ''; }

  /* ---------- Petits menus « ⋯ » ---------- */

  var menuOuvert = null;
  function fermerMenu() {
    if (!menuOuvert) return;
    if (menuOuvert._ancre) menuOuvert._ancre.setAttribute('aria-expanded', 'false');
    menuOuvert.remove();
    menuOuvert = null;
  }
  // items : [{ label, action, danger }] ou '-' pour un séparateur
  function ouvrirMenu(ancre, items) {
    var memeAncre = menuOuvert && menuOuvert._ancre === ancre;
    fermerMenu();
    if (memeAncre) return;                       // 2e clic sur ⋯ : on referme
    var m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m._ancre = ancre;
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.setAttribute('role', 'menuitem');
      if (it.danger) b.className = 'danger';
      b.onclick = function (e) { e.stopPropagation(); fermerMenu(); it.action(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = ancre.getBoundingClientRect();
    var larg = m.offsetWidth, haut = m.offsetHeight;
    var gauche = Math.min(Math.max(8, r.right - larg), window.innerWidth - larg - 8);
    var haute = r.bottom + 6;
    if (haute + haut > window.innerHeight - 8) haute = Math.max(8, r.top - haut - 6);
    m.style.left = gauche + 'px';
    m.style.top = haute + 'px';
    ancre.setAttribute('aria-expanded', 'true');
    menuOuvert = m;
    var premier = m.querySelector('button');
    if (premier) premier.focus();
  }
  document.addEventListener('click', function (e) {
    if (menuOuvert && !menuOuvert.contains(e.target) && e.target !== menuOuvert._ancre) fermerMenu();
  });
  window.addEventListener('scroll', function () { fermerMenu(); }, true);
  window.addEventListener('resize', function () { fermerMenu(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (menuOuvert) { var a = menuOuvert._ancre; fermerMenu(); if (a) a.focus(); return; }
    closeModal();
  });

  /* ---------- Sélecteur d'univers ---------- */

  function compteUnivers(key) {
    if (key === '__actus') return state.catalogue.actualites.length;
    var t = state.catalogue.themes[key];
    if (!t) return 0;
    var n = 0;
    (t.familles || []).forEach(function (f) { n += (f.articles || []).length; });
    return n;
  }

  // Onglets des univers, dans la barre fixe en haut (toujours visibles).
  function renderOnglets() {
    var nav = $('univers-onglets');
    nav.innerHTML = '';
    UNIVERS.forEach(function (u) {
      if (u.key !== '__actus' && !state.catalogue.themes[u.key]) return;
      var actif = u.key === state.univers && !state.triDate;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'onglet' + (u.key === '__actus' ? ' affiches' : '') + (actif ? ' actif' : '');
      b.style.setProperty('--uc', u.couleur);
      b.setAttribute('aria-pressed', actif ? 'true' : 'false');
      b.title = u.nom;
      b.innerHTML = '<span class="pastille"></span>' + esc(u.court) + ' <span class="n">' + compteUnivers(u.key) + '</span>';
      b.onclick = function () {
        state.univers = u.key; state.triDate = false; majBoutonTri();
        $('admin-search').value = ''; $('resultats-recherche').innerHTML = '';
        render();
        window.scrollTo(0, 0);
      };
      nav.appendChild(b);
      if (actif && typeof b.offsetLeft === 'number') nav.scrollLeft = Math.max(0, b.offsetLeft - 24);
    });
  }

  function supprimerRayon(theme, fam) {
    var n = (fam.articles || []).length;
    if (confirm('Supprimer le rayon « ' + fam.nom + ' »' + (n ? ' et ses ' + n + ' article(s)' : '') + ' ?')) {
      theme.familles.splice(theme.familles.indexOf(fam), 1);
      markDirty(); render();
    }
  }

  /* ---------- Ligne d'article ---------- */

  function articleRow(fam, art, contexte) {
    var row = document.createElement('div');
    row.className = 'art';
    var src = photoSrcAdmin(art.photo);
    var tags = '';
    if (!art.photo) tags += '<span class="tag">sans photo</span>';
    if (art.epuise) tags += '<span class="tag tag-rouge">épuisé</span>';
    else if (art.stock != null) tags += '<span class="tag tag-stock">stock : ' + esc(art.stock) + '</span>';
    var pb = art.prixBoutique != null ? art.prixBoutique : art.prix;
    var prixTxt = prixLabel(pb);
    if (pb != null && art.prix != null && Number(art.prix) !== Number(pb)) {
      prixTxt += ' <span style="color:var(--faded)">· en ligne ' + Number(art.prix).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €</span>';
    }
    row.innerHTML =
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '<div class="noimg">💎</div>') +
      '<div class="art-info">' +
      '<div class="art-nom">' + esc(art.nom) + '</div>' +
      '<div class="art-ligne2"><span class="art-prix">' + prixTxt + '</span>' + tags +
      (contexte ? ' · ' + esc(contexte) : '') + '</div>' +
      '</div>';
    row.title = 'Modifier « ' + art.nom + ' »';
    // Toute la ligne ouvre la fiche (grande cible, pratique au doigt).
    row.onclick = function () { openArticleForm(fam, art); };
    var actions = document.createElement('div');
    actions.className = 'art-actions';
    var dup = document.createElement('button');
    dup.type = 'button';
    dup.className = 'mini';
    dup.innerHTML = '⧉<span class="txt"> Dupliquer</span>';
    dup.title = 'Nouvel article pré-rempli à partir de celui-ci (pratique pour une série)';
    dup.setAttribute('aria-label', 'Dupliquer « ' + art.nom + ' »');
    dup.onclick = function (e) { e.stopPropagation(); openArticleForm(fam, null, art); };
    var mod = document.createElement('button');
    mod.type = 'button';
    mod.className = 'mini btn-modifier';
    mod.textContent = 'Modifier';
    mod.onclick = function (e) { e.stopPropagation(); openArticleForm(fam, art); };
    actions.appendChild(dup);
    actions.appendChild(mod);
    row.appendChild(actions);
    return row;
  }

  /* ---------- Vue d'un univers (rayons + articles) ---------- */

  function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }

  function renderUnivers(contenu) {
    var u = uInfo(state.univers);
    var theme = state.catalogue.themes[state.univers];
    var familles = theme.familles || [];

    // En-tête compact : nom, chiffres, lien vers le site, « ＋ Nouveau rayon ».
    var entete = document.createElement('div');
    entete.className = 'univers-entete';
    entete.innerHTML =
      '<span class="puce" style="background:' + u.couleur + '"></span>' +
      '<h2>' + esc(u.nom) + '</h2>' +
      '<span class="compte">' + pluriel(familles.length, 'rayon') + ' · ' + pluriel(compteUnivers(state.univers), 'article') + '</span>' +
      '<span class="spacer"></span>' +
      '<a class="voir-site" href="' + SITE + '/' + u.path + '/" target="_blank" rel="noopener">Voir sur le site ↗</a>';
    var btnNouv = document.createElement('button');
    btnNouv.type = 'button';
    btnNouv.className = 'mini';
    btnNouv.textContent = '＋ Nouveau rayon';
    btnNouv.onclick = function () { openRayonForm(theme, null); };
    entete.appendChild(btnNouv);
    contenu.appendChild(entete);

    familles.forEach(function (fam) { contenu.appendChild(carteRayon(theme, fam)); });

    if (!familles.length) {
      var vide = document.createElement('div');
      vide.className = 'rayon-vide';
      vide.textContent = 'Aucun rayon dans cet univers pour l\'instant. Cliquez sur « ＋ Nouveau rayon » pour commencer.';
      contenu.appendChild(vide);
    }
  }

  /* Un rayon = un accordéon. Ses articles ne sont construits qu'à l'ouverture
     (un rayon de 566 articles ne ralentit plus la page tant qu'il est fermé). */
  function carteRayon(theme, fam) {
    var carte = document.createElement('div');
    carte.className = 'rayon';
    var n = (fam.articles || []).length;
    var ouvert = !!state.rayonsOuverts[fam.id] || n === 0;

    var tete = document.createElement('div');
    tete.className = 'rayon-tete';
    tete.innerHTML =
      '<span class="chevron">' + (ouvert ? '▾' : '▸') + '</span>' +
      '<h3>' + esc(fam.nom) + '</h3>' +
      '<span class="nb">' + pluriel(n, 'article') + '</span>';
    var actions = document.createElement('div');
    actions.className = 'rayon-actions';
    var btnAdd = document.createElement('button');
    btnAdd.type = 'button';
    btnAdd.className = 'mini primary';
    btnAdd.innerHTML = '＋<span class="txt"> Ajouter ici</span>';
    btnAdd.title = 'Ajouter un article dans « ' + fam.nom + ' »';
    btnAdd.setAttribute('aria-label', 'Ajouter un article dans « ' + fam.nom + ' »');
    btnAdd.onclick = function (e) { e.stopPropagation(); openArticleForm(fam, null); };
    var btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'btn-menu';
    btnPlus.textContent = '⋯';
    btnPlus.setAttribute('aria-label', 'Options du rayon « ' + fam.nom + ' »');
    btnPlus.setAttribute('aria-haspopup', 'true');
    btnPlus.onclick = function (e) {
      e.stopPropagation();
      ouvrirMenu(btnPlus, [
        { label: '✏️  Modifier le rayon (nom, phrase)', action: function () { openRayonForm(theme, fam); } },
        '-',
        { label: '🗑️  Supprimer le rayon', danger: true, action: function () { supprimerRayon(theme, fam); } }
      ]);
    };
    actions.appendChild(btnAdd);
    actions.appendChild(btnPlus);
    tete.appendChild(actions);
    carte.appendChild(tete);

    var corps = document.createElement('div');
    corps.className = 'rayon-corps';
    if (!ouvert) corps.classList.add('hidden');
    carte.appendChild(corps);
    var rempli = false;
    function remplir() { if (!rempli) { rempli = true; remplirCorpsRayon(corps, fam); } }
    if (ouvert) remplir();

    // Clic sur l'en-tête (hors boutons) : plier / déplier.
    tete.onclick = function (e) {
      if (e.target.closest('button')) return;
      var plie = corps.classList.toggle('hidden');
      state.rayonsOuverts[fam.id] = !plie;
      if (!plie) remplir();
      var chev = tete.querySelector('.chevron');
      if (chev) chev.textContent = plie ? '▸' : '▾';
    };
    return carte;
  }

  var RAYON_PAGE = 50;

  // Contenu d'un rayon ouvert : les plus récents d'abord, par paquets de 50,
  // avec un filtre dès que le rayon est grand.
  function remplirCorpsRayon(corps, fam) {
    corps.innerHTML = '';
    if (fam.slogan) {
      var sl = document.createElement('p');
      sl.className = 'rayon-slogan';
      sl.textContent = fam.slogan;
      corps.appendChild(sl);
    }
    var n = (fam.articles || []).length;
    if (!n) {
      var vide = document.createElement('div');
      vide.className = 'rayon-vide';
      vide.textContent = 'Ce rayon est vide. Cliquez sur « ＋ » (Ajouter ici) pour y mettre un premier article.';
      corps.appendChild(vide);
      return;
    }
    var filtre = null;
    if (n > RAYON_PAGE) {
      filtre = document.createElement('input');
      filtre.type = 'search';
      filtre.className = 'filtre-rayon';
      filtre.placeholder = '🔎  Filtrer dans « ' + fam.nom + ' »…';
      filtre.setAttribute('aria-label', 'Filtrer les articles du rayon ' + fam.nom);
      filtre.value = state.filtreRayon[fam.id] || '';
      corps.appendChild(filtre);
    }
    var liste = document.createElement('div');
    corps.appendChild(liste);

    function dessiner() {
      liste.innerHTML = '';
      var q = filtre ? filtre.value.trim() : '';
      var tokens = norm(q).split(/\s+/).filter(function (t) { return t.length >= 2; });
      var arts = fam.articles.slice().sort(function (a, b) { return dateAjout(b) - dateAjout(a); });
      if (tokens.length) {
        arts = arts.filter(function (a) {
          var h = norm(a.nom + ' ' + (a.description || ''));
          return tokens.every(function (x) { return h.indexOf(x) !== -1; });
        });
      }
      var limite = state.limiteRayon[fam.id] || RAYON_PAGE;
      arts.slice(0, limite).forEach(function (art) { liste.appendChild(articleRow(fam, art)); });
      if (tokens.length && !arts.length) {
        var rien = document.createElement('div');
        rien.className = 'rayon-vide';
        rien.textContent = 'Aucun article de ce rayon ne correspond à « ' + q + ' ».';
        liste.appendChild(rien);
      }
      if (arts.length > limite) {
        var reste = arts.length - limite;
        var suite = document.createElement('button');
        suite.type = 'button';
        suite.className = 'mini voir-plus';
        suite.textContent = 'Afficher les ' + Math.min(RAYON_PAGE, reste) + ' suivants (encore ' + reste + ')';
        suite.onclick = function () { state.limiteRayon[fam.id] = limite + RAYON_PAGE; dessiner(); };
        liste.appendChild(suite);
      }
    }
    if (filtre) {
      filtre.addEventListener('input', function () {
        state.filtreRayon[fam.id] = filtre.value;
        state.limiteRayon[fam.id] = RAYON_PAGE;
        dessiner();
      });
    }
    dessiner();
  }

  /* ---------- Vue affiches / promos ---------- */

  function renderActus(contenu) {
    var actus = state.catalogue.actualites;
    var entete = document.createElement('div');
    entete.className = 'univers-entete';
    entete.innerHTML =
      '<span class="puce" style="background:#c9a86a"></span>' +
      '<h2>Affiches & promos</h2>' +
      '<span class="compte">' + pluriel(actus.length, 'affiche') + ' · en haut de la page d\'accueil</span>' +
      '<span class="spacer"></span>' +
      '<a class="voir-site" href="' + SITE + '/" target="_blank" rel="noopener">Voir l\'accueil ↗</a>';
    var btnAdd = document.createElement('button');
    btnAdd.type = 'button';
    btnAdd.className = 'mini primary';
    btnAdd.textContent = '＋ Nouvelle affiche';
    btnAdd.onclick = function () { openActuForm(null); };
    entete.appendChild(btnAdd);
    contenu.appendChild(entete);

    actus.forEach(function (actu) {
      var row = document.createElement('div');
      row.className = 'art';
      var src = photoSrcAdmin(actu.image);
      var etat = actu.fin
        ? (actu.fin < aujourdhui() ? '<span class="tag tag-rouge">terminée</span>' : '<span class="tag tag-stock">jusqu\'au ' + esc(actu.fin) + '</span>')
        : '<span style="color:var(--faded)">permanente</span>';
      row.innerHTML =
        (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="noimg">📣</div>') +
        '<div class="art-info"><div class="art-nom">' + esc(actu.titre) + '</div>' +
        '<div class="art-ligne2">' + etat + '</div></div>';
      row.onclick = function () { openActuForm(actu); };
      var actions = document.createElement('div');
      actions.className = 'art-actions';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mini';
      btn.textContent = 'Modifier';
      btn.onclick = function (e) { e.stopPropagation(); openActuForm(actu); };
      actions.appendChild(btn);
      row.appendChild(actions);
      contenu.appendChild(row);
    });

    if (!actus.length) {
      var vide = document.createElement('div');
      vide.className = 'rayon-vide';
      vide.textContent = 'Aucune affiche pour l\'instant. Cliquez sur « ＋ Nouvelle affiche ».';
      contenu.appendChild(vide);
    }
  }

  /* ---------- Rendu général ---------- */

  function render() {
    renderOnglets();
    var contenu = $('contenu');
    contenu.innerHTML = '';
    if (state.univers === '__actus') renderActus(contenu);
    else renderUnivers(contenu);
    // Si une recherche est en cours (ex. après une suppression), on la rafraîchit
    // pour que la liste des résultats reste à jour ; sinon on rétablit la vue.
    var champ = $('admin-search');
    var q = champ ? champ.value.trim() : '';
    if (q || state.triDate) renderRecherche(q); else rechercheActive(false);
  }

  /* ---------- Recherche ---------- */

  // Nombre total d'articles, pour l'indication « … sur N articles ».
  function nbArticlesTotal() {
    var n = 0;
    Object.keys(state.catalogue.themes).forEach(function (key) {
      (state.catalogue.themes[key].familles || []).forEach(function (fam) { n += (fam.articles || []).length; });
    });
    return n;
  }

  // Pendant une recherche, on masque la vue « univers » pour ne montrer que
  // les résultats (plus clair). Quand la recherche est vide, on la ré-affiche.
  function rechercheActive(on) {
    $('contenu').style.display = on ? 'none' : '';
  }

  // Quitte la recherche et le tri par date : retour aux rayons de l'univers.
  function quitterResultats() {
    $('admin-search').value = '';
    state.triDate = false;
    majBoutonTri();
    renderRecherche('');
  }

  var RECH_MAX = 80;
  var DATE_PAGE = 100;

  /* Date et heure d'ajout d'un article : elles sont inscrites dans son
     identifiant, créé une fois pour toutes à l'ajout (« nom-<horodatage en
     base 36><4 caractères aléatoires> », voir uid()). 0 si illisible. */
  function dateAjout(art) {
    var seg = String((art && art.id) || '').split('-').pop();
    if (seg.length < 8) return 0;
    var t = parseInt(seg.slice(0, 8), 36);
    return (t > 1577836800000 && t < Date.now() + 86400000) ? t : 0;   // entre 2020 et demain
  }

  function libelleJour(t) {
    if (!t) return 'Date d\'ajout inconnue';
    var d = new Date(t), auj = new Date();
    var ecart = Math.round((new Date(auj.getFullYear(), auj.getMonth(), auj.getDate()) -
      new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    var long = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (ecart === 0) return 'Aujourd\'hui · ' + long;
    if (ecart === 1) return 'Hier · ' + long;
    return long.charAt(0).toUpperCase() + long.slice(1);
  }

  function heureAjout(t) {
    var d = new Date(t);
    return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0');
  }

  /* Vue « résultats » : recherche par mots et/ou tri par date. Sans mots ni
     tri par date, on revient à la vue normale (univers et rayons). */
  function renderRecherche(q) {
    var box = $('resultats-recherche');
    box.innerHTML = '';
    var tokens = norm(q).split(/\s+/).filter(function (t) { return t.length >= 2; });
    if (!tokens.length && !state.triDate) { rechercheActive(false); return; }
    rechercheActive(true);

    var qJoin = tokens.join(' ');
    var resultats = [];
    Object.keys(state.catalogue.themes).forEach(function (key) {
      var theme = state.catalogue.themes[key];
      (theme.familles || []).forEach(function (fam) {
        (fam.articles || []).forEach(function (art) {
          var nomN = norm(art.nom);
          var score = 0;
          if (tokens.length) {
            var hay = nomN + ' ' + norm(fam.nom) + ' ' + norm(theme.nom) + ' ' + norm(art.description || '');
            // Recherche précise : TOUS les mots tapés doivent être présents.
            if (!tokens.every(function (x) { return hay.indexOf(x) !== -1; })) return;
            // Score : on remonte les correspondances dans le nom (les plus utiles).
            if (nomN === qJoin) score += 1000;
            else if (nomN.indexOf(qJoin) === 0) score += 500;
            else if (nomN.indexOf(qJoin) !== -1) score += 200;
            tokens.forEach(function (x) { if (nomN.indexOf(x) !== -1) score += 20; });
          }
          resultats.push({ art: art, fam: fam, ctx: theme.nom + ' › ' + fam.nom, score: score,
            len: nomN.length, date: dateAjout(art) });
        });
      });
    });
    if (state.triDate) resultats.sort(function (a, b) { return b.date - a.date; });
    else resultats.sort(function (a, b) { return b.score - a.score || a.len - b.len; });

    var carte = document.createElement('div');
    carte.className = 'resultats';
    var titre;
    if (!resultats.length) titre = 'Aucun résultat';
    else if (state.triDate && !tokens.length) titre = 'Tous les articles (' + resultats.length + '), du plus récent au plus ancien';
    else titre = resultats.length + ' résultat' + (resultats.length > 1 ? 's' : '') + ' sur ' + nbArticlesTotal() + ' articles' +
      (state.triDate ? ', du plus récent au plus ancien' : '');
    var tete = document.createElement('div');
    tete.className = 'resultats-tete';
    tete.innerHTML = '<div style="flex:1;min-width:0"><div class="etiq">' + (state.triDate ? 'Triés par date d\'ajout' : 'Recherche') +
      '</div><h3>' + esc(titre) + '</h3></div>';
    var retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'mini';
    retour.textContent = '← Revenir aux rayons';
    retour.onclick = quitterResultats;
    tete.appendChild(retour);
    carte.appendChild(tete);

    if (state.triDate) {
      // Groupés par jour (« Aujourd'hui », « Hier »…), avec l'heure d'ajout.
      var jourPrecedent = null;
      resultats.slice(0, state.limiteDate).forEach(function (r) {
        var jour = r.date ? new Date(r.date).toDateString() : 'inconnu';
        if (jour !== jourPrecedent) {
          var sep = document.createElement('div');
          sep.className = 'jour-sep';
          sep.textContent = libelleJour(r.date);
          carte.appendChild(sep);
          jourPrecedent = jour;
        }
        carte.appendChild(articleRow(r.fam, r.art, (r.date ? 'ajouté à ' + heureAjout(r.date) + ' · ' : '') + r.ctx));
      });
      if (resultats.length > state.limiteDate) {
        var suite = document.createElement('button');
        suite.type = 'button';
        suite.className = 'mini voir-plus';
        var reste = resultats.length - state.limiteDate;
        suite.textContent = 'Afficher les ' + Math.min(DATE_PAGE, reste) + ' suivants (encore ' + reste + ')';
        suite.onclick = function () { state.limiteDate += DATE_PAGE; renderRecherche(q); };
        carte.appendChild(suite);
      }
    } else {
      resultats.slice(0, RECH_MAX).forEach(function (r) { carte.appendChild(articleRow(r.fam, r.art, r.ctx)); });
      if (resultats.length > RECH_MAX) {
        var plus = document.createElement('div');
        plus.className = 'rayon-vide';
        plus.textContent = 'Affichage des ' + RECH_MAX + ' premiers · ajoutez un mot pour affiner.';
        carte.appendChild(plus);
      }
    }
    if (!resultats.length) {
      var v = document.createElement('div'); v.className = 'rayon-vide';
      v.textContent = 'Aucun article ne correspond à « ' + q + ' ». Essayez avec moins de mots, ou vérifiez l\'orthographe.';
      carte.appendChild(v);
    }
    box.appendChild(carte);
  }

  function majBoutonTri() {
    var b = $('btn-tri-date');
    if (!b) return;
    b.classList.toggle('actif', state.triDate);
    b.setAttribute('aria-pressed', state.triDate ? 'true' : 'false');
    if (state.catalogue) renderOnglets();   // en tri par date, aucun univers n'est sélectionné
  }

  /* ---------- Fiche article ----------
     Ordre de travail naturel : la photo d'abord, l'IA remplit le nom et la
     description, puis prix et quantité, puis le rayon (qui permet aussi de
     déplacer un article). Les boutons restent collés en bas de la fiche.
     - art     : article à modifier (sinon nouvel article)
     - modele  : article à dupliquer (fiche pré-remplie ; rien n'est créé avant « Ajouter »)
     - garde   : { prix, stock } repris de la fiche précédente (« Ajouter et en faire un autre ») */

  function listeRayons() {
    var l = [];
    UNIVERS.forEach(function (u) {
      var t = state.catalogue.themes[u.key];
      if (!t) return;
      (t.familles || []).forEach(function (f) { l.push({ cle: u.key, univers: u.nom, theme: t, fam: f }); });
    });
    return l;
  }

  function trouverRayon(famId) {
    var l = listeRayons();
    for (var i = 0; i < l.length; i++) if (l[i].fam.id === famId) return l[i];
    return null;
  }

  // Rayon proposé par « ＋ Nouvel article » : le dernier utilisé s'il est dans
  // l'univers affiché, sinon le rayon ouvert de cet univers, sinon son premier.
  function rayonParDefaut() {
    var dernier = state.dernierFamId && trouverRayon(state.dernierFamId);
    var t = state.catalogue.themes[state.univers];
    var fams = (t && t.familles) || [];
    if (dernier && dernier.cle === state.univers) return dernier.fam;
    var ouvert = fams.filter(function (f) { return state.rayonsOuverts[f.id]; })[0];
    if (ouvert) return ouvert;
    if (fams.length) return fams[0];
    if (dernier) return dernier.fam;
    var tous = listeRayons();
    return tous.length ? tous[0].fam : null;
  }

  function nouvelArticle() {
    var fam = rayonParDefaut();
    if (!fam) { alert('Créez d\'abord un rayon : ouvrez un univers puis « ＋ Nouveau rayon ».'); return; }
    openArticleForm(fam, null);
  }

  function openArticleForm(fam, art, modele, garde) {
    var source = art || modele || null;
    var photoTemp = null;
    var photoExistante = source ? source.photo || null : null;
    var titre = art ? 'Modifier l\'article' : modele ? 'Nouvel article (copie)' : 'Nouvel article';
    var prixDe = function (a) { return prixFr(a.prixBoutique != null ? a.prixBoutique : a.prix); };
    var prixInit = source ? prixDe(source) : garde ? garde.prix : '';
    var stockInit = source ? (source.stock != null ? source.stock : '') : garde ? garde.stock : '';

    // Liste des rayons, groupés par univers
    var options = '', groupe = null;
    listeRayons().forEach(function (r) {
      if (r.cle !== groupe) {
        if (groupe) options += '</optgroup>';
        options += '<optgroup label="' + esc(r.univers) + '">';
        groupe = r.cle;
      }
      options += '<option value="' + esc(r.fam.id) + '"' + (r.fam === fam ? ' selected' : '') + '>' + esc(r.fam.nom) + '</option>';
    });
    if (groupe) options += '</optgroup>';

    var pied = art
      ? '<button type="button" class="danger-link" id="af-delete">Supprimer</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" id="af-cancel">Annuler</button>' +
        '<button type="submit" class="primary">Enregistrer</button>'
      // Le bouton principal est le 1er bouton « submit » du formulaire : c'est lui
      // que déclenche la touche Entrée ; l'ordre visuel est rétabli par « order ».
      : '<button type="submit" class="primary" style="order:3">Ajouter l\'article</button>' +
        '<button type="button" id="af-cancel" style="order:0">Annuler</button>' +
        '<span class="spacer" style="order:1"></span>' +
        '<button type="submit" id="af-suite" style="order:2" title="Ajoute cet article, puis ouvre une nouvelle fiche dans le même rayon (prix et quantité gardés)">Ajouter et en faire un autre</button>';

    var box = openModal(
      '<div class="fiche-tete"><h2>' + titre + '</h2>' +
      '<button type="button" class="btn-menu discret" id="af-fermer" aria-label="Fermer la fiche">✕</button></div>' +
      '<form id="article-form" class="fiche-form" novalidate>' +
      '<div class="fiche-corps">' +
      '<div class="zone-photo" id="af-zone" tabindex="0" role="button" aria-label="Ajouter ou changer la photo">' +
      '<div id="af-zone-contenu" style="display:contents"></div></div>' +
      '<input id="af-photo" type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">' +
      (IA_WORKER_URL
        ? '<div class="ligne-ia"><button type="button" id="af-ia" class="mini">✨ Remplir le nom et la description avec l\'IA</button>' +
          '<p class="msg" id="af-ia-msg"></p></div>'
        : '') +
      '<label for="af-nom">Nom de l\'article</label>' +
      '<input id="af-nom" autocomplete="off" value="' + esc(source ? source.nom : '') + '">' +
      '<label for="af-desc">Description <span style="color:var(--faded);font-weight:300">(facultatif)</span></label>' +
      '<textarea id="af-desc" rows="3" placeholder="Vertus, origine, taille…">' + esc(source ? source.description || '' : '') + '</textarea>' +
      '<div class="deux-cols">' +
      '<div><label for="af-prix">Prix en boutique (€)</label>' +
      '<input id="af-prix" inputmode="decimal" placeholder="ex : 12,50" value="' + esc(prixInit) + '"></div>' +
      '<div><label for="af-stock">Quantité en stock</label>' +
      '<input id="af-stock" inputmode="numeric" placeholder="ex : 3" value="' + esc(stockInit) + '"></div>' +
      '</div>' +
      '<p class="hint" id="af-prix-hint"></p>' +
      '<label for="af-rayon">Rayon</label>' +
      '<select id="af-rayon">' + options + '</select>' +
      '</div>' +
      '<div class="fiche-pied">' + pied + '</div>' +
      '</form>', 'fiche');

    function rayonChoisi() {
      var r = trouverRayon($('af-rayon').value);
      return r ? r.fam : fam;
    }

    function majPhoto() {
      var src = photoTemp ? 'data:image/jpeg;base64,' + photoTemp : photoSrcAdmin(photoExistante);
      $('af-zone').classList.toggle('vide', !src);   // cadre compact tant qu'il n'y a pas de photo
      $('af-zone-contenu').innerHTML = src
        ? '<img src="' + esc(src) + '" alt=""><span class="changer">📷 Changer la photo</span>'
        : '<span class="ico">📷</span><b>Ajouter une photo</b><span class="petit">Cliquez ici, ou glissez la photo dans ce cadre</span>';
    }

    function majPrix() {
      var ps = $('af-prix').value.trim().replace(/[€\s]/g, '').replace(',', '.');
      var pb = ps === '' || isNaN(Number(ps)) ? null : Number(ps);
      var enligne = pb === null ? null : prixSite(pb);
      var hint = $('af-prix-hint');
      if (enligne === null) {
        hint.textContent = 'Sans prix, le site affiche « Prix en boutique » : l\'article n\'est pas vendu en ligne.';
        hint.style.color = '';
      } else {
        hint.innerHTML = '💳 Prix payé sur le site : <b>' + enligne.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) +
          ' €</b> (frais de paiement inclus). Quand toute la quantité est vendue, l\'article passe « épuisé » tout seul.';
        hint.style.color = 'var(--accent-soft)';
      }
    }

    function prendrePhoto(f) {
      if (!f) return;
      cropImage(f).then(function (b64) {
        if (b64) { photoTemp = b64; majPhoto(); }
        $('af-photo').value = '';
      }).catch(function () { $('af-photo').value = ''; alertePhoto(); });
    }

    var zone = $('af-zone');
    zone.onclick = function () { $('af-photo').click(); };
    zone.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('af-photo').click(); } };
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('survol'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('survol'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('survol');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) prendrePhoto(f);
    });
    $('af-photo').addEventListener('change', function () { prendrePhoto($('af-photo').files[0]); });
    $('af-prix').addEventListener('input', majPrix);

    // ✨ IA : envoie la photo au relais Cloudflare, remplit le nom et la description.
    var btnIa = box.querySelector('#af-ia');
    if (btnIa) btnIa.onclick = function () {
      var msg = $('af-ia-msg');
      var pImage;
      if (photoTemp) {
        pImage = Promise.resolve('data:image/jpeg;base64,' + photoTemp);
      } else if (photoExistante) {
        var src = /^https?:/.test(photoExistante) ? photoExistante : '../' + photoExistante;
        pImage = fetch(src).then(function (r) { return r.blob(); }).then(function (b) {
          return new Promise(function (res, rej) {
            var fr = new FileReader();
            fr.onload = function () { res(fr.result); };
            fr.onerror = rej;
            fr.readAsDataURL(b);
          });
        });
      } else {
        msg.className = 'msg err';
        msg.textContent = 'Ajoutez d\'abord une photo (cadre ci-dessus), puis cliquez ici.';
        return;
      }
      btnIa.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'L\'IA regarde la photo… (quelques secondes)';
      var cible = rayonChoisi();
      pImage.then(function (dataURI) {
        return fetch(IA_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: dataURI,
            titre: $('af-nom').value.trim(),
            description: $('af-desc').value.trim(),
            // Titres des autres articles du rayon : le worker s'en sert pour reperer
            // la gamme et copier son format (ils ne sont jamais envoyes a l'IA).
            exemples: (cible.articles || [])
              .filter(function (a) { return (!art || a.id !== art.id) && a.nom; })
              .map(function (a) { return a.nom; })
              .slice(0, 12)
          })
        });
      }).then(function (r) {
        return r.json().then(function (j) { if (!r.ok) throw new Error(j.erreur || ('Erreur ' + r.status)); return j; });
      }).then(function (j) {
        if (typeof j.titre === 'string' && j.titre) $('af-nom').value = j.titre;
        if (typeof j.description === 'string' && j.description) $('af-desc').value = j.description;
        msg.className = 'msg ok';
        msg.textContent = '✓ C\'est rempli : relisez et corrigez si besoin.';
      }).catch(function (e) {
        msg.className = 'msg err';
        msg.textContent = 'L\'IA n\'a pas répondu : ' + e.message;
      }).finally(function () { btnIa.disabled = false; });
    };

    // Deux boutons « Ajouter » : on retient lequel a été cliqué.
    var enchainer = false;
    var btnSuite = $('af-suite');
    if (btnSuite) btnSuite.onclick = function () { enchainer = true; };

    $('article-form').onsubmit = function (ev) {
      ev.preventDefault();
      var continuer = enchainer;
      enchainer = false;
      var nom = $('af-nom').value.trim();
      if (!nom) { alert('Donnez un nom à l\'article (ou cliquez sur ✨ pour que l\'IA le propose à partir de la photo).'); $('af-nom').focus(); return; }
      var prixSaisi = $('af-prix').value.trim();
      var stockSaisi = $('af-stock').value.trim();
      var ps = prixSaisi.replace(/[€\s]/g, '').replace(',', '.');
      if (ps !== '' && (isNaN(Number(ps)) || Number(ps) < 0)) { alert('Prix invalide : écrivez par exemple 12,50'); $('af-prix').focus(); return; }
      var ss = stockSaisi.replace(/\s/g, '');
      if (ss !== '' && (!/^\d+$/.test(ss) || Number(ss) < 0)) { alert('Quantité invalide : écrivez un nombre entier, par exemple 3'); $('af-stock').focus(); return; }
      // Quantité obligatoire avec un prix (évite un stock illimité par oubli).
      if (ps !== '' && ss === '') { alert('Indiquez la quantité en stock. Si vous en avez beaucoup, mettez un grand nombre (par exemple 50).'); $('af-stock').focus(); return; }

      var cible = rayonChoisi();
      var target = art || { id: slug(nom) + '-' + uid(), nom: '', prix: null, description: '', photo: null };
      target.nom = nom;
      var pb = ps === '' ? null : Number(ps);
      target.prixBoutique = pb;        // ce que la gérante saisit
      target.prix = prixSite(pb);      // prix affiché/encaissé en ligne (frais inclus)
      target.stock = ss === '' ? null : Number(ss);
      target.description = $('af-desc').value.trim();
      if (photoTemp) {
        var path = 'images/articles/' + slug(nom) + '-' + uid() + '.jpg';
        state.pendingPhotos[path] = photoTemp;
        target.photo = path;
      } else if (!art && photoExistante) {
        target.photo = photoExistante;   // copie : même photo tant qu'on n'en choisit pas une autre
      }
      if (!cible.articles) cible.articles = [];
      if (art) {
        if (cible !== fam) {             // changement de rayon : on déplace l'article
          fam.articles.splice(fam.articles.indexOf(art), 1);
          cible.articles.push(art);
        }
      } else {
        cible.articles.push(target);
      }
      state.dernierFamId = cible.id;
      state.rayonsOuverts[cible.id] = true;
      markDirty(); closeModal(); render();
      if (continuer) openArticleForm(cible, null, null, { prix: prixSaisi, stock: stockSaisi });
    };

    box.querySelector('#af-cancel').onclick = closeModal;
    box.querySelector('#af-fermer').onclick = closeModal;
    var del = box.querySelector('#af-delete');
    if (del) del.onclick = function () {
      if (confirm('Supprimer définitivement « ' + art.nom + ' » ?')) {
        fam.articles.splice(fam.articles.indexOf(art), 1);
        markDirty(); closeModal(); render();
      }
    };
    majPhoto();
    majPrix();
  }

  /* ---------- Formulaire rayon ---------- */

  function openRayonForm(theme, fam) {
    var box = openModal(
      '<h2>' + (fam ? 'Modifier le rayon' : 'Nouveau rayon') + '</h2>' +
      '<p class="hint">Un rayon regroupe des articles qui vont ensemble (ex : Bracelets, Encens, Fontaines).</p>' +
      '<form id="rayon-form">' +
      '<label style="margin-top:14px">Nom du rayon</label>' +
      '<input id="rf-nom" required placeholder="ex : Bracelets" value="' + esc(fam ? fam.nom : '') + '">' +
      '<label>Petite phrase de présentation (facultatif)</label>' +
      '<input id="rf-slogan" placeholder="ex : Nos plus beaux bracelets en pierres." value="' + esc(fam ? fam.slogan || '' : '') + '">' +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (fam ? 'Enregistrer' : 'Créer le rayon') + '</button>' +
      '<button type="button" id="rf-cancel">Annuler</button>' +
      '</div></form>');

    $('rayon-form').onsubmit = function (ev) {
      ev.preventDefault();
      var nom = $('rf-nom').value.trim();
      if (!nom) return;
      if (fam) { fam.nom = nom; fam.slogan = $('rf-slogan').value.trim(); }
      else {
        var nouveau = { id: slug(nom) + '-' + uid(), nom: nom, slogan: $('rf-slogan').value.trim(), articles: [] };
        if (!theme.familles) theme.familles = [];
        theme.familles.push(nouveau);
        state.rayonsOuverts[nouveau.id] = true;   // prêt à recevoir ses articles
        state.dernierFamId = nouveau.id;
      }
      markDirty(); closeModal(); render();
    };
    box.querySelector('#rf-cancel').onclick = closeModal;
    $('rf-nom').focus();
  }

  /* ---------- Formulaire affiche ---------- */

  function openActuForm(actu) {
    var imageTemp = null;
    var box = openModal(
      '<h2>' + (actu ? 'Modifier l\'affiche' : 'Nouvelle affiche') + '</h2>' +
      '<form id="actu-form">' +
      '<label style="margin-top:14px">Titre</label>' +
      '<input id="ac-titre" required value="' + esc(actu ? actu.titre : '') + '">' +
      '<label>Texte (facultatif)</label>' +
      '<textarea id="ac-texte" rows="2">' + esc(actu ? actu.texte || '' : '') + '</textarea>' +
      '<label>Date de fin (facultatif)</label>' +
      '<input id="ac-fin" type="date" value="' + esc(actu && actu.fin ? actu.fin : '') + '">' +
      '<p class="hint">Laissez vide pour une affiche permanente ; sinon elle disparaît du site après cette date.</p>' +
      '<label>Image de l\'affiche</label>' +
      '<input id="ac-image" type="file" accept="image/*">' +
      (actu && actu.image ? '<img class="thumb-preview" id="ac-preview" src="' + esc(photoSrcAdmin(actu.image)) + '" alt="">' : '<img class="thumb-preview hidden" id="ac-preview" alt="">') +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (actu ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '<button type="button" id="ac-cancel">Annuler</button>' +
      '<span class="spacer"></span>' +
      (actu ? '<button type="button" class="danger-link" id="ac-delete">Supprimer</button>' : '') +
      '</div></form>');

    $('ac-image').addEventListener('change', function () {
      var f = $('ac-image').files[0];
      if (!f) return;
      resizePhoto(f).then(function (b64) { imageTemp = b64; var pv = $('ac-preview'); pv.src = 'data:image/jpeg;base64,' + b64; pv.classList.remove('hidden'); })
        .catch(function () { $('ac-image').value = ''; alertePhoto(); });
    });

    $('actu-form').onsubmit = function (ev) {
      ev.preventDefault();
      var titre = $('ac-titre').value.trim();
      if (!titre) return;
      var target = actu || { id: 'actu-' + slug(titre) + '-' + uid(), titre: '', texte: '', fin: null, image: null };
      target.titre = titre;
      target.texte = $('ac-texte').value.trim();
      target.fin = $('ac-fin').value || null;
      if (imageTemp) {
        var path = 'images/actualites/' + slug(titre) + '-' + uid() + '.jpg';
        state.pendingPhotos[path] = imageTemp;
        target.image = path;
      }
      if (!actu) state.catalogue.actualites.push(target);
      markDirty(); closeModal(); render();
    };
    box.querySelector('#ac-cancel').onclick = closeModal;
    var del = box.querySelector('#ac-delete');
    if (del) del.onclick = function () {
      if (confirm('Supprimer l\'affiche « ' + actu.titre + ' » ?')) {
        state.catalogue.actualites.splice(state.catalogue.actualites.indexOf(actu), 1);
        markDirty(); closeModal(); render();
      }
    };
    $('ac-titre').focus();
  }

  /* ---------- Mise en ligne ---------- */

  /* auto = true : mise en ligne automatique, silencieuse (aucune alerte : un
     échec réessaie plus tard, la gérante n'est jamais interrompue). */
  function publish(auto) {
    auto = auto === true;
    if (!state.catalogue || !state.nbModifs || state.publication) return;
    state.publication = true;
    updateStatusbar();

    // Photo instantanée de ce qui part : la gérante peut continuer à ajouter
    // des articles pendant l'envoi ; ces ajouts-là restent « à mettre en ligne ».
    var instantane = null;
    function enregistrer() {
      var json = JSON.stringify(state.catalogue, null, 2);
      var photos = Object.keys(state.pendingPhotos);
      instantane = { json: json, photos: photos, rev: state.rev };
      var fichiers = photos.map(function (p) { return { path: p, base64: state.pendingPhotos[p] }; });
      fichiers.push({ path: CATALOGUE_PATH, base64: b64EncodeUtf8(json) });
      return committerFichiers(fichiers, auto
        ? 'Catalogue : mise en ligne automatique depuis l\'administration'
        : 'Catalogue : mise à jour depuis l\'administration',
        { path: CATALOGUE_PATH, sha: state.sha });
    }
    // Le catalogue a bougé en ligne (robot Stripe/stock) : on fusionne puis on réessaie.
    function estConflit(e) { return /PAS_A_JOUR|fast forward|fast-forward|does not match|not match|409|422/i.test(e.message); }

    setStatus(auto ? 'Mise en ligne automatique…' : 'Enregistrement…');
    enregistrer().catch(function (e) {
      if (!estConflit(e)) throw e;
      setStatus('La boutique a reçu des mises à jour automatiques (ventes, liens de paiement)… je les récupère et je réessaie…');
      return fusionnerRobots().then(enregistrer).catch(function (e2) {
        if (!estConflit(e2)) throw e2;
        return fusionnerRobots().then(enregistrer);
      });
    }).then(function (res) {
      state.publication = false;
      // Ce qui est en ligne = la photo instantanée (pas ce qui a été ajouté depuis).
      state.sha = res.shas[CATALOGUE_PATH];
      state.empreinte = empreinteSansRobot(JSON.parse(instantane.json));
      instantane.photos.forEach(function (p) { delete state.pendingPhotos[p]; });
      state.nbModifs = Math.max(0, state.rev - instantane.rev);
      state.premiereModif = state.nbModifs ? Date.now() : null;
      state.autoEssaiApres = 0;
      state.autoEchecs = 0;
      sauverBrouillon();
      updateStatusbar();
      setStatus(auto
        ? '✓ Mis en ligne automatiquement — le site se met à jour dans 1 à 2 minutes.'
        : '✓ C\'est en ligne ! Le site se met à jour dans 1 à 2 minutes.', true);
    }).catch(function (e) {
      state.publication = false;
      if (e.message === 'CONFLIT_HUMAIN') {
        // Jamais d'écrasement automatique du travail fait sur un autre appareil.
        state.autoBloque = true;
        updateStatusbar();
        if (auto) {
          setStatus('⚠️ La boutique a été modifiée depuis un autre appareil : mise en ligne automatique suspendue. Rechargez la page (touche F5) ; vos ajouts sont gardés en brouillon.');
        } else {
          setStatus('');
          alert('Quelqu\'un d\'autre a modifié la boutique en même temps, depuis un autre appareil. Pour ne rien écraser, rechargez la page (touche F5) et refaites vos dernières modifications.');
        }
      } else if (auto) {
        state.autoEchecs++;
        state.autoEssaiApres = Date.now() + Math.min(10, 2 * state.autoEchecs) * 60000;
        updateStatusbar();
        setStatus('Mise en ligne automatique impossible pour l\'instant (connexion ?) : nouvel essai tout seul dans quelques minutes, ou cliquez « Mettre en ligne ».');
      } else {
        updateStatusbar();
        setStatus('');
        alert('Échec de la mise en ligne : ' + e.message);
      }
    });
  }

  /* ---------- Connexion / démarrage ---------- */

  function start() {
    loadCatalogue().then(function () {
      $('login').classList.add('hidden');
      $('titre-connexion').classList.add('hidden');
      $('editor').classList.remove('hidden');
      $('statusbar').classList.remove('hidden');
      $('fab-nouvel-article').classList.remove('hidden');
      restaurerBrouillon();
      updateStatusbar();
      render();
    }).catch(function (e) {
      setStatus('');
      alert(e.message);
      localStorage.removeItem('geode-admin-token');
      state.token = '';
    });
  }

  $('btn-login-pass').onclick = function () {
    var pass = $('password').value;
    if (!pass) { $('password').focus(); return; }
    var msg = $('login-msg'); msg.className = 'msg'; msg.textContent = 'Vérification…';
    fetch(RAW + ACCES_PATH + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) throw new Error('Aucun mot de passe n\'est encore défini — utilisez le code d\'accès (section installateur).');
        if (!r.ok) throw new Error('Connexion impossible (erreur ' + r.status + '). Réessayez dans un instant.');
        return r.json();
      })
      .then(function (acces) { return dechiffrerToken(acces, pass).catch(function () { throw new Error('Mot de passe incorrect.'); }); })
      .then(function (token) { state.token = token; localStorage.setItem('geode-admin-token', token); msg.textContent = ''; start(); })
      .catch(function (e) { msg.className = 'msg err'; msg.textContent = e.message; });
  };

  $('password').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('btn-login-pass').click(); });

  $('btn-login').onclick = function () {
    var t = $('token').value.trim();
    if (!t) return;
    state.token = t; localStorage.setItem('geode-admin-token', t); start();
  };

  /* ---------- Menu « ⋯ » de la barre : outils moins fréquents ---------- */

  function ouvrirMotDePasse() {
    var box = openModal(
      '<h2>Mot de passe de connexion</h2>' +
      '<p class="hint">Choisissez une petite phrase de 3-4 mots, facile à retenir. Elle servira sur tous vos appareils.</p>' +
      '<label for="np1">Nouveau mot de passe</label>' +
      '<input type="password" id="np1" autocomplete="new-password">' +
      '<label for="np2">Confirmer</label>' +
      '<input type="password" id="np2" autocomplete="new-password">' +
      '<div class="form-actions">' +
      '<button class="primary" id="btn-set-pass" type="button">Enregistrer le mot de passe</button>' +
      '<button type="button" id="np-cancel">Fermer</button>' +
      '</div>' +
      '<p class="msg" id="pass-msg"></p>');
    box.querySelector('#np-cancel').onclick = closeModal;
    $('btn-set-pass').onclick = function () {
      var p1 = $('np1').value, p2 = $('np2').value, msg = $('pass-msg');
      msg.className = 'msg err';
      if (p1.length < 8) { msg.textContent = 'Mot de passe trop court (8 caractères minimum : une petite phrase est idéale).'; return; }
      if (p1 !== p2) { msg.textContent = 'Les deux saisies ne correspondent pas.'; return; }
      msg.className = 'msg'; msg.textContent = 'Chiffrement en cours…';
      var btn = $('btn-set-pass'); btn.disabled = true;
      chiffrerToken(state.token, p1)
        .then(function (acces) {
          return gh(ACCES_PATH).then(function (r) { return r.ok ? r.json().then(function (j) { return j.sha; }) : null; })
            .then(function (sha) { return putFile(ACCES_PATH, b64EncodeUtf8(JSON.stringify(acces)), 'Admin : mot de passe de connexion mis à jour', sha || undefined); });
        })
        .then(function () { $('np1').value = ''; $('np2').value = ''; msg.className = 'msg ok'; msg.textContent = 'Mot de passe enregistré ✓ Il fonctionnera d\'ici quelques minutes, sur tous vos appareils.'; })
        .catch(function (e) { msg.className = 'msg err'; msg.textContent = 'Échec : ' + e.message; })
        .finally(function () { btn.disabled = false; });
    };
    $('np1').focus();
  }

  function ouvrirAide() {
    var box = openModal(
      '<h2>Comment ça marche ?</h2>' +
      '<div class="aide">' +
      '<p>Votre site est rangé comme votre magasin : des <b>univers</b> (les onglets en haut), des <b>rayons</b> dans chaque univers, et des <b>articles</b> dans chaque rayon.</p>' +
      '<p><b>＋ Nouvel article</b> : commencez par la photo, puis cliquez sur ✨ pour que l\'IA propose le nom et la description. Vérifiez, mettez le prix et la quantité, c\'est tout. « Ajouter et en faire un autre » enchaîne les articles d\'une même série.</p>' +
      '<p><b>Retrouver un article</b> : tapez son nom dans la recherche en haut. Le bouton 🕒 montre les derniers articles ajoutés. Cliquez sur une ligne pour modifier ou supprimer l\'article ; « ⧉ » le duplique.</p>' +
      '<p><b>Mise en ligne</b> : vos changements partent tout seuls sur le site 5 minutes après (ou tout de suite avec « Mettre en ligne »). Le site se met à jour 1 à 2 minutes plus tard.</p>' +
      '</div>' +
      '<div class="form-actions"><button class="primary" id="aide-ok" type="button">J\'ai compris</button></div>');
    box.querySelector('#aide-ok').onclick = closeModal;
  }

  function deconnexion() {
    if ((state.nbModifs || state.publication) && !confirm('Des changements ne sont pas encore en ligne. Se déconnecter quand même ?')) return;
    localStorage.removeItem('geode-admin-token'); location.reload();
  }

  $('btn-menu').onclick = function (e) {
    e.stopPropagation();
    ouvrirMenu($('btn-menu'), [
      { label: '📋  Exporter l\'inventaire (Excel)', action: exporterInventaire },
      { label: '❔  Comment ça marche', action: ouvrirAide },
      { label: '🔑  Changer le mot de passe', action: ouvrirMotDePasse },
      '-',
      { label: '🚪  Se déconnecter', action: deconnexion }
    ]);
  };
  $('btn-nouvel-article').onclick = nouvelArticle;
  $('fab-nouvel-article').onclick = nouvelArticle;

  $('btn-publish').onclick = function () { publish(false); };

  // Export CSV de l'inventaire (séparateur ; + BOM pour Excel français)
  function exporterInventaire() {
    var lignes = [['Univers', 'Rayon', 'Article', 'Prix boutique (€)', 'Prix en ligne (€)', 'Stock en ligne', 'Épuisé', 'Description']];
    UNIVERS.forEach(function (u) {
      if (u.key === '__actus') return;
      var theme = state.catalogue.themes[u.key];
      if (!theme) return;
      (theme.familles || []).forEach(function (fam) {
        (fam.articles || []).forEach(function (art) {
          lignes.push([
            u.nom, fam.nom, art.nom,
            art.prixBoutique != null ? String(art.prixBoutique).replace('.', ',') : (art.prix != null ? String(art.prix).replace('.', ',') : ''),
            art.prix != null ? String(art.prix).replace('.', ',') : '',
            art.stock != null ? art.stock : '',
            art.epuise ? 'oui' : '',
            art.description || ''
          ]);
        });
      });
    });
    var csv = '﻿' + lignes.map(function (l) {
      return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    var d = new Date();
    var nomFichier = 'inventaire-la-geode-' + d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.csv';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nomFichier;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  var searchTimer = null;
  var champRech = $('admin-search');
  champRech.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = champRech.value.trim();
    state.limiteDate = DATE_PAGE;
    searchTimer = setTimeout(function () {
      renderRecherche(q);
      if (q) window.scrollTo(0, 0);   // la barre est collée en haut : on montre les résultats
    }, 120);
  });
  // Échap vide la recherche, coupe le tri par date et revient à la vue normale.
  champRech.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { quitterResultats(); champRech.blur(); }
  });
  // Croix native du champ « type=search » : rafraîchir quand on efface.
  champRech.addEventListener('search', function () { renderRecherche(champRech.value.trim()); });

  // Tri par date d'ajout (uniquement dans l'admin) : marche aussi avec la recherche.
  $('btn-tri-date').onclick = function () {
    state.triDate = !state.triDate;
    state.limiteDate = DATE_PAGE;
    majBoutonTri();
    renderRecherche(champRech.value.trim());
    window.scrollTo(0, 0);
  };

  // Mise en ligne automatique : toutes les 15 s on rafraîchit le compte à
  // rebours et on publie si des changements attendent depuis 5 minutes.
  setInterval(function () {
    if (!state.catalogue) return;
    verifierAutoPublication(false);
    updateStatusbar();
  }, 15000);
  // Onglet quitté, fenêtre réduite, écran verrouillé : on n'attend pas, on publie.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') verifierAutoPublication(true);
  });

  window.addEventListener('beforeunload', function (ev) {
    if (state.nbModifs || state.publication) { ev.preventDefault(); ev.returnValue = ''; }
  });

  if (state.token) start();
})();
