/* Réconciliation des champs « robot » sur la dernière version du catalogue.

   Quand un robot (Stripe, stock) a calculé ses changements à partir d'une
   version du catalogue, un autre commit peut arriver entre-temps (la gérante
   qui publie, l'autre robot). Plutôt que de relancer le robot — ce qui, pour
   Stripe, créerait des produits en double — on SUPERPOSE simplement ses champs
   techniques sur la toute dernière version, par identifiant d'article.

   Usage : node reconcile-robot.js <robot.json> <base.json> <sortie.json>
     robot.json  : le catalogue produit par le robot (avec ses nouveaux champs)
     base.json   : la dernière version en ligne (origin/main), qui fait foi pour
                   tout le reste (articles ajoutés/retirés/édités par la gérante)
     sortie.json : le résultat fusionné à écrire

   Sortie : code 0 ; affiche le nombre de champs superposés. */

'use strict';

const fs = require('fs');

// Champs écrits par les robots (identiques à ceux de l'admin) : eux seuls sont
// superposés ; tout le reste vient de la version de base.
const CHAMPS_ROBOT = ['stripe', 'stripeProductId', 'stripePriceId', 'stripeLinkId',
  'stripePrix', 'stripeMode', 'stripeNom', 'stripeDesc', 'stripeStock', 'epuise'];

function chaqueArticle(cat, cb) {
  Object.keys((cat && cat.themes) || {}).forEach(function (t) {
    ((cat.themes[t] && cat.themes[t].familles) || []).forEach(function (f) {
      (f.articles || []).forEach(cb);
    });
  });
}

const robotPath = process.argv[2];
const basePath = process.argv[3];
const sortiePath = process.argv[4];

if (!robotPath || !basePath || !sortiePath) {
  console.error('Usage : node reconcile-robot.js <robot.json> <base.json> <sortie.json>');
  process.exit(2);
}

const robot = JSON.parse(fs.readFileSync(robotPath, 'utf8'));
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));

const parId = {};
chaqueArticle(robot, function (a) { if (a && a.id) parId[a.id] = a; });

let superposes = 0;
chaqueArticle(base, function (a) {
  const r = parId[a.id];
  if (!r) return;                    // article absent du robot : on garde la base
  CHAMPS_ROBOT.forEach(function (c) {
    if (!(c in r)) return;           // le robot n'a pas touché ce champ
    if (JSON.stringify(a[c]) !== JSON.stringify(r[c])) { a[c] = r[c]; superposes++; }
  });
});

fs.writeFileSync(sortiePath, JSON.stringify(base, null, 2) + '\n');
console.log('Réconciliation : ' + superposes + ' champ(s) robot superposé(s) sur la dernière version.');
