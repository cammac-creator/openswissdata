# FINMA counterparty audit

Cross-check a list of Swiss counterparties (by UID or name) against the FINMA authorised institutions registry.

## Code

```python
import pandas as pd
from openswissdata.finma import load_finma_registry

finma = load_finma_registry("./finma-2026.04.22/finma_registry.csv")

# Your internal counterparties (example)
my_counterparties = pd.DataFrame([
    {"name": "UBS Switzerland AG", "uid": "CHE-101.329.561"},
    {"name": "Acme Finance AG", "uid": "CHE-999.999.999"},
])

# Match by UID
merged = my_counterparties.merge(
    finma,
    how="left",
    left_on="uid",
    right_on="uid",
    suffixes=("_internal", "_finma"),
)

# Flag unmatched
unmatched = merged[merged["entity_type"].isna()]
print(f"{len(unmatched)} counterparties NOT found in FINMA registry — flag for review:")
print(unmatched[["name_internal", "uid"]])
```
