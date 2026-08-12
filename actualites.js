// Affiche la section « En ce moment au showroom » sur la page d'accueil.
// Les annonces viennent de data/catalogue.json (clé "actualites") ; une
// annonce avec une date de fin passée est masquée automatiquement.
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

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function estActive(a) {
    return !a.fin || a.fin >= aujourdhui();
  }

  function dateFr(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR',
      { day: 'numeric', month: 'long', year: 'numeric' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var section = document.getElementById('actualites');
    var grid = document.getElementById('actus-grid');
    if (!section || !grid) return;

    fetch('data/catalogue.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        var actus = (data.actualites || []).filter(estActive);
        if (!actus.length) return;

        actus.forEach(function (a, i) {
          var card = el('div', 'actu-card');
          card.setAttribute('data-reveal', String(i * 120));
          if (a.image) {
            var lien = el('a');
            lien.href = a.image;
            lien.target = '_blank';
            lien.rel = 'noopener';
            var img = el('img');
            img.src = a.image;
            img.alt = a.titre;
            img.loading = 'lazy';
            lien.appendChild(img);
            card.appendChild(lien);
          }
          var body = el('div', 'actu-body');
          body.appendChild(el('h3', null, esc(a.titre)));
          if (a.texte) body.appendChild(el('p', null, esc(a.texte)));
          if (a.fin) body.appendChild(el('p', 'actu-fin', 'Jusqu\'au ' + dateFr(a.fin)));
          card.appendChild(body);
          grid.appendChild(card);
        });

        section.style.display = '';
        if (window.initReveal) window.initReveal(section);
      })
      .catch(function () { /* section simplement absente en cas d'erreur */ });
  });
})();
