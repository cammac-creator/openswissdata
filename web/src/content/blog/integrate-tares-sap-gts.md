---
title: "Integrating Swiss TARES customs codes into SAP GTS: a practical playbook"
description: "A step-by-step guide for ERP integrators bringing Swiss HS8 tariff codes into SAP Global Trade Services, with realistic cost and time comparisons."
publishedAt: 2026-04-22
keywords: ["SAP GTS", "TARES", "HS8", "Swiss customs", "ERP integration"]
dataset: "tares"
---

If you run SAP GTS in a Swiss subsidiary of a multinational, you've probably hit this friction point: the standard delivered HS reference tables lag behind the Swiss Federal Office for Customs and Border Security (BAZG) by weeks, and none of them cover the CH-specific HS8 granularity that the Swiss tariff uses.

You end up with one of three unpleasant options:

1. Maintain an Excel sidecar with HS8 codes exported from xtares.admin.ch by hand
2. Pay a customs consultant CHF 6 000-15 000 for a one-off mapping that will be outdated in 3 months
3. Build your own scraper of the TARES web UI — which takes a sprint and breaks at every BAZG release

This post walks through a fourth option: a CHF 299 per year cost for a maintained, format-clean TARES dataset that drops straight into your SAP GTS staging tables.

## The TARES problem, concretely

The Swiss tariff has roughly 6 000 HS8 positions. Unlike most European tariffs that stop at HS6 or HS8, the Swiss customs tariff actually carries MFN duties, preferential regimes (EU, EFTA, UK, CN, TR, ISR, and several dozen more), statistical units, and restriction codes (REACH, medical device, alcohol tax, etc.) for each position.

All of this is exposed by BAZG through xtares.admin.ch, but the site is:

- Not programmatically accessible (no public API)
- Not downloadable as a single structured export
- Updated continuously without versioned changelogs
- Rendered with HTML tables that change layout across BAZG releases

If you need to feed this into SAP GTS, the data format matters enormously. GTS expects specific column names, specific encoding (UTF-8 with Swiss diacritics preserved), and a strict hierarchy where chapters, headings, subheadings, and HS8 codes link via parent keys.

## What the openswissdata TARES bundle gives you

[TARES Dataset](/datasets/tares) ships as a single ZIP containing the same tariff data in 5 formats:

- `tares.csv` — UTF-8, comma-separated, quotes escaped
- `tares.json` — hierarchical, safe to stream
- `tares.parquet` — Apache Parquet for Spark/Databricks
- `tares.sql` — `CREATE TABLE` + `INSERT` statements (PostgreSQL/MySQL/SQLite compatible)
- `schema.json` — JSON Schema Draft-07 for CI validation

Plus `checksums.sha256`, `README.md`, and `LICENSE.txt` with the mandatory BAZG "non-official publication" disclaimer (DE/FR/EN).

### The record shape

Each row carries:

```
hs8:                  "84820010"      # Swiss 8-digit code
hs6:                  "848200"        # International 6-digit (HS6 from WCO)
chapter:              84              # integer, 1-99
heading:              "8482"
designation_fr:       "Roulements à billes, à contact radial"
designation_de:       "Kugellager, mit radialer Berührung"
designation_it:       "Cuscinetti a sfere a contatto radiale"
designation_en:       "Ball bearings with radial contact"
unit_stat:            "kg"
duty_mfn_chf_per_100kg: 0
preferential_regimes: {"eu": "free", "efta": "free", "uk": "free"}
restrictions_codes:   []
valid_from:           "2025-01-01"
source_url:           "https://xtares.admin.ch/tares/..."
```

Note the **hs6** field — this is the cross-walk to international HS6 used by every non-Swiss ERP on the planet. It lets you enrich SAP GTS's global commodity master with CH-specific 8-digit granularity without losing the link to the parent 6-digit classification.

## A 45-minute integration with SAP GTS

Here's the rough pipeline, which you can adapt to your GTS staging tables.

### Step 1. Load the CSV into staging

```sql
CREATE TABLE tares_staging (
  COMMODITY_CODE    VARCHAR(8) PRIMARY KEY,
  DESCRIPTION_DE    VARCHAR(500),
  DESCRIPTION_FR    VARCHAR(500),
  DESCRIPTION_IT    VARCHAR(500),
  DESCRIPTION_EN    VARCHAR(500),
  UNIT              VARCHAR(10),
  VALID_FROM        DATE,
  SRC_URL           VARCHAR(500)
);

\copy tares_staging FROM 'tares.csv' WITH (FORMAT csv, HEADER true);
```

### Step 2. Map to GTS vocabulary

If you're on ECC-based GTS (with the legacy T8N1 / T8N5 table structure), the simplest mapping is:

```sql
INSERT INTO /SAPSLL/T8N1 (NUMTY, NUMSP, NUMBR, LANDZ, DATBI, DATAB, LBEZ)
SELECT 'CHEHS8', 'CH', COMMODITY_CODE, 'CH', '99991231', VALID_FROM, DESCRIPTION_DE
FROM tares_staging;
```

