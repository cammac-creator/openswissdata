---
title: "Cross-checking counterparties against FINMA: a practical 30-minute playbook"
description: "How compliance and onboarding teams can automate Swiss counterparty verification against the unified FINMA registry, with PSD3 and FinSA 2026-2027 in mind."
publishedAt: 2026-04-22
keywords: ["FINMA", "PSD3", "FinSA", "Swiss compliance", "counterparty verification", "KYC"]
dataset: "finma"
tldr: "FINMA publishes 9 separate XLSX lists with drifting schemas. We unify them under a single CSV/JSON/Parquet schema with 16 columns including UID and LEI, refreshed daily via GitHub Actions cron. Skip 30 min of manual lookup per counterparty — buy the FINMA dataset (299 CHF) or the bundle (797 CHF, includes TARES + Classifications)."
---

If you run compliance or onboarding at a Swiss or EU fintech, you already know the shape of the problem. Before you wire funds, sign a merchant agreement, or onboard a new banking partner, you need to confirm the counterparty is actually licensed by FINMA for the activity they claim to perform.

The authoritative source is the FINMA Public register at https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/.

Open it. You'll find **10 separate lists**: banks, insurance companies, asset managers (collective and individual), securities firms, fund representatives, payment institutions, SRO members, supervisory organisations, insurance intermediaries.

Each list is a standalone XLSX download. Each list has a different schema. Column names drift slightly between releases. Some lists carry UID in `CHE-101.329.561` format, others strip the prefix. Licence dates are sometimes ISO, sometimes DD.MM.YYYY. Addresses are free text with no canton normalization.

So you want to know "is Sygnum Bank AG licensed by FINMA as a bank?" — and there's no single query you can run. You have to:

1. Know which of the 10 lists it should be in (banks)
2. Download that specific XLSX (today)
3. Parse the header layout (which may have changed)
4. Search for the exact name (case-sensitive? with accents? spaces normalized?)
5. Record the match (or non-match) against your audit log

For a one-off check, that's 5 minutes of clicking. For a batch of 500 counterparties at onboarding time, it's a full day of engineering work — and you'll redo it next month when FINMA publishes updates.

## The unified FINMA registry

[openswissdata.com/datasets/finma](/datasets/finma) publishes all 10 FINMA authorised-institutions lists unified under a single schema, CHF 299. The bundle ships as a ZIP with one canonical CSV (plus per-type CSVs for granular consumption):

```
finma-2026.04.22/
├── finma_registry.csv             # unified (all 10 types)
├── finma_registry.json
├── finma_registry.parquet
├── finma_registry.sql
├── finma_bank.csv                 # just banks
├── finma_payment_institution.csv  # just PSPs
├── finma_insurance.csv
├── finma_asset_manager_individual.csv
├── finma_asset_manager_collective.csv
├── finma_securities_firm.csv
├── finma_fund_representative.csv
├── finma_sro_member.csv
├── finma_supervisory_org.csv
├── finma_insurance_intermediary.csv
├── changelog_90d.csv              # additions, removals, status changes
├── schema.json
├── README.md
├── LICENSE.txt
└── checksums.sha256
```

Each row in the unified registry carries a consistent set of fields regardless of which source list it came from:

```
entity_type:   "bank" | "insurance" | "payment_institution" | ...
name:          "Sygnum Bank AG"
uid:           "CHE-387.648.322"      # canonical CHE-XXX.XXX.XXX format
lei:           "5067000000LEI01X00"   # from GLEIF (when available)
licence_type:  "bank" | "fintech licence" | "branch" | ...
licence_date:  "2019-08-27"           # ISO, always
status:        "active" | "withdrawn" | ...
canton:        "ZH"                   # 2-letter
address:       "Uetlibergstrasse 134a, 8045 Zürich"
source_list:   "finma-banks"
source_url:    "https://www.finma.ch/en/finma-public/..."
```

