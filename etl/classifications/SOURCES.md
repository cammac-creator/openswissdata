# Classifications data sources

## v2 — production (ingéré 2026-04-29 dans `ingest-real.ts`)

Toutes les sources ci-dessous sont récupérées dynamiquement par
`etl/classifications/ingest-real.ts` et mises en cache dans
`data/classifications/classifications-cache/` (TTL 7 jours).

### Nomenclatures principales

| Schème | Source | URL exacte | Format | Volume |
|---|---|---|---|---|
| **NACE Rev 2** | npm `nace-codes` (mirror Eurostat) | (intégré au package) | JS dist | 1047 codes |
| **NACE Rev 2.1** | EU Vocabularies (publications.europa.eu) | https://op.europa.eu/o/opportal-service/euvoc-download-handler?cellarURI=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fcellar%2Fbeb2efec-da9a-11ed-a05c-01aa75ed71a1.0001.02%2FDOC_1&fileName=ESTAT-NACE2.1.rdf | RDF/SKOS-XKOS | 1047 codes (24 langues, 4 retenues) |
| **NOGA 2008** | i14y.admin.ch (BFS — plateforme suisse interopérabilité) | https://api.i14y.admin.ch/api/public/v1/concepts/08dc481b-2add-1232-b5fe-b1fae7a1ac02?includeCodeListEntries=true | JSON | 1790 codes EN/DE/FR/IT |
| **NOGA 2025** | i14y.admin.ch | https://api.i14y.admin.ch/api/public/v1/concepts/001bfaa8-fa57-4d66-acfd-c795d67fcf80?includeCodeListEntries=true | JSON | 1845 codes EN/DE/FR/IT (incl. 6 chiffres CH) |
| **ISIC Rev 4** | UN Statistics Division | https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_{english,French,Spanish}_structure.Txt | CSV (Windows-1252 pour FR/ES) | 766 codes EN/FR/ES |

### Cross-walks officiels

| Bridge | Source | Méthode |
|---|---|---|
| **NACE 2.0 ↔ NACE 2.1** | EU Vocabularies SKOS RDF (intégré dans `ESTAT-NACE2.1.rdf`) | 1589 triples `skos:closeMatch` extraits par regex |
| **NACE ↔ NOGA** | BFS méthodologie | Identité au niveau section/division/group/class (documenté dans NOGA 2025 introduction) |
| **NACE 2.x ↔ ISIC 4** | NACE built-on-ISIC (Eurostat + UN) | Identité au niveau classe quand le code à 4 chiffres correspond ; sinon `partial` |
| **NOGA 2008 ↔ NOGA 2025** | dérivé via la chaîne `NOGA_2008 ↔ NACE_2.0 ↔ NACE_2.1 ↔ NOGA_2025` | construction transitive |

**Volume total cross-walks : 2177 lignes** (anchored on NOGA 2025 codes, levels above section).

### Notes

- Le bridge **NACE 2.0 ↔ NACE 2.1** dispose d'une table officielle Eurostat sous forme
  de triples `skos:closeMatch` dans le RDF NACE 2.1. Pour les codes sans
  closeMatch, on fait un fallback identité (= code inchangé entre révisions, ce
  qui est exact pour ~50 % des codes).
- Le bridge **NOGA 2008 ↔ NOGA 2025** n'a pas de table publique unique (BFS
  publie uniquement une introduction PDF). Il est dérivé via la chaîne ci-dessus,
  ce qui couvre les ~85 % de codes inchangés et marque les autres comme
  `derived` ou `partial` dans `mapping_type`.
- Les codes CH-spécifiques NOGA 2025 à 6 chiffres (ex. `011100`, `113001`) n'ont
  pas de NACE counterpart → `nace_2_1 = null` avec note explicative.

## v3 Pro tier — STATENT (ingéré 2026-04-30 dans `ingest-statent.ts`)

Activation : `CLASSIFICATIONS_TIER=pro` (default = `standard`, qui ne livre pas STATENT).

### Source

| Champ | Valeur |
|---|---|
| Dataset opendata.swiss | https://opendata.swiss/fr/dataset/betriebszahlung-unternehmensstatistik-arbeitsstatten |
| Producteur | OFS (Office fédéral de la statistique) — Section Structure et analyses économiques |
| Contact | statent@bfs.admin.ch |
| Licence | `terms_by_ask` (CH Open Data ToU) — utilisation libre, **utilisation commerciale uniquement avec autorisation BFS** |
| API | PX-Web JSON-stat2 — https://www.pxweb.bfs.admin.ch/api/v1/fr/{table}/{table}.px |
| Tables ingérées | `px-x-0602010000_101` (canton × NOGA division) + `px-x-0602010000_102` (commune × secteur) |
| Couverture temporelle | 2011 → dernière année publiée (auto-skip si année 404) |
| Pas de chunking | 1 POST par année par table → ~28 requêtes total, < 60 s en cache froid |
| TTL cache | 30 jours dans `data/classifications/classifications-cache/statent_<table>_<year>.json` |

### Pourquoi pas commune × NOGA-class

