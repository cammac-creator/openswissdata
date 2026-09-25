# Dépendances — contrôle du 25.09.2026

Le contrôle npm porte sur les graphes verrouillés de l’application et du site. Il ne prouve ni l’absence de toute vulnérabilité ni la couverture des SDK séparés et du code métier.

- Serveur : Hono 4.13.9, adaptateur Node 1.19.17, Sentry 10.75.3 ; analyse des CSV avec csv-parse 7.0.3. Le correctif Hono concerne notamment la limite des corps de requête sans longueur annoncée. Les protections de session, d’origine et CSRF sont conservées.
- Excel : SheetJS 0.20.3 depuis sa distribution officielle, URL et intégrité verrouillées. `etl/shared/xlsx.ts` utilise la variante CommonJS recommandée pour Node, avec filesystem et encodages inclus. Ne pas revenir au paquet npm 0.18.5.
- Tests : Vitest 4.1.11 ; les constructeurs simulés restent de vrais constructeurs. Aucun scénario ni assertion retiré.
- Site : Astro 7.3.5 en génération statique, sans serveur Astro en production. Les avis d’optimisation d’images et de rendu serveur ne prouvent donc pas une exploitation du service existant ; la mise à jour réduit néanmoins les dépendances signalées.
- Un seul moteur Transformers.js 3.8.1 pour recherche et traduction. L’ancien Xenova 2 et son ancien protobufjs sont retirés. Les requêtes sont traitées localement. Les index existants restent distincts des collectes de fichiers. Les caches de reprise exigent la révision du modèle et le moteur de calcul courants ; les anciens caches sont recalculés.
- Deux contraintes transitives explicites : sharp 0.35.4 (correctifs des décodeurs d’images) et esbuild 0.28.2 (serveur de développement). Pas d’entrée image dans nos parcours IA ; build, traduction et recherche doivent être revalidés lors de leur évolution. Retirer ces contraintes lorsque les paquets parents adoptent des versions corrigées compatibles.

## Modèle de recherche

Modèle `Xenova/paraphrase-multilingual-mpnet-base-v2`, révision figée `e5d116277351513fd260955ece953ecddde7046e`. Les quatre fichiers ont taille et SHA-256 dans `src/lib/embedding-model.ts`. La construction conserve les octets dans un cache distinct, vérifie les empreintes et refuse les téléchargements trop volumineux ou tronqués avant promotion du fichier temporaire. L’exécution ne télécharge rien et ne transmet aucun texte.

Pour les collectes qui génèrent explicitement des vecteurs : exécuter `npm run models:prepare:embedding` avant la collecte. La construction complète le fait également. Cache ignoré Git dans `dist/models/embedding/`, conservé par le nettoyage de build. Ne pas publier de nouveaux index à partir d’un modèle ou d’une révision différente sans revalider ensemble index et requêtes.

Comparaison locale sur six textes FR/DE/EN et les deux index existants : premier résultat identique et même ensemble de cinq premiers résultats dans les douze comparaisons. Les vecteurs ne sont pas rigoureusement identiques (cosinus minimal 0,9989). Cette vérification bornée ne prouve pas une invariance sur toute requête ni une qualité métier générale.

## Sources officielles

- [SheetJS Node](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [Hono : corps de requêtes](https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v)
- [csv-parse : prototypes](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx)
- [Vitest : serveur UI](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
- [Migration Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/)
- [Modèle public à la révision utilisée](https://huggingface.co/Xenova/paraphrase-multilingual-mpnet-base-v2/tree/e5d116277351513fd260955ece953ecddde7046e)

Les preuves détaillées de contrôle, mesures et essais sont dans le dossier privé du chantier. Aucun secret ou contenu de mail dans ce document.
