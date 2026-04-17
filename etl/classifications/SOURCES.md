# Classifications data sources

## Official sources (download manually into data/classifications/raw/)

- **NOGA 2008** — https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html
- **NOGA 2025** (released Jan 2025) — same portal, "NOGA 2025 — Nomenclature générale des activités économiques"
- **NACE Rev 2** — https://ec.europa.eu/eurostat/ramon/nomenclatures/index.cfm?TargetUrl=LST_NOM&StrGroupCode=CLASSIFIC (search "NACE Rev. 2")
- **NACE Rev 2.1** — same Ramon portal
- **ISIC Rev 4** — https://unstats.un.org/unsd/classifications/Econ/isic

## Bridges

- **NOGA 2008 → NOGA 2025** — BFS nomenclatures portal (part of NOGA 2025 release)
- **NACE Rev 2 → Rev 2.1** — Eurostat Ramon
- **NACE → ISIC** — Eurostat + UN Stats (official correspondence tables)

## License

Raw data is not copyrighted in CH (opendata.swiss ToU). Permission email to BFS sent 2026-04-17. Source attribution mandatory in README.

## Column conventions

BFS publishes NOGA as XLSX with columns like:
- `Code` (e.g. `64`, `64.1`, `6412`)
- `Titre français` / `Titel deutsch` / `Titolo italiano`
- Sometimes an English column or explanatory notes

Our parser tolerates variations in header spelling via substring matching.

## Testing

`etl/classifications/fixtures/generate-fixture.ts` generates synthetic NOGA XLSX fixtures for CI without needing the real BFS files.
