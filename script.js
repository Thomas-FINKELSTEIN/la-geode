// Apparition au scroll des éléments [data-reveal] (délai en ms dans l'attribut)
document.addEventListener('DOMContentLoaded', function () {
  var els = document.querySelectorAll('[data-reveal]');
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
});