(Adjust `NUMTY` to match your custom number type. If you're on S/4HANA GTS, the equivalent is `/SAPSLL/CUHDTA`.)

### Step 3. Delta monitoring

openswissdata publishes TARES updates weekly. Download the new ZIP, compare its `checksums.sha256` with last week's, and re-run only the rows whose SHA differs.

```bash
#!/usr/bin/env bash
# weekly-tares-sync.sh
TODAY=$(date -u +%Y.%m.%d)
NEW_ZIP="./tares-${TODAY}.zip"

# Download from openswissdata (signed URL delivered by webhook or re-issued via /account)
curl -sSfL "$OPENSWISSDATA_SIGNED_URL" -o "$NEW_ZIP"

# Extract + SHA compare
unzip -o "$NEW_ZIP" -d "./tares-${TODAY}"
diff -q "./tares-${TODAY}/tares.csv" "./tares-previous/tares.csv" || {
  psql -f ./sql/import_tares.sql
  psql -f ./sql/run_gts_delta.sql
}
rm -rf "./tares-previous"
mv "./tares-${TODAY}" "./tares-previous"
```

That's it. 30 lines of bash + 2 SQL files = one Swiss customs feed kept current in GTS.

## Understanding the tariff hierarchy

Before mapping, it helps to understand how the Swiss tariff is structured. TARES inherits the WCO Harmonized System hierarchy:

- **Chapter** (2-digit): broad material category (e.g., 84 = nuclear reactors, boilers, machinery)
- **Heading** (4-digit): general product type (8482 = ball and roller bearings)
- **Subheading** (6-digit): international subdivision (848200 = ball bearings with radial contact)
- **HS8** (8-digit): Swiss-specific granularity, where duties and restrictions apply

Most multinational ERP systems work at HS6. The CH-specific extension (HS7 and HS8) is what BAZG uses for tariff scheduling, and it's entirely Swiss. No international concordance exists for these digits — you need the TARES source.

## Common pitfalls in the SAP integration

After helping several teams with this integration, here are the failure modes we see most often:

**1. Encoding issues with Swiss diacritics.** The German designations carry ä, ö, ü, ß and the French carry é, è, à, â. If your ETL pipeline doesn't preserve UTF-8 all the way from CSV to GTS, you'll get corrupted text in description fields. The openswissdata bundle is always UTF-8-BOM-free — configure your SAP data transfer object (DTO) explicitly for UTF-8.

**2. Missing duty regime columns.** Some teams import only the MFN duty and forget the preferential regime fields. Then six months later someone asks "what's the duty rate for an EU supplier?" and the answer isn't in GTS. The `preferential_regimes` JSON column contains all current bilateral agreements — flatten them into GTS's `/SAPSLL/T8N5` before going live.

**3. No validity date tracking.** TARES positions come and go. New HS8 codes appear at the start of each WCO revision cycle; others are deprecated. If your import script is a full truncate-and-reload, you risk losing the audit trail of which code was valid when. Use `valid_from` and `valid_to` to implement soft deletes in your staging table.

**4. SAP transport order sequencing.** If your GTS tables are maintained via ABAP programs rather than direct SQL, make sure your transport order imports the TARES data after any configuration that defines `NUMTY`. A race condition here will throw a foreign-key violation in `/SAPSLL/T8N1` that's painful to debug.

## Cost comparison

Assume you're a data engineer billing CHF 120/hour.

| Approach | One-off cost | Annual maintenance |
|----------|-------------:|-------------------:|
| In-house scraper of xtares.admin.ch | ~40 hours × CHF 120 = CHF 4 800 | ~12 hours/year × CHF 120 = CHF 1 440 |
| Customs consultant quarterly dump | CHF 8 000 | CHF 24 000-32 000 |
| openswissdata TARES bundle | CHF 299 | CHF 120 (updates subscription) |

The 5× cost gap versus in-house build is what makes this product viable. The 20× gap versus a consultant is what makes it a no-brainer for mid-market firms that can't justify the full consulting spend.

## What's NOT in the dataset

Per the BAZG compliance agreement, openswissdata does **not** redistribute:

- The BAZG "Erläuterungen" (explanatory notes) — these remain proprietary to BAZG
- Classification "Entscheide" (rulings on specific products) — same reason

If your GTS project needs those, your customs broker or a licensed consultancy is still the right answer. openswissdata covers the structural tariff data only.

## Beyond SAP GTS: other integration patterns

The TARES bundle is designed to be format-agnostic. Teams have used it in several ways beyond GTS:

**Python/pandas for customs analytics.** Import `tares.parquet` directly into a Jupyter notebook or a Spark job. The Parquet file is schema-typed — hs8 is a string, chapter is an integer, duty_mfn_chf_per_100kg is a float — so you don't need to cast after loading.

**PostgreSQL reference table.** Run `tares.sql` directly against a PostgreSQL instance to create a searchable customs reference. The SQL file includes indexes on `hs8`, `hs6`, and `chapter`. Add a GIN index on the JSON `preferential_regimes` column for fast regime queries.

**Databricks Delta Lake.** Load `tares.parquet`, register as a Delta table, and schedule a weekly `MERGE INTO` from the latest download. The `valid_from` column works as your partition pruning key.

**REST API via PostgREST.** If you want to expose TARES as an internal API, PostgREST on top of the PostgreSQL table gives you a queryable endpoint in under an hour. Your customs team can then look up codes from a simple web UI without needing database access.

## Try it before you buy

A 10-row sample CSV is available at [/samples/tares-sample.csv](/samples/tares-sample.csv). It includes chapters across the full range — bearings, polymers, beverages, footwear, medical devices — so you can validate your parser against realistic diversity.

If it fits, grab the full bundle at [openswissdata.com/datasets/tares](/datasets/tares) for CHF 299.

## Closing thought

Swiss customs data is one of those quietly expensive reference problems: individually trivial, collectively painful, maintained poorly by every organization that thinks it'll be a one-time job. Paying CHF 299/year for someone else to worry about it is, to be honest, embarrassingly obvious value — but only if that someone else actually ships weekly and respects the BAZG conditions.

That's the thesis. Give the sample a try.