The `changelog_90d.csv` is the other critical deliverable. It tracks:

- **Additions**: new licences granted in the last 90 days
- **Removals**: licences withdrawn
- **Status changes**: active → suspended, etc.
- **Address changes**: moves between cantons
- **Licence type changes**: rare but material

## The 30-minute compliance pipeline

Given a table of counterparties with UIDs, here's how to automate the verification.

### Step 1. Join your CRM to the FINMA registry

```python
import pandas as pd

crm = pd.read_csv("your_counterparties.csv", dtype={"uid": str})
finma = pd.read_csv("./finma-2026.04.22/finma_registry.csv", dtype=str, keep_default_na=False)

# Normalize UIDs on your side too (strip dashes/dots just in case)
def normalize_uid(s):
    digits = "".join(c for c in s if c.isdigit())
    return f"CHE-{digits[:3]}.{digits[3:6]}.{digits[6:9]}"

crm["uid"] = crm["uid"].apply(normalize_uid)

joined = crm.merge(
    finma[["uid", "entity_type", "licence_type", "status", "canton"]],
    on="uid",
    how="left",
)

# Unmatched rows = not in FINMA registry
unmatched = joined[joined["entity_type"].isna()]
```

### Step 2. Classify the unmatched

Unmatched doesn't always mean unlicensed — it could mean the counterparty is an EU institution operating in Switzerland under an exemption, or a foreign entity you don't need FINMA authorisation for.

Split the unmatched into three buckets:

```python
eu_country_prefixes = ["DEU", "FRA", "ITA", "ESP", "NLD", "BEL", "AUT", "SWE"]

ch_unmatched = unmatched[unmatched["uid"].str.startswith("CHE")]
eu_unmatched = unmatched[unmatched["uid"].str[:3].isin(eu_country_prefixes)]
other_unmatched = unmatched[
    ~unmatched["uid"].str.startswith("CHE") &
    ~unmatched["uid"].str[:3].isin(eu_country_prefixes)
]
```

`ch_unmatched` is the list you escalate. A Swiss UID that's not in the FINMA registry for an activity that requires authorisation is a real compliance hit.

### Step 3. Track the delta

```python
delta = pd.read_csv("./finma-2026.04.22/changelog_90d.csv", dtype=str, keep_default_na=False)

# Did any of your active counterparties have a status change?
risky = joined.merge(delta, on="uid", how="inner")
if len(risky) > 0:
    print(f"{len(risky)} counterparties had FINMA status changes in the last 90 days:")
    print(risky[["name", "kind", "before", "after"]])
```

You now have a weekly cron job that flags any degradation in your counterparty portfolio against the authoritative source.

## Why this matters more in 2026-2027

Two regulatory tailwinds drive adoption of this pattern:

- **PSD3** (EU Payment Services Directive 3) expands counterparty due-diligence requirements across Europe, with specific provisions for cross-border CH-EU flows.
- **FinSA** (Swiss Financial Services Act) amendments continue to widen the scope of regulated activities, adding entity types to the FINMA register each year.

Both regulations reward structured, programmatic counterparty verification and penalize manual, email-based onboarding. The firms that can demonstrate a weekly-refreshed registry audit trail will pass inspections faster; the firms doing it manually will get slowed down.

## A note on name-matching vs UID-matching

The pipeline above assumes you have UIDs in your CRM. If you only have entity names, the matching problem is harder. Swiss company names change (legal form conversions, mergers), contain diacritics, abbreviate inconsistently (AG vs. SA vs. Ltd), and sometimes include trading names that differ from the legal name in the register.

Our bundle includes a `name_variants` column that captures known aliases — "UBS AG" also appears as "UBS Switzerland AG" in some contexts, for example. But for serious name-matching at scale, you'll want to combine our bundle with a fuzzy-match library (rapidfuzz in Python, fuse.js in Node) and run a similarity threshold test.

