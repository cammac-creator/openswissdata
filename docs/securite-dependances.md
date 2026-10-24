# Dépendances — contrôle du 25.09.2026

Le contrôle npm porte sur les graphes verrouillés de l’application, du site, de la passerelle `sdks/mcp-server` et du client `sdks/sdk-ts`. Ces quatre graphes ne remontent aucun avis au contrôle du 25.09.2026. Cela ne prouve ni l’absence de toute vulnérabilité ni la couverture du code métier, des lecteurs historiques `packages/` ou de Python.

- Serveur : Hono 4.13.9, adaptateur Node 1.19.17, Sentry 10.75.3 ; analyse des CSV avec csv-parse 7.0.3. Le correctif Hono concerne notamment la limite des corps de requête sans longueur annoncée. Les protections de session, d’origine et CSRF sont conservées.
- Excel : SheetJS 0.20.3 depuis sa distribution officielle, URL et intégrité verrouillées. `etl/shared/xlsx.ts` utilise la variante CommonJS recommandée pour Node, avec filesystem et encodages inclus. Ne pas revenir au paquet npm 0.18.5.
- Tests : Vitest 4.1.12 depuis le 22.10.2026 (4.1.11 auparavant) ; les constructeurs simulés restent de vrais constructeurs. Aucun scénario ni assertion retiré.
- Intégrations : SDK MCP officiel 1.30.1 et dépendances transitives actualisées ; Vitest 4 pour les deux paquets maintenus. Le délai de requête inclut désormais le corps de réponse. Échange MCP réel en mémoire et processus STDIO issu de l’archive installée vérifiés ; distributions ESM et CommonJS du client également.
- Site : Astro 7.3.5 en génération statique, sans serveur Astro en production. Les avis d’optimisation d’images et de rendu serveur ne prouvent donc pas une exploitation du service existant ; la mise à jour réduit néanmoins les dépendances signalées.
- Un seul moteur Transformers.js 3.8.1 pour recherche et traduction. L’ancien Xenova 2 et son ancien protobufjs sont retirés. Les requêtes sont traitées localement. Les index existants restent distincts des collectes de fichiers. Les caches de reprise exigent la révision du modèle et le moteur de calcul courants ; les anciens caches sont recalculés.
- Deux contraintes transitives explicites : sharp 0.35.5 depuis le 21.10.2026 (0.35.4 auparavant ; correctifs des décodeurs d’images) et esbuild 0.28.2 (serveur de développement). Pas d’entrée image dans nos parcours IA ; build, traduction et recherche doivent être revalidés lors de leur évolution. Retirer ces contraintes lorsque les paquets parents adoptent des versions corrigées compatibles.

## Mise à jour du 24.10.2026 (zod 4)

Application : `zod` 3.25.76 → 4.6.7 (plage `^4.6.7`), qui lève l'avis élevé GHSA-mrhx-c7xc-m3w5 : depuis 4.6.6, une collection qui dépasse son `.max()` est refusée par une seule erreur, sans valider ses éléments. Un seul changement de code : `z.record` à deux arguments dans la route des événements, sans changement de comportement. Les chemins financiers qui importent zod (`src/routes/checkout.ts`, `src/routes/stripe-webhook.ts`, `src/lib/stripe-financial.ts`) sont inchangés et leurs tests passent tels quels. Les messages d'erreur des outils MCP gardent leur préfixe `Invalid input:` mais adoptent le format de zod 4. La lecture des variables d'environnement de production donne le même résultat sous zod 3 et zod 4 (essai avec les noms réels et des valeurs factices). Preuves : `npm ci` puis `npm audit --audit-level=low` à 0 avis, typage 0, suite complète 233 fichiers (3 530 tests, dont 17 neufs), sous Node 22.23.3 et npm 10.9.9.

## Mise à jour du 24.10.2026

Avis apparus dans la CI des intégrations du 24.10 (paquet MCP), puis relevés sur les quatre lockfiles :
- `sdks/mcp-server` : `zod` 4.3.6 → 4.6.7 (avis élevé GHSA-mrhx-c7xc-m3w5, versions < 4.6.6 ; version épinglée dans `package.json`, seul changement de déclaration), `body-parser` 2.3.0 → 2.4.0 (élevé), `fast-uri` 3.1.8 → 3.1.9 (moyen) ; aucune nouvelle version du paquet publié.
- Site (`web`) : `undici` 8.11.2 → 8.12.3 (élevé) et `zod` 4.6.5 → 4.6.7, dans les plages déclarées ; `@emnapi/core` et `@emnapi/runtime` gardés dans le lockfile.
- Application : `mailparser` 3.9.28 → 3.12.4 et ses dépendances, dans la plage ^3.9.28, pour lever l'avis moyen sur `nodemailer` < 10.1.4 qu'il embarquait. `qs` 6.16.1 suit `body-parser` dans le paquet MCP sans corriger d'avis.
- **Levé le même jour par la migration vers zod 4 (section ci-dessus)** : `zod` 3 de l'application (plage ^3.23.0) n'avait aucune version corrigée. Corps bornés avant validation : 4 Kio (événements, paiement, connexion, confirmation de connexion), 16 Kio pour le CRM (administration), 16 Kio en OAuth, 64 Kio en MCP ; les autres routes d'administration ne lisent leur corps qu'après le contrôle du secret. La demande de téléchargement d'un client connecté (`/api/account/download-request`) n'a pas de plafond propre ; son schéma n'a aucune collection, donc l'avis ne la touche pas.
- Preuves : sous Node 22.23.3 et npm 10.9.9, `npm audit --audit-level=low` à 0 avis pour `sdks/mcp-server`, `sdks/sdk-ts` et `web` ; paquet MCP : typage, 12 tests, construction et `npm pack --dry-run` verts ; site : `npm ci` puis construction verte (11 672 pages) ; application : suite complète verte (230 fichiers, 3 513 tests).

