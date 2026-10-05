# FINMA data sources

> **État au 29.09.2026.** Certains passages ci-dessous sont historiques (collecte hebdomadaire, listes XLSX par catégorie, rapprochement par ressemblance). Fonctionnement actuel : registre lu chaque jour dans `uid.csv` (`refresh-finma.yml`, créneau 04:17 UTC, souvent lancé plus tard par GitHub), type d'établissement tiré de `AuthorisationTypeEN` (`entityTypeForAuthorisation`, insensible à la casse), liste d'alerte par l'API de recherche de la FINMA (`ingest-warnings.ts`), LEI par l'API GLEIF (`ingest-gleif.ts`), et depuis le 30.09.2026 organisme de surveillance des gestionnaires de fortune et trustees ainsi que les listes des OAR et des OS (`ingest-supervision.ts`, section ci-dessous). En cas de doute, le code fait foi.

## Authorised institutions registry (`finma_registry.*`)

### Upstream

FINMA publishes a single consolidated CSV with ALL authorised institutions
(UID, name, city, AuthorisationType in DE/FR/IT/EN). Updated daily.

- Page: https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/
- File: https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv

Per-category XLSX files are still available for richer enrichment (licence
date, status, branch addresses) — see `FINMA_PER_CATEGORY_XLSX` in `sources.ts`.
Three of them are read daily since 2026-09-30 (`vvtr.xlsx`, `sro.xlsx`, `ao.xlsx`,
see the section on supervisory organisations below).

### Update cadence

Continuous — FINMA updates the source file whenever licences are granted,
withdrawn, or modified. We re-ingest daily (since September 2026).

### Licence

FINMA data is public. Email of permission sent 2026-04-17 (see
`docs/legal-correspondence.md`).

## FINMA Warning List (`finma_warnings.*`)

### Upstream

Public list of companies and individuals carrying out financial activities
in/from Switzerland without FINMA authorisation. Updated whenever FINMA adds
a new unauthorised provider.

- Page: https://www.finma.ch/en/finma-public/warnungen/warning-list/
- API: `POST https://www.finma.ch/en/api/search/getresult`
  - Body (form-urlencoded): `ds={1C6B8731-638C-4003-A93C-A625BF7A6800}&Order=4`
  - Returns full list (~2 180 entries) in a single response (`ResultsPerPage=20000`)
- Response structure: `{ Items: [{ Title, Link, Date, Timestamp, FacetColumn }], Count }`

### Field mapping (raw → `FinmaWarning`)

