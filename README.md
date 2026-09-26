# OpenSwissData

Jeux de données publics suisses normalisés : FINMA, TARES et classifications. API Hono, site Astro et collectes TypeScript dans ce dépôt. Les données des clients et les preuves privées restent hors Git.

## Préparer une copie de travail

Node **22.12 ou ultérieur** ; la CI et Railway utilisent Node 22. Utiliser une copie isolée et lire `AGENTS.md` avant de commencer. Depuis la racine de cette copie :

```sh
npm ci
npm --prefix web ci
npm run typecheck
npm test
npm run build
```

Ces contrôles ne demandent aucun secret de production. Ne pas copier un `.env` ni une base de clients pour tester. Le build prépare des modèles publics figés : le premier passage demande le réseau et plusieurs gigaoctets ; les suivants contrôlent et réutilisent `dist/models`. La construction du site vérifie ensuite liens, langues et sitemap.

Les tests créent des bases fictives dans des dossiers temporaires et injectent explicitement leurs clés Ed25519 éphémères. Ils ne remplacent jamais la clé publique officielle et ne contactent pas les autorités d’horodatage pour fabriquer les archives de test. La CI vérifie que les fichiers suivis sont inchangés après les tests.

## Démarrer localement

Après construction, depuis la copie isolée, sans variables de production :

```sh
npm run db:migrate
npm run dev
```

L’application est accessible sur `http://localhost:3000`. `DATABASE_PATH` permet de choisir une base locale fictive ; par défaut, elle est créée dans `data/openswissdata.sqlite`. Le site servi vient de `web/dist` et se reconstruit avec `npm run web:build`. `npm run web:dev` lance séparément le serveur Astro.

Une base vide permet de démarrer, mais ne satisfait pas `/api/health/ready` : ce contrôle exige les trois versions distribuées et les ressources du site. Ne pas inventer des versions pour contourner la disponibilité. Les tests créent leurs propres références fictives. Paiement, messagerie et stockage ne fonctionnent qu’avec leurs connexions configurées ; les commandes de vérification ci-dessus n’en ont pas besoin.

`db:migrate` initialise le schéma et applique les évolutions idempotentes de `getDb()`. Ce n’est pas un exécuteur de toutes les anciennes migrations SQL : l’élargissement historique Business reste une intervention distincte avant réouverture de cette offre.

## Carte du projet

| Dossier | Rôle |
| --- | --- |
| `src/routes`, `src/lib` | API, comptes, CRM privé, droits, files de livraison et suivi financier |
| `src/db` | Schéma SQLite ; le volume Railway conserve la base |
| `src/legal` | Contrats datés immuables et registre des versions |
| `src/mcp` | Outils MCP, OAuth, données réellement chargées et rafraîchissement R2 |
| `etl` | Sources en bronze, validation, archives signées, publication des jeux de données |
| `web` | Site Astro, pages de produits, compte, bureau et centre juridique FR/DE/EN |
| `sdks` | Intégrations publiables avec installation et tests indépendants |
| `tests` | Scénarios fictifs, pannes, reprises et contrats techniques |
| `docs/internal` | Rapports et preuves privés, ignorés par Git |

Les archives vendues résident dans R2. La base référence leurs versions ; catalogue, échantillons et caches MCP suivent les publications validées. Les fiches publiques FINMA et les index vectoriels historiques sont distincts : voir `docs/fiches-publiques.md` et les limites dans `AGENTS.md`.

## Publication et contrôles

`main` alimente Railway, qui attend les tests GitHub puis `/api/health/ready`. Un changement uniquement documentaire ou ETL peut être ignoré par les filtres de `railway.json` : le SHA de l’application demeure alors celui du dernier déploiement. Un push réussi ne prouve pas la publication.

Après modification : tests adaptés, typage, build si application/site, `npm run security:public`, puis contrôle de la CI et de la version réellement servie à `/api/health/ready`. Vérifier les parcours concernés dans un navigateur, aussi sur mobile. Les contrôles `/ready` (démarrage), `/freshness` (FINMA) et `/deep` (diagnostic privé des dépendances externes) ont des rôles différents. `/deep` exige une session administrateur ; le bureau propose le contrôle dans Automatisations. Les moniteurs sans session utilisent `/ready` et `/freshness`, sans lancer d’appels Stripe ou R2.

Ne pas lancer les commandes `etl:*` comme un simple test : elles peuvent publier. Utiliser les simulations prévues dans `AGENTS.md` et les workflows manuels, qui démarrent en simulation. Ne pas rouvrir les abonnements ou l’offre Pro sans traiter leurs conditions spécifiques.
