---
paths:
  - "web/**"
  - "scripts/check-seo.mjs"
  - "scripts/check-fonts.mjs"
  - "scripts/generate-og-image.mjs"
  - "scripts/atlas/**"
  - "src/lib/delivery-page.ts"
  - "src/lib/sample-measures.ts"
  - "tests/web/**"
---

# Site public, fiches, guides et compte client (prix et CGV : chemins F2)

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

## Contrôles de publication et pages publiques
- Railway attend les suites GitHub (`source.checkSuites=true`, relu le 25.09.2026). Ne pas désactiver pour contourner un test en échec. Ce réglage porte sur les publications automatiques GitHub ; une intervention manuelle demande toujours une vérification explicite de la CI et du SHA servi. Référence : https://docs.railway.com/deployments/github-autodeploys.
- Les tests racine importent aussi des utilitaires du site. Installer `npm --prefix web ci` avant ces tests dans un environnement vierge : le tsconfig Astro est nécessaire. La CI le fait explicitement depuis le 25.09.2026.
- Après chaque build du site, `npm run seo:check` contrôle les liens internes, canonical, hreflang réciproques et sitemap. Ne pas remettre une date `lastmod` fabriquée à la construction.
- Les fiches FINMA publiques sont une copie historique distincte du produit quotidien. Les correspondances des fiches NOGA viennent des mêmes références sourcées que le MCP. Voir `docs/fiches-publiques.md`.
- Recherche et traduction vérifient leurs fichiers de modèle par taille et SHA-256 au build. Les modèles figés et les index vectoriels historiques restent deux sujets distincts ; aucun téléchargement ni envoi de texte à un fournisseur pendant la traduction.
- Téléchargement des poids au build : reprise bornée (4 essais, 2/4/8 s ou `Retry-After` plafonné à 60 s) seulement pour un refus passager (408, 425, 429, 5xx) ou une panne réseau avant réponse ; une adresse absente ou un contenu non conforme échoue aussitôt. La CI garde `dist/models` en cache par empreinte des références ; chaque fichier du cache est revérifié.

## Polices et confidentialité — 26.09.2026
- Les cinq familles sont servies localement, fichiers WOFF2 officiels inchangés et empreintes produites par Astro. Aucun téléchargement de police au build ni connexion du navigateur à Google Fonts.
- Les provenances et SHA sont dans `web/src/assets/fonts/provenance.json`, les licences OFL sont distribuées dans `/fonts/licenses/`. Le contrôle `fonts:check`, obligatoire après le build, vérifie les octets, les licences, les liens CSS et l’absence d’appels Google Fonts.
- Importer `fonts-geist.css` dans les nouveaux gabarits qui utilisent Geist. Ne pas rétablir de domaine tiers dans `style-src` ou `font-src` pour charger une police.

## Annuaire FINMA et parcours fichiers — 26.09.2026
- Les index FR/DE/EN conservent la recherche historique et proposent le véritable échantillon `/api/catalog/finma?format=csv` ainsi que la fiche produit localisée. Ne pas présenter la copie historique comme le produit quotidien, ni l’absence d’un résultat comme une sanction ou une absence dans le registre officiel.
- Les contenus essentiels et les liens restent visibles sans animation ni JavaScript. La fraîcheur du produit se lit sur sa fiche, pas dans une date figée au build de l’annuaire. Aucun gain SEO ne se déduit de la seule publication ; voir `docs/fiches-publiques.md`.

## Demandes d’échantillons — 26.09.2026
- `sample_served` observe seulement les réponses GET CSV 200 des trois produits ; nom réservé au serveur. Réutiliser les budgets de collecte et la purge à 180 jours, sans client, email ou URL dans la trace. Une panne de mesure ne doit jamais bloquer le fichier.
- Le CRM sépare demandes, navigateurs présumés et visiteurs-jours valides, dédupliqués entre produits. Ni HTTP 200 ni première trace conservée ne prouvent réception, présence humaine ou début de collecte. Aucun taux de conversion inventé ; règles et limites dans `docs/mesures-echantillons.md`.

