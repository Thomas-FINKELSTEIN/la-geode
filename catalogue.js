// Affiche le catalogue (familles + articles) d'un thème sur sa page univers,
// avec une barre de recherche tolérante (bouts de mots, sans accents,
// trouve même si un des mots tapés ne correspond pas) sur tout le catalogue.
// Chaque article est un lien vers sa page /article/?id=…
// La page doit contenir <div id="catalogue" data-theme="..." data-tint="...">.
// Si window.CATALOGUE_DEMO est défini (page d'aperçu), il remplace data/catalogue.json.
(function () {
  var TEL = '+33468566053';
  var TEL_AFFICHE = '04 68 56 60 53';
  var MAX_RESULTATS = 30;

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function prixLabel(prix) {
    if (prix === null || prix === undefined || prix === '') return 'Prix en boutique';
    var n = Number(prix);
    if (isNaN(n)) return esc(prix);
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  }

  function photoSrc(photo) {
    return /^https?:/.test(photo) ? photo : '../' + photo;
  }

  function articleUrl(a) {
    return '../article/?id=' + encodeURIComponent(a.id || '');
  }

  /* ---------- Carte article (réutilisée par les sections et la recherche) ---------- */

  function itemCard(a, revealDelay, contexte) {
    var card = el('a', 'item-card');
    card.setAttribute('data-reveal', String(revealDelay));
    if (a.id) card.href = articleUrl(a);
    if (a.photo) {
      var img = el('img');
      img.src = photoSrc(a.photo);
      img.alt = a.nom;
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      card.appendChild(el('div', 'item-noimg', '◆'));
    }
    var body = el('div', 'item-body');
    if (contexte) body.appendChild(el('div', 'item-contexte', esc(contexte)));
    body.appendChild(el('h3', null, esc(a.nom)));
    body.appendChild(el('div', 'item-prix', prixLabel(a.prix)));
    if (a.description) body.appendChild(el('p', null, esc(a.description)));
    card.appendChild(body);
    return card;
  }

  /* ---------- Recherche ---------- */

  // Index de tous les articles du catalogue, tous thèmes confondus.
  function buildIndex(data) {
    var index = [];
    Object.keys(data.themes).forEach(function (key) {
      var theme = data.themes[key];
      (theme.familles || []).forEach(function (fam) {
        (fam.articles || []).forEach(function (art) {
          index.push({
            article: art,
            contexte: theme.nom + ' · ' + fam.nom,
            nom: norm(art.nom),
            texte: norm(art.nom + ' ' + (art.description || '') + ' ' + fam.nom + ' ' + theme.nom)
          });
        });
      });
    });
    return index;
  }

  // Recherche tolérante : chaque mot tapé compte s'il apparaît quelque part
  // (même en morceau de mot) ; un mot qui ne matche pas n'élimine pas l'article.
  function chercher(index, requete) {
    var tokens = norm(requete).split(/\s+/).filter(function (t) { return t.length >= 2; });
    if (!tokens.length) return null;
    var resultats = [];
    index.forEach(function (entry) {
      var score = 0;
      var trouves = 0;
      tokens.forEach(function (t) {
        if (entry.nom.indexOf(t) !== -1) { score += 3; trouves++; }
        else if (entry.texte.indexOf(t) !== -1) { score += 1; trouves++; }
      });
      if (trouves === 0) return;
      if (trouves === tokens.length) score += 2;
      resultats.push({ entry: entry, score: score });
    });
    resultats.sort(function (a, b) { return b.score - a.score; });
    return resultats.slice(0, MAX_RESULTATS).map(function (r) { return r.entry; });
  }

  function setupSearch(container, data, normalWrap) {
    var index = buildIndex(data);

    var wrap = el('div', 'search-wrap');
    var input = el('input', 'search-input');
    input.type = 'search';
    input.placeholder = 'Rechercher un article… (ex : améthyste, bracelet, encens)';
    input.setAttribute('aria-label', 'Rechercher un article');
    wrap.appendChild(input);
    container.insertBefore(wrap, container.firstChild);

    var resultsWrap = el('div', 'search-results');
    resultsWrap.style.display = 'none';
    container.appendChild(resultsWrap);

    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = input.value.trim();
        var entries = chercher(index, q);

        if (entries === null) {
          resultsWrap.style.display = 'none';
          resultsWrap.innerHTML = '';
          normalWrap.style.display = '';
          return;
        }

        normalWrap.style.display = 'none';
        resultsWrap.style.display = '';
        resultsWrap.innerHTML = '';

        if (!entries.length) {
          resultsWrap.appendChild(el('p', 'search-vide',
            'Aucun article trouvé pour « ' + esc(q) + ' ». Le catalogue en ligne n\'est pas complet : ' +
            'appelez-nous au <a href="tel:' + TEL + '">' + TEL_AFFICHE + '</a>, nous l\'avons peut-être en boutique.'));
          return;
        }

        resultsWrap.appendChild(el('p', 'search-compte',
          entries.length + ' article' + (entries.length > 1 ? 's' : '') + ' trouvé' + (entries.length > 1 ? 's' : '')));
        var grid = el('div', 'items-grid');
        entries.forEach(function (entry) {
          var card = itemCard(entry.article, 0, entry.contexte);
          card.classList.add('revealed');
          grid.appendChild(card);
        });
        resultsWrap.appendChild(grid);
      }, 150);
    });
  }

  /* ---------- Rendu ---------- */

  // Les vignettes de familles servent de filtres : un clic n'affiche que les
  // articles de la famille choisie ; « Afficher toutes les familles » (ou un
  // second clic sur la famille active) rétablit la vue complète.
  function render(container, data, themeKey, tint) {
    var theme = data.themes[themeKey];
    if (!theme) return;
    var familles = theme.familles || [];

    // Tout le contenu « normal » (familles + sections) dans un conteneur
    // que la recherche peut masquer d'un bloc.
    var normalWrap = el('div', null);

    var sections = {};
    var cartes = {};
    var hints = {};
    var filtreActif = null;

    var resetBar = el('div', 'filtre-bar');
    var resetBtn = el('button', 'filtre-reset', '✕ Afficher toutes les familles');
    resetBar.appendChild(resetBtn);
    resetBar.style.display = 'none';

    function hintTexte(f) {
      return f.articles.length > 1 ? 'Voir les ' + f.articles.length + ' articles →' : 'Voir l\'article →';
    }

    function setFiltre(id) {
      filtreActif = (filtreActif === id) ? null : id;
      Object.keys(sections).forEach(function (fid) {
        sections[fid].style.display = (!filtreActif || filtreActif === fid) ? '' : 'none';
      });
      familles.forEach(function (f) {
        if (!cartes[f.id]) return;
        cartes[f.id].classList.toggle('card-active', filtreActif === f.id);
        if (hints[f.id]) {
          hints[f.id].textContent = filtreActif === f.id ? '✕ Tout revoir' : hintTexte(f);
        }
      });
      resetBar.style.display = filtreActif ? '' : 'none';
      if (filtreActif && sections[filtreActif]) {
        sections[filtreActif].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    resetBtn.addEventListener('click', function () { setFiltre(filtreActif); });

    var grid = el('div', 'cards');
    familles.forEach(function (f, i) {
      var hasArticles = f.articles && f.articles.length > 0;
      var card = el(hasArticles ? 'a' : 'div', 'card');
      card.setAttribute('data-reveal', String(i * 80));
      card.appendChild(el('div', 'univers-bar')).style.background = tint;
      card.appendChild(el('h3', null, esc(f.nom)));
      card.appendChild(el('p', null, esc(f.slogan || '')));
      if (hasArticles) {
        card.href = '#f-' + f.id;
        var hint = el('span', 'panel-hint', hintTexte(f));
        card.appendChild(hint);
        hints[f.id] = hint;
        cartes[f.id] = card;
        card.addEventListener('click', function (ev) {
          ev.preventDefault();
          setFiltre(f.id);
        });
      }
      grid.appendChild(card);
    });
    normalWrap.appendChild(grid);
    normalWrap.appendChild(resetBar);

    familles.forEach(function (f) {
      if (!f.articles || !f.articles.length) return;
      var section = el('section', 'famille');
      section.id = 'f-' + f.id;
      sections[f.id] = section;
      var head = el('div', null);
      head.setAttribute('data-reveal', '0');
      head.appendChild(el('h2', null, esc(f.nom)));
      if (f.slogan) head.appendChild(el('p', 'famille-slogan', esc(f.slogan)));
      section.appendChild(head);

      var items = el('div', 'items-grid');
      f.articles.forEach(function (a, i) {
        items.appendChild(itemCard(a, i * 60));
      });
      section.appendChild(items);
      normalWrap.appendChild(section);
    });

    container.appendChild(normalWrap);
    setupSearch(container, data, normalWrap);

    if (window.initReveal) window.initReveal(container);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('catalogue');
    if (!container) return;
    var themeKey = container.getAttribute('data-theme');
    var tint = container.getAttribute('data-tint') || 'var(--accent)';

    // Le paramètre horodaté contourne aussi le cache du CDN GitHub Pages
    // (sinon jusqu'à 10 min de retard après une publication).
    fetch('../data/catalogue.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { render(container, data, themeKey, tint); })
      .catch(function () {
        container.appendChild(el('p', null,
          'Le catalogue est momentanément indisponible. Appelez-nous au <a href="tel:' + TEL + '">' + TEL_AFFICHE + '</a>.'));
      });
  });
})();
