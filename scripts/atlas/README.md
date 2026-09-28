# Relief suisse interactif — chaîne de fabrication

Le modèle est une interprétation graphique mesurée, produite hors du serveur web. Aucun service cartographique ni téléchargement de données géographiques ne se déclenche chez le visiteur.

## Sources originales, conservées séparément

- [MNT25/DHM25](https://www.swisstopo.admin.ch/fr/modele-altimetrique-mnt25) : [archive complète](https://cms.geo.admin.ch/ogd/topography/DHM25_MM_ASCII_GRID.zip), distribuée en 2021. SHA-256 `53c926c7c1dc9d34d59fb749e135dfb3147853c90d047b007b3018486df0dd46`.
- [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/fr/modele-du-territoire-swissboundaries3d) : [édition 2026-01, LV95/LN02](https://data.geo.admin.ch/ch.swisstopo.swissboundaries3d/swissboundaries3d_2026-01/swissboundaries3d_2026-01_2056_5728.gpkg.zip). SHA-256 `68e922353c76fa5db3cef06a32f9711c0198faa6fbd2b5bcde9edc88b0f8999f`.
- [Conditions swisstopo](https://www.swisstopo.admin.ch/fr/conditions-utilisation-geodonnees-et-geoservices-gratuit) : transformation et usage commercial autorisés avec attribution. La page affiche **©swisstopo** et explique les transformations.

Les archives sont téléchargées une fois, vérifiées par SHA-256 et gardées intactes dans `bronze/2026-09-28/`. Extraire le ZIP MNT dans `argent/mnt/`, avec `ASCII_GRID_1part/dhm25_grid_raster.asc`, et le GeoPackage dans `argent/frontieres/`. Les chemins se passent explicitement aux scripts ; aucun téléchargement implicite. Les gros originaux et le fichier Blender restent hors du dépôt public.

## Transformation

Python : numpy/scipy, shapely 2.0.7, pyproj 3.6.1, rasterio 1.4.3, triangle 20250106. Blender 5.2.1 LTS ; glTF Transform 4.5.0.

1. `prepare-terrain.py --data DOSSIER_SOURCE --output DOSSIER_GEOMETRIE` lit la frontière `icc=CH`, transforme LV95 en LV03, conserve la principale composante du pays et ses trous. Contour simplifié à 100 m, maillage à environ 350 m ; MNT 25 m filtré à 175 m. Les hauteurs sont multipliées par **8**, puis le maillage est allégé dans Blender. Les sommets et les valeurs précises ne sont donc pas utilisables pour une mesure.
2. `blender --background --python-exit-code 1 --python build-scene.py -- --geometry DOSSIER_GEOMETRIE --output DOSSIER_OR` crée relief, socle vert, liseré rouge et lettres volumétriques satinées au dos. « Made in Switzerland » est un marquage en léger relief façon frappe industrielle. Pas de texture plane ni de mention officielle de certification.
3. `gltf-transform quantize DOSSIER_OR/swiss-atlas.glb DOSSIER_OR/swiss-atlas-quantized.glb --quantize-position 14 --quantize-normal 10`.
4. `package-model.py --input DOSSIER_OR --output CHEMIN_PROJET/web/src/assets/art` écrit le gzip déterministe dans `.bin` et copie le rendu Blender. Astro émet les adresses avec empreinte, ainsi que les affiches WebP.

Les rapports `geometrie.json` et `scene.json` documentent chaque exécution. Le MNT historique n’est pas swissALTI3D ; aucune géologie, couverture de données, forêt ou frontière cantonale n’est codée par une couleur. Ivoire, vert et rouge sont artistiques. La saturation HSL des matériaux colorés est multipliée par 1,2 ; ce réglage ne signifie pas que chaque pixel est exactement 20 % plus saturé après éclairage.

## Dans la page

Three.js est chargé à la demande, puis le modèle de moins de 3 Mo est lu sur la même origine, décompressé avec `DecompressionStream` et rendu localement. Aucun WASM, CDN ni service tiers ; CSP inchangée. La licence MIT de Three.js accompagne la distribution dans `/licenses/three-MIT.txt`. Sur téléphone ou connexion économe, chargement explicite. Une affiche demeure sans JavaScript, sans WebGL, en cas d’échec réseau ou de perte du contexte graphique ; le visiteur peut réessayer.

Glisser à la souris tourne librement ; les flèches du clavier aussi. Les boutons montrent le dos et rétablissent le recto. Sur écran tactile, « Manipuler » active les gestes, « Terminer » libère le défilement. Le mouvement réduit, la pause, la visibilité de la page et la sortie de l’écran interrompent le mouvement automatique. Les ressources GPU sont libérées au départ de la page. Prévoir une recette sur un vrai téléphone en complément des moteurs de navigateur automatisés.
