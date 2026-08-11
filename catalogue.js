// Affiche le catalogue (familles + articles) d'un thème sur sa page univers.
// La page doit contenir <div id="catalogue" data-theme="..." data-tint="...">.
(function () {
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

  function prixLabel(prix) {
    if (prix === null || prix === undefined || prix === '') return 'Prix en boutique';
    var n = Number(prix);
    if (isNaN(n)) return esc(prix);
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  }

  function render(container, theme, tint) {
    var familles = theme.familles || [];

    // Sommaire des familles (vignettes)
    var grid = el('div', 'cards');
    familles.forEach(function (f, i) {
      var hasArticles = f.articles && f.articles.length > 0;
      var card = el(hasArticles ? 'a' : 'div', 'card');
      card.setAttribute('data-reveal', String(i * 80));
      if (hasArticles) card.href = '#f-' + f.id;
      card.appendChild(el('div', 'univers-bar')).style.background = tint;
      card.appendChild(el('h3', null, esc(f.nom)));
      card.appendChild(el('p', null, esc(f.slogan || '')));
      if (hasArticles) {
        card.appendChild(el('span', 'panel-hint',
          'Voir les ' + f.articles.length + ' article' + (f.articles.length > 1 ? 's' : '') + ' →'));
      }
      grid.appendChild(card);
    });
    container.appendChild(grid);

    // Sections détaillées des familles qui ont des articles
    familles.forEach(function (f) {
      if (!f.articles || !f.articles.length) return;
      var section = el('section', 'famille');
      section.id = 'f-' + f.id;
      var head = el('div', null);
      head.setAttribute('data-reveal', '0');
      head.appendChild(el('h2', null, esc(f.nom)));
      if (f.slogan) head.appendChild(el('p', 'famille-slogan', esc(f.slogan)));
      section.appendChild(head);

      var items = el('div', 'items-grid');
      f.articles.forEach(function (a, i) {
        var card = el('article', 'item-card');
        card.setAttribute('data-reveal', String(i * 60));
        if (a.photo) {
          var img = el('img');
          img.src = '../' + a.photo;
          img.alt = a.nom;
          img.loading = 'lazy';
          card.appendChild(img);
        }
        var body = el('div', 'item-body');
        body.appendChild(el('h3', null, esc(a.nom)));
        body.appendChild(el('div', 'item-prix', prixLabel(a.prix)));
        if (a.description) body.appendChild(el('p', null, esc(a.description)));
        card.appendChild(body);
        items.appendChild(card);
      });
      section.appendChild(items);
      container.appendChild(section);
    });

    if (window.initReveal) window.initReveal(container);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('catalogue');
    if (!container) return;
    var themeKey = container.getAttribute('data-theme');
    var tint = container.getAttribute('data-tint') || 'var(--accent)';
    fetch('../data/catalogue.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        var theme = data.themes && data.themes[themeKey];
        if (theme) render(container, theme, tint);
      })
      .catch(function () {
        container.appendChild(el('p', null,
          'Le catalogue est momentanément indisponible — appelez-nous au <a href="tel:+33468566053">04 68 56 60 53</a>.'));
      });
  });
})();
