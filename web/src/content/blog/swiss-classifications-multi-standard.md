---
title: "Reporting a Swiss company across NOGA 2025, NACE 2.1, and ISIC 4 — without losing your mind"
description: "Why the cross-walk between Swiss NOGA and international NACE/ISIC is the single most-requested and least-maintained reference table in Europe, and what a complete bundle looks like."
publishedAt: 2026-04-22
keywords: ["NOGA 2025", "NACE 2.1", "ISIC 4", "Swiss classifications", "cross-walk"]
dataset: "classifications"
---

You work in finance at a Swiss subsidiary of a German parent. Head office asks you to produce a quarterly sector report. Your customer master is classified under NOGA 2025 (the fresh Swiss economic activities nomenclature released January 2025). Head office reports in NACE Rev 2.1 and needs its own ISIC 4 view for the group's ESG disclosures.

You open Ramon.eurostat.ec.europa.eu. You download the Swiss BFS NOGA Excel. You copy-paste into a sidecar Excel, and you start hand-mapping codes.

Three days later you've processed 40% of the mapping, you've already found three classes where NOGA 2025 splits what NACE 2.0 had grouped, and you know this is not going to work as a repeatable process.

This post is about why the cross-walk between Swiss NOGA and international NACE/ISIC is one of the most painful and least-addressed reference-data problems in European finance, and what a ready-made bundle looks like.

## The four classifications at play

A Swiss company can be classified, in any given report, under any of these five standards (or their predecessors):

| Standard | Maintainer | Scope | Current revision |
|----------|-----------|-------|------------------|
| NOGA | BFS (CH) | Swiss economic activities | 2025 (released Jan 2025) |
| NACE | Eurostat | EU economic activities | Rev 2.1 |
| ISIC | UN Stats | International | Rev 4 |

