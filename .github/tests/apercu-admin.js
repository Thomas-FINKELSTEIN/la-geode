// Aperçu local de l'admin : vrai admin.js + vrai catalogue, GitHub simulé en
// LECTURE SEULE (aucune publication possible) ; les photos viennent du vrai site.
// Usage : node .github/tests/apercu-admin.js   puis ouvrir http://localhost:8765/apercu/
// (faire un « git pull » avant, pour avoir le catalogue à jour).
const http = require('http'), fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, "..", "..");
const ADMIN = path.join(RACINE, "admin");
const PORT = Number(process.argv[2] || 8765);

const MOCK = `<script>
// --- Aperçu local : faux GitHub en lecture seule ---
localStorage.setItem('geode-admin-token', 'apercu');
localStorage.removeItem('geode-brouillon');
(function () {
  var vraiFetch = window.fetch.bind(window), texte = null;
  function charger() { return texte ? Promise.resolve(texte) : vraiFetch('catalogue.json').then(function (r) { return r.text(); }).then(function (t) { return (texte = t); }); }
  function rep(obj, st) { return Promise.resolve(new Response(JSON.stringify(obj), { status: st || 200, headers: { 'Content-Type': 'application/json' } })); }
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('api.github.com') !== -1) {
      if (/contents\\/data\\/catalogue\\.json/.test(u) && !(opts && opts.method)) {
        return charger().then(function (t) { return rep({ sha: 'apercu', encoding: 'base64', content: btoa(unescape(encodeURIComponent(t))) }); });
      }
      return rep({ message: 'Apercu local : lecture seule' }, 403);
    }
    if (u.indexOf('workers.dev') !== -1) return rep({ erreur: 'Apercu local' }, 403);
    return vraiFetch(url, opts);
  };
})();
</script>
`;

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/images/')) { res.writeHead(302, { Location: 'https://lageode66.fr' + p }); return res.end(); }
  let fichier = null, type = 'text/plain; charset=utf-8';
  if (p === '/apercu/' || p === '/apercu/index.html') {
    const html = fs.readFileSync(path.join(ADMIN, 'index.html'), 'utf8').replace('<script src="admin.js"></script>', MOCK + '<script src="admin.js"></script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
  }
  if (p === '/apercu/admin.js') { fichier = path.join(ADMIN, 'admin.js'); type = 'application/javascript; charset=utf-8'; }
  if (p === '/apercu/catalogue.json') { fichier = path.join(RACINE, 'data', 'catalogue.json'); type = 'application/json; charset=utf-8'; }
  if (!fichier || !fs.existsSync(fichier)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(fichier).pipe(res);
}).listen(PORT, () => console.log('Aperçu : http://localhost:' + PORT + '/apercu/'));