Le BFS **ne publie pas** publiquement de table commune × NOGA classe (4-chiffres) parce que les cellules avec 1 à 4 établissements sont supprimées (confidentialité statistique : Loi sur la statistique fédérale, art. 14). Les deux slices PX-Web ci-dessus sont la granularité publique la plus fine. Pour des données plus fines, BFS propose un contrat d'accès ad hoc.

### Fichiers livrés (uniquement quand `tier=pro`)

| Fichier | Contenu | Format | Volume typique |
|---|---|---|---|
| `statent_canton_division.csv` | Canton × NOGA div × année × ObsUnit | CSV | ~150k lignes (13 ans × 26 cantons × 86 div × 7 unités) |
| `statent_canton_division.parquet` | idem | Parquet | ~30% du CSV |
| `statent_canton_division.sql` | idem | SQL chunked INSERT VALUES (1000 rows/tuple) | ~30 MB |
| `statent_commune_sector.csv` | Commune × secteur × année × ObsUnit | CSV | ~750k lignes (13 ans × 2137 communes × 4 secteurs × 7 unités) |
| `statent_commune_sector.parquet` | idem | Parquet | ~30% du CSV |
| `statent_commune_sector.sql` | idem | SQL chunked | ~150 MB |
| `statent_source.json` | Métadonnées source (URL, licence, attribution, stats fetch) | JSON | < 1 KB |

Cellules supprimées (confidentialité) : sérialisées comme `null` (Parquet) / cellule vide (CSV) / `NULL` (SQL).

### Comment joindre avec NOGA et avec les communes

```sql
-- Joindre canton × division au pack NOGA 2025 (au niveau division)
SELECT s.year, s.canton_label, n.code, n.label_fr, s.observation_unit, s.value
FROM statent_canton_division s
JOIN noga_2025 n ON n.code = s.noga_division AND n.level = 'division'
WHERE s.observation_unit = 'fte_total' AND s.year = 2023;

-- Joindre commune × secteur à toute table BFS commune (si vous en avez une externe)
SELECT s.year, s.commune_bfs_id, s.commune_label, s.sector, s.value
FROM statent_commune_sector s
WHERE s.observation_unit = 'establishments' AND s.year = 2023;
```

### Schéma (Parquet)

`statent_canton_division.parquet` :

| Colonne | Type | Notes |
|---|---|---|
| `year` | INT32 | 2011..2024 |
| `canton_bfs_id` | INT32 | 1..26 (BFS canton ID) |
| `canton_label` | UTF8 | ex. "Zürich" |
| `noga_division` | UTF8 | 2-digit, ex. "47" |
| `noga_division_label` | UTF8 | ex. "47 Commerce de détail…" |
| `observation_unit` | UTF8 | enum (voir ci-dessous) |
| `value` | DOUBLE optional | `null` = supprimé pour confidentialité |

`statent_commune_sector.parquet` :

| Colonne | Type | Notes |
|---|---|---|
| `year` | INT32 | 2011..2024 |
| `commune_bfs_id` | INT32 | BFS commune ID |
| `commune_label` | UTF8 | ex. "Zürich" |
| `sector` | UTF8 | enum: total / primary / secondary / tertiary |
| `sector_label` | UTF8 | ex. "Secteur économique - total" |
| `observation_unit` | UTF8 | (voir ci-dessous) |
| `value` | DOUBLE optional | `null` = supprimé |

`observation_unit` enum :

| Clé | Description |
|---|---|
| `establishments` | Nombre d'établissements |
| `employment_total` | Emplois (total) |
| `employment_female` | Emplois (femmes) |
| `employment_male` | Emplois (hommes) |
| `fte_total` | Équivalents plein temps (total) |
| `fte_female` | Équivalents plein temps (femmes) |
| `fte_male` | Équivalents plein temps (hommes) |

### Attribution + license

À reproduire dans tout produit dérivé :

> Données : OFS — Statistique structurelle des entreprises (STATENT), via opendata.swiss.
> Conditions : `terms_by_ask` (utilisation commerciale soumise à autorisation BFS).

## Anciens fichiers (v1 fixtures, encore utilisables via `USE_FIXTURE=1`)

- `etl/classifications/fixtures/generate-fixture.ts` — génère les XLSX/CSV
  synthétiques pour les tests CI (sans dépendances réseau).
- Ces fixtures couvrent un sous-ensemble (≈ 5 codes par schème) et restent
  pertinentes pour valider le code de parsing.

## License + attribution

Les données brutes ne sont pas protégées par copyright en CH (opendata.swiss
ToU, BFS). Eurostat publie sous re-use policy. Les attributions suivantes sont
incluses dans le README généré dans chaque ZIP :

- BFS — Federal Statistical Office, Switzerland
- Eurostat — European Statistical Office (DG ESTAT)
- UN Statistics Division (DESA)

## Testing

Le script `etl/classifications/fixtures/generate-fixture.ts` génère des
fixtures XLSX/CSV synthétiques pour valider le parsing offline. Le path
fixture est activé via `USE_FIXTURE=1 npm run etl:classifications`.
