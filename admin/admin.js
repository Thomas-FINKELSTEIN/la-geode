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
    { key: 'mineraux', nom: 'Minéraux', path: 'mineraux', couleur: '#b795e3' },
    { key: 'bijoux', nom: 'Bijoux', path: 'bijoux', couleur: '#e0a3a8' },
    { key: 'esoterisme', nom: 'Ésotérisme & encens', path: 'esoterisme', couleur: '#85c9ab' },
    { key: 'decoration', nom: 'Décoration du monde', path: 'decoration', couleur: '#cdb289' },
    { key: '__actus', nom: 'Affiches & promos', path: '', couleur: '#c9a86a' }
  ];

  var state = {
    token: localStorage.getItem('geode-admin-token') || '',
    catalogue: null,
    sha: null,
    univers: 'mineraux',
    nbModifs: 0,
    pendingPhotos: {}
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

  function markDirty() { state.nbModifs++; updateStatusbar(); }

  function updateStatusbar() {
    var dirty = state.nbModifs > 0;
    $('dot').className = 'dot' + (dirty ? ' dirty' : '');
    $('etat-txt').textContent = dirty
      ? state.nbModifs + ' changement' + (state.nbModifs > 1 ? 's' : '') + ' à mettre en ligne'
      : 'Tout est en ligne';
    $('btn-publish').disabled = !dirty;
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
      state.catalogue = JSON.parse(b64DecodeUtf8(j.content));
      if (!state.catalogue.actualites) state.catalogue.actualites = [];
      setStatus('');
    });
  }

  /* ---------- Fenêtre modale ---------- */

  function openModal(html, large) {
    closeModal();
    var overlay = document.createElement('div');
    overlay.className = 'modal'; overlay.id = 'modal';
    var box = document.createElement('div');
    box.className = 'modal-box' + (large ? ' large' : '');
    box.innerHTML = html;
    overlay.appendChild(box);
    $('modal-root').appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return box;
  }
  function closeModal() { var m = $('modal'); if (m) m.remove(); document.body.style.overflow = ''; }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });

  /* ---------- Sélecteur d'univers ---------- */

  function compteUnivers(key) {
    if (key === '__actus') return state.catalogue.actualites.length;
    var t = state.catalogue.themes[key];
    if (!t) return 0;
    var n = 0;
    (t.familles || []).forEach(function (f) { n += (f.articles || []).length; });
    return n;
  }

  function renderUniversGrid() {
    var grid = $('univers-grid');
    grid.innerHTML = '';
    UNIVERS.forEach(function (u) {
      if (u.key !== '__actus' && !state.catalogue.themes[u.key]) return;
      var b = document.createElement('button');
      b.className = 'u-btn' + (u.key === state.univers ? ' active' : '');
      b.style.setProperty('--uc', u.couleur);
      var compte = compteUnivers(u.key);
      var libelle = u.key === '__actus'
        ? compte + ' affiche' + (compte > 1 ? 's' : '')
        : compte + ' article' + (compte > 1 ? 's' : '');
      b.innerHTML =
        '<div class="pastille" style="background:' + u.couleur + '"></div>' +
        '<div class="u-nom">' + esc(u.nom) + '</div>' +
        '<div class="u-compte">' + libelle + '</div>';
      b.onclick = function () { state.univers = u.key; $('admin-search').value = ''; $('resultats-recherche').innerHTML = ''; render(); };
      grid.appendChild(b);
    });
  }

  /* ---------- Ligne d'article ---------- */

  function moveItem(arr, item, delta) {
    var i = arr.indexOf(item), j = i + delta;
    if (j < 0 || j >= arr.length) return;
    arr.splice(i, 1); arr.splice(j, 0, item);
    markDirty(); render();
  }

  function supprimerRayon(theme, fam) {
    var n = (fam.articles || []).length;
    if (confirm('Supprimer le rayon « ' + fam.nom + ' »' + (n ? ' et ses ' + n + ' article(s)' : '') + ' ?')) {
      theme.familles.splice(theme.familles.indexOf(fam), 1);
      markDirty(); render();
    }
  }

  function dupliquer(fam, art) {
    var copie = { id: slug(art.nom) + '-' + uid(), nom: art.nom + ' (copie)', prix: art.prix, stock: null, description: art.description || '', photo: art.photo || null };
    fam.articles.splice(fam.articles.indexOf(art) + 1, 0, copie);
    markDirty(); render();
    openArticleForm(fam, copie);
  }

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
      (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="noimg">💎</div>') +
      '<div class="art-info">' +
      '<div class="art-nom">' + esc(art.nom) + '</div>' +
      '<div class="art-ligne2"><span class="art-prix">' + prixTxt + '</span>' + tags +
      (contexte ? ' · ' + esc(contexte) : '') + '</div>' +
      '</div>';
    var btn = document.createElement('button');
    btn.className = 'mini art-modif';
    btn.textContent = 'Modifier';
    btn.onclick = function () { openArticleForm(fam, art); };
    row.appendChild(btn);
    return row;
  }

  /* ---------- Vue d'un univers (rayons + articles) ---------- */

  function renderUnivers(contenu) {
    var u = uInfo(state.univers);
    var theme = state.catalogue.themes[state.univers];

    var entete = document.createElement('div');
    entete.className = 'univers-entete';
    entete.innerHTML =
      '<span class="puce" style="background:' + u.couleur + '"></span>' +
      '<h2>' + esc(u.nom) + '</h2>' +
      '<a class="voir-site" href="' + SITE + '/' + u.path + '/" target="_blank" rel="noopener">Voir cette page sur le site ↗</a>';
    contenu.appendChild(entete);

    var guide = document.createElement('p');
    guide.className = 'hint';
    guide.style.margin = '4px 0 0';
    guide.textContent = '2. Voici les rayons de cet univers. Ouvrez un rayon pour y ajouter ou modifier des articles.';
    contenu.appendChild(guide);

    (theme.familles || []).forEach(function (fam) {
      var carte = document.createElement('div');
      carte.className = 'rayon';

      var tete = document.createElement('div');
      tete.className = 'rayon-tete';
      var n = (fam.articles || []).length;
      tete.innerHTML =
        '<div style="flex:1;min-width:0">' +
        '<div class="etiq">Rayon</div>' +
        '<h3>' + esc(fam.nom) + '  <span style="color:var(--faded);font-size:16px;font-family:\'Jost\',sans-serif;font-weight:300">(' + n + ' article' + (n > 1 ? 's' : '') + ')</span></h3>' +
        '</div>';
      var actionsRayon = document.createElement('div');
      actionsRayon.className = 'rayon-actions';
      var btnRayon = document.createElement('button');
      btnRayon.className = 'mini';
      btnRayon.textContent = 'Renommer';
      btnRayon.onclick = function () { openRayonForm(theme, fam); };
      actionsRayon.appendChild(btnRayon);
      var btnDel = document.createElement('button');
      btnDel.className = 'mini suppr';
      btnDel.textContent = 'Supprimer';
      btnDel.onclick = function () { supprimerRayon(theme, fam); };
      actionsRayon.appendChild(btnDel);
      tete.appendChild(actionsRayon);
      carte.appendChild(tete);

      if (fam.slogan) {
        var sl = document.createElement('p');
        sl.className = 'rayon-slogan';
        sl.textContent = fam.slogan;
        carte.appendChild(sl);
      }

      (fam.articles || []).forEach(function (art) { carte.appendChild(articleRow(fam, art)); });

      if (!n) {
        var vide = document.createElement('div');
        vide.className = 'rayon-vide';
        vide.textContent = 'Ce rayon est encore vide. Cliquez sur le bouton ci-dessous pour y ajouter votre premier article.';
        carte.appendChild(vide);
      }

      var add = document.createElement('div');
      add.style.marginTop = '16px';
      var btnAdd = document.createElement('button');
      btnAdd.className = 'primary gros';
      btnAdd.innerHTML = '<span class="plus">＋</span> Ajouter un article dans « ' + esc(fam.nom) + ' »';
      btnAdd.onclick = function () { openArticleForm(fam, null); };
      add.appendChild(btnAdd);
      carte.appendChild(add);

      contenu.appendChild(carte);
    });

    var nouveau = document.createElement('div');
    nouveau.className = 'add-rayon';
    var btnNouv = document.createElement('button');
    btnNouv.className = 'ghost gros';
    btnNouv.innerHTML = '<span class="plus">＋</span> Créer un nouveau rayon dans « ' + esc(u.nom) + ' »';
    btnNouv.onclick = function () { openRayonForm(theme, null); };
    nouveau.appendChild(btnNouv);
    contenu.appendChild(nouveau);
  }

  /* ---------- Vue affiches / promos ---------- */

  function renderActus(contenu) {
    var entete = document.createElement('div');
    entete.className = 'univers-entete';
    entete.innerHTML =
      '<span class="puce" style="background:#c9a86a"></span>' +
      '<h2>Affiches & promotions</h2>' +
      '<a class="voir-site" href="' + SITE + '/" target="_blank" rel="noopener">Voir la page d\'accueil ↗</a>';
    contenu.appendChild(entete);

    var guide = document.createElement('p');
    guide.className = 'hint';
    guide.style.margin = '4px 0 0';
    guide.innerHTML = 'Ces affiches s\'affichent en haut de la page d\'accueil du site. Si vous mettez une date de fin, l\'affiche disparaît toute seule après cette date.';
    contenu.appendChild(guide);

    var carte = document.createElement('div');
    carte.className = 'rayon';
    var actus = state.catalogue.actualites;

    actus.forEach(function (actu) {
      var row = document.createElement('div');
      row.className = 'art';
      var src = photoSrcAdmin(actu.image);
      var etat = actu.fin
        ? (actu.fin < aujourdhui() ? '<span class="tag tag-rouge">terminée</span>' : '<span class="tag tag-stock">jusqu\'au ' + esc(actu.fin) + '</span>')
        : '';
      row.innerHTML =
        (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="noimg">📣</div>') +
        '<div class="art-info"><div class="art-nom">' + esc(actu.titre) + '</div>' +
        (etat ? '<div class="art-ligne2">' + etat + '</div>' : '') + '</div>';
      var btn = document.createElement('button');
      btn.className = 'mini art-modif';
      btn.textContent = 'Modifier';
      btn.onclick = function () { openActuForm(actu); };
      row.appendChild(btn);
      carte.appendChild(row);
    });

    if (!actus.length) {
      var vide = document.createElement('div');
      vide.className = 'rayon-vide';
      vide.textContent = 'Aucune affiche pour l\'instant.';
      carte.appendChild(vide);
    }

    var add = document.createElement('div');
    add.style.marginTop = '16px';
    var btnAdd = document.createElement('button');
    btnAdd.className = 'primary gros';
    btnAdd.innerHTML = '<span class="plus">＋</span> Ajouter une affiche';
    btnAdd.onclick = function () { openActuForm(null); };
    add.appendChild(btnAdd);
    carte.appendChild(add);
    contenu.appendChild(carte);
  }

  /* ---------- Rendu général ---------- */

  function render() {
    renderUniversGrid();
    var contenu = $('contenu');
    contenu.innerHTML = '';
    if (state.univers === '__actus') renderActus(contenu);
    else renderUnivers(contenu);
  }

  /* ---------- Recherche ---------- */

  function renderRecherche(q) {
    var box = $('resultats-recherche');
    box.innerHTML = '';
    var tokens = norm(q).split(/\s+/).filter(function (t) { return t.length >= 2; });
    if (!tokens.length) return;
    var resultats = [];
    Object.keys(state.catalogue.themes).forEach(function (key) {
      var theme = state.catalogue.themes[key];
      (theme.familles || []).forEach(function (fam) {
        (fam.articles || []).forEach(function (art) {
          var hay = norm(art.nom + ' ' + (art.description || '') + ' ' + fam.nom + ' ' + theme.nom);
          var t = tokens.filter(function (x) { return hay.indexOf(x) !== -1; }).length;
          if (t > 0) resultats.push({ art: art, fam: fam, ctx: theme.nom + ' › ' + fam.nom, score: t });
        });
      });
    });
    resultats.sort(function (a, b) { return b.score - a.score; });
    var carte = document.createElement('div');
    carte.className = 'rayon';
    carte.innerHTML = '<div class="rayon-tete"><h3>Résultats (' + resultats.length + ')</h3></div>';
    resultats.slice(0, 40).forEach(function (r) { carte.appendChild(articleRow(r.fam, r.art, r.ctx)); });
    if (!resultats.length) {
      var v = document.createElement('div'); v.className = 'rayon-vide'; v.textContent = 'Aucun article ne correspond.';
      carte.appendChild(v);
    }
    box.appendChild(carte);
  }

  /* ---------- Formulaire article (avec aperçu) ---------- */

  function openArticleForm(fam, art) {
    var photoTemp = null;
    var box = openModal(
      '<h2>' + (art ? 'Modifier l\'article' : 'Nouvel article') + '</h2>' +
      '<p class="hint">Rayon : ' + esc(fam.nom) + '</p>' +
      '<div class="modal-cols"><div>' +
      '<form id="article-form">' +
      '<label style="margin-top:6px">Nom de l\'article</label>' +
      '<input id="af-nom" required value="' + esc(art ? art.nom : '') + '">' +
      '<label>Prix en boutique (€)</label>' +
      '<input id="af-prix" inputmode="decimal" placeholder="ex : 12,50" value="' + esc(art ? prixFr(art.prixBoutique != null ? art.prixBoutique : art.prix) : '') + '">' +
      '<p class="hint" id="af-prix-hint"></p>' +
      '<label>Combien en avez-vous à vendre en ligne ?</label>' +
      '<input id="af-stock" inputmode="numeric" placeholder="ex : 3" value="' + esc(art && art.stock != null ? art.stock : '') + '">' +
      '<p class="hint">Obligatoire dès que vous mettez un prix. Une fois ce nombre vendu, l\'article passe « épuisé » tout seul. Si vous en avez beaucoup, mettez un grand nombre (ex : 50).</p>' +
      '<label>Description (facultatif)</label>' +
      '<textarea id="af-desc" rows="3" placeholder="Vertus, origine, taille…">' + esc(art ? art.description || '' : '') + '</textarea>' +
      '<label>Photo</label>' +
      '<input id="af-photo" type="file" accept="image/*">' +
      (IA_WORKER_URL ? '<button type="button" id="af-ia" class="mini" style="margin-top:12px">✨ Générer le titre et la description avec l\'IA</button><p class="hint" id="af-ia-msg"></p>' : '') +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (art ? 'Enregistrer' : 'Ajouter au rayon') + '</button>' +
      '<button type="button" id="af-cancel">Annuler</button>' +
      '<span class="spacer"></span>' +
      (art ? '<button type="button" class="danger-link" id="af-delete">Supprimer</button>' : '') +
      '</div></form></div>' +
      '<div><div class="preview-titre">Aperçu sur le site</div>' +
      '<div class="preview-card"><div id="pv-ph"></div>' +
      '<div class="preview-body"><h4 id="pv-nom"></h4><div class="preview-prix" id="pv-prix"></div><p id="pv-desc"></p></div>' +
      '</div></div></div>', true);

    function maj() {
      var nom = $('af-nom').value.trim() || 'Nom de l\'article';
      var ps = $('af-prix').value.trim().replace(/[€\s]/g, '').replace(',', '.');
      var pb = ps === '' || isNaN(Number(ps)) ? null : Number(ps);
      var enligne = prixSite(pb);
      $('pv-nom').textContent = nom;
      $('pv-prix').textContent = prixLabel(enligne);
      $('pv-desc').textContent = $('af-desc').value.trim();
      var hint = $('af-prix-hint');
      if (pb === null) {
        hint.innerHTML = 'Laissez vide pour afficher « Prix en boutique » (l\'article ne sera pas vendable en ligne).';
        hint.style.color = '';
      } else {
        hint.innerHTML = '💳 Prix affiché et payé <b>sur le site : ' + enligne.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) +
          ' €</b> — vos ' + pb.toLocaleString('fr-FR') + ' € + les frais de paiement en ligne (calculés sur la commission la plus élevée, pour ne jamais perdre).';
        hint.style.color = 'var(--accent-soft)';
      }
      var src = photoTemp ? 'data:image/jpeg;base64,' + photoTemp : photoSrcAdmin(art ? art.photo : null);
      $('pv-ph').innerHTML = src ? '<img class="ph" src="' + esc(src) + '" alt="">' : '<div class="ph vide2">💎</div>';
    }
    ['af-nom', 'af-prix', 'af-desc'].forEach(function (id) { $(id).addEventListener('input', maj); });

    $('af-photo').addEventListener('change', function () {
      var f = $('af-photo').files[0];
      if (!f) return;
      cropImage(f).then(function (b64) {
        if (b64) { photoTemp = b64; maj(); }
        else { $('af-photo').value = ''; }   // annulé : on remet à zéro le champ
      }).catch(function () { $('af-photo').value = ''; alertePhoto(); });
    });

    // Bouton « Générer avec l'IA » : envoie la photo au relais Cloudflare,
    // remplit le titre + la description (la gérante relit et corrige).
    var btnIa = box.querySelector('#af-ia');
    if (btnIa) btnIa.onclick = function () {
      var msg = $('af-ia-msg');
      // Récupère la photo : celle qu'on vient de choisir, sinon celle déjà enregistrée.
      var pImage;
      if (photoTemp) {
        pImage = Promise.resolve('data:image/jpeg;base64,' + photoTemp);
      } else if (art && art.photo) {
        var src = /^https?:/.test(art.photo) ? art.photo : '../' + art.photo;
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
        msg.textContent = 'Ajoutez d\'abord une photo, puis cliquez sur ce bouton.';
        return;
      }

      btnIa.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Génération en cours… (quelques secondes)';

      pImage.then(function (dataURI) {
        return fetch(IA_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: dataURI,
            titre: $('af-nom').value.trim(),
            description: $('af-desc').value.trim(),
            // Titres des autres articles du rayon : l'IA imite leur format
            // (ex : « Œil-de-Tigre Donut 3cm » → « Hématite Donut 3cm »).
            exemples: fam.articles
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
        maj();
        msg.className = 'msg ok';
        msg.textContent = 'Proposition générée ✓ — relisez et modifiez si besoin avant d\'enregistrer.';
      }).catch(function (e) {
        msg.className = 'msg err';
        msg.textContent = 'La génération a échoué : ' + e.message;
      }).finally(function () { btnIa.disabled = false; });
    };

    $('article-form').onsubmit = function (ev) {
      ev.preventDefault();
      var nom = $('af-nom').value.trim();
      if (!nom) return;
      var ps = $('af-prix').value.trim().replace(/[€\s]/g, '').replace(',', '.');
      if (ps !== '' && (isNaN(Number(ps)) || Number(ps) < 0)) { alert('Prix invalide — écrivez par exemple : 12,50'); $('af-prix').focus(); return; }
      var ss = $('af-stock').value.trim().replace(/\s/g, '');
      if (ss !== '' && (!/^\d+$/.test(ss) || Number(ss) < 0)) { alert('Quantité invalide — écrivez un nombre entier, par exemple : 3'); $('af-stock').focus(); return; }
      // Quantité obligatoire quand l'article a un prix (évite un stock illimité par oubli).
      if (ps !== '' && ss === '') { alert('Indiquez combien vous en avez à vendre en ligne (le nombre d\'exemplaires). Si vous en avez beaucoup, mettez un grand nombre, par exemple 50.'); $('af-stock').focus(); return; }
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
      }
      if (!art) fam.articles.push(target);
      markDirty(); closeModal(); render();
    };

    box.querySelector('#af-cancel').onclick = closeModal;
    var del = box.querySelector('#af-delete');
    if (del) del.onclick = function () {
      if (confirm('Supprimer définitivement « ' + art.nom + ' » ?')) {
        fam.articles.splice(fam.articles.indexOf(art), 1);
        markDirty(); closeModal(); render();
      }
    };
    maj();
    $('af-nom').focus();
  }

  /* ---------- Formulaire rayon ---------- */

  function openRayonForm(theme, fam) {
    var box = openModal(
      '<h2>' + (fam ? 'Renommer le rayon' : 'Nouveau rayon') + '</h2>' +
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
      else { theme.familles.push({ id: slug(nom) + '-' + uid(), nom: nom, slogan: $('rf-slogan').value.trim(), articles: [] }); }
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

  function publish() {
    if (!state.nbModifs) return;
    var btn = $('btn-publish');
    btn.disabled = true;
    var photos = Object.keys(state.pendingPhotos);
    var chain = Promise.resolve();
    photos.forEach(function (path, i) {
      chain = chain.then(function () {
        setStatus('Envoi de la photo ' + (i + 1) + '/' + photos.length + '…');
        return putFile(path, state.pendingPhotos[path], 'Catalogue : ajout photo ' + path);
      });
    });
    chain.then(function () {
      setStatus('Enregistrement…');
      var content = b64EncodeUtf8(JSON.stringify(state.catalogue, null, 2));
      return putFile(CATALOGUE_PATH, content, 'Catalogue : mise à jour depuis l\'administration', state.sha);
    }).then(function (j) {
      state.sha = j.content.sha;
      state.pendingPhotos = {};
      state.nbModifs = 0;
      updateStatusbar();
      setStatus('✓ C\'est en ligne ! Le site se met à jour dans 1 à 2 minutes.', true);
    }).catch(function (e) {
      updateStatusbar();
      if (/does not match|409/.test(e.message)) {
        setStatus('');
        alert('La boutique a été modifiée ailleurs. Rechargez la page (vos changements non mis en ligne seront perdus) et recommencez.');
      } else { setStatus(''); alert('Échec de la mise en ligne : ' + e.message); }
    });
  }

  /* ---------- Connexion / démarrage ---------- */

  function start() {
    loadCatalogue().then(function () {
      $('login').classList.add('hidden');
      $('editor').classList.remove('hidden');
      $('statusbar').classList.remove('hidden');
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

  $('btn-set-pass').onclick = function () {
    var p1 = $('np1').value, p2 = $('np2').value, msg = $('pass-msg');
    msg.className = 'msg err';
    if (p1.length < 8) { msg.textContent = 'Mot de passe trop court (8 caractères minimum — une petite phrase est idéale).'; return; }
    if (p1 !== p2) { msg.textContent = 'Les deux saisies ne correspondent pas.'; return; }
    msg.className = 'msg'; msg.textContent = 'Chiffrement en cours…';
    var btn = $('btn-set-pass'); btn.disabled = true;
    chiffrerToken(state.token, p1)
      .then(function (acces) {
        return gh(ACCES_PATH).then(function (r) { return r.ok ? r.json().then(function (j) { return j.sha; }) : null; })
          .then(function (sha) { return putFile(ACCES_PATH, b64EncodeUtf8(JSON.stringify(acces)), 'Admin : mot de passe de connexion mis à jour', sha || undefined); });
      })
      .then(function () { $('np1').value = ''; $('np2').value = ''; msg.className = 'msg ok'; msg.textContent = 'Mot de passe enregistré ✓ — utilisable d\'ici quelques minutes, depuis n\'importe quel ordinateur.'; })
      .catch(function (e) { msg.className = 'msg err'; msg.textContent = 'Échec : ' + e.message; })
      .finally(function () { btn.disabled = false; });
  };

  $('btn-logout').onclick = function () {
    if (state.nbModifs && !confirm('Des changements ne sont pas mis en ligne. Quitter quand même ?')) return;
    localStorage.removeItem('geode-admin-token'); location.reload();
  };

  $('btn-publish').onclick = publish;

  // Export CSV de l'inventaire (séparateur ; + BOM pour Excel français)
  $('btn-inventaire').onclick = function () {
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
  };

  var searchTimer = null;
  $('admin-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = $('admin-search').value.trim();
    searchTimer = setTimeout(function () { renderRecherche(q); }, 150);
  });

  window.addEventListener('beforeunload', function (ev) { if (state.nbModifs) { ev.preventDefault(); ev.returnValue = ''; } });

  if (state.token) start();
})();
