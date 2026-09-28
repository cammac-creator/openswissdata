# Relief suisse — visuel original

`swiss-atlas-v1.png` a été créé le 27 septembre 2026 avec l’outil de génération d’images de Codex, à la demande de Claude-Alain pour l’identité visuelle d’OpenSwissData.

Direction : maquette topographique sculpturale de la Suisse, strates ivoire et vert forêt, mince strate vermillon, lumière de studio et fond clair. Sans texte, logo, institution ou donnée réelle.

Ce premier visuel est une illustration décorative, pas une carte géographique de référence ni une représentation du contenu FINMA. La version historique utilisait une alternative vide et masque les annotations décoratives aux technologies d’assistance. Astro fabrique les variantes WebP et leurs empreintes ; le PNG source n’est pas téléchargé par la page.

## Version 2 — 28 septembre 2026

`swiss-atlas-v2.png` est un rendu Blender du véritable volume présent dans `swiss-atlas-v2.bin` (GLB quantifié, compressé en gzip). Le contour provient de swissBOUNDARIES3D 2026-01 et les altitudes de MNT25 : **©swisstopo**. Les hauteurs sont amplifiées ×8 et le relief simplifié ; les couleurs sont artistiques. La version 2 remplaçait la version 1 dans `AtlasArtwork` ; elle n’est plus utilisée. La [documentation de fabrication](../../../../scripts/atlas/README.md) donne les sources, empreintes, règles d’attribution et étapes de reconstruction.


## Historique — illustration éditoriale fixe — 28 septembre 2026 (lot58)

`swiss-atlas-editorial-v3.png`, création ChatGPT dérivée de la maquette A et du premier atlas, était le visuel du lot58. Aucun modèle 3D n’était importé. Crêtes et couleurs sont imaginées ; l’image n’est pas issue du MNT et ne porte pas l’attribution swisstopo réservée aux modèles historiques.

## Illustration pixels — 28 septembre 2026

`swiss-atlas-pixels-v1.png` est le visuel courant, choisi par Claude-Alain après une comparaison de six pistes puis une retouche du fond. Illustration créée avec l’outil imagegen intégré : relief ivoire, pixels émeraude, socle vert sombre, filet rouge et fond papier clair. La copie source est conservée sans retouche des pixels ; le raccord de luminosité est appliqué en CSS. SHA-256 : `c7034c475f7e5dfec360721577e4802673e40d7d406846a639e469c73067b081`.

Les pixels constituent une évocation artistique des données suisses. Aucune mesure de couverture numérique, position d’établissement ni statistique réelle ne leur est attribuée ; ils ne proviennent pas de l’atlas OFCOM. Les détails de relief générés ne sont pas certifiés topographiquement. `AtlasArtwork` conserve une alternative décorative vide et une provenance consultable FR/DE/EN, sans mouvement ni modèle 3D. Astro produit les variantes WebP avec empreinte dans leur adresse.