(You'll sometimes also see SITC or CPC in older international statistical series, but for corporate reporting the three above are what you actually need.)

Crucially:
- **NOGA and NACE are identical at the class level** (4-digit). NOGA 2025 = NACE 2.1 class codes. NOGA 2008 = NACE 2.0 class codes.
- The divergence appears at the **subclass level** (5-digit), where BFS adds Swiss-specific granularity.
- The official bridges that matter are **NACE 2.0 ↔ 2.1** (Eurostat Ramon) and **NACE 2.1 ↔ ISIC 4** (UN Stats + Eurostat cooperation).

So in theory, the chain is: NOGA 2008 → NACE 2.0 → NACE 2.1 → ISIC 4 (and NOGA 2025 rides alongside NACE 2.1 at the class level).

In practice, assembling this chain yourself requires:

1. Downloading 5 XLSX/CSV files from 3 different government portals
2. Normalizing 4 different column schemas (BFS uses FR/DE/IT/EN, Ramon uses EN only, UN uses EN only)
3. Parsing two official bridge files (Eurostat publishes these as XLSX with multi-line headers)
4. Reconciling cases where one NOGA 2025 class maps to multiple NACE 2.0 codes (the "partial" relationship type), or where a NACE 2.1 class aggregates several predecessors
5. Exporting to a format your BI tool can join on

The first time, that's a 40-80 hour engineering effort. Every 6-12 months when a revision drops, it's 8-16 hours of maintenance.

## The openswissdata Classifications Bundle

[openswissdata.com/datasets/classifications](/datasets/classifications) ships all of the above in a single ZIP, CHF 399.

Inside:

```
classifications-2026.04.22/
├── noga_2008.csv              # 996 classes
├── noga_2025.csv              # 1 080 classes
├── nace_2_0.csv               # 996 classes (identical to noga_2008 except labels)
├── nace_2_1.csv               # 1 080 classes
├── isic_4.csv                 # 421 classes
├── nomenclatures.parquet      # all 5 above, combined, with scheme column
├── crosswalks.csv             # 5-way bridge, anchored on NOGA_2025 classes
├── crosswalks.json
├── crosswalks.parquet
├── schema.json
├── README.md
├── LICENSE.txt
└── checksums.sha256
```

Every row in `nomenclatures.parquet` carries:

- `scheme` — one of NOGA_2008, NOGA_2025, NACE_2.0, NACE_2.1, ISIC_4
- `code` — normalized (no dots)
- `level` — section | division | group | class | subclass
- `parent` — the immediate parent code in the same scheme
- `label_fr`, `label_de`, `label_it`, `label_en` — multilingual where available

And each row in `crosswalks.csv` carries:

- `noga_2008`, `noga_2025`, `nace_2_0`, `nace_2_1`, `isic_4` — five columns, one per standard
- `mapping_type` — exact, partial, aggregated, or derived
- `notes` — human-readable disambiguation

## A real reporting pipeline, in Python

Say you have a table of customers, each tagged with a NOGA 2008 code (because that's what your CRM was set up with in 2015), and you need to produce a NACE 2.1 and ISIC 4 view for consolidation.

```python
import pandas as pd

# Load the bundle
customers = pd.read_csv("customers.csv", dtype={"noga_2008": str})
walks = pd.read_csv("./classifications-2026.04.22/crosswalks.csv", dtype=str, keep_default_na=False)

# Left-join to resolve NACE 2.1 + ISIC 4
enriched = customers.merge(
    walks[["noga_2008", "nace_2_1", "isic_4", "mapping_type"]],
    on="noga_2008",
    how="left",
)

# Flag rows with partial mappings for manual review
ambiguous = enriched[enriched["mapping_type"] == "partial"]
if len(ambiguous) > 0:
    print(f"{len(ambiguous)} customers have partial mappings — review needed")
    ambiguous[["customer_id", "noga_2008", "nace_2_1"]].to_csv("review.csv", index=False)

# Export the clean view
enriched.groupby("nace_2_1").agg(
    customer_count=("customer_id", "count"),
    revenue=("revenue", "sum"),
).to_csv("sector_report_nace21.csv")
```

That's it. Eight lines of data manipulation, plus a review export for the ambiguous 5-10% that will always exist in multi-standard mapping.

## Why we anchor on NOGA 2025 classes

A subtle design decision in our cross-walks: the table is **anchored on NOGA_2025 class codes**. Every row's `noga_2025` field is non-null. Every other field may be null if the bridge doesn't resolve.

Why? Because NOGA 2025 is the most granular of the five for Swiss business, and most Swiss users enter the bundle from that direction. If you need the reverse (anchor on ISIC 4 and traverse backward), it's a simple `GROUP BY isic_4` — but by default, we assume the question is "given a Swiss company classified in NOGA 2025, what's its NACE / ISIC equivalent".

## The partial-mapping problem explained

Every multi-standard classification bridge has a dirty secret: some relationships are many-to-many. When BFS introduced NOGA 2025, it split several classes that existed in NOGA 2008, aligning the Swiss nomenclature with the more granular NACE 2.1.

For example, one former NOGA 2008 class covering "retail sale of telecommunications equipment" was divided in 2025 into two NOGA 2025 subclasses — one for phones, one for accessories. The NACE 2.0 → NACE 2.1 bridge marks these as "partial" because the old code maps to two new ones with no 1:1 correspondence.

What this means for you: if 3% of your customer portfolio sits in these split categories, your cross-walk will return two rows per customer rather than one. You need to decide, as a business, which NACE 2.1 code applies to each specific customer — no reference table can make that call for you.

The `mapping_type` field in our cross-walks lets you identify these cases programmatically:

- `exact` — one-to-one, safe to join without review
- `partial` — one-to-many split; manual assignment required
- `aggregated` — many-to-one merge; safe but loses granularity
- `derived` — cross-standard inference (NACE → ISIC) where no direct bridge exists

In practice, 80-85% of codes are `exact`. The `partial` and `aggregated` cases cluster in retail, services, and new economy sectors — precisely where new industries have emerged since the last major revision.

## Credit risk applications

Beyond sectoral reporting, classification bundles matter in credit risk. Swiss banks and insurance companies do sector-level exposure analysis, often requiring all four classification codes simultaneously — NOGA 2025 for the Swiss statutory view, NACE for comparison with EU sector benchmarks, ISIC for cross-border group consolidation.

If your risk data warehouse was built pre-2025, it's likely structured around NOGA 2008 codes. The January 2025 revision creates a direct migration pressure: all new counterparties will come in with NOGA 2025 codes, while historical data uses 2008 codes. Without a maintained cross-walk, your sector exposure reports will have systematic holes in the new categories.

The bundle handles this directly: the `nomenclatures.parquet` file carries both NOGA 2008 and NOGA 2025 codes in the same schema, with the same `parent` chain. You can build a reporting layer that handles both vintages without a separate reconciliation step.

## ESG sector classification

One more use case that's grown in importance: ESG sector scoring. Credit risk teams at Swiss banks increasingly need to tag counterparties with NACE sector codes for CSRD alignment and for the EU Taxonomy sector thresholds. The EU Taxonomy uses NACE codes as its primary sector filter (which activities are eligible for taxonomy alignment), so having a clean NOGA 2025 → NACE 2.1 mapping is a prerequisite for any Swiss company doing EU Taxonomy reporting.

For Swiss companies that don't have a NACE code in their CRM (because Swiss entities are natively classified in NOGA, not NACE), the cross-walk from this bundle is the fastest path to NACE coverage at scale.

## Update cadence

We refresh the bundle when any upstream standard is revised:

- NOGA: every 7-10 years (major revisions)
- NACE: similar cadence
- ISIC: every 10-15 years

Between major revisions, we also refresh for label corrections (sometimes BFS publishes an erratum) and for clarifications in the cross-walks. In practice: 1-2 refreshes per year, plus whatever happens the year a major revision drops.

The 360-day updates included with each purchase cover this cadence comfortably. Renewal is CHF 160/year.

## Sample before you buy

A 50-row cross-section is at [/samples/classifications-sample.csv](/samples/classifications-sample.csv). Try joining it against your own customer master — you'll know within 10 minutes whether the data shape fits your BI tool.

## A word on what this isn't

We don't offer fuzzy classification (entity name → NOGA code). That's a separate ML problem — classification.codes and a few specialized vendors handle it, with mixed quality. Our bundle is a reference table, not a classifier. It assumes you already know the code.

If you need help deciding which NOGA 2025 code to assign to a specific activity, the BFS explanatory notes (available free of charge on bfs.admin.ch) are the authoritative guidance. Our bundle adds structured access and the cross-walk; it doesn't replace domain judgement on classification decisions.

## Buy the bundle

[/datasets/classifications](/datasets/classifications) — CHF 399 one-off, 360 days of updates included. Or grab the [full 3-dataset bundle](/bundle) at CHF 799 for Classifications + TARES + FINMA.
