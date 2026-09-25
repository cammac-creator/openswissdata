# Dépendances — contrôle du 25.09.2026

Le contrôle npm porte sur les graphes verrouillés de l’application, du site, de la passerelle `sdks/mcp-server` et du client `sdks/sdk-ts`. Ces quatre graphes ne remontent aucun avis au contrôle du 25.09.2026. Cela ne prouve ni l’absence de toute vulnérabilité ni la couverture du code métier, des lecteurs historiques `packages/` ou de Python.

- Serveur : Hono 4.13.9, adaptateur Node 1.19.17, Sentry 10.75.3 ; analyse des CSV avec csv-parse 7.0.3. Le correctif Hono concerne notamment la limite des corps de requête sans longueur annoncée. Les protections de session, d’origine et CSRF sont conservées.
- Excel : SheetJS 0.20.3 depuis sa distribution officielle, URL et intégrité verrouillées. `etl/shared/xlsx.ts` utilise la variante CommonJS recommandée pour Node, avec filesystem et encodages inclus. Ne pas revenir au paquet npm 0.18.5.
- Tests : Vitest 4.1.11 ; les constructeurs simulés restent de vrais constructeurs. Aucun scénario ni assertion retiré.
- Intégrations : SDK MCP officiel 1.30.1 et dépendances transitives actualisées ; Vitest 4 pour les deux paquets maintenus. Le délai de requête inclut désormais le corps de réponse. Échange MCP réel en mémoire et processus STDIO issu de l’archive installée vérifiés ; distributions ESM et CommonJS du client également.
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

## Contrôle récurrent

`dependency-audit.yml` examine les quatre lockfiles chaque lundi à 06 h 35 UTC et sur demande. Il consulte les avis npm sans installer ni exécuter les paquets, échoue dès un avis et conserve les rapports 14 jours. Aucune mise à jour forcée ni publication automatique de paquet. La CI des deux intégrations installe avec `npm ci`, vérifie les types, les tests, la compilation, le contenu du paquet et l’audit.

Pour le site, régénérer le lockfile depuis un dossier propre et vérifier également avec npm 10, utilisé par Node 22 sur Railway. Un succès npm 11/Mac ne prouve pas une installation npm 10/Linux : l’omission de dépendances WASM a bloqué un build le 25 septembre.

## Modèles de traduction

Les deux révisions de traduction restent inchangées : [m2m100 multilingue](https://huggingface.co/Xenova/m2m100_418M/tree/9c374f0b7aca709787cea97b047bfbbd1559d177) et [opus anglais–français](https://huggingface.co/Xenova/opus-mt-en-fr/tree/28726206f80896b90035bd99cccd5cc1e151f916). Leurs douze fichiers (753 087 762 octets) ont été comparés aux objets du dépôt officiel, par SHA-256 LFS pour les poids et par identifiant Git pour les petits fichiers. Les SHA-256 de tous les fichiers sont maintenant figés dans `translation-model.ts`.

Le même contrôle de cache sert à la recherche et à la traduction : taille et empreinte, écriture temporaire unique, refus d’un flux trop long, tronqué ou différent, promotion seulement après validation. Un cache de taille correcte mais altéré ne passe plus silencieusement. Une panne laisse l’ancien fichier en place mais fait échouer la préparation ; elle ne le déclare pas valide. Les textes de mails restent dans le processus local de traduction ; ces contrôles portent sur les fichiers publics du modèle, pas sur leur qualité linguistique.
