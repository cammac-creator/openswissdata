# Progress — Refonte tier Pro Classifications (2026-04-30)

## Demande

Retirer STATENT du tier Pro Classifications (999 CHF) — license `terms_by_ask` non obtenue auprès de l'OFS — et le remplacer par 3 nouvelles valeurs ajoutées qui justifient le pricing.

## Livré

### 1. STATENT retiré du flow Pro

- `etl/classifications/release.ts` : suppression de l'appel `ingestStatent()` et du paramètre `statent` passé à `buildBundle`.
- Code historique laissé dormant : `ingest-statent.ts`, branche STATENT dans `bundle.ts`, et `tests/etl/classifications-statent.test.ts` continuent de passer (3 tests verts) pour reproduire bit-identiquement les bundles déjà émis aux clients existants.
- Aucune modification de Stripe — le Price LIVE `price_1TRsIN…` reste actif.

### 2. Trois nouvelles valeurs ajoutées (Pro)

| # | Module | Source | Volume |
|---|---|---|---|
| 01 | `embeddings-multilingual.ts` | wrapper de `embeddings.ts` | 3 × 1 845 = 5 535 vecteurs DE/IT/EN (en plus du FR existant) |
| 02 | `naics-crosswalk.ts` | US Census Bureau XLSX (Public Domain) | ~2 100-2 800 mappings NAICS↔ISIC↔NACE↔NOGA |
| 03 | `nace-en-labels.ts` | RDF Eurostat (déjà téléchargé) | 1 047 lignes EN stand-alone |

Le module embeddings.ts a été optimisé pour **skipper le chargement du modèle** quand le cache est complet (économise ~3 s par langue à chaque release).

### 3. Bundle ZIP Pro mis à jour

`etl/classifications/bundle.ts` accepte 4 nouveaux artéfacts optionnels (`naics`, `naceEnLabels`, et split per-language des embeddings). Le ZIP Pro contient désormais :

- `noga_2025_embeddings_{fr,de,it,en}.parquet` — un fichier par langue
- `naics_nace_crosswalk.{csv,json,sql,parquet}` + `naics_source.json`
- `nace_2_1_en_labels.{csv,json,parquet}`

Le README généré + le `schema.json` Draft-07 reflètent les nouveaux fichiers.

### 4. Frontend Astro

`web/src/pages/datasets/classifications.astro` : les 3 cards Pro (`01·Embeddings DE/IT/EN`, `02·NAICS 2022`, `03·NACE EN labels`) remplacent les libellés génériques. La mention "STATENT à venir V2" a été retirée.

### 5. Tests Vitest

3 nouveaux fichiers de tests (21 cas), tous passant + 2 cas supplémentaires couvrant le bundle Pro complet :

- `tests/etl/classifications-nace-en-labels.test.ts` (6 cas) — projection, idempotence, sort
- `tests/etl/classifications-naics-crosswalk.test.ts` (8 cas) — XLSX parse, group→class fan-out, sort déterministe
- `tests/etl/classifications-embeddings-multilingual.test.ts` (7 cas) — wrapper, cache warm-path, `langs` filter

**Total suite Classifications : 40 tests verts.** Aucune régression sur l'existant (statent + bundle + crosswalks + nace-isic + noga continuent de passer).

### 6. Documentation

- `etl/classifications/SOURCES.md` : section v3 STATENT marquée "RETIRÉ" avec rationale, nouvelles sections v4 (multilingue), v5 (NAICS), v6 (NACE EN labels) avec licenses détaillées.
- `docs/preflight-14-stripe-live.md` : nouvelle section "Mise à jour 2026-04-30" documentant le changement de contenu sans modification du Price LIVE.

## Sécurité license

| Source | License | OK ? |
|---|---|---|
| Census Bureau NAICS | Public Domain (US Government Work, 17 USC § 105) | ✅ Redistribution commerciale libre |
| Eurostat NACE 2.1 RDF | Re-use policy (free + attribution) | ✅ Déjà couvert dans Standard |
| Xenova/paraphrase-multilingual-mpnet-base-v2 | Apache 2.0 | ✅ Modèle libre |
| BFS STATENT | `terms_by_ask` | ❌ Retiré faute d'autorisation |

## Vérifications

- `npx tsc --noEmit` : ✅ pas d'erreur
- `vitest run` (suite classifications) : ✅ 40/40
- HEAD `https://www.census.gov/naics/concordances/2022_NAICS_to_ISIC_Rev_4.xlsx` : ✅ 200 OK (vérifié 2026-04-30)

## Commits

Voir le log git pour la séquence (4 commits logiques : remove STATENT / nace-en-labels / NAICS / multilingual embeddings + docs/tests/astro).
