# Site public Atlas — 27 septembre 2026

Le lot53 refond l’accueil et la fiche FINMA, chacun en français, allemand et anglais. Le bureau privé reste celui du lot52. Les autres fiches, outils, pages juridiques et l’espace client conservent leur présentation actuelle : la continuité visuelle figure dans A20 de la roadmap.

## Présentation et contenu

- Palette ivoire/vert profond/vermillon, typographie Geist hébergée localement, relief suisse original et catalogue hiérarchisé. FINMA apparaît en premier ; les prix et produits commercialisables sont inchangés.
- `AtlasLayout` transmet un header/footer dédiés aux emplacements de `BaseLayout`. Le script de navigation historique est absent des six pages Atlas. Les autres pages gardent leur comportement.
- Les sources sont identifiées comme des sources publiques préparées indépendamment. Aucun témoignage, label officiel ou chiffre commercial ajouté. Les volumes et versions proviennent du catalogue servi à la consultation ; rien n’est figé dans le build.
- FINMA présente tôt un échantillon filtrable par nom, catégorie, UID et LEI, en tableau, CSV et JSON. Les trois vues montrent les mêmes quatre champs et au plus vingt lignes après filtrage. Le lien CSV reste l’échantillon livré par l’API, avec son périmètre propre. La présentation ne prétend pas que les quatre champs constituent le fichier complet.
- Les cinq limites de couverture, les champs vides, les trous d’historique, la non-affiliation, les conditions d’achat et les liens contractuels sont conservés. Le POST de paiement reste `/api/checkout/start` avec `locale` et `dataset_ids=finma`.

## Mouvement et accessibilité

Depuis le lot58, l’illustration est fixe : aucun flottement, aucune parallaxe et aucun mode 3D. Le parcours et les autres sections gardent leurs animations. Les sections entrent par un déplacement court, sans masquage initial. Aucun contenu essentiel ne dépend d’une animation ou du JavaScript.

La préférence `prefers-reduced-motion` désactive les mouvements. Un bouton permet aussi de les arrêter dans la page ; aucun stockage navigateur n’est ajouté. Le menu mobile natif `details` fonctionne sans script, et le script complète Échap, clic/focus extérieur, changement de largeur et retour du focus. Les ancres conservent l’URL et rendent le focus au contenu visé.

Les images sont transformées par Astro en WebP de quatre largeurs avec adresses portant une empreinte. Pas de bibliothèque d’animation, pas de nouveau service externe. Les vues texte utilisent `textContent`, jamais le HTML de la source. Une réponse catalogue incohérente ou une panne est annoncée ; pas de zéro de secours ni de pourcentage inventé. Délai de lecture borné à douze secondes.

## Vérification et suite

La recette couvre les six routes à 320, 390, 768 et 1440 pixels dans Chromium, Firefox et WebKit, avec menu/clavier, mouvement réduit et pause, formats et recherche, textes hostiles, formulaire intercepté, absence de JavaScript et panne du catalogue. Les contrôles axe sont automatisés ; ils ne remplacent ni un lecteur d’écran humain ni un vrai iPhone. Aucun achat réel ni donnée client utilisé.

Poursuivre A20 sur TARES, classifications et bundle, puis sur le compte et la continuité achat/livraison/support. Ne pas assimiler cette livraison à une refonte de toutes les pages ni à un gain de conversion mesuré. Vérifier les performances terrain avant d’annoncer un bénéfice commercial.

## Historique — relief interactif — 28 septembre 2026

La version A choisie devient un modèle 3D issu de MNT25 et swissBOUNDARIES3D, avec altitudes ×8, liseré rouge et couleurs renforcées. Le dos porte « Made in Switzerland », orthographe confirmée par Claude-Alain. Souris, clavier, commandes tactiles et affichage de repli sont gérés par `atlas-relief.ts` et son module différé. Voir [la chaîne de fabrication et ses limites](../scripts/atlas/README.md). Ce remplacement concerne les six pages qui utilisent `AtlasArtwork` ; A20 reste partiel.


## Historique — relief et intégration v5 — 28 septembre 2026

Le volume courant reprend le choix explicite de hauteur −45 % par rapport à la sculpture v4, avec socle et inscription conservés et occlusion recalculée. Éclairage chaud adouci, socle mieux rempli, stries discrètes sur les pentes, cadrage et commandes regroupées. L’illustration demeure l’entrée initiale ; le modèle n’est téléchargé qu’à la demande. La fabrication reproductible et les limites sont décrites dans `scripts/atlas/README.md`.


