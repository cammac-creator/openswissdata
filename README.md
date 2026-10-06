# OpenSwissData

**Swiss federal reference data for AI agents and developers:** the Swiss customs tariff (TARES, 8-digit tariff numbers with MFN duty and preferential regimes), the FINMA register of supervised institutions and the FINMA warnings list, and NOGA / NACE / ISIC activity-code correspondences.

- **Free MCP endpoint, no key or sign-up:** `https://mcp.openswissdata.com/jsonrpc`, four tools (`tariff_lookup`, `kyc_check`, `company_check`, `cross_walk`), 100 calls per hour per IP address, plus a free trial of the three search tools (`tariff_semantic_search`, `classify_text`, `finma_search`): 20 calls per day per IP address in total. Claude Code: `claude mcp add --transport http openswissdata https://mcp.openswissdata.com/jsonrpc`. Local-process clients: `npx -y @openswissdata/mcp`.
- **Full datasets as signed files:** [openswissdata.com](https://www.openswissdata.com/en/). Summary for AI agents: [llms.txt](https://www.openswissdata.com/llms.txt).
- Unofficial copies: binding decisions belong to the official sources (xtares.admin.ch, finma.ch, the Swiss Federal Statistical Office).

## Tools

| Tool | Access | What it answers |
| --- | --- | --- |
| `tariff_lookup` | Free, no key | Swiss customs tariff line for an 8-digit tariff number (MFN duty, preferential regimes, restrictions, relief codes), or the Swiss lines under a 2- to 7-digit HS prefix |
| `kyc_check` | Free, no key | FINMA register of supervised institutions and FINMA warning list, searched by name, closest matches first |
| `cross_walk` | Free, no key | Correspondence of an activity code between NOGA 2008/2025, NACE 2.0/2.1 and ISIC 4, with the relation type and its source |
| `tariff_semantic_search` | Free trial, no key (20 calls/day in total) | TARES lines from a description in French, German, Italian or English, using each line's official hierarchy |
| `tariff_changelog` | Existing access grant | MFN duty history of a tariff number across archived releases |
| `classify_text` | Free trial, no key (20 calls/day in total) | NOGA 2025 subclasses suggested for an activity description (FR/DE/IT/EN) |
| `finma_search` | Free trial, no key (20 calls/day in total) | FINMA register search tolerant of accents, legal forms and typos, each match labelled with its type |
| `entity_history` | Existing access grant | Change history of a FINMA-supervised entity by Swiss UID |

New Pro subscriptions are closed; the three free tools and the search trial need no sign-up. The endpoint accepts browser calls (CORS, any origin, no cookies).

---

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

La [procédure de sauvegarde et de reprise](docs/sauvegarde-et-reprise.md) distingue les contrôles réels de la base, les témoins indépendants dans le stockage et l’exercice complet du service restant à réaliser.

## Publication et contrôles

`main` alimente Railway, qui attend les tests GitHub puis `/api/health/ready`. Un changement uniquement documentaire ou ETL peut être ignoré par les filtres de `railway.json` : le SHA de l’application demeure alors celui du dernier déploiement. Un push réussi ne prouve pas la publication.

Après modification : tests adaptés, typage, build si application/site, `npm run security:public`, puis contrôle de la CI et de la version réellement servie à `/api/health/ready`. Vérifier les parcours concernés dans un navigateur, aussi sur mobile. Les contrôles `/ready` (démarrage), `/freshness` (FINMA) et `/deep` (diagnostic privé des dépendances externes) ont des rôles différents. `/deep` exige une session administrateur ; le bureau propose le contrôle dans Automatisations. Les moniteurs sans session utilisent `/ready` et `/freshness`, sans lancer d’appels Stripe ou R2.

Ne pas lancer les commandes `etl:*` comme un simple test : elles peuvent publier. Utiliser les simulations prévues dans `AGENTS.md` et les workflows manuels, qui démarrent en simulation. Ne pas rouvrir les abonnements ou l’offre Pro sans traiter leurs conditions spécifiques.
