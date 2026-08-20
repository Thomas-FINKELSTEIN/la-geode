/* Administration du catalogue La Géode.
   Lit et écrit data/catalogue.json + images/ dans le dépôt GitHub via l'API
   Contents, entièrement côté navigateur. Les modifications sont accumulées
   localement puis envoyées en une fois avec « Publier » (GitHub Pages limite
   le nombre de reconstructions par heure). */

(function () {
  'use strict';

  var OWNER = 'Thomas-FINKELSTEIN';
  var REPO = 'la-geode';
  var BRANCH = 'main';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  var RAW = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/';
  var CATALOGUE_PATH = 'data/catalogue.json';
  var ACCES_PATH = 'admin/acces.json';
  var PBKDF2_ITERATIONS = 1000000; // dérivation volontairement lente (anti force brute)
  var PHOTO_MAX = 1200;            // côté max des photos envoyées
  var PHOTO_QUALITY = 0.82;

  var state = {
    token: localStorage.getItem('geode-admin-token') || '',
    catalogue: null,
    sha: null,
    theme: 'mineraux',
    nbModifs: 0,
    pendingPhotos: {}   // chemin -> base64 (sans préfixe data:)
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

  function b64EncodeUtf8(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function b64DecodeUtf8(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }

  function putFile(path, base64Content, message, sha) {
    var body = { message: message, content: base64Content, branch: BRANCH };
    if (sha) body.sha = sha;
    return gh(path, { method: 'PUT', body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) {
          throw new Error(j.message || ('Erreur ' + r.status));
        });
        return r.json();
      });
  }

  /* ---------- Connexion par mot de passe ----------
     Le code d'accès GitHub est chiffré (AES-GCM, clé dérivée du mot de passe
     par PBKDF2) et publié dans admin/acces.json. Le déchiffrement se fait
     entièrement dans le navigateur : le mot de passe ne circule jamais. */

  function bytesToB64(bytes) {
    var s = '';
    new Uint8Array(bytes).forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function b64ToBytes(b64) {
    var s = atob(b64);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

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
      return {
        v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS,
        salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data)
      };
    });
  }

  function dechiffrerToken(acces, password) {
    return deriveKey(password, b64ToBytes(acces.salt), acces.iterations).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(acces.iv) }, key, b64ToBytes(acces.data));
    }).then(function (buf) {
      return new TextDecoder().decode(buf);
    });
  }

  /* ---------- Utilitaires ---------- */

  function slug(s) {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .substring(0, 40) || 'x';
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function prixLabel(prix) {
    if (prix === null || prix === undefined || prix === '') return 'Prix en boutique';
    return Number(prix).toLocaleString('fr-FR') + ' €';
  }

  function prixFr(prix) {
    return prix === null || prix === undefined ? '' : String(prix).replace('.', ',');
  }

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function markDirty() {
    state.nbModifs++;
    updateStatusbar();
  }

  function updateStatusbar() {
    var dirty = state.nbModifs > 0;
    $('dot').className = 'dot' + (dirty ? ' dirty' : '');
    $('etat-txt').textContent = dirty
      ? state.nbModifs + ' modification' + (state.nbModifs > 1 ? 's' : '') + ' à publier'
      : 'Tout est publié';
    $('btn-publish').disabled = !dirty;
  }

  function setStatus(msg, ok) {
    var el = $('status-msg');
    el.textContent = msg || '';
    el.className = 'msg' + (ok ? ' ok' : '');
    el.style.margin = '0';
  }

  /* Redimensionne une photo et renvoie son base64 JPEG (sans préfixe). */
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }

  function alertePhoto() {
    alert('Cette photo n\'a pas pu être lue. Utilisez une image JPG ou PNG.\n' +
      'Sur iPhone : Réglages → Appareil photo → Formats → « Le plus compatible ».');
  }

  function photoSrcAdmin(photo) {
    if (!photo) return null;
    if (state.pendingPhotos[photo]) return 'data:image/jpeg;base64,' + state.pendingPhotos[photo];
    if (/^https?:/.test(photo)) return photo;
    return '../' + photo;
  }

  /* ---------- Chargement ---------- */

  function loadCatalogue() {
    setStatus('Chargement…');
    return gh(CATALOGUE_PATH).then(function (r) {
      if (r.status === 401) throw new Error('Code d\'accès refusé — vérifiez-le.');
      if (!r.ok) throw new Error('Impossible de charger le catalogue (erreur ' + r.status + ')');
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
    overlay.className = 'modal';
    overlay.id = 'modal';
    var box = document.createElement('div');
    box.className = 'modal-box' + (large ? ' large' : '');
    box.innerHTML = html;
    overlay.appendChild(box);
    document.getElementById('modal-root').appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return box;
  }

  function closeModal() {
    var m = $('modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeModal();
  });

  /* ---------- Onglets ---------- */

  var THEME_ORDER = ['mineraux', 'bijoux', 'esoterisme', 'decoration'];

  function countArticles(themeKey) {
    var n = 0;
    (state.catalogue.themes[themeKey].familles || []).forEach(function (f) {
      n += (f.articles || []).length;
    });
    return n;
  }

  function renderTabs() {
    var tabs = $('tabs');
    tabs.innerHTML = '';
    THEME_ORDER.forEach(function (key) {
      if (!state.catalogue.themes[key]) return;
      var b = document.createElement('button');
      b.innerHTML = esc(state.catalogue.themes[key].nom) + '<span class="n">' + countArticles(key) + '</span>';
      b.className = key === state.theme ? 'active' : '';
      b.onclick = function () { state.theme = key; $('admin-search').value = ''; render(); };
      tabs.appendChild(b);
    });
    var ba = document.createElement('button');
    ba.innerHTML = 'Actualités<span class="n">' + state.catalogue.actualites.length + '</span>';
    ba.className = state.theme === 'actus' ? 'active' : '';
    ba.onclick = function () { state.theme = 'actus'; $('admin-search').value = ''; render(); };
    tabs.appendChild(ba);
  }

  /* ---------- Lignes d'articles ---------- */

  function smallBtn(label, onclick, cls) {
    var b = document.createElement('button');
    b.className = cls || '';
    b.textContent = label;
    b.onclick = onclick;
    return b;
  }

  function moveItem(arr, item, delta) {
    var i = arr.indexOf(item);
    var j = i + delta;
    if (j < 0 || j >= arr.length) return;
    arr.splice(i, 1);
    arr.splice(j, 0, item);
    markDirty(); render();
  }

  function dupliquer(fam, art) {
    var copie = {
      id: slug(art.nom) + '-' + uid(),
      nom: art.nom + ' (copie)',
      prix: art.prix,
      description: art.description || '',
      photo: art.photo || null
    };
    fam.articles.splice(fam.articles.indexOf(art) + 1, 0, copie);
    markDirty();
    render();
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
    row.innerHTML =
      (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="noimg">◆</div>') +
      '<div class="art-info">' +
      '<div class="art-nom">' + esc(art.nom) + tags +
      '</div>' +
      (contexte ? '<div class="art-ctx">' + esc(contexte) + '</div>' : '') +
      '</div>' +
      '<span class="art-prix' + (art.prix == null ? ' off' : '') + '">' + prixLabel(art.prix) + '</span>';
    var btns = document.createElement('div');
    btns.className = 'art-btns';
    btns.appendChild(smallBtn('↑', function () { moveItem(fam.articles, art, -1); }, 'icon subtle'));
    btns.appendChild(smallBtn('↓', function () { moveItem(fam.articles, art, 1); }, 'icon subtle'));
    btns.appendChild(smallBtn('Modifier', function () { openArticleForm(fam, art); }));
    btns.appendChild(smallBtn('Dupliquer', function () { dupliquer(fam, art); }, 'subtle'));
    row.appendChild(btns);
    return row;
  }

  /* ---------- Vue familles ---------- */

  function renderFamilles(content) {
    var theme = state.catalogue.themes[state.theme];

    theme.familles.forEach(function (fam) {
      var card = document.createElement('div');
      card.className = 'card';

      var head = document.createElement('div');
      head.className = 'fam-head';
      head.innerHTML = '<h3>' + esc(fam.nom) + '</h3>' +
        '<span class="fam-count">' + (fam.articles || []).length + ' article' + ((fam.articles || []).length > 1 ? 's' : '') + '</span>';
      var actions = document.createElement('div');
      actions.className = 'fam-actions';
      actions.appendChild(smallBtn('↑', function () { moveItem(theme.familles, fam, -1); }, 'icon subtle'));
      actions.appendChild(smallBtn('↓', function () { moveItem(theme.familles, fam, 1); }, 'icon subtle'));
      actions.appendChild(smallBtn('Modifier', function () { openFamilleForm(theme, fam); }, 'subtle'));
      head.appendChild(actions);
      if (fam.slogan) {
        var slogan = document.createElement('p');
        slogan.className = 'fam-slogan';
        slogan.textContent = fam.slogan;
        head.appendChild(slogan);
      }
      card.appendChild(head);

      (fam.articles || []).forEach(function (art) {
        card.appendChild(articleRow(fam, art));
      });
      if (!(fam.articles || []).length) {
        var v = document.createElement('p');
        v.className = 'vide';
        v.textContent = 'Aucun article pour l\'instant.';
        card.appendChild(v);
      }

      var addWrap = document.createElement('div');
      addWrap.className = 'add-row';
      addWrap.appendChild(smallBtn('+ Ajouter un article', function () { openArticleForm(fam, null); }, 'primary'));
      card.appendChild(addWrap);

      content.appendChild(card);
    });

    var newFam = document.createElement('div');
    newFam.className = 'add-row';
    newFam.style.marginTop = '22px';
    newFam.appendChild(smallBtn('+ Nouvelle famille', function () { openFamilleForm(theme, null); }));
    content.appendChild(newFam);
  }

  /* ---------- Recherche admin ---------- */

  function renderRecherche(content, q) {
    var tokens = norm(q).split(/\s+/).filter(function (t) { return t.length >= 2; });
    var resultats = [];
    Object.keys(state.catalogue.themes).forEach(function (key) {
      var theme = state.catalogue.themes[key];
      (theme.familles || []).forEach(function (fam) {
        (fam.articles || []).forEach(function (art) {
          var hay = norm(art.nom + ' ' + (art.description || '') + ' ' + fam.nom + ' ' + theme.nom);
          var trouves = tokens.filter(function (t) { return hay.indexOf(t) !== -1; }).length;
          if (trouves > 0) resultats.push({ art: art, fam: fam, ctx: theme.nom + ' · ' + fam.nom, score: trouves });
        });
      });
    });
    resultats.sort(function (a, b) { return b.score - a.score; });

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="fam-head"><h3>Résultats</h3><span class="fam-count">' +
      resultats.length + ' article' + (resultats.length > 1 ? 's' : '') + ' trouvé' + (resultats.length > 1 ? 's' : '') + '</span></div>';
    resultats.slice(0, 50).forEach(function (r) {
      card.appendChild(articleRow(r.fam, r.art, r.ctx));
    });
    if (!resultats.length) {
      var v = document.createElement('p');
      v.className = 'vide';
      v.textContent = 'Aucun article ne correspond.';
      card.appendChild(v);
    }
    content.appendChild(card);
  }

  /* ---------- Vue actualités ---------- */

  function renderActus(content) {
    var actus = state.catalogue.actualites;
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="fam-head"><h3>Actualités du showroom</h3></div>' +
      '<p class="fam-slogan">Affiches, promotions, nouveautés… affichées sur la page d\'accueil. ' +
      'Une annonce avec une date de fin disparaît automatiquement du site après cette date.</p>';

    actus.forEach(function (actu) {
      var row = document.createElement('div');
      row.className = 'art';
      var src = photoSrcAdmin(actu.image);
      var etat = '';
      if (actu.fin) {
        etat = actu.fin < aujourdhui()
          ? '<span class="art-prix" style="color:var(--danger)">expirée</span>'
          : '<span class="art-prix off">jusqu\'au ' + esc(actu.fin) + '</span>';
      }
      row.innerHTML =
        (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="noimg">📣</div>') +
        '<div class="art-info"><div class="art-nom">' + esc(actu.titre) + '</div></div>' + etat;
      var btns = document.createElement('div');
      btns.className = 'art-btns';
      btns.appendChild(smallBtn('↑', function () { moveItem(actus, actu, -1); }, 'icon subtle'));
      btns.appendChild(smallBtn('↓', function () { moveItem(actus, actu, 1); }, 'icon subtle'));
      btns.appendChild(smallBtn('Modifier', function () { openActuForm(actu); }));
      row.appendChild(btns);
      card.appendChild(row);
    });
    if (!actus.length) {
      var v = document.createElement('p');
      v.className = 'vide';
      v.textContent = 'Aucune annonce pour l\'instant.';
      card.appendChild(v);
    }

    var addWrap = document.createElement('div');
    addWrap.className = 'add-row';
    addWrap.appendChild(smallBtn('+ Ajouter une annonce', function () { openActuForm(null); }, 'primary'));
    card.appendChild(addWrap);
    content.appendChild(card);
  }

  /* ---------- Rendu général ---------- */

  function render() {
    renderTabs();
    var content = $('content');
    content.innerHTML = '';
    var q = $('admin-search').value.trim();
    if (q.length >= 2) { renderRecherche(content, q); return; }
    if (state.theme === 'actus') { renderActus(content); return; }
    renderFamilles(content);
  }

  /* ---------- Formulaire article (avec aperçu en direct) ---------- */

  function openArticleForm(fam, art) {
    var photoTemp = null; // base64 d'une nouvelle photo choisie, avant enregistrement

    var box = openModal(
      '<h2>' + (art ? 'Modifier l\'article' : 'Nouvel article') + '</h2>' +
      '<p class="hint">' + esc(fam.nom) + '</p>' +
      '<div class="modal-cols">' +
      '<div>' +
      '<form id="article-form">' +
      '<label style="margin-top:6px">Nom de l\'article *</label>' +
      '<input id="af-nom" required value="' + esc(art ? art.nom : '') + '">' +
      '<label>Prix en €</label>' +
      '<input id="af-prix" inputmode="decimal" placeholder="ex : 12,50" value="' + esc(art ? prixFr(art.prix) : '') + '">' +
      '<p class="hint">Laisser vide pour afficher « Prix en boutique »</p>' +
      '<label>Quantité en stock pour la vente en ligne</label>' +
      '<input id="af-stock" inputmode="numeric" placeholder="ex : 3" value="' + esc(art && art.stock != null ? art.stock : '') + '">' +
      '<p class="hint">Nombre d\'exemplaires vendables en ligne. Une fois atteint, l\'article passe « épuisé » automatiquement. Laisser vide = pas de limite.</p>' +
      '<label>Description</label>' +
      '<textarea id="af-desc" rows="3" placeholder="Vertus, origine, particularités…">' + esc(art ? art.description || '' : '') + '</textarea>' +
      '<label>Photo</label>' +
      '<input id="af-photo" type="file" accept="image/*">' +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (art ? 'Enregistrer' : 'Ajouter au catalogue') + '</button>' +
      '<button type="button" id="af-cancel">Annuler</button>' +
      '<span class="spacer"></span>' +
      (art ? '<button type="button" class="danger-link" id="af-delete">Supprimer</button>' : '') +
      '</div>' +
      '</form>' +
      '</div>' +
      '<div>' +
      '<div class="preview-titre">Aperçu sur le site</div>' +
      '<div class="preview-card">' +
      '<div id="pv-ph"></div>' +
      '<div class="preview-body">' +
      '<h4 id="pv-nom"></h4>' +
      '<div class="preview-prix" id="pv-prix"></div>' +
      '<p id="pv-desc"></p>' +
      '</div></div>' +
      '</div>' +
      '</div>', true);

    function majApercu() {
      var nom = $('af-nom').value.trim() || 'Nom de l\'article';
      var prixStr = $('af-prix').value.trim().replace(/[€\s]/g, '').replace(',', '.');
      var prix = prixStr === '' || isNaN(Number(prixStr)) ? null : Number(prixStr);
      $('pv-nom').textContent = nom;
      $('pv-prix').textContent = prixLabel(prix);
      $('pv-desc').textContent = $('af-desc').value.trim();
      var src = photoTemp ? 'data:image/jpeg;base64,' + photoTemp : photoSrcAdmin(art ? art.photo : null);
      $('pv-ph').innerHTML = src
        ? '<img class="ph" src="' + esc(src) + '" alt="">'
        : '<div class="ph vide2">◆</div>';
    }

    ['af-nom', 'af-prix', 'af-desc'].forEach(function (id) {
      $(id).addEventListener('input', majApercu);
    });

    $('af-photo').addEventListener('change', function () {
      var file = $('af-photo').files[0];
      if (!file) return;
      resizePhoto(file).then(function (b64) {
        photoTemp = b64;
        majApercu();
      }).catch(function () { $('af-photo').value = ''; alertePhoto(); });
    });

    $('article-form').onsubmit = function (ev) {
      ev.preventDefault();
      var nom = $('af-nom').value.trim();
      if (!nom) return;
      var prixStr = $('af-prix').value.trim().replace(/[€\s]/g, '').replace(',', '.');
      if (prixStr !== '' && (isNaN(Number(prixStr)) || Number(prixStr) < 0)) {
        alert('Prix invalide — écrivez par exemple : 12,50');
        $('af-prix').focus();
        return;
      }
      var stockStr = $('af-stock').value.trim().replace(/\s/g, '');
      if (stockStr !== '' && (!/^\d+$/.test(stockStr) || Number(stockStr) < 0)) {
        alert('Quantité en stock invalide — écrivez un nombre entier, par exemple : 3');
        $('af-stock').focus();
        return;
      }
      var target = art || { id: slug(nom) + '-' + uid(), nom: '', prix: null, description: '', photo: null };
      target.nom = nom;
      target.prix = prixStr === '' ? null : Number(prixStr);
      target.stock = stockStr === '' ? null : Number(stockStr);
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

    majApercu();
    $('af-nom').focus();
  }

  /* ---------- Formulaire famille ---------- */

  function openFamilleForm(theme, fam) {
    var box = openModal(
      '<h2>' + (fam ? 'Modifier la famille' : 'Nouvelle famille') + '</h2>' +
      '<form id="famille-form">' +
      '<label style="margin-top:14px">Nom de la famille *</label>' +
      '<input id="ff-nom" required placeholder="ex : Sphères" value="' + esc(fam ? fam.nom : '') + '">' +
      '<label>Petite phrase de présentation</label>' +
      '<input id="ff-slogan" placeholder="ex : L\'énergie de la pierre dans sa forme parfaite." value="' + esc(fam ? fam.slogan || '' : '') + '">' +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (fam ? 'Enregistrer' : 'Créer la famille') + '</button>' +
      '<button type="button" id="ff-cancel">Annuler</button>' +
      '<span class="spacer"></span>' +
      (fam ? '<button type="button" class="danger-link" id="ff-delete">Supprimer</button>' : '') +
      '</div>' +
      '</form>');

    $('famille-form').onsubmit = function (ev) {
      ev.preventDefault();
      var nom = $('ff-nom').value.trim();
      if (!nom) return;
      if (fam) {
        fam.nom = nom;
        fam.slogan = $('ff-slogan').value.trim();
      } else {
        theme.familles.push({
          id: slug(nom) + '-' + uid(),
          nom: nom,
          slogan: $('ff-slogan').value.trim(),
          articles: []
        });
      }
      markDirty(); closeModal(); render();
    };

    box.querySelector('#ff-cancel').onclick = closeModal;
    var del = box.querySelector('#ff-delete');
    if (del) del.onclick = function () {
      var n = (fam.articles || []).length;
      if (confirm('Supprimer la famille « ' + fam.nom + ' »' + (n ? ' et ses ' + n + ' article(s)' : '') + ' ?')) {
        theme.familles.splice(theme.familles.indexOf(fam), 1);
        markDirty(); closeModal(); render();
      }
    };

    $('ff-nom').focus();
  }

  /* ---------- Formulaire actualité ---------- */

  function openActuForm(actu) {
    var imageTemp = null;

    var box = openModal(
      '<h2>' + (actu ? 'Modifier l\'annonce' : 'Nouvelle annonce') + '</h2>' +
      '<form id="actu-form">' +
      '<label style="margin-top:14px">Titre *</label>' +
      '<input id="ac-titre" required value="' + esc(actu ? actu.titre : '') + '">' +
      '<label>Texte</label>' +
      '<textarea id="ac-texte" rows="2">' + esc(actu ? actu.texte || '' : '') + '</textarea>' +
      '<label>Fin de l\'annonce</label>' +
      '<input id="ac-fin" type="date" value="' + esc(actu && actu.fin ? actu.fin : '') + '">' +
      '<p class="hint">Laisser vide pour une annonce permanente ; sinon elle disparaîtra du site après cette date.</p>' +
      '<label>Affiche / image</label>' +
      '<input id="ac-image" type="file" accept="image/*">' +
      (actu && actu.image ? '<img class="thumb-preview" id="ac-preview" src="' + esc(photoSrcAdmin(actu.image)) + '" alt="">' : '<img class="thumb-preview hidden" id="ac-preview" alt="">') +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (actu ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '<button type="button" id="ac-cancel">Annuler</button>' +
      '<span class="spacer"></span>' +
      (actu ? '<button type="button" class="danger-link" id="ac-delete">Supprimer</button>' : '') +
      '</div>' +
      '</form>');

    $('ac-image').addEventListener('change', function () {
      var file = $('ac-image').files[0];
      if (!file) return;
      resizePhoto(file).then(function (b64) {
        imageTemp = b64;
        var pv = $('ac-preview');
        pv.src = 'data:image/jpeg;base64,' + b64;
        pv.classList.remove('hidden');
      }).catch(function () { $('ac-image').value = ''; alertePhoto(); });
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
      if (confirm('Supprimer l\'annonce « ' + actu.titre + ' » ?')) {
        state.catalogue.actualites.splice(state.catalogue.actualites.indexOf(actu), 1);
        markDirty(); closeModal(); render();
      }
    };

    $('ac-titre').focus();
  }

  /* ---------- Publication ---------- */

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
      setStatus('✓ Publié ! En ligne dans 1 à 2 minutes.', true);
    }).catch(function (e) {
      updateStatusbar();
      if (/does not match|409/.test(e.message)) {
        setStatus('');
        alert('Le catalogue a été modifié ailleurs. Rechargez la page (vos changements non publiés seront perdus) et recommencez.');
      } else {
        setStatus('');
        alert('Échec de la publication : ' + e.message);
      }
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
    var msg = $('login-msg');
    msg.className = 'msg';
    msg.textContent = 'Vérification…';
    fetch(RAW + ACCES_PATH + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) throw new Error('Aucun mot de passe n\'est configuré — utilisez le code d\'accès (section installateur ci-dessous).');
        if (!r.ok) throw new Error('Connexion impossible (erreur ' + r.status + '). Réessayez dans un instant.');
        return r.json();
      })
      .then(function (acces) {
        return dechiffrerToken(acces, pass).catch(function () {
          throw new Error('Mot de passe incorrect.');
        });
      })
      .then(function (token) {
        state.token = token;
        localStorage.setItem('geode-admin-token', token);
        msg.textContent = '';
        start();
      })
      .catch(function (e) { msg.className = 'msg err'; msg.textContent = e.message; });
  };

  $('password').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') $('btn-login-pass').click();
  });

  $('btn-login').onclick = function () {
    var t = $('token').value.trim();
    if (!t) return;
    state.token = t;
    localStorage.setItem('geode-admin-token', t);
    start();
  };

  $('btn-set-pass').onclick = function () {
    var p1 = $('np1').value;
    var p2 = $('np2').value;
    var msg = $('pass-msg');
    msg.className = 'msg err';
    if (p1.length < 8) { msg.textContent = 'Mot de passe trop court (8 caractères minimum — une petite phrase est idéale).'; return; }
    if (p1 !== p2) { msg.textContent = 'Les deux saisies ne correspondent pas.'; return; }
    msg.className = 'msg';
    msg.textContent = 'Chiffrement en cours…';
    var btn = $('btn-set-pass');
    btn.disabled = true;
    chiffrerToken(state.token, p1)
      .then(function (acces) {
        return gh(ACCES_PATH).then(function (r) {
          return r.ok ? r.json().then(function (j) { return j.sha; }) : null;
        }).then(function (sha) {
          return putFile(ACCES_PATH, b64EncodeUtf8(JSON.stringify(acces)),
            'Admin : mot de passe de connexion mis à jour', sha || undefined);
        });
      })
      .then(function () {
        $('np1').value = ''; $('np2').value = '';
        msg.className = 'msg ok';
        msg.textContent = 'Mot de passe enregistré ✓ — utilisable d\'ici quelques minutes, depuis n\'importe quel ordinateur.';
      })
      .catch(function (e) { msg.className = 'msg err'; msg.textContent = 'Échec : ' + e.message; })
      .finally(function () { btn.disabled = false; });
  };

  $('btn-logout').onclick = function () {
    if (state.nbModifs && !confirm('Des modifications ne sont pas publiées. Se déconnecter quand même ?')) return;
    localStorage.removeItem('geode-admin-token');
    location.reload();
  };

  $('btn-publish').onclick = publish;

  var searchTimer = null;
  $('admin-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 150);
  });

  window.addEventListener('beforeunload', function (ev) {
    if (state.nbModifs) { ev.preventDefault(); ev.returnValue = ''; }
  });

  if (state.token) start();
})();
