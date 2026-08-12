// Affiche le catalogue (familles + articles) d'un thème sur sa page univers.
// La page doit contenir <div id="catalogue" data-theme="..." data-tint="...">.
// Si window.CATALOGUE_DEMO est défini (page d'aperçu), il remplace le fichier data/catalogue.json.
(function () {
  var TEL = '+33468566053';
  var TEL_AFFICHE = '04 68 56 60 53';

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
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  }

  function photoSrc(photo) {
    return /^https?:/.test(photo) ? photo : '../' + photo;
  }

  /* ---------- Fenêtre de détail (lightbox) ---------- */

  var lightbox = null;

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    document.body.style.overflow = '';
  }

  function openLightbox(article) {
    closeLightbox();
    lightbox = el('div', 'lightbox');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');

    var box = el('div', 'lightbox-box');
    box.appendChild(el('button', 'lightbox-close', '✕')).onclick = closeLightbox;
    if (article.photo) {
      var img = el('img');
      img.src = photoSrc(article.photo);
      img.alt = article.nom;
      box.appendChild(img);
    }
    var body = el('div', 'lightbox-body');
    body.appendChild(el('h3', null, esc(article.nom)));
    body.appendChild(el('div', 'item-prix', prixLabel(article.prix)));
    if (article.description) body.appendChild(el('p', null, esc(article.description)));
    var tel = el('a', 'btn-primary', '📞 Réserver : ' + TEL_AFFICHE);
    tel.href = 'tel:' + TEL;
    body.appendChild(tel);
    box.appendChild(body);
    lightbox.appendChild(box);

    lightbox.addEventListener('click', function (ev) {
      if (ev.target === lightbox) closeLightbox();
    });
    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeLightbox();
  });

  /* ---------- Rendu ---------- */

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
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', a.nom + ' — ' + prixLabel(a.prix));
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
        body.appendChild(el('h3', null, esc(a.nom)));
        body.appendChild(el('div', 'item-prix', prixLabel(a.prix)));
        if (a.description) body.appendChild(el('p', null, esc(a.description)));
        card.appendChild(body);
        card.addEventListener('click', function () { openLightbox(a); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openLightbox(a); }
        });
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

    if (window.CATALOGUE_DEMO) {
      var theme = window.CATALOGUE_DEMO.themes[themeKey];
      if (theme) render(container, theme, tint);
      return;
    }

    fetch('../data/catalogue.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        var theme = data.themes && data.themes[themeKey];
        if (theme) render(container, theme, tint);
      })
      .catch(function () {
        container.appendChild(el('p', null,
          'Le catalogue est momentanément indisponible — appelez-nous au <a href="tel:' + TEL + '">' + TEL_AFFICHE + '</a>.'));
      });
  });
})();
