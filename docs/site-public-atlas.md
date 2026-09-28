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
