# openswissdata — branding source files

Archive des fichiers Midjourney d'origine utilisés pour la marque openswissdata.com.
Les fichiers sont conservés sous leur nom MJ original (UUID inclus) pour permettre de
retrouver le seed / prompt côté Midjourney si besoin.

Ces fichiers ne sont **pas** servis sur le site — ce dossier sert d'archive permanente.
Les versions traitées (croppées, redimensionnées, optimisées) sont sous `web/public/`.

## Inventaire

| Source | Usage | URL servie |
|---|---|---|
| `u9837718348_minimal_logo_mark_swiss_cross_composed_of_small_g_84ba9caa-f519-4c4d-aff1-266e0f08c2b9_3.png` | Logo officiel openswissdata (croix suisse en pixels) — choisi 2026-05-06 | `/logo.png`, `/favicon.*`, `/icon-*.png`, `/apple-touch-icon.png` |
| `u9837718348_minimal_banner_composition_horizontal_field_of_sm_7ee0a106-ecea-462d-bd46-902862929b1d_1.png` | Bannière TARES (pixels qui convergent vers carré rouge) — validée 2026-05-06 | `/og-tares.png`, fond du hero `/datasets/tares` |
| `u9837718348_un_carr_qui_se_divise_en_4_plus_petits_qui_se_div_dcaf56bb-0012-42d7-b82c-e9139dfb0e40_0.png` | Bannière Classifications v1 (subdivision récursive, carré rouge centre-droit) — éphémère, remplacée le jour même | — |
| `u9837718348_un_carr_qui_se_divise_en_4_plus_petits_qui_se_div_bd610bfd-e126-45b4-9a04-519f608defe5_2.png` | Bannière Classifications v2 (subdivision blueprint, carré rouge à droite) — validée 2026-05-06, version live **flipée horizontalement** | `/og-classifications.png` (flippée + redimensionnée 1200×630), fond du hero `/datasets/classifications` |

## Style guide MJ

Tous les visuels respectent la même palette et grammaire :

- Fond cream / off-white `#FAFAF7`
- Pixels noirs `#0A0A0C`
- Un seul carré rouge accent `#DC1F2D`
- Style : helvetica era, swiss design system, geometric precision, programmatic
- Format banner : `--ar 191:100 --style raw --v 6.1`
- Format logo : `--ar 1:1 --style raw --v 6.1`
- Toujours : `flat 2d vector, no text, no gradient, no shadow, no 3d`