The recommended approach for new onboarding is: require the UID as part of your onboarding form. Most Swiss entities know their UID; it's on their letterhead. Collecting it at entry eliminates the name-matching problem entirely.

## LEI enrichment

Roughly 40% of FINMA-registered institutions also have a Legal Entity Identifier (LEI) issued by GLEIF. We cross-reference the FINMA UID against the GLEIF golden copy weekly and populate the `lei` field where a match exists.

This is particularly useful for:

- **SWIFT/ISO 20022 payments**: LEI is increasingly required in the creditor agent field for cross-border payments above certain thresholds
- **CSRD reporting**: The Corporate Sustainability Reporting Directive uses LEI as the canonical counterparty identifier in supply chain disclosures
- **Derivative reporting**: EMIR and its Swiss equivalent (FMIA) require LEI for trade repository submissions

For the 60% of FINMA entities without a LEI, the `lei` field is null — not empty string, null — so it's unambiguous in your SQL queries.

## Operational security around the bundle

A few teams have asked about storing the FINMA registry internally versus re-downloading on each run. Our recommendation:

**Download once per week, on a fixed schedule.** Store the ZIP in your secure data lake with the version date in the filename. This gives you a reproducible audit trail — if a regulator asks "what did you know about counterparty X on date Y?", you can replay the exact registry snapshot from that week.

Don't rely on in-memory downloads during onboarding API calls. The latency and failure modes of just-in-time downloads are not appropriate for a compliance workflow. Cache it.

The `checksums.sha256` file lets you verify integrity without re-downloading when you're unsure whether your stored copy has been tampered with.

## Suspended vs. withdrawn: an important distinction

The FINMA registry uses several status codes that have different compliance implications:

- **Active**: licensed, in good standing
- **Suspended**: licence temporarily suspended (e.g., for investigation). This is a red flag — halt onboarding immediately
- **Withdrawn**: licence surrendered voluntarily (often because the entity merged, restructured, or ceased the regulated activity). Less urgent, but you should understand why
- **Revoked**: forcibly removed by FINMA enforcement. This is a serious risk signal — check for public FINMA enforcement notices

The `changelog_90d.csv` captures transitions between these states. A counterparty that moves from `active` to `suspended` between two of your weekly checks will appear in the delta as a `status_change` row with `before: active, after: suspended`. That's the signal you want to catch before you process their next payment.

## Update cadence

FINMA updates the XLSX files continuously (licences granted, withdrawn, or modified). openswissdata re-ingests weekly and publishes a new versioned bundle. The 90-day changelog makes it trivial to spot material changes in your portfolio.

Included in the CHF 299 one-off: 360 days of updates. Renewal CHF 120/year.

## Building a compliance audit trail

One requirement that regulators increasingly inspect is the **audit trail** for each counterparty verification decision. It's not enough to say "we checked FINMA." You need to show *when* you checked, *which version* of the registry you used, and *what result you got*.

A practical pattern: store the `source_url` and the bundle version date alongside your CRM record each time you run the join. When an examiner asks "did you verify that XY Bank AG was licensed on 14 January 2026?", you can pull up the registry snapshot from that week and replay the lookup. No ambiguity, no "we think we checked."

This is the kind of concrete, documentable process that moves an audit from a multi-day review to a half-hour walk-through.

## Try the sample

[/samples/finma-sample.csv](/samples/finma-sample.csv) — 15 rows across 4 entity types. Try joining it against a subset of your counterparty master to see the fit.

## Buy the bundle

[/datasets/finma](/datasets/finma) — CHF 299 · or the [full bundle](/bundle) at CHF 797 for FINMA + Classifications + TARES together.

A final word: this dataset is derived from FINMA's public register, which FINMA itself does not endorse, certify, or support for third-party redistribution. Our bundle adds format, normalization, and delta tracking; the authoritative source remains https://www.finma.ch/ and we link back to it on every row via the `source_url` field. Use accordingly.