## Historique — illustration fixe — 28 septembre 2026 (lot58)

Claude-Alain retire la manipulation et donne la priorité à la ressemblance avec l’illustration. Les six pages utilisent désormais directement `swiss-atlas-editorial-v3.png` comme visuel définitif : crêtes ivoire, strates fines, verts profonds, filet rouge et lumière de l’image conservés. La saturation CSS de 1,2 reste celle de la direction approuvée ; le contraste supplémentaire est retiré. Le cadrage responsive et les fondus périphériques intègrent l’image au papier sans recouvrir le relief d’une carte de formats.

`AtlasArtwork` n’importe plus de modèle ni de script 3D. Les commandes de rotation, de manipulation et de revers disparaissent ; aucune scène WebGL ou ressource 3D n’est livrée par le build de ces pages. Les anciens scripts et modèles restent des sources historiques non importées. La description accessible de provenance concerne uniquement l’illustration ChatGPT : ni altitudes mesurables, ni géologie réelle. Elle fonctionne sans JavaScript, en FR/DE/EN. Le bouton de réduction des animations concerne les autres animations de la page.

Astro produit quatre tailles WebP (qualité 90) avec adresses par empreinte et sélection adaptée à la largeur d’affichage. Les dimensions de l’image réservent sa place avant son chargement. Cette décision remplace les gestes et l’inscription au revers des lots précédents ; elle ne transforme pas l’illustration imaginée en carte topographique.


## Illustration pixels sur fond clair — 28 septembre 2026

Après comparaison de six pistes, Claude-Alain choisit la maquette pixels et demande de conserver le fond clair actuel, puis autorise son intégration. `swiss-atlas-pixels-v1.png` remplace le visuel importé par `AtlasArtwork` sur l’accueil et FINMA FR/DE/EN. Cette illustration issue de ChatGPT conserve relief ivoire, pixels émeraude, socle vert et filet rouge. Empreinte SHA-256 du PNG : `c7034c475f7e5dfec360721577e4802673e40d7d406846a639e469c73067b081`.

Le papier du site reste `#f4f3ed`. La sursaturation de l’ancien visuel est retirée ; une luminosité CSS de 1,045 et le mélange par multiplication raccordent son fond au papier, avec fondu limité aux bords. Aucun nouveau panneau sombre, mouvement ou modèle 3D. Le fichier source reste inchangé ; Astro produit les formats WebP adaptés avec empreinte dans l’adresse.

La notice FR/DE/EN précise que les pixels évoquent les données suisses : ils ne décrivent pas une couverture réseau mesurée. Le relief n’est ni une mesure d’altitude exacte ni une carte géologique. Aucune source de couverture OFCOM n’a été intégrée à l’image. Cette illustration artistique ne remplace aucune donnée vendue.


## Fiches TARES, classifications et bundle — 28 septembre 2026

Les trois fiches (FR/DE/EN) reprennent `AtlasLayout`, l’illustration fixe et la structure de la fiche FINMA : héros, barre de sections collante, relevé de la version servie, sections numérotées, questions et bloc d’achat. Les prix viennent de `web/src/lib/offers.ts`, source unique également lue par l’accueil et FINMA ; un test les compare au référentiel serveur. Les feuilles `atlas-fiches.css` (commune) et `atlas-fiche-*.css` (une par produit) complètent `atlas.css` sans le modifier.

- TARES : anatomie d’un numéro réel (8501.1000) et arbre d’un contingent (0101.21), désignations reprises telles quelles de la version publiée le 28.09.2026, sans taux figé. La lecture commentée d’une ligne et l’aperçu filtrable utilisent l’échantillon servi par `/api/catalog/tares` ; les unités restent celles livrées (`duty_mfn_unit` en français, `unit_stat` sur DE/EN) et une ligne sans résumé affiche « voir le détail », jamais une franchise. Le fichier ne livre que la désignation de la ligne à huit chiffres : la fiche le dit.
- Classifications : carte des correspondances en HTML (volumes par nomenclature lus dans le catalogue) et équivalent en toutes lettres ; exemple 18.11 et échelle des niveaux calculés au build depuis la référence sourcée 2026.09.25. Aucune permission de source ni date de révision n’est affirmée.
- Bundle : composition, économie calculée puis dessinée en SVG depuis le module des prix, rythmes de publication et prolongations, exclusions (aucune clé MCP payante, ni Classifications Pro, ni connecteur ERP). Un bandeau neutre explique les retours `?checkout=cancelled|error` de Stripe, communs à tous les achats de fichiers.
- Balisage : Dataset localisé et complet sur les neuf fiches produit (trois jeux, trois langues), sans distribution ni volume ; `seo:check` l’exige après chaque build. Offre schema.org sans date de validité, livraison ni retour inventés sur TARES, classifications et bundle ; la fiche FINMA n’a plus d’offre depuis le 25.09.
- Retirés : intégrations ERP nommées, volumes figés, « remboursement sans condition », continuité de séries entre révisions, démonstrateur à quarante taux non vérifiés, composants `TaresQuality`, `ClassificationsQuality`, `TrustStrip`, `ApiSwitch` et `ProductFaq`.

