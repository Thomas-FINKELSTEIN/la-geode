# Relais IA (Cloudflare Workers AI) — mode d'emploi

Ce relais permet le bouton « ✨ Générer avec l'IA » de l'admin : il reçoit une
photo, appelle un modèle d'IA gratuit de Cloudflare, et renvoie un titre + une
description. La clé/facturation reste chez Cloudflare (offre gratuite) ; aucun
secret n'est dans le site.

## Déploiement (une seule fois)

1. **Cloudflare → Workers & Pages → Create → Create Worker.**
   Nom : `geode-ia`. Cliquer « Deploy » (le worker « Hello World » par défaut).

2. **Edit code** : effacer tout, coller le contenu de `worker-ia.js`, puis **Deploy**.

3. **Ajouter le binding IA** : dans le Worker → **Settings → Bindings → Add →
   Workers AI**. Nom de la variable : **`AI`** (exactement). Enregistrer, puis
   **Deploy** à nouveau.

4. **Accepter la licence du modèle (une fois)** : aller dans **AI → Playground**,
   choisir le modèle `llama-3.2-11b-vision-instruct`, lancer un essai. Cela
   accepte la licence Meta et vérifie que le modèle répond. (Sinon, le premier
   appel du Worker renverra une erreur de licence.)

5. **Copier l'adresse du Worker** (du type `https://geode-ia.<sous-domaine>.workers.dev`)
   et la donner à Thomas pour qu'il l'inscrive dans l'admin (`IA_WORKER_URL`).

## Bon à savoir
- **Gratuit** dans la limite du quota quotidien Workers AI (largement suffisant
  pour une boutique).
- Les descriptions IA sont des **brouillons** : la gérante relit et corrige
  toujours avant de publier.
- Aucune allégation médicale n'est produite (consigne intégrée au relais).
