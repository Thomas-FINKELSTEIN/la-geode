// Apparition au scroll des éléments [data-reveal] (délai en ms dans l'attribut).
// initReveal est réutilisable pour les éléments ajoutés dynamiquement (catalogue.js).
window.initReveal = function (root) {
  var els = (root || document).querySelectorAll('[data-reveal]:not(.revealed)');
  if (!('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('revealed'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        var d = parseInt(e.target.getAttribute('data-reveal') || '0', 10);
        e.target.style.transitionDelay = d + 'ms';
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(function (el) { io.observe(el); });
};

document.addEventListener('DOMContentLoaded', function () {
  window.initReveal(document);

  // Met en évidence le jour actuel dans le tableau des horaires
  var lignes = document.querySelectorAll('.horaire-ligne[data-jour]');
  if (lignes.length) {
    var jour = String(new Date().getDay());
    lignes.forEach(function (l) {
      if (l.getAttribute('data-jour').split(',').indexOf(jour) !== -1) {
        l.classList.add('aujourdhui');
      }
    });
  }
});
