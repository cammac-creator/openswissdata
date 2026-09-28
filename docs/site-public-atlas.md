# Site public Atlas — 27 septembre 2026

Le lot53 refond l’accueil et la fiche FINMA, chacun en français, allemand et anglais. Le bureau privé reste celui du lot52. Les autres fiches, outils, pages juridiques et l’espace client conservent leur présentation actuelle : la continuité visuelle figure dans A20 de la roadmap.

## Présentation et contenu

- Palette ivoire/vert profond/vermillon, typographie Geist hébergée localement, relief suisse original et catalogue hiérarchisé. FINMA apparaît en premier ; les prix et produits commercialisables sont inchangés.
- `AtlasLayout` transmet un header/footer dédiés aux emplacements de `BaseLayout`. Le script de navigation historique est absent des six pages Atlas. Les autres pages gardent leur comportement.
- Les sources sont identifiées comme des sources publiques préparées indépendamment. Aucun témoignage, label officiel ou chiffre commercial ajouté. Les volumes et versions proviennent du catalogue servi à la consultation ; rien n’est figé dans le build.
- FINMA présente tôt un échantillon filtrable par nom, catégorie, UID et LEI, en tableau, CSV et JSON. Les trois vues montrent les mêmes quatre champs et au plus vingt lignes après filtrage. Le lien CSV reste l’échantillon livré par l’API, avec son périmètre propre. La présentation ne prétend pas que les quatre champs constituent le fichier complet.
- Les cinq limites de couverture, les champs vides, les trous d’historique, la non-affiliation, les conditions d’achat et les liens contractuels sont conservés. Le POST de paiement reste `/api/checkout/start` avec `locale` et `dataset_ids=finma`.

## Mouvement et accessibilité

Le relief flotte légèrement ; le volume réagit au glissement du pointeur sur ordinateur ; une carte de formats bouge en contrepoint et le parcours est animé. Les sections entrent par un déplacement court, sans masquage initial. Aucun contenu essentiel ne dépend d’une animation ou du JavaScript.

La préférence `prefers-reduced-motion` désactive les mouvements. Un bouton permet aussi de les arrêter dans la page ; aucun stockage navigateur n’est ajouté. Le menu mobile natif `details` fonctionne sans script, et le script complète Échap, clic/focus extérieur, changement de largeur et retour du focus. Les ancres conservent l’URL et rendent le focus au contenu visé.

Les images sont transformées par Astro en WebP de quatre largeurs avec adresses portant une empreinte. Pas de bibliothèque d’animation, pas de nouveau service externe. Les vues texte utilisent `textContent`, jamais le HTML de la source. Une réponse catalogue incohérente ou une panne est annoncée ; pas de zéro de secours ni de pourcentage inventé. Délai de lecture borné à douze secondes.

## Vérification et suite

La recette couvre les six routes à 320, 390, 768 et 1440 pixels dans Chromium, Firefox et WebKit, avec menu/clavier, mouvement réduit et pause, formats et recherche, textes hostiles, formulaire intercepté, absence de JavaScript et panne du catalogue. Les contrôles axe sont automatisés ; ils ne remplacent ni un lecteur d’écran humain ni un vrai iPhone. Aucun achat réel ni donnée client utilisé.

Poursuivre A20 sur TARES, classifications et bundle, puis sur le compte et la continuité achat/livraison/support. Ne pas assimiler cette livraison à une refonte de toutes les pages ni à un gain de conversion mesuré. Vérifier les performances terrain avant d’annoncer un bénéfice commercial.

## Relief interactif — 28 septembre 2026

La version A choisie devient un modèle 3D issu de MNT25 et swissBOUNDARIES3D, avec altitudes ×8, liseré rouge et couleurs renforcées. Le dos porte « Made in Switzerland », orthographe confirmée par Claude-Alain. Souris, clavier, commandes tactiles et affichage de repli sont gérés par `atlas-relief.ts` et son module différé. Voir [la chaîne de fabrication et ses limites](../scripts/atlas/README.md). Ce remplacement concerne les six pages qui utilisent `AtlasArtwork` ; A20 reste partiel.


## Relief et intégration v5 — 28 septembre 2026

Le volume courant reprend le choix explicite de hauteur −45 % par rapport à la sculpture v4, avec socle et inscription conservés et occlusion recalculée. Éclairage chaud adouci, socle mieux rempli, stries discrètes sur les pentes, cadrage et commandes regroupées. L’illustration demeure l’entrée initiale ; le modèle n’est téléchargé qu’à la demande. La fabrication reproductible et les limites sont décrites dans `scripts/atlas/README.md`.
