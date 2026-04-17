# FINMA data sources

## Upstream

FINMA publishes ~10 separate XLSX files at https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/.
Each list has its own schema. This project normalizes all 10 into a unified `FinmaEntity` schema.

## Update cadence

Continuous — FINMA updates the XLSX files whenever licences are granted, withdrawn, or modified. We re-ingest weekly.

## Licence

FINMA data is public. Email of permission sent 2026-04-17 (see `docs/legal-correspondence.md`).

## Sources covered

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

4 synthetic fixtures materialized by `fixtures/generate-fixture.ts` cover Banks / PSP / Insurance / Asset Managers. Real ingestion will use the full 10 lists once downloaded.