| Raw field      | Target field       | Notes                                                    |
|----------------|--------------------|----------------------------------------------------------|
| `Title`        | `name`             |                                                          |
| `Link`         | `source_url`       | absolute URL = `https://www.finma.ch` + `Link`           |
| `Link`         | `additional_info`  | slug extracted from `/warning-list/<slug>/`              |
| `Date`         | `date_added`       | parsed from "DD.MM.YYYY" → ISO "YYYY-MM-DD"              |
| `FacetColumn`  | `category`         | "Entered in commercial register" / "Not entered..."      |
| (constant)     | `warning_type`     | always `"unauthorized_provider"` (FINMA's only bucket)   |
| (constant)     | `source_list`      | always `"finma-warnings"`                                |
| n/a            | `country`          | not in list response — would need 2 180 detail-page hits |

### Cross-reference with the authorised registry

No fuzzy cross-reference is made. `release.ts` sets `is_warning_listed` to null on
every registry row: the warning list is shipped as its own table and is never matched
to an authorised entity by approximate name. The former fuzzy helper,
never called, was removed on 2026-10-05 (tâche osd.N03).

### Update cadence

The page itself states: "Please note that the warning list does not claim to
be exhaustive and is not updated on a daily basis." We re-ingest weekly along
with the registry.

### Licence

FINMA data is public. Same permission email as the registry (2026-04-17).
OpenSanctions also republishes this list under CC-BY-NC at
https://www.opensanctions.org/datasets/ch_finma_warnings/ — for reference only;
we ingest directly from the FINMA primary source.

## Organisme de surveillance et tables des OAR et des OS (depuis le 30.09.2026)

Trois fichiers FINMA lus à chaque collecte quotidienne, après uid.csv, la liste
d'alerte et GLEIF (`etl/finma/ingest-supervision.ts`, appelé par `release.ts`).
Adresses : `FINMA_VVTR_XLSX_URL`, `FINMA_SRO_XLSX_URL`, `FINMA_AO_XLSX_URL`
dans `sources.ts`.

| Fichier | Contenu FINMA | Ce que l'archive en fait |
|---|---|---|
| `vvtr.xlsx` | « List of portfolio managers and trustees licensed by FINMA and monitored by a supervisory organisation » : nom, localité, cases Portfolio Manager / Trustee, organisme de surveillance | Colonne `supervisory_organisation` du registre (+ `_source_url`, `_observed_on`) |
| `sro.xlsx` | Organismes d'autorégulation (OAR) reconnus : raison sociale, adresse, téléphone, e-mail, site | Table `finma_reference_sros.*` : raison sociale, adresse, site |
| `ao.xlsx` | Organismes de surveillance (OS) autorisés : nom, adresse, localité, téléphone, e-mail, site | Table `finma_reference_supervisory_organisations.*` : nom, adresse, localité, site |

**Vocabulaire.** Un OS surveille les gestionnaires de fortune et trustees selon
la loi sur les établissements financiers (LEFin, art. 43a LFINMA). Un OAR
(organisme d'autorégulation) relève de la loi sur le blanchiment d'argent (LBA).
Le champ `supervisory_organisation` n'est jamais une affiliation OAR ; le fichier
ne contient toujours pas les affiliations aux OAR (recherche officielle de la
FINMA, une entreprise à la fois).

**Rapprochement (règle du 25.09.2026 : aucune ressemblance approximative).**
Seules les lignes « Portfolio manager » et « Trustee » du registre sont
concernées. Une ligne reçoit l'OS si le nom ET la localité sont identiques après
normalisation stricte (Unicode NFC, espaces réduits et retirés en bord ; casse,
ponctuation, guillemets et forme juridique conservés : « X AG » ≠ « X SA »), si
cette clé est unique dans vvtr.xlsx, si les lignes candidates du registre ont un
seul UID et si le type de la ligne est coché dans vvtr.xlsx. Sinon le champ
reste vide. Mesure du 30.09.2026 (vvtr.xlsx du jour, uid.csv du 29.09) : 1 508
lignes vvtr sur 1 508 rattachées, aucune ambiguë ni absente ; 1 519 lignes du
registre sur 1 608 renseignées (une société peut détenir les deux
autorisations). Les 89 lignes vides n'ont pas de correspondance dans vvtr.xlsx ;
la FINMA publie à part les sociétés de groupe qu'elle surveille directement
(`grfinig.xlsx`, non repris).

**Garde-fous (la version n'est pas publiée, alerte par mail du workflow).**
Signature XLSX contrôlée avant lecture (une page HTML est refusée) ; en-tête
repéré par son texte ; ligne « Total …: N » obligatoire et égale au nombre de
lignes lues ; rien après le total ; drapeaux « X » ou vides, au moins un par
ligne ; chaque OS de vvtr.xlsx doit figurer dans ao.xlsx du même passage ;
planchers : 1 000 gestionnaires, 5 OAR, 2 OS ; au moins 95 % des lignes
vvtr.xlsx rattachées ; `buildBundle` refuse une table de référence vide ou un
champ promis sans aucune valeur.

**Données personnelles et intégrité.** Les colonnes e-mail et téléphone ne sont
jamais lues : deux adresses e-mail de sro.xlsx désignent des personnes. Les
valeurs reprises le sont telles que publiées (adresses avec leurs retours à la
ligne). Provenance : URL, date de collecte, date `Last-Modified` et SHA-256 de
chaque fichier dans `quality.json` et le README de l'archive (accord FINMA du
06.05.2026 : source citée, documents non altérés).

**Surveillance des sources.** Les trois classeurs sont régénérés chaque nuit :
`scripts/monitor-sources.ts` les suit en mode `xlsx-shape` (nom de feuille et
ligne d'en-tête), références dans `etl/canary-baseline.json`.

## Sources covered (registry)

9 sources registered in `sources.ts`:
1. Banks
2. Insurance companies
3. Payment institutions (PSP / fintechs)
4. Asset managers collective
5. Asset managers individual
6. Securities firms
7. Fund representatives
8. Supervisory organisations
9. Insurance intermediaries

Removed 2026-09-30: "SRO members" (`finma-sro-members`). The listed source URL
(`.../authorised-institutions/sro-members/`) has never existed at FINMA (404),
and no `AuthorisationTypeEN` label in the daily `uid.csv` maps to it either
(see `AUTH_TYPE_TO_ENTITY_TYPE` in `sources.ts`). It shipped as an always-empty
category in every archive. See `docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md`.

## Testing

4 synthetic fixtures materialized by `fixtures/generate-fixture.ts` cover
Banks / PSP / Insurance / Asset Managers. Real ingestion uses the official
FINMA `uid.csv` (registry) and the warning-list JSON API (warnings).

## Tier "FINMA + Zefix Sync" — LINDAS bulk enrichment

Activated by setting `FINMA_TIER=zefix` before running `npm run etl:finma`.
Default tier (`standard`) is unchanged — Zefix files are NOT shipped.

### Endpoint

- URL: `POST https://register.ld.admin.ch/query`
- Content-Type: `application/sparql-query`
- Accept: `application/sparql-results+json`
- Discovery: `https://register.ld.admin.ch/.well-known/dataset/foj-zefix`
- Public, no auth required.

### Graph

`<https://lindas.admin.ch/foj/zefix>`

### Bulk query (batches of 500 UIDs)

```sparql
PREFIX schema: <http://schema.org/>
SELECT ?uidValue ?company ?legalName ?legalForm ?desc WHERE {
  GRAPH <https://lindas.admin.ch/foj/zefix> {
    VALUES ?uidValue { "CHE103137179" "CHE105928677" ... }
    ?uidNode schema:name "CompanyUID" ;
             schema:value ?uidValue .
    ?company schema:identifier ?uidNode ;
             schema:legalName ?legalName .
    OPTIONAL { ?company schema:additionalType ?legalForm }
    OPTIONAL { ?company schema:description ?desc }
  }
}
```

UIDs are passed in the canonical Zefix flat form (no separators), e.g.
`CHE103137179` (= FINMA `CHE-103.137.179`). The implementation in
`etl/finma/ingest-zefix.ts` handles round-trip normalization.

### Vocabulary

| RDF predicate                               | Field                | Notes                                        |
|---------------------------------------------|----------------------|----------------------------------------------|
| `schema:legalName`                          | `name`               | canonical legal name                         |
| `schema:description`                        | `zefix_purpose`      | corporate purpose / objet social             |
| `schema:additionalType`                     | `zefix_legal_form*`  | URI under `https://ld.admin.ch/ech/97/legalforms/<code>` (eCH-0097) |
| `schema:identifier` (sub-node `CompanyUID`) | UID round-trip       | `schema:value` literal carries `CHEnnnnnnnnn`|
| `schema:address` (sub-node)                 | (not yet promoted)   | nested locn:address with street/postcode     |

The eCH-0097 code → human label table is embedded in `ingest-zefix.ts`
(`ECH_0097_LABELS`).

### Cache

`./data/finma/finma-cache/zefix-bulk.json` keyed by SHA-256 of the sorted UID
list. Re-using the same UID set short-circuits all SPARQL calls.

### Join with FINMA Registry

`finma_with_zefix.{csv,json,sql,parquet}` is built by left-joining the
authorised registry on `uid` (canonical form `CHE-xxx.xxx.xxx`). Entities
without a UID (e.g. some `asset_manager_individual` rows for natural persons)
or without a Zefix match keep all `zefix_*` columns empty/null.

### Limitations (v1)

LINDAS does NOT expose:
- `capital`, `capital_currency`
- RC status (active / inactive / liquidation)
- `organes` (board members, signatures)
- mutations / SOGC journal entries
- `last_update`

These fields require the **authenticated Zefix REST API** (Swagger:
https://www.zefix.admin.ch/ZefixPublicREST/swagger-ui/index.html). The API
key is requested by emailing `zefix@bj.admin.ch` — not yet obtained as of
this release. Once provisioned, a complementary `ingest-zefix-rest.ts`
module will populate the missing columns. The interface `ZefixData` is
already forward-compatible.

### Match rate

Empirical (2026-04-29 sample): ~91% of FINMA UIDs match Zefix. Misses are
expected for:
- foreign branches (no Swiss UID in Zefix)
- natural persons (asset_manager_individual without UID)
- entities deregistered before LINDAS coverage
