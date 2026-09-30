# Changelog

## 2026-09-30: supervisory organisation of portfolio managers and trustees

`finma.schema.json` gains three optional properties:
`supervisory_organisation`, `supervisory_organisation_source_url` and
`supervisory_organisation_observed_on`. For rows whose licence type is
"Portfolio manager" or "Trustee", `supervisory_organisation` gives the
supervisory organisation that supervises the institution under the Financial
Institutions Act (FinIA), copied verbatim from FINMA's list `vvtr.xlsx`. It is
not a self-regulatory organisation (SRO) affiliation under the Anti-Money
Laundering Act (AMLA). The value is set only when name and city are identical
(Unicode NFC and whitespace normalised; case, punctuation and legal form kept),
the match is unique, carries a single UID and the same licence type; otherwise
the field stays empty. Archives also ship two reference tables with their own
schemas (`schema_reference_sros.json`, `schema_reference_supervisory_organisations.json`):
FINMA's lists of recognised SROs (`sro.xlsx`) and authorised supervisory
organisations (`ao.xlsx`), limited to name, address and website (no e-mail
addresses or phone numbers, no member lists). See `etl/finma/SOURCES.md`.

## 2026-09-30: correction

`finma.schema.json`'s `entity_type` enum no longer lists `sro_member`. That
value was never populated by production ingestion (FINMA never published a
"SRO members" list at the URL this project used to reference; the daily
`uid.csv` mapping never produced it either): every archive shipped it as an
always-empty category. The enum also gained `fintech`, `infrastructure` and
`other`, which production has emitted since the switch to `uid.csv` ingestion
but which this static reference file never listed. This is a pre-existing
gap, found while fixing the `sro_member` issue but unrelated to it. The v1.0.0 entry below,
which described the FINMA schema as covering "10 source lists", is left
unchanged as a historical record of what was announced at the time; it does
not reflect the current enum. See `etl/finma/SOURCES.md` and
`docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md`.

## v1.0.0 — 2026-04-22

Initial public release of schemas for:
- TARES (Swiss customs tariff, HS8)
- Classifications (NOGA / NACE / ISIC with cross-walks)
- FINMA registry (unified 10 source lists)

Schemas track the 2026-04-22 bundles of the same datasets.
