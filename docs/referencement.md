# Référencement — règles de construction

Les pages publiques conservent leurs adresses. Les comptes, l’administration, la page privée et les erreurs ne doivent pas apparaître dans le sitemap. Une page sans traduction anglaise ne déclare pas une adresse anglaise fictive : les pages juridiques ont FR/DE, les articles et les tarifs sont actuellement en français. Le sélecteur renvoie vers l’accueil de la langue absente, avec une indication de repli.

Le sitemap n’a pas de `lastmod` automatique. Une date de compilation ne prouve pas une modification du contenu. Réintroduire ce champ seulement avec une source vérifiable de changements significatifs, conservée d’une construction à l’autre. Les dates éditoriales explicites des articles restent distinctes.

`npm run web:build` exécute aussi `npm run seo:check`. Le contrôle porte sur les fichiers produits : canoniques, traductions existantes et réciproques, liens internes et URLs indexables du sitemap. Il ignore les routes API servies dynamiquement et les fichiers de validation Google, qui ne sont pas des pages. Un lien dans une chaîne JavaScript n’est pas traité comme un lien HTML rendu.

Ce contrôle ne mesure ni la qualité métier des fiches ni leur présence dans Google. Les données historiques des fiches FINMA et les correspondances NOGA générées restent un chantier distinct. Avant suppression ou changement d’URL, consulter les clics et impressions dans Search Console ; les données d’audience restent dans le rapport privé.

Sources : [dates et sitemaps, Google](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [intégration Astro](https://docs.astro.build/en/guides/integrations-guide/sitemap/). L’[inspection Google](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect) renseigne l’état connu de l’index ; elle ne constitue pas un test en direct de la nouvelle version.