## Mise à jour du 23.10.2026

Avis GHSA-rxp7-6hxx-x8q5 (moyen) sur `ip-address` ≤ 10.7.3, apparu dans la CI des intégrations du 23.10 (paquet MCP) :
- `ip-address` 10.7.2 → 10.7.4 dans le lockfile de l'application (sous `socks`, plage ^10.1.1) et dans celui de `sdks/mcp-server` (sous `express-rate-limit`, plage ^10.2.0). Aucune dépendance ni moteur Node changés entre les deux versions ; aucune nouvelle version du paquet publié.
- Preuves : `npm ci` puis `npm audit --audit-level=low` à 0 avis des deux côtés ; paquet MCP : typage, 12 tests et construction verts ; application : typage 0, suite complète 223 fichiers (3 400 tests), sous Node 22.23.3 et npm 10.9.9.

## Mise à jour du 22.10.2026

Les sept avis moyens restants (voir le 21.10) sont levés sans version majeure :
- Application : `overrides` `global-agent` ^4.1.3 (au lieu de 3.0.0 sous `onnxruntime-node` 1.21.0). La version 4 ne dépend plus de `roarr` ni de `sprintf-js` (avis GHSA-hp3w-g68c-fv3c, aucune version corrigée de `sprintf-js`). `onnxruntime-node` n'utilise `global-agent` que dans son script d'installation (`bootstrap()`, présent en 4.1.3 et vérifié). Transformers.js reste en 3.8.1 : modèle, révision, moteur et index de recherche inchangés.
- Site : `overrides` `postcss-selector-parser` ^7.1.7 sous `@tailwindcss/typography` (avis GHSA-rj75-hqrm-r3gf ; la dernière version 0.5.20 du greffon impose encore 6.0.10). Les 15 feuilles CSS construites sont identiques à l'octet près à celles de main.
- Lockfiles calculés par npm 11.6.2, installés et vérifiés par `npm ci` sous npm 10.9.9 ; entrées @emnapi/core et @emnapi/runtime conservées dans le lock du site.
- Preuves : `npm audit` 0 avis (application et site), typage 0, suite complète 218 fichiers (3 350 tests), `web:build` avec seo, polices et bureau verts, sous Node 22.23.3.

## Mise à jour du 21.10.2026

Avis apparus les 19 et 21.10.2026 (contrôle hebdomadaire rouge, puis CI des intégrations) :
- Application : Hono 4.13.9 → 4.13.13 (avis GHSA-5r4p-p66f-jhc7, le serveur utilise `serveStatic`) ; contrainte sharp 0.35.4 → 0.35.5 (dépendance de libvips corrigée) ; vite 8.3.5 et source-map-js 1.2.2 par `npm audit fix`, sans changement majeur.
- Site : sharp, vite, source-map-js et http-cache-semantics par `npm audit fix` ; entrées @emnapi/core et @emnapi/runtime conservées dans le lock.
- Intégrations : vite et hono dans les lockfiles des deux kits (même jour).
- Restent cinq avis moyens côté application, tous sous `@huggingface/transformers` 3.8.1 (global-agent, roarr, sprintf-js, onnxruntime-node) : leur correctif est la version majeure 4, qui demande de revalider modèle, index et recherche ensemble (même règle que pour une nouvelle révision de modèle). Et deux avis moyens côté site sous `@tailwindcss/typography` (outil de construction, rien n'est servi au navigateur). À traiter dans un lot dédié.
- Preuves : typage 0, suite complète 213 fichiers (3 312 tests), `web:build` avec seo, polices et bureau verts, construction complète du serveur réussie, sous Node 22.23.3 et npm 10.9.9.

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

## Contrôle récurrent

`dependency-audit.yml` examine les quatre lockfiles chaque lundi à 06 h 35 UTC et sur demande. Il consulte les avis npm sans installer ni exécuter les paquets, échoue dès un avis et conserve les rapports 14 jours. Aucune mise à jour forcée ni publication automatique de paquet. La CI des deux intégrations installe avec `npm ci`, vérifie les types, les tests, la compilation, le contenu du paquet et l’audit.

Pour le site, régénérer le lockfile depuis un dossier propre et vérifier également avec npm 10, utilisé par Node 22 sur Railway. Un succès npm 11/Mac ne prouve pas une installation npm 10/Linux : l’omission de dépendances WASM a bloqué un build le 25 septembre.

## Modèles de traduction

Les deux révisions de traduction restent inchangées : [m2m100 multilingue](https://huggingface.co/Xenova/m2m100_418M/tree/9c374f0b7aca709787cea97b047bfbbd1559d177) et [opus anglais–français](https://huggingface.co/Xenova/opus-mt-en-fr/tree/28726206f80896b90035bd99cccd5cc1e151f916). Leurs douze fichiers (753 087 762 octets) ont été comparés aux objets du dépôt officiel, par SHA-256 LFS pour les poids et par identifiant Git pour les petits fichiers. Les SHA-256 de tous les fichiers sont maintenant figés dans `translation-model.ts`.

Le même contrôle de cache sert à la recherche et à la traduction : taille et empreinte, écriture temporaire unique, refus d’un flux trop long, tronqué ou différent, promotion seulement après validation. Un cache de taille correcte mais altéré ne passe plus silencieusement. Une panne laisse l’ancien fichier en place mais fait échouer la préparation ; elle ne le déclare pas valide. Les textes de mails restent dans le processus local de traduction ; ces contrôles portent sur les fichiers publics du modèle, pas sur leur qualité linguistique.
