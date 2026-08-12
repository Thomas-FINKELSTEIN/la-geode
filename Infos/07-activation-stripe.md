# Activation de la vente en ligne (Stripe) — à faire plus tard

> Tout est déjà installé et en veille. Ce document explique quoi faire le jour
> où on veut activer les boutons « Acheter en ligne ». Tant que ce n'est pas
> fait, le site fonctionne normalement, sans vente en ligne.

## Ce qui est déjà en place

Un robot (GitHub Action « Synchronisation Stripe ») se déclenche à chaque
publication du catalogue par la gérante :

- Article avec **prix** → il crée automatiquement dans Stripe le produit
  (nom, description, photo), le tarif, et le lien de paiement, puis fait
  apparaître le bouton **« Acheter en ligne »** sur la page de l'article
- **Prix modifié** → nouveau lien de paiement créé, l'ancien est désactivé
- **Prix retiré** (article en « Prix en boutique ») → bouton d'achat désactivé
- Nom ou description modifiés → mis à jour dans Stripe

**La gérante n'a jamais rien à faire** : elle saisit ses articles dans
l'admin comme d'habitude, le reste est automatique.

Le code : `.github/workflows/stripe-sync.yml` (déclencheur) et
`.github/scripts/stripe-sync.js` (logique). Le paiement passe par des
liens Stripe (page de paiement hébergée par Stripe : CB, Apple Pay,
Google Pay, reçu automatique). L'acheteur peut ajuster la quantité (1 à 10).

## Procédure d'activation (~20 minutes, une seule fois)

### 1. Créer le compte Stripe
- https://stripe.com/fr → créer un compte pour la **SARL Franck et David**
  (SIREN 504 847 179, il faudra un RIB et une pièce d'identité du gérant)
- Compléter l'activation du compte (informations de l'entreprise) pour
  pouvoir encaisser des paiements réels

### 2. Créer la clé API restreinte
- Dashboard Stripe → **Développeurs → Clés API → Créer une clé restreinte**
- Nom : `Robot catalogue La Géode`
- Permissions — mettre en **Écriture** uniquement :
  - **Products** (produits)
  - **Prices** (tarifs)
  - **Payment Links** (liens de paiement)
  - tout le reste : « Aucune »
- Copier la clé (`rk_live_…`)

*(Pourquoi restreinte : si la clé fuyait, elle ne permettrait ni de voir les
clients, ni de faire des remboursements — juste de créer des produits.)*

### 3. Donner la clé au robot
- GitHub → dépôt **la-geode** → **Settings → Secrets and variables → Actions**
- **New repository secret** :
  - Name : `STRIPE_SECRET_KEY`
  - Secret : la clé `rk_live_…` copiée
- Enregistrer. C'est tout.

### 4. Vérifier
- Demander à la gérante de publier n'importe quelle petite modification du
  catalogue (ou aller sur GitHub → Actions → « Synchronisation Stripe » →
  « Run workflow »)
- ~2-3 minutes après, les articles avec prix affichent « Acheter en ligne »
- Faire un achat test d'un petit article pour valider le parcours complet
  (on peut se rembourser depuis le Dashboard Stripe ensuite)

## Bon à savoir

- **Frais Stripe** : ~1,5 % + 0,25 € par paiement CB européenne (aucun
  abonnement, aucun frais fixe)
- **Livraison** : les liens de paiement ne configurent pas de frais de port
  par défaut. À décider au moment de l'activation : retrait en boutique
  uniquement (le plus simple), ou configuration des frais d'expédition dans
  Stripe (Dashboard → Payment Links, ou on adaptera le robot)
- **Pas de panier multi-articles** : chaque article s'achète individuellement
  (limitation d'un site statique). Si les ventes décollent, on pourra ajouter
  un vrai panier avec un service type Snipcart (~2 % de commission) ou un
  petit backend
- **Mode test** : on peut d'abord brancher une clé restreinte du **mode test**
  de Stripe (`rk_test_…`) pour tout essayer sans argent réel, puis la
  remplacer par la clé live
