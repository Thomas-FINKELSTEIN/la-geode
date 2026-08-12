/* Synchronise le catalogue avec Stripe (exécuté par GitHub Actions).

   Pour chaque article avec un prix :
   - crée le produit Stripe (nom, description, photo) s'il n'existe pas
   - met à jour le produit si le nom ou la description ont changé
   - crée un tarif + un lien de paiement, et les recrée si le prix change
   - écrit l'URL du lien dans le champ `stripe` de l'article
   Pour un article dont le prix est retiré : désactive le lien de paiement.

   Champs techniques ajoutés aux articles (invisibles pour la gérante) :
   stripeProductId, stripePriceId, stripeLinkId, stripePrix, stripeNom,
   stripeDesc, stripe (URL du bouton « Acheter en ligne »).

   Sans STRIPE_SECRET_KEY, le script se termine sans rien faire. */

'use strict';

const fs = require('fs');

const KEY = process.env.STRIPE_SECRET_KEY;
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const CATALOGUE = 'data/catalogue.json';

if (!KEY) {
  console.log('Pas de clé Stripe configurée (secret STRIPE_SECRET_KEY absent) — synchronisation ignorée.');
  process.exit(0);
}

async function stripe(method, path, params) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json.error && json.error.message) || ('HTTP ' + res.status));
  }
  return json;
}

function imageUrl(photo) {
  if (!photo) return null;
  if (/^https?:/.test(photo)) return photo;
  return SITE ? SITE + '/' + photo : null;
}

function prixValide(prix) {
  const n = Number(prix);
  return prix !== null && prix !== undefined && prix !== '' && !isNaN(n) && n > 0;
}

async function syncArticle(art) {
  let changed = false;

  if (!prixValide(art.prix)) {
    // Plus de prix affiché → on retire le bouton d'achat.
    if (art.stripe) {
      if (art.stripeLinkId) {
        await stripe('POST', 'payment_links/' + art.stripeLinkId, { active: 'false' })
          .catch((e) => console.warn(`  (désactivation du lien impossible : ${e.message})`));
      }
      art.stripe = null;
      art.stripeLinkId = null;
      changed = true;
      console.log(`- « ${art.nom} » : prix retiré, bouton d'achat désactivé`);
    }
    return changed;
  }

  const prix = Number(art.prix);
  const desc = art.description || '';

  // Produit
  if (!art.stripeProductId) {
    const params = { name: art.nom };
    if (desc) params.description = desc;
    const img = imageUrl(art.photo);
    if (img) params['images[0]'] = img;
    const product = await stripe('POST', 'products', params);
    art.stripeProductId = product.id;
    art.stripeNom = art.nom;
    art.stripeDesc = desc;
    changed = true;
    console.log(`- « ${art.nom} » : produit Stripe créé`);
  } else if (art.stripeNom !== art.nom || art.stripeDesc !== desc) {
    const params = { name: art.nom };
    params.description = desc; // vide = suppression de la description
    await stripe('POST', 'products/' + art.stripeProductId, params);
    art.stripeNom = art.nom;
    art.stripeDesc = desc;
    changed = true;
    console.log(`- « ${art.nom} » : produit Stripe mis à jour`);
  }

  // Tarif + lien de paiement (recréés si le prix change)
  if (!art.stripePriceId || art.stripePrix !== prix || !art.stripe) {
    const price = await stripe('POST', 'prices', {
      product: art.stripeProductId,
      currency: 'eur',
      unit_amount: String(Math.round(prix * 100))
    });

    if (art.stripeLinkId) {
      await stripe('POST', 'payment_links/' + art.stripeLinkId, { active: 'false' })
        .catch((e) => console.warn(`  (désactivation de l'ancien lien impossible : ${e.message})`));
    }

    const link = await stripe('POST', 'payment_links', {
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '1',
      'line_items[0][adjustable_quantity][enabled]': 'true',
      'line_items[0][adjustable_quantity][minimum]': '1',
      'line_items[0][adjustable_quantity][maximum]': '10',
      'billing_address_collection': 'auto'
    });

    art.stripePriceId = price.id;
    art.stripePrix = prix;
    art.stripeLinkId = link.id;
    art.stripe = link.url;
    changed = true;
    console.log(`- « ${art.nom} » : lien de paiement créé (${prix.toFixed(2)} €)`);
  }

  return changed;
}

(async () => {
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  let changed = false;
  let erreurs = 0;

  for (const themeKey of Object.keys(catalogue.themes)) {
    const theme = catalogue.themes[themeKey];
    for (const fam of theme.familles || []) {
      for (const art of fam.articles || []) {
        try {
          changed = (await syncArticle(art)) || changed;
        } catch (e) {
          erreurs++;
          console.error(`- « ${art.nom} » : ÉCHEC — ${e.message}`);
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
    console.log('catalogue.json mis à jour avec les liens de paiement.');
  } else {
    console.log('Rien à synchroniser.');
  }

  if (erreurs) process.exit(1);
})();
