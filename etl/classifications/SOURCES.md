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
