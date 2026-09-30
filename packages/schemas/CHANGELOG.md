# Changelog

## 2026-09-30 — correction

`finma.schema.json`'s `entity_type` enum no longer lists `sro_member`. That
value was never populated by production ingestion (FINMA never published a
"SRO members" list at the URL this project used to reference; the daily
`uid.csv` mapping never produced it either): every archive shipped it as an
always-empty category. The enum also gained `fintech`, `infrastructure` and
`other`, which production has emitted since the switch to `uid.csv` ingestion
but which this static reference file never listed — a pre-existing gap found
while fixing the `sro_member` issue, unrelated to it. The v1.0.0 entry below,
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
