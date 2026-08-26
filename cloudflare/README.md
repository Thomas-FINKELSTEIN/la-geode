# Relais IA (Cloudflare Worker + Mistral) — mode d'emploi

Ce relais permet le bouton « ✨ Générer avec l'IA » de l'admin : il reçoit une
photo, appelle Mistral (entreprise française, offre gratuite, modèle vision
Pixtral) et renvoie un titre + une description. La clé reste secrète dans le
Worker ; rien dans le site.

> Note : on n'utilise PAS les modèles Llama de Cloudflare — leur licence interdit
> l'usage aux entreprises de l'UE (or La Géode est une SARL française). Mistral
> est une société française : pas de restriction UE, très bon français, clé stable.

## Déploiement (une seule fois)

1. **Clé Mistral gratuite** : va sur **console.mistral.ai** → crée un compte
   (vérification par téléphone, **sans carte bancaire**) → **API Keys** →
   **Create new key** → copie la clé. Offre gratuite « Experiment » (~1 milliard
   de tokens/mois).

2. **Cloudflare → Workers & Pages → Create → Create Worker**, nom `geode-ia`,
   **Deploy**.

3. **Edit code** : efface tout, colle le contenu de `worker-ia.js`, **Deploy**.

4. **Ajouter la clé** : Worker → **Settings → Variables and Secrets → Add** →
   type **Secret**, nom **`MISTRAL_API_KEY`**, valeur = la clé Mistral. Enregistrer,
   puis **Deploy**.

5. **Copier l'adresse du Worker** (`https://geode-ia.<sous-domaine>.workers.dev`)
   et la donner à Thomas pour l'inscrire dans l'admin (`IA_WORKER_URL`).

*(Le binding « Workers AI » n'est plus nécessaire ; s'il a été ajouté, on peut le
laisser ou le retirer, sans effet.)*

## Bon à savoir
- **Gratuit** dans la limite du quota quotidien Workers AI (largement suffisant
  pour une boutique).
- Les descriptions IA sont des **brouillons** : la gérante relit et corrige
  toujours avant de publier.
- Aucune allégation médicale n'est produite (consigne intégrée au relais).
