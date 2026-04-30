# FINMA data sources

## Authorised institutions registry (`finma_registry.*`)

### Upstream

FINMA publishes a single consolidated CSV with ALL authorised institutions
(UID, name, city, AuthorisationType in DE/FR/IT/EN). Updated daily.

- Page: https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/
- File: https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv

Per-category XLSX files are still available for richer enrichment (licence
date, status, branch addresses) — see `FINMA_PER_CATEGORY_XLSX` in `sources.ts`.

### Update cadence

Continuous — FINMA updates the source file whenever licences are granted,
withdrawn, or modified. We re-ingest weekly.

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

`flagWarningsOnRegistry()` in `unify-schema.ts` performs a fuzzy name match
between each warning and each authorised entity (Levenshtein-based similarity,
normalized lowercase + legal-suffix stripping). Entities matched at score ≥ 0.8
get `is_warning_listed = true` in the registry.

Authorised registries and warning lists are disjoint by definition, so a
match count of 0–3 is the expected (correct) outcome and not a bug.

### Update cadence

The page itself states: "Please note that the warning list does not claim to
be exhaustive and is not updated on a daily basis." We re-ingest weekly along
with the registry.

### Licence

FINMA data is public. Same permission email as the registry (2026-04-17).
OpenSanctions also republishes this list under CC-BY-NC at
https://www.opensanctions.org/datasets/ch_finma_warnings/ — for reference only;
we ingest directly from the FINMA primary source.

## Sources covered (registry)

10 sources registered in `sources.ts`:
1. Banks
2. Insurance companies
3. Payment institutions (PSP / fintechs)
4. Asset managers collective
5. Asset managers individual
6. Securities firms
7. Fund representatives
8. SRO members
9. Supervisory organisations
10. Insurance intermediaries

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