Recette : Chromium, Firefox et WebKit à 390 et 1440, géométrie à 320 et 768, sans JavaScript, mouvement réduit, clavier, panne du catalogue, retour de paiement, textes hostiles, axe 4.13.0 sans violation. Vrai iPhone, lecteur d’écran humain, zoom natif et vitesse terrain restent à éprouver ; aucun effet commercial ou SEO ne se déduit de ces contrôles.


## Guides FINMA — 29 septembre 2026

Trois guides FR/DE/EN, à la même adresse dans chaque langue (préfixe `/de` ou `/en`) : `/guides/finma-authorisation-check/` (vérifier une autorisation), `/guides/finma-warning-list/` (liste d’alerte) et `/guides/finma-screening-automation/` (automatiser le contrôle). Contenus dans `web/src/content/guides-finma/`, sources officielles et textes communs dans `web/src/lib/guides.ts`, gabarit `FinmaGuide.astro` sur `AtlasLayout`, feuille `atlas-guides.css`. Lecture sans JavaScript ni animation ; sommaire collant sur ordinateur, repliable sur téléphone ; tableaux et code défilent dans leur cadre.

- Faits et citations viennent seulement de pages officielles (FINMA, OFS, OFJ, SECO, GLEIF) consultées le 29.09.2026 (`SOURCES_CONSULTED`) ; leurs octets, dates et SHA-256 sont archivés dans le dossier privé du chantier. Chaque renvoi numéroté mène à la liste des sources. Citations dans la langue de la page et terminologie de la FINMA : « liste d’alerte », « Warnliste », « warning list ».
- Aucune entrée de la liste d’alerte n’est nommée ni liée (l’adresse d’une page de détail porte le nom). Une absence n’est jamais présentée comme une sanction ni une inscription comme la preuve d’une infraction. L’avertissement « n’engage pas la FINMA, ne remplace pas un avis professionnel » figure dans les trois langues. Exemples fictifs : noms « Exemple … », IDE au chiffre de contrôle invalide.
- Aucun volume, aucune version ni date de publication figés ; prix lu dans `offers.ts`. Les limites du fichier sont dites : ni intermédiaires d’assurance, ni membres OAR, ni placements collectifs ; `licence_date` et `status` vides ; `entity_type` est un regroupement d’OpenSwissData, un libellé non classé tombe dans `other`.
- `tests/web/guides-finma.test.ts` exécute le SQL de chaque langue contre une archive construite par `etl/finma/bundle.ts` et vérifie sources, liens et prudence. Balisage Article ou TechArticle et BreadcrumbList sans `datePublished` ni `dateModified` ; `seo:check` exige neuf guides conformes.
- Liens entrants : fiche FINMA (sous la couverture), annuaire FR/DE/EN (recherche et fichiers), fiches d’entités (« Vérifier à la source », guide 1) et `llms.txt`. Si une source change, relire l’archive, adapter le texte et la date de consultation. Aucun gain SEO ne se déduit de la publication : comparer la Search Console sur quatre semaines.


## Compte, support et tarifs — 29 septembre 2026

L’espace client, la page support et les tarifs, en FR/DE/EN, rejoignent `AtlasLayout`. Les textes d’aide et le trajet d’un achat vivent dans `web/src/lib/customer-care.ts` ; ils reprennent les CGV en vigueur (art. 2, 4, 8 et 9) et ne promettent aucun délai de réponse. Changer les CGV ou le parcours de livraison impose de relire ce module.

