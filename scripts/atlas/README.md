# Relief suisse interactif — chaîne de fabrication

Le modèle est une interprétation artistique à partir de données topographiques, produite hors du serveur web. Aucun service cartographique ni téléchargement de données géographiques ne se déclenche chez le visiteur.

## Sources originales, conservées séparément

- [MNT25/DHM25](https://www.swisstopo.admin.ch/fr/modele-altimetrique-mnt25) : [archive complète](https://cms.geo.admin.ch/ogd/topography/DHM25_MM_ASCII_GRID.zip), distribuée en 2021. SHA-256 `53c926c7c1dc9d34d59fb749e135dfb3147853c90d047b007b3018486df0dd46`.
- [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/fr/modele-du-territoire-swissboundaries3d) : [édition 2026-01, LV95/LN02](https://data.geo.admin.ch/ch.swisstopo.swissboundaries3d/swissboundaries3d_2026-01/swissboundaries3d_2026-01_2056_5728.gpkg.zip). SHA-256 `68e922353c76fa5db3cef06a32f9711c0198faa6fbd2b5bcde9edc88b0f8999f`.
- [Conditions swisstopo](https://www.swisstopo.admin.ch/fr/conditions-utilisation-geodonnees-et-geoservices-gratuit) : transformation et usage commercial autorisés avec attribution. La page affiche **©swisstopo** et explique les transformations.

Les archives sont téléchargées une fois, vérifiées par SHA-256 et gardées intactes dans `bronze/2026-09-28/`. Extraire le ZIP MNT dans `argent/mnt/`, avec `ASCII_GRID_1part/dhm25_grid_raster.asc`, et le GeoPackage dans `argent/frontieres/`. Les chemins se passent explicitement aux scripts ; aucun téléchargement implicite. Les gros originaux et le fichier Blender restent hors du dépôt public.

## Préparation topographique et ancien modèle v2

Python : numpy/scipy, shapely 2.0.7, pyproj 3.6.1, rasterio 1.4.3, triangle 20250106. Blender 5.2.1 LTS ; glTF Transform 4.5.0.

1. `prepare-terrain.py --data DOSSIER_SOURCE --output DOSSIER_GEOMETRIE` lit la frontière `icc=CH`, transforme LV95 en LV03, conserve la principale composante du pays et ses trous. Contour simplifié à 100 m, maillage à environ 350 m ; MNT 25 m filtré à 175 m. Les hauteurs sont multipliées par **8**, puis le maillage est allégé dans Blender. Les sommets et les valeurs précises ne sont donc pas utilisables pour une mesure.
2. `blender --background --python-exit-code 1 --python build-scene.py -- --geometry DOSSIER_GEOMETRIE --output DOSSIER_OR` crée relief, socle vert, liseré rouge et lettres volumétriques satinées au dos. « Made in Switzerland » est un marquage en léger relief façon frappe industrielle. Pas de texture plane ni de mention officielle de certification.
3. `gltf-transform quantize DOSSIER_OR/swiss-atlas.glb DOSSIER_OR/swiss-atlas-quantized.glb --quantize-position 14 --quantize-normal 10`.
4. `package-model.py --input DOSSIER_OR --output CHEMIN_PROJET/web/src/assets/art` écrit le gzip déterministe dans `.bin` et copie le rendu Blender. Astro émet les adresses avec empreinte, ainsi que les affiches WebP.

Les rapports `geometrie.json` et `scene.json` documentent chaque exécution. Le MNT historique n’est pas swissALTI3D ; aucune géologie, couverture de données, forêt ou frontière cantonale n’est codée par une couleur. Ivoire, vert et rouge sont artistiques. La saturation HSL des matériaux colorés est multipliée par 1,2 ; ce réglage ne signifie pas que chaque pixel est exactement 20 % plus saturé après éclairage.

## Dans la page

Three.js est chargé à la demande, puis le modèle v5 (environ 3,4 Mo compressés) est lu sur la même origine, décompressé avec `DecompressionStream` et rendu localement. Aucun WASM, CDN ni service tiers ; CSP inchangée. La licence MIT de Three.js accompagne la distribution dans `/licenses/three-MIT.txt`. Chargement exclusivement explicite sur tous les appareils : le mode 3D ne remplace jamais automatiquement l’illustration. Une affiche demeure sans JavaScript, sans WebGL, en cas d’échec réseau ou de perte du contexte graphique ; le visiteur peut réessayer.

Glisser à la souris tourne librement ; les flèches du clavier aussi. Les boutons montrent le dos et rétablissent le recto. Sur écran tactile, « Manipuler » active les gestes, « Terminer » libère le défilement. Le mouvement réduit, la pause, la visibilité de la page et la sortie de l’écran interrompent le mouvement automatique. Le bouton « Illustration » revient au visuel artistique, rend le focus au bouton d’exploration et libère les ressources GPU ; celles-ci sont aussi libérées au départ de la page. Prévoir une recette sur un vrai téléphone en complément des moteurs de navigateur automatisés.

## Illustration éditoriale — 28.09.2026

L’accueil et FINMA FR/DE/EN présentent d’abord `swiss-atlas-editorial-v3.png`, une création ChatGPT dérivée de la maquette A approuvée et du premier atlas artistique. Sa composition et ses sommets sont imaginés ; elle n’est pas un rendu du MNT ni une carte géologique. Le panneau « Illustration artistique » le précise. L’attribution swisstopo concerne uniquement le volume 3D séparé et ses données.

Direction : grande sculpture ivoire, socle et vallées vert forêt, fin liseré vermillon, lumière chaude latérale et ombres profondes. La demande de couleurs plus présentes est traduite dans l’image et par une saturation CSS de 1,2 ; ce n’est pas une mesure de surface ou une exactitude colorimétrique. Les fichiers servis par Astro portent leur empreinte de contenu. Les animations respectent le mouvement réduit et le bouton de pause. Sans JavaScript, l’illustration et sa provenance restent accessibles.

Le prototype en terrasses Blender du même jour n’a pas été retenu : son rendu mécanique ne correspondait pas à la référence. Le volume v4 ci-dessous remplace le v2 dans le mode interactif. Il reprend les verts profonds, les stries et le contraste de cette direction artistique, avec une géométrie distincte guidée par le MNT. Il ne prétend pas reproduire exactement les sommets imaginés de l’illustration.


## Sculpture interactive v4 — 28.09.2026

Après la première étape topographique ci-dessus, utiliser les fichiers argent `terrain.npz` et `contour.npz`. Aucune archive n’est modifiée et aucun téléchargement supplémentaire n’est nécessaire.

1. `prepare-artistic.py --geometry DOSSIER_GEOMETRIE --output DOSSIER_SCULPTURE` reconstruit un maillage d’environ 625 m. Deux lissages gaussiens regroupent les petits sommets en massifs ; une amplification de 16 est appliquée après soustraction d’un niveau de base de 330 m. Le contour est arrondi et simplifié ; les hauteurs s’abaissent progressivement près du bord. Ce traitement variable ne correspond donc pas à une échelle altimétrique uniforme ×16.
2. `blender --background --python-exit-code 1 --python build-artistic.py -- --geometry DOSSIER_SCULPTURE --output DOSSIER_OR` fabrique le volume ivoire, les pigments des vallées, le socle vert profond, le liseré vermillon et la signature volumétrique. Blender calcule l’occlusion des creux dans les couleurs des sommets. Aucun éclairage directionnel n’est figé dans ces couleurs. Les chants reçoivent des normales pondérées pour rendre les reflets continus. Le `.blend` et les vues de comparaison restent privés.
3. `gltf-transform quantize DOSSIER_OR/swiss-atlas.glb DOSSIER_OR/swiss-atlas-quantized.glb --quantize-position 14 --quantize-normal 10`.
4. `package-model.py --input DOSSIER_OR --output CHEMIN_PROJET/web/src/assets/art --version v4 --without-poster` compresse le GLB avec une date gzip fixe. Seul le `.bin` est livré ; l’illustration éditoriale reste l’affiche initiale.

`sculpture.json` et `scene.json` consignent les paramètres, effectifs et occlusion. Les stries et pigments ne représentent ni géologie ni occupation du sol. Le bord abaissé améliore la finition de l’objet au prix d’une déformation volontaire : ce n’est pas une carte de mesure.

Dans le navigateur, `atlas-relief-material.ts` ajoute des stries fines qui suivent la hauteur du volume, avec un relief de surface procédural et un filtrage à distance. Les ombres portées entre massifs suivent la rotation. `RoomEnvironment` produit sur place des reflets doux ; aucun panorama externe n’est chargé. `atlas-relief-shadow.ts` calcule une empreinte floutée une seule fois pour le contact au sol et l’efface progressivement quand le visiteur retourne l’objet. Les textures de calcul, matériaux et géométries sont libérés au retour à l’illustration. Les filtres et la perturbation des normales s’appuient sur Three.js, distribué sous licence MIT.


## Hauteur choisie et lumière v5 — 28.09.2026

Après comparaison de quatre études, Claude-Alain retient une hauteur réduite de **45 % par rapport au v4**. Reprendre la même géométrie argent et exécuter `build-artistic.py` avec `--height-scale 0.55` : chaque hauteur devient `0.23 + (z - 0.23) × 0.55`. Ce facteur concerne le terrain et son chant, pas le socle, le filet rouge ni l’inscription. Le paramètre vaut 1 par défaut pour conserver la fabrication historique. L’occlusion est recalculée sur la nouvelle géométrie ; les pigments d’origine restent identiques. Quantifier comme ci-dessus, puis empaqueter avec `--version v5 --without-poster`.

La scène web utilise une lumière principale chaude plus haute, un remplissage neutre et un éclairage d’ambiance pour lire le socle vert. L’ombre de contact est plus légère et diffuse ; les stries s’atténuent sur les faibles pentes pour éviter les anneaux du plateau. Le cadrage est légèrement plus plongeant, centré sur le nouveau volume. Un halo doux sur le papier, un fondu à l’ouverture et les commandes réunies sous la carte assurent la continuité avec la page ; le mouvement réduit neutralise le fondu.

L’illustration initiale, l’activation explicite, les gestes, le revers et les informations de provenance sont conservés. Ce réglage ne remodélise pas les crêtes ni les couches géométriques ; il ne prétend donc pas reproduire exactement l’illustration.
