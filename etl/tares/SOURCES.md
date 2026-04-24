# TARES data sources

## Upstream

- Main portal: https://xtares.admin.ch/tares/ (web UI only, no public API)
- Tariff general PDF: https://www.bazg.admin.ch/ (search "tarif des douanes")
- Update cadence: continuous (changes announced BAZG)
- Source authority: Federal Office for Customs and Border Security (FOCBS / BAZG)

## Scraping policy (for Task 2.4)

- User-Agent: `openswissdata/0.1 (+contact:contact@openswissdata.com)`
- Rate limit: 1 request per second, sequential only
- Persist raw HTML to `data/tares/raw/` for crash recovery
- License: raw data not copyrighted in Switzerland (opendata.swiss ToU)
  — permission email sent 2026-04-17

## Fixture sample

`fixtures/sample-5-rows.json` contains 5 hand-curated rows covering:
- ball bearings (industrial, standard tariff)
- expandable polystyrene (with REACH restriction)
- beer in bottles (with alcohol tax)
- sports footwear (with preferential regimes differentials)
- MRI (medical device restriction)

Used for development + tests until Task 2.4 implements real scraping.
