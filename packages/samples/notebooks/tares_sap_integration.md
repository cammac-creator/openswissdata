# TARES → SAP GTS integration

Load the TARES dataset and map it into an SAP GTS-compatible structure.

## Requirements

- Python 3.9+
- `pandas`
- `openswissdata` SDK

## Setup

```bash
pip install openswissdata
```

Download the TARES bundle from openswissdata.com, unzip into a local folder.

## Code

```python
from openswissdata.tares import load_tares

df = load_tares("./tares-2026.04.22/tares.csv")

# Filter to a specific chapter (e.g. 84 — nuclear reactors, boilers, machinery)
ch84 = df[df["chapter"] == "84"]
print(f"{len(ch84)} codes in chapter 84")

# Pivot to SAP GTS format (example columns)
sap_df = ch84.rename(columns={
    "hs8": "COMMODITY_CODE",
    "designation_de": "DESCRIPTION_DE",
    "designation_fr": "DESCRIPTION_FR",
    "designation_en": "DESCRIPTION_EN",
    "valid_from": "VALID_FROM",
})[["COMMODITY_CODE", "DESCRIPTION_DE", "DESCRIPTION_FR", "DESCRIPTION_EN", "VALID_FROM"]]

# Export for SAP upload
sap_df.to_csv("./sap_gts_upload.csv", index=False, sep=";")
```

## Notes

- The TARES dataset is covered by BAZG approval 2026-04-21 with conditions (see LICENSE.txt in the bundle).
- SAP GTS requires specific column names and formats — adjust the rename map to match your GTS profile.
