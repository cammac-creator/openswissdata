# Swiss Economic Classifications Bundle — version 2026.04.29-test

Normalized economic activity classifications for Swiss and international reporting:

- **NOGA 2008** — 1790 rows
- **NOGA 2025** — 1845 rows
- **NACE Rev 2** (2.0) — 1047 rows
- **NACE Rev 2.1** — 1047 rows
- **ISIC Rev 4** — 766 rows
- **Cross-walks** — 2177 mappings (5-way NOGA↔NACE↔ISIC)

## Files

### Per scheme (CSV/JSON/SQL)

- `noga_2008.{csv,json,sql}`
- `noga_2025.{csv,json,sql}`
- `nace_2_0.{csv,json,sql}`
- `nace_2_1.{csv,json,sql}`
- `isic_4.{csv,json,sql}`

### Combined (Parquet)

- `nomenclatures.parquet` — all 5 schemes in one file with a `scheme` column

### Cross-walks

- `crosswalks.{csv,json,sql,parquet}` — one row per NOGA 2025 class linking to the 4 other standards

### Metadata

- `schema.json` — JSON Schema (Draft-07)
- `checksums.sha256`
- `provenance.json` — Ed25519-signed manifest + RFC-3161 timestamp (verify with `npx tsx etl/shared/verify-provenance.ts <zip>`; public key at `packages/schemas/openswissdata.pubkey.ed25519`)
- `LICENSE.txt`
- `README.md` (this file)

## Sources

- **NOGA** — Federal Statistical Office (BFS/OFS), Switzerland. https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html
- **NACE** — Eurostat Ramon. https://ec.europa.eu/eurostat/ramon/
- **ISIC** — United Nations Statistics Division. https://unstats.un.org/unsd/classifications/Econ/isic

## Mapping principle

- NOGA 2025 codes are identical to NACE Rev 2.1 at the class level (4-digit).
- NOGA 2008 codes are identical to NACE Rev 2.0 at the class level.
- The explicit bridges are NACE 2.0 ↔ 2.1 (Eurostat) and NACE 2.1 ↔ ISIC 4 (UN Stats).
- Cross-walks are anchored on NOGA 2025 classes. One NOGA 2025 class can produce multiple cross-walk rows if several NACE 2.0 or ISIC 4 codes match.

## Dataset metadata

- Bundle version: 2026.04.29-test
- Generated: 2026-04-30T09:30:28.579Z
