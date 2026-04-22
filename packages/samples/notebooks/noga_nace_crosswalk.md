# Classifications cross-walk: NOGA 2008 → NACE 2.1 → ISIC 4

Given a Swiss company classified in NOGA 2008, resolve equivalents in NACE 2.1 (EU) and ISIC 4 (UN) for international reporting.

## Code

```python
from openswissdata.classifications import load_classifications, load_cross_walks

walks = load_cross_walks("./classifications-2026.04.22/crosswalks.csv")
all_noms = load_classifications("./classifications-2026.04.22/")

# Example: company classified as NOGA 2008 code 64.11 (central banking)
my_code = "6411"  # clean form (no dots)
matches = walks[walks["noga_2008"] == my_code]

for _, row in matches.iterrows():
    print(f"NOGA 2008: {row['noga_2008']} → NOGA 2025: {row['noga_2025']} → NACE 2.1: {row['nace_2_1']} → ISIC 4: {row['isic_4']} ({row['mapping_type']})")
```