## Illustration publique fixe — 28.09.2026
- Claude-Alain a retiré la manipulation de la carte pour privilégier la ressemblance avec l’illustration. Il a choisi ensuite la piste pixels sur le fond clair existant. `AtlasArtwork` utilise `swiss-atlas-pixels-v1.png` sur l’accueil et FINMA FR/DE/EN, sans parallaxe, flottement ni import de modèle/Three.js. Ne pas réactiver automatiquement l’ancien mode 3D.
- La provenance visible décrit une illustration ChatGPT : pixels évocateurs de données, sans couverture réseau mesurée, géologie ni altitudes exactes. L’attribution swisstopo concerne les modèles historiques, pas cette image. Le fond papier du site reste #f4f3ed ; la légère luminosité et la multiplication CSS servent au raccord, sans l’ancienne sursaturation. Ne pas isoler `.atlas-artwork` : cela coupe le mélange avec le fond de page et fait réapparaître un rectangle. La pause et le mouvement réduit restent applicables aux autres animations. Voir `docs/site-public-atlas.md`.

## Fiches produit Atlas — 28.09.2026
- Les prix des fichiers et des prolongations vivent dans `web/src/lib/offers.ts`, seule source des pages Atlas (accueil, FINMA, TARES, classifications, bundle) ; `tests/web/fiches-atlas.test.ts` les compare à `src/db/seed.ts`. `/pricing` lit aussi `offers.ts` depuis le 29.09. Changer un prix reste une décision de Claude-Alain.
- TARES, classifications et bundle réutilisent AtlasLayout, AtlasArtwork et le bloc d’achat FINMA. Les valeurs vivantes viennent du catalogue servi, contrôlé avant affichage ; les exemples statiques (8501.1000, 0101.21, 18.11) sont des textes officiels relus, jamais des taux. Unités TARES affichées telles que livrées ; une absence de résumé n’est pas une franchise ; un pourcentage n’est jamais présenté en CHF.
- Ne pas réintroduire : intégrations ERP nommées, volumes figés, « remboursement sans condition », continuité entre révisions par chaînage de deux rapprochements, échantillon embarqué au build. Le test des fiches les refuse.
- Dataset schema.org localisé sur les neuf fiches produit via `web/src/lib/structured-data.ts`, sans distribution ni volume ; `seo:check` échoue sinon. Offre sans date de validité, livraison ni retour ; la fiche FINMA n’a plus d’offre depuis le 25.09.
- `/bundle` reçoit tous les retours Stripe `?checkout=cancelled|error` des achats de fichiers : son bandeau ne suppose pas le produit acheté.
- Recette : outils privés `docs/internal/audit-global-20260925/fiches-atlas-20260928/outils/` (serveur fictif 8911, trois moteurs, écrans téléphone, axe).
- 30.09.2026 : le fichier FINMA ne couvre pas les affiliations aux organismes d'autorégulation (OAR/SRO, loi sur le blanchiment d'argent) ni le registre des intermédiaires d'assurance ; la fiche FINMA (FR/DE/EN) et le README de l'archive le disent, avec un lien vers la recherche officielle de membres OAR de la FINMA (`web/src/lib/guides.ts`, `SOURCES['finma-oar']`). `sro_member` a été retiré de `FinmaEntityType`, du schéma livré et de `FINMA_SOURCES` (source 404 à la FINMA, jamais produite par la collecte quotidienne). Dans `etl/finma/bundle.ts`, l'énumération `entity_type` du `schema.json` livré n'est plus la liste statique `entityTypes`/`FINMA_BUNDLE_ENTITY_TYPES` : elle ne garde que les catégories produites par `AUTH_TYPE_TO_ENTITY_TYPE` (plus `other`) ou réellement présentes dans l'archive (`schemaEntityTypes`). Ne pas revenir à `enum: entityTypes` : c'est exactement ce qui laissait sro_member listé comme catégorie possible. Test C4 de non-régression (« une catégorie citée comme contenue ne peut pas avoir 0 ligne, y compris dans l'énumération du schéma ») : `tests/etl/finma-coverage-promises.test.ts`. Rapport d'origine : `docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md`.

## Notice de confidentialité — 29.09.2026
- Section « Destinataires et lieux » réécrite FR/DE/EN d'après la matrice privée des prestataires (Stripe Payments Europe, Resend envoi AWS Irlande mais compte aux États-Unis et sans certification suisse, Infomaniak domaine/DNS/redirection, Cloudflare seulement pour R2 avec l'IP de l'acheteur au téléchargement, Swiss-U.S. DPF cité, Sentry en région UE, lettre Substack). La page de confidentialité affiche `legalDate`, plus la version des CGV.
- Suivi des ouvertures et des clics désactivé chez Resend pour openswissdata.com le 29.09 (relu par l'API depuis le conteneur de production) : la notice l'annonce. Ne pas le réactiver sans modifier la notice ; il faisait aussi transiter les liens de connexion et de téléchargement par une adresse de Resend. Le compte Resend sert aussi un autre projet : ne régler que le domaine d'OpenSwissData.

## Guides FINMA — 29.09.2026
- Trois guides FR/DE/EN à la même adresse dans chaque langue : `/guides/finma-authorisation-check/`, `/guides/finma-warning-list/`, `/guides/finma-screening-automation/`. Contenus dans `web/src/content/guides-finma/`, sources et textes communs dans `web/src/lib/guides.ts`, gabarit `FinmaGuide.astro`. Voir `docs/site-public-atlas.md`.
- Seulement des pages officielles (FINMA, OFS, OFJ, SECO, GLEIF), archivées avec date et SHA-256 dans le dossier privé du chantier ; citations dans la langue de la page, terme officiel « liste d’alerte » / « Warnliste » / « warning list ». Ne jamais nommer ni lier une entrée de la liste d’alerte (l’adresse porte le nom) ; exemples fictifs « Exemple … » et IDE au chiffre de contrôle invalide.
- Aucun volume, version ni date de publication figés ; prix lu dans `offers.ts` ; pas de `datePublished`. Si une source change : relire l’archive, adapter le texte et `SOURCES_CONSULTED`.
- `tests/web/guides-finma.test.ts` exécute le SQL des trois langues contre une archive de `etl/finma/bundle.ts` : toute évolution du format `.sql` ou du registre doit garder ce test vert. `seo:check` exige neuf guides avec Article ou TechArticle et fil d’Ariane.
- Aucun gain SEO ne se déduit de la publication : comparer la Search Console sur quatre semaines, mêmes pages et requêtes.
- L’ancien article `blog/finma-registry-compliance` (mai 2026), en contradiction avec le produit, est retiré et redirigé en 301 vers `/en/guides/finma-screening-automation/` (décision de Claude-Alain du 29.09). Terme officiel « liste d’alerte » sur les pages françaises ; « liste d’avertissement » reste un mot-clé de recherche.

## Compte, support et tarifs Atlas — 29.09.2026
- /account, /support et /pricing (FR/DE/EN) utilisent AtlasLayout. Textes d'aide et trajet d'achat dans `web/src/lib/customer-care.ts`, repris des CGV (art. 2, 4, 8, 9) ; aucun délai de réponse promis, seules les durées réelles (14 j, 15 min, 48 h, 360 j) citées. Relire ce module à chaque changement des CGV ou du parcours de livraison.
- Le compte n'est qu'affichage : `web/src/scripts/account.ts` garde à l'identique les neuf appels de l'ancien script (adresse, méthode, en-têtes, corps, credentials) ; `tests/web/service-atlas.test.ts` les verrouille. Modifier un appel est un changement de session ou de téléchargement, pas de présentation. Vues basculées par l'attribut hidden ; texte serveur toujours par textContent.
- /pricing lit fichiers, bundle et prolongations dans `offers.ts`. Pro 49 CHF et Business 199 CHF restent affichés fermés, sans formulaire (constante MCP_CLOSED comparée aux pages MCP et à `scopes.ts`). Ne pas y réintroduire LDA art. 5 pour l'OFS, RFC 3161, volumes figés ni « mises à jour automatiques ».
- La confirmation de connexion n'a changé que de feuille de style ; sa CSP la reprend par empreinte. La page /api/delivery/:token utilise Atlas depuis le 29.09 (`src/lib/delivery-page.ts`, voir `docs/site-public-atlas.md`).
- Recette : banc privé `docs/internal/audit-global-20260925/compte-atlas-20260929/outils/` (port 8912, connexion par le vrai formulaire, R2 et Stripe simulés). La demande de lien n'accepte qu'un envoi par IP toutes les dix secondes : attendre entre deux essais.
