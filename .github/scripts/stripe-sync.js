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

// Mode test ou réel, détecté depuis la clé : au changement de mode, les
// produits/liens de l'ancien mode sont recréés dans le nouveau.
const MODE = /_test_/.test(KEY) ? 'test' : 'live';

const MESSAGE_CONFIRMATION =
  'Merci pour votre achat ! Votre article vous attend au showroom — ' +
  '15 Avenue du Maréchal Joffre, 66740 Saint-Génis-des-Fontaines ' +
  '(du mardi au samedi, 9h-12h et 15h-19h). ' +
  'Présentez votre reçu de paiement en boutique.';

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

// Stock : entier strictement positif = quantité suivie ; sinon illimité.
function stockValeur(stock) {
  const n = Number(stock);
  if (stock === null || stock === undefined || stock === '' || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function syncArticle(art) {
  let changed = false;

  // Changement de mode test/réel : on repart de zéro pour cet article.
  if (art.stripeMode && art.stripeMode !== MODE) {
    art.stripeProductId = null;
    art.stripePriceId = null;
    art.stripeLinkId = null;
    art.stripePrix = null;
    art.stripe = null;
    art.stripeMode = null;
    changed = true;
    console.log(`- « ${art.nom} » : changement de mode Stripe, recréation`);
  }

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
  const stock = stockValeur(art.stock);

  // Produit
  if (!art.stripeProductId) {
    const params = { name: art.nom };
    if (desc) params.description = desc;
    const img = imageUrl(art.photo);
    if (img) params['images[0]'] = img;
    const product = await stripe('POST', 'products', params);
    art.stripeProductId = product.id;
    art.stripeMode = MODE;
    art.stripeNom = art.nom;
    art.stripeDesc = desc;
    changed = true;
    console.log(`- « ${art.nom} » : produit Stripe créé (mode ${MODE})`);
  } else if (art.stripeNom !== art.nom || art.stripeDesc !== desc) {
    const params = { name: art.nom };
    params.description = desc; // vide = suppression de la description
    await stripe('POST', 'products/' + art.stripeProductId, params);
    art.stripeNom = art.nom;
    art.stripeDesc = desc;
    changed = true;
    console.log(`- « ${art.nom} » : produit Stripe mis à jour`);
  }

  // Tarif (recréé si le prix change)
  const prixChange = art.stripePrix !== prix;
  if (!art.stripePriceId || prixChange) {
    const price = await stripe('POST', 'prices', {
      product: art.stripeProductId,
      currency: 'eur',
      unit_amount: String(Math.round(prix * 100))
    });
    art.stripePriceId = price.id;
    art.stripePrix = prix;
    changed = true;
  }

  // Lien de paiement (recréé si le prix ou le stock change).
  // Stock suivi → quantité fixée à 1 par commande (1 vente = 1 unité) et
  // limite de ventes = stock : Stripe bloque tout paiement au-delà.
  // Sans stock → quantité ajustable 1 à 10, ventes illimitées.
  const stockChange = (art.stripeStock === undefined ? null : art.stripeStock) !== stock;
  if (!art.stripeLinkId || prixChange || stockChange || !art.stripe) {
    if (art.stripeLinkId) {
      await stripe('POST', 'payment_links/' + art.stripeLinkId, { active: 'false' })
        .catch((e) => console.warn(`  (désactivation de l'ancien lien impossible : ${e.message})`));
    }

    const params = {
      'line_items[0][price]': art.stripePriceId,
      'line_items[0][quantity]': '1',
      'billing_address_collection': 'auto',
      // Case à cocher obligatoire « J'accepte les conditions de vente » avant paiement.
      // (Le lien vers les CGV se règle une fois dans Stripe : Paramètres → Informations
      //  publiques → Conditions d'utilisation → https://lageode66.fr/conditions-de-vente/)
      'consent_collection[terms_of_service]': 'required',
      // Message bien visible AU-DESSUS du bouton de paiement Stripe
      'custom_text[submit][message]':
        'RETRAIT EN BOUTIQUE UNIQUEMENT — aucune livraison. Vous récupérez votre article ' +
        'au showroom, 15 Avenue du Maréchal Joffre, 66740 Saint-Génis-des-Fontaines. ' +
        'Nous vous prévenons dès qu\'il est prêt.',
      'after_completion[type]': 'hosted_confirmation',
      'after_completion[hosted_confirmation][custom_message]': MESSAGE_CONFIRMATION
    };
    if (stock) {
      params['restrictions[completed_sessions][limit]'] = String(stock);
    } else {
      params['line_items[0][adjustable_quantity][enabled]'] = 'true';
      params['line_items[0][adjustable_quantity][minimum]'] = '1';
      params['line_items[0][adjustable_quantity][maximum]'] = '10';
    }

    const link = await stripe('POST', 'payment_links', params);
    art.stripeLinkId = link.id;
    art.stripe = link.url;
    art.stripeStock = stock;
    art.epuise = false;
    changed = true;
    console.log(`- « ${art.nom} » : lien de paiement créé (${prix.toFixed(2)} €` +
      (stock ? `, stock ${stock}` : '') + ')');
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
