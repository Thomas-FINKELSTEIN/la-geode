/* Administration du catalogue La Géode.
   Lit et écrit data/catalogue.json + images/articles/ dans le dépôt GitHub
   via l'API Contents, entièrement côté navigateur. Les modifications sont
   accumulées localement puis envoyées en une fois avec « Publier »
   (GitHub Pages limite le nombre de reconstructions par heure). */

(function () {
  'use strict';

  var OWNER = 'Thomas-FINKELSTEIN';
  var REPO = 'la-geode';
  var BRANCH = 'main';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  var CATALOGUE_PATH = 'data/catalogue.json';
  var PHOTO_MAX = 1200;      // côté max des photos envoyées
  var PHOTO_QUALITY = 0.82;

  var state = {
    token: localStorage.getItem('geode-admin-token') || '',
    catalogue: null,
    sha: null,
    theme: 'mineraux',
    dirty: false,
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

  /* ---------- Utilitaires ---------- */

  function slug(s) {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .substring(0, 40) || 'x';
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

  function markDirty() {
    state.dirty = true;
    $('badge').textContent = 'Modifications non publiées';
    $('badge').className = 'badge dirty';
  }

  function setStatus(msg) { $('status-msg').textContent = msg || ''; }

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

  /* ---------- Chargement ---------- */

  function loadCatalogue() {
    setStatus('Chargement du catalogue…');
    return gh(CATALOGUE_PATH).then(function (r) {
      if (r.status === 401) throw new Error('Code d\'accès refusé — vérifiez-le.');
      if (!r.ok) throw new Error('Impossible de charger le catalogue (erreur ' + r.status + ')');
      return r.json();
    }).then(function (j) {
      state.sha = j.sha;
      state.catalogue = JSON.parse(b64DecodeUtf8(j.content));
      setStatus('');
    });
  }

  /* ---------- Rendu ---------- */

  function themeKeys() { return Object.keys(state.catalogue.themes); }

  function renderTabs() {
    var tabs = $('tabs');
    tabs.innerHTML = '';
    themeKeys().forEach(function (key) {
      var b = document.createElement('button');
      b.textContent = state.catalogue.themes[key].nom;
      b.className = key === state.theme ? 'active' : '';
      b.onclick = function () { state.theme = key; render(); };
      tabs.appendChild(b);
    });
  }

  function articleRow(fam, art) {
    var row = document.createElement('div');
    row.className = 'art';
    var thumb;
    if (art.photo && state.pendingPhotos[art.photo]) {
      thumb = '<img src="data:image/jpeg;base64,' + state.pendingPhotos[art.photo] + '" alt="">';
    } else if (art.photo) {
      thumb = '<img src="../' + esc(art.photo) + '" alt="">';
    } else {
      thumb = '<div class="noimg">◆</div>';
    }
    row.innerHTML = thumb +
      '<span class="art-nom">' + esc(art.nom) + '</span>' +
      '<span class="art-prix">' + prixLabel(art.prix) + '</span>';
    row.appendChild(smallBtn('↑', function () { moveItem(fam.articles, art, -1); }));
    row.appendChild(smallBtn('↓', function () { moveItem(fam.articles, art, 1); }));
    row.appendChild(smallBtn('Modifier', function () { openArticleForm(fam, art); }));
    row.appendChild(smallBtn('Supprimer', function () {
      if (confirm('Supprimer l\'article « ' + art.nom + ' » ?')) {
        fam.articles.splice(fam.articles.indexOf(art), 1);
        markDirty(); render();
      }
    }, 'danger'));
    return row;
  }

  function smallBtn(label, onclick, extra) {
    var b = document.createElement('button');
    b.className = 'small' + (extra ? ' ' + extra : '');
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

  function render() {
    renderTabs();
    var wrap = $('familles');
    wrap.innerHTML = '';
    var theme = state.catalogue.themes[state.theme];

    theme.familles.forEach(function (fam) {
      var card = document.createElement('div');
      card.className = 'card';

      var head = document.createElement('div');
      head.className = 'fam-head';
      head.innerHTML = '<h3>' + esc(fam.nom) + '</h3>';
      head.appendChild(smallBtn('↑', function () { moveItem(theme.familles, fam, -1); }));
      head.appendChild(smallBtn('↓', function () { moveItem(theme.familles, fam, 1); }));
      head.appendChild(smallBtn('Renommer', function () {
        var nom = prompt('Nom de la famille :', fam.nom);
        if (nom === null) return;
        var slogan = prompt('Petite phrase de présentation :', fam.slogan || '');
        if (nom.trim()) fam.nom = nom.trim();
        if (slogan !== null) fam.slogan = slogan.trim();
        markDirty(); render();
      }));
      head.appendChild(smallBtn('Supprimer', function () {
        var n = (fam.articles || []).length;
        if (confirm('Supprimer la famille « ' + fam.nom + ' »' + (n ? ' et ses ' + n + ' article(s)' : '') + ' ?')) {
          theme.familles.splice(theme.familles.indexOf(fam), 1);
          markDirty(); render();
        }
      }, 'danger'));
      var slogan = document.createElement('p');
      slogan.className = 'fam-slogan';
      slogan.textContent = fam.slogan || '';
      head.appendChild(slogan);
      card.appendChild(head);

      (fam.articles || []).forEach(function (art) {
        card.appendChild(articleRow(fam, art));
      });

      var addWrap = document.createElement('div');
      addWrap.style.marginTop = '12px';
      var addBtn = smallBtn('+ Ajouter un article', function () { openArticleForm(fam, null); });
      addBtn.className = 'small primary';
      addWrap.appendChild(addBtn);
      card.appendChild(addWrap);

      wrap.appendChild(card);
    });
  }

  /* ---------- Formulaire article ---------- */

  function openArticleForm(fam, art) {
    closeArticleForm();
    var form = document.createElement('form');
    form.className = 'inline-form';
    form.id = 'article-form';
    form.innerHTML =
      '<h2>' + (art ? 'Modifier « ' + esc(art.nom) + ' »' : 'Nouvel article — ' + esc(fam.nom)) + '</h2>' +
      '<label>Nom de l\'article *</label>' +
      '<input id="af-nom" required value="' + esc(art ? art.nom : '') + '">' +
      '<label>Prix en € (laisser vide pour afficher « Prix en boutique »)</label>' +
      '<input id="af-prix" type="number" step="0.01" min="0" value="' + (art && art.prix != null ? esc(art.prix) : '') + '">' +
      '<label>Description (optionnel)</label>' +
      '<textarea id="af-desc" rows="2">' + esc(art ? art.description || '' : '') + '</textarea>' +
      '<label>Photo (optionnel — elle sera réduite automatiquement)</label>' +
      '<input id="af-photo" type="file" accept="image/*">' +
      (art && art.photo ? '<img class="thumb-preview" src="' + (state.pendingPhotos[art.photo] ? 'data:image/jpeg;base64,' + state.pendingPhotos[art.photo] : '../' + esc(art.photo)) + '" alt="">' : '') +
      '<div class="form-actions">' +
      '<button type="submit" class="primary">' + (art ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '<button type="button" id="af-cancel">Annuler</button>' +
      '</div>';

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var nom = $('af-nom').value.trim();
      if (!nom) return;
      var prixStr = $('af-prix').value.trim();
      var target = art || { id: slug(nom) + '-' + uid(), nom: '', prix: null, description: '', photo: null };
      target.nom = nom;
      target.prix = prixStr === '' ? null : Number(prixStr);
      target.description = $('af-desc').value.trim();

      var file = $('af-photo').files[0];
      var done = function () {
        if (!art) fam.articles.push(target);
        markDirty(); closeArticleForm(); render();
      };
      if (file) {
        setStatus('Préparation de la photo…');
        resizePhoto(file).then(function (b64) {
          var path = 'images/articles/' + slug(nom) + '-' + uid() + '.jpg';
          state.pendingPhotos[path] = b64;
          target.photo = path;
          setStatus('');
          done();
        }).catch(function (e) { alert('Photo impossible à lire : ' + e.message); });
      } else {
        done();
      }
    };

    form.querySelector('#af-cancel').onclick = closeArticleForm;
    document.querySelector('.wrap').appendChild(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('af-nom').focus();
  }

  function closeArticleForm() {
    var f = $('article-form');
    if (f) f.remove();
  }

  /* ---------- Publication ---------- */

  function publish() {
    if (!state.dirty) { setStatus('Rien à publier.'); return; }
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
      setStatus('Enregistrement du catalogue…');
      var content = b64EncodeUtf8(JSON.stringify(state.catalogue, null, 2));
      return putFile(CATALOGUE_PATH, content, 'Catalogue : mise à jour depuis l\'administration', state.sha);
    }).then(function (j) {
      state.sha = j.content.sha;
      state.pendingPhotos = {};
      state.dirty = false;
      $('badge').textContent = 'À jour';
      $('badge').className = 'badge';
      setStatus('Publié ! Le site se met à jour d\'ici 1 à 2 minutes.');
    }).catch(function (e) {
      if (/does not match|409/.test(e.message)) {
        setStatus('');
        alert('Le catalogue a été modifié ailleurs. Rechargez la page (vos changements non publiés seront perdus) et recommencez.');
      } else {
        setStatus('');
        alert('Échec de la publication : ' + e.message);
      }
    }).finally(function () { btn.disabled = false; });
  }

  /* ---------- Connexion / démarrage ---------- */

  function start() {
    loadCatalogue().then(function () {
      $('login').classList.add('hidden');
      $('editor').classList.remove('hidden');
      $('statusbar').classList.remove('hidden');
      render();
    }).catch(function (e) {
      setStatus('');
      alert(e.message);
      localStorage.removeItem('geode-admin-token');
      state.token = '';
    });
  }

  $('btn-login').onclick = function () {
    var t = $('token').value.trim();
    if (!t) return;
    state.token = t;
    localStorage.setItem('geode-admin-token', t);
    start();
  };

  $('btn-logout').onclick = function () {
    if (state.dirty && !confirm('Des modifications ne sont pas publiées. Se déconnecter quand même ?')) return;
    localStorage.removeItem('geode-admin-token');
    location.reload();
  };

  $('btn-publish').onclick = publish;

  $('btn-add-fam').onclick = function () {
    var nom = $('new-fam-nom').value.trim();
    if (!nom) { $('new-fam-nom').focus(); return; }
    state.catalogue.themes[state.theme].familles.push({
      id: slug(nom) + '-' + uid(),
      nom: nom,
      slogan: $('new-fam-slogan').value.trim(),
      articles: []
    });
    $('new-fam-nom').value = '';
    $('new-fam-slogan').value = '';
    markDirty(); render();
  };

  window.addEventListener('beforeunload', function (ev) {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });

  if (state.token) start();
})();
