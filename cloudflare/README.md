# Relais IA (Cloudflare Worker + Google Gemini) — mode d'emploi

Ce relais permet le bouton « ✨ Générer avec l'IA » de l'admin : il reçoit une
photo, appelle Google Gemini (offre gratuite, autorisée en Europe) et renvoie un
titre + une description. La clé reste secrète dans le Worker ; rien dans le site.

> Note : on n'utilise PAS les modèles Llama de Cloudflare — leur licence interdit
> l'usage aux entreprises de l'UE (or La Géode est une SARL française).

## Déploiement (une seule fois)

1. **Clé Google gratuite** : va sur **aistudio.google.com** → connecte-toi avec un
   compte Google → **Get API key** → **Create API key** → copie la clé
   (commence par `AIza…`). L'usage est gratuit (1 500 requêtes/jour).

2. **Cloudflare → Workers & Pages → Create → Create Worker**, nom `geode-ia`,
   **Deploy**.

3. **Edit code** : efface tout, colle le contenu de `worker-ia.js`, **Deploy**.

4. **Ajouter la clé** : Worker → **Settings → Variables and Secrets → Add** →
   type **Secret**, nom **`GEMINI_API_KEY`**, valeur = la clé `AIza…`. Enregistrer,
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
