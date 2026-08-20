// Vitrine du catalogue sur les pages univers.
// - Rail de familles collant (pastilles-filtres avec compteurs) : « Tout voir »
//   affiche tous les articles groupés par famille ; un clic sur une famille
//   filtre instantanément.
// - Tant qu'aucun article n'existe dans l'univers, la page montre les familles
//   en présentation simple (vignettes avec slogans).
// - Recherche tolérante sur tout le catalogue (bouts de mots, sans accents).
// La page doit contenir <div id="catalogue" data-theme="..." data-tint="...">.
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

  /* ---------- Carte article (vitrine et recherche) ---------- */

  function itemCard(a, revealDelay, contexte) {
    var card = el('a', 'item-card');
    card.setAttribute('data-reveal', String(revealDelay));
    if (a.id) card.href = articleUrl(a);
    if (a.epuise) card.classList.add('article-epuise');

    var photo = el('div', 'item-photo');
    if (a.photo) {
      var img = el('img');
      img.src = photoSrc(a.photo);
      img.alt = a.nom;
      img.loading = 'lazy';
      photo.appendChild(img);
    } else {
      photo.appendChild(el('div', 'item-noimg', '◆'));
    }
    photo.appendChild(el('span', 'prix-pill', prixLabel(a.prix)));
    if (a.epuise) photo.appendChild(el('span', 'epuise-badge', 'Épuisé'));
    card.appendChild(photo);

    var body = el('div', 'item-body');
    if (contexte) body.appendChild(el('div', 'item-contexte', esc(contexte)));
    body.appendChild(el('h3', null, esc(a.nom)));
    if (a.description) body.appendChild(el('p', null, esc(a.description)));
    card.appendChild(body);
    return card;
  }

  /* ---------- Recherche ---------- */

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

  /* ---------- Vitrine ---------- */

  function render(container, data, themeKey, tint) {
    var theme = data.themes[themeKey];
    if (!theme) return;
    var familles = theme.familles || [];

    // Tout le contenu « normal » dans un conteneur que la recherche peut masquer.
    var normalWrap = el('div', null);

    var pleines = familles.filter(function (f) { return f.articles && f.articles.length; });
    var total = pleines.reduce(function (s, f) { return s + f.articles.length; }, 0);

    // Univers encore vide : présentation simple des familles.
    if (!total) {
      var grid = el('div', 'cards');
      familles.forEach(function (f, i) {
        var card = el('div', 'card');
        card.setAttribute('data-reveal', String(i * 80));
        card.appendChild(el('div', 'univers-bar')).style.background = tint;
        card.appendChild(el('h3', null, esc(f.nom)));
        card.appendChild(el('p', null, esc(f.slogan || '')));
        grid.appendChild(card);
      });
      normalWrap.appendChild(grid);
      container.appendChild(normalWrap);
      setupSearch(container, data, normalWrap);
      if (window.initReveal) window.initReveal(container);
      return;
    }

    // Rail de familles : pastilles-filtres avec compteurs.
    var rail = el('nav', 'familles-rail');
    rail.style.setProperty('--tint', tint);
    rail.setAttribute('aria-label', 'Familles d\'articles');

    var vitrine = el('div', 'vitrine');
    var actif = null;
    var boutons = {};

    function faireChip(label, count, id) {
      var b = el('button', 'fam-chip');
      b.type = 'button';
      if (id !== null) b.appendChild(el('span', 'dot'));
      b.appendChild(el('span', 'fam-chip-nom', esc(label)));
      b.appendChild(el('span', 'n', String(count)));
      b.addEventListener('click', function () {
        afficher(actif === id ? null : id, true);
      });
      boutons[id === null ? '__tout' : id] = b;
      rail.appendChild(b);
      return b;
    }

    faireChip('Tout voir', total, null);
    pleines.forEach(function (f) { faireChip(f.nom, f.articles.length, f.id); });

    function sectionFamille(f) {
      var sec = el('section', 'famille');
      var head = el('div', 'vitrine-head');
      head.setAttribute('data-reveal', '0');
      var barre = el('div', 'vitrine-bar');
      barre.style.background = tint;
      head.appendChild(barre);
      var ligne = el('div', 'vitrine-ligne');
      ligne.appendChild(el('h2', null, esc(f.nom)));
      ligne.appendChild(el('span', 'vitrine-count',
        f.articles.length + ' article' + (f.articles.length > 1 ? 's' : '')));
      head.appendChild(ligne);
      if (f.slogan) head.appendChild(el('p', 'famille-slogan', esc(f.slogan)));
      sec.appendChild(head);

      var grid = el('div', 'items-grid');
      f.articles.forEach(function (a, i) {
        grid.appendChild(itemCard(a, Math.min(i, 8) * 60));
      });
      sec.appendChild(grid);
      return sec;
    }

    function afficher(id, scroller) {
      actif = id;
      Object.keys(boutons).forEach(function (k) {
        boutons[k].classList.toggle('active', (id === null && k === '__tout') || k === id);
      });
      vitrine.innerHTML = '';
      if (id === null) {
        pleines.forEach(function (f) { vitrine.appendChild(sectionFamille(f)); });
      } else {
        var f = pleines.filter(function (x) { return x.id === id; })[0];
        if (f) vitrine.appendChild(sectionFamille(f));
      }
      if (window.initReveal) window.initReveal(vitrine);
      if (scroller) rail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    normalWrap.appendChild(rail);
    normalWrap.appendChild(vitrine);
    afficher(null, false);

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