- Compte (`AccountApp.astro`, `scripts/account.ts`, `atlas-compte.css`) : page privée (`noindex` transmis par `AtlasLayout`), vues basculées par l’attribut `hidden`. Le script garde à l’identique les neuf appels réseau de l’ancien script en ligne ; `tests/web/service-atlas.test.ts` les verrouille. Les refus s’affichent dans la page (session expirée, droit retiré, version absente, service indisponible, reçu, portail, déconnexion, limite de demandes). Une liste de fichiers illisible n’est pas présentée comme un compte vide. Sans JavaScript, un avis explique que les liens de téléchargement reçus par email fonctionnent sans lui.
- Confirmation de connexion : seule la feuille de `src/lib/login-confirmation-page.ts` change (palette Atlas, polices système) ; la CSP la reprend par empreinte. La page de téléchargement `/api/delivery/:token` a rejoint Atlas le 29.09.2026 (voir la section suivante).
- Support (`/support`) : sept situations avec action ou article des CGV, trajet d’un achat avec « si ça bloque », contenu d’un message et message modèle prérempli sans donnée personnelle. Balisage ContactPage.
- Tarifs (`/pricing`, désormais en trois langues) : fichiers, bundle, économie et prolongations lus dans `offers.ts`. Pro et Business restent fermés, prix et quotas inchangés, sans formulaire ; bandeau pour le retour `?checkout=closed`. Retirés : « mises à jour automatiques », fondement LDA art. 5 pour l’OFS, horodatage RFC 3161, volumes figés, correspondances « bidirectionnelles », support prioritaire.
- Trajet d’un achat (`PurchaseJourney.astro`) : schéma HTML/SVG lisible sans JavaScript ; le mouvement suit `data-motion` et un bouton de pause l’arrête, comme le message illustré du support.
- Corrections : la description Organization de toutes les pages parle de collectes planifiées et contrôlées ; les listes `.atlas-limits` retrouvent leur puce carrée rouge.

Recette sur banc fictif (Chromium, Firefox, WebKit ; 390 et 1440 ; sans JavaScript ; clavier ; mouvement réduit et pause ; axe 4.13.0 sans violation). Connexion par le vrai formulaire de confirmation, cookie `__Host-osd_session` vérifié ; R2 et Stripe simulés. Vrai iPhone, lecteur d’écran humain et vrais mails restent à éprouver.


## Page de téléchargement — 29 septembre 2026

La page ouverte depuis le lien du mail d’achat (`/api/delivery/:token`) reprend la palette Atlas : papier ivoire, carte à filet rouge, vert profond, marque OpenSwissData. Son HTML vient de `src/lib/delivery-page.ts`, séparé de la confirmation de connexion dont l’empreinte CSS fixe la CSP.

- Aucune logique changée. GET ne lit pas la base et ne consomme rien ; le formulaire garde exactement sa méthode, sa cible `/api/delivery/<jeton>` et l’absence de champ. Le POST passe toujours par `redeemDownload` : contrôles, codes, redirection signée R2, tolérance de 90 s et traces `download_activity` inchangés. Seul le corps d’un refus devient une page HTML, avec le même statut et les mêmes en-têtes (content-type excepté). Le lien historique `/api/download/:token` garde ses réponses texte.
- La CSP de la route reste `default-src 'none'` avec styles en ligne : ni police, ni image, ni script. La page utilise une pile système proche de Geist et des icônes SVG écrites dans le document. Le jeton n’apparaît que dans la cible du formulaire de confirmation, jamais dans les pages de refus.
- La confirmation explique les règles du lien (48 h, un seul usage, second clic accepté 90 s sans prolonger le lien), que le fichier arrive dans les téléchargements et que la page reste affichée. Neuf états sont expliqués en FR/DE/EN avec une action : lien incomplet, lien inconnu (le cas habituel d’un lien expiré puis effacé par le nettoyage), expiré, déjà utilisé, épuisé pendant le clic, accès inactif (remboursement complet ou contestation, sans l’affirmer), version hors période, fichier absent, service de fichiers indisponible (retour à la confirmation par une adresse relative, sans écrire le jeton).
- Langue : la confirmation suit `?lang=` du mail comme avant. Les pages de refus suivent `Accept-Language`, français par défaut, car le formulaire ne transmet pas la langue.
- Tests : `tests/routes/delivery-contract.test.ts`, écrit avant la refonte et vert avant comme après, fige statut, en-têtes, redirection, formulaire et traces de chaque état ; `tests/routes/delivery-page.test.ts` relie chaque refus texte à un état, les durées affichées aux constantes du code, et vérifie langues, liens et absence de jeton.

Recette sur banc fictif (Chromium, Firefox, WebKit ; 390 et 1440) : clic réel, redirection vers une adresse R2 fictive interceptée, double clic, chaque état. Vrai iPhone, lecteur d’écran humain et vrai mail restent à éprouver.

