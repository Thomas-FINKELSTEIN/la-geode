/* Vérifie l'état des stocks auprès de Stripe (exécuté par GitHub Actions).

   Pour chaque article dont le stock est suivi (champ stripeStock défini) et
   qui a un lien de paiement, on interroge Stripe : quand la limite de ventes
   est atteinte, Stripe désactive automatiquement le lien (active = false).
   On écrit alors `epuise: true` dans catalogue.json → le site affiche
   « Épuisé » et masque le bouton d'achat. Inversement, un lien de nouveau
   actif (ré-approvisionnement) repasse l'article en disponible.

   Sans STRIPE_SECRET_KEY, le script se termine sans rien faire. */

'use strict';

const fs = require('fs');

const KEY = process.env.STRIPE_SECRET_KEY;
const CATALOGUE = 'data/catalogue.json';

if (!KEY) {
  console.log('Pas de clé Stripe configurée — vérification des stocks ignorée.');
  process.exit(0);
}

async function stripeGet(path) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { 'Authorization': 'Bearer ' + KEY }
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json.error && json.error.message) || ('HTTP ' + res.status));
  return json;
}

(async () => {
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  let changed = false;
  let erreurs = 0;

  for (const themeKey of Object.keys(catalogue.themes)) {
    for (const fam of catalogue.themes[themeKey].familles || []) {
      for (const art of fam.articles || []) {
        // Uniquement les articles à stock suivi possédant un lien de paiement.
        if (!art.stripeLinkId || art.stripeStock === undefined || art.stripeStock === null) continue;
        try {
          const link = await stripeGet('payment_links/' + art.stripeLinkId);
          const epuise = link.active === false;
          if (Boolean(art.epuise) !== epuise) {
            art.epuise = epuise;
            changed = true;
            console.log(`- « ${art.nom} » : ${epuise ? 'ÉPUISÉ (stock atteint)' : 'de nouveau disponible'}`);
          }
        } catch (e) {
          erreurs++;
          console.error(`- « ${art.nom} » : ÉCHEC — ${e.message}`);
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
    console.log('Stocks mis à jour.');
  } else {
    console.log('Aucun changement de stock.');
  }

  if (erreurs) process.exit(1);
})();
