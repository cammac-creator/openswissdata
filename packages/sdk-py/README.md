# openswissdata

Python SDK for working with datasets from [openswissdata.com](https://openswissdata.com).

## Install

```bash
pip install openswissdata
```

## Usage

### Load TARES

```python
from openswissdata.tares import load_tares
rows = load_tares("./tares-2026.04.22/tares.csv")
print(len(rows), "codes loaded")
```

### Load Classifications with cross-walks

```python
from openswissdata.classifications import load_classifications, load_cross_walks
nomenclatures = load_classifications("./classifications-2026.04.22/")
walks = load_cross_walks("./classifications-2026.04.22/crosswalks.csv")
```

### Load FINMA registry

```python
from openswissdata.finma import load_finma_registry
df = load_finma_registry("./finma-2026.04.22/finma_registry.csv")
banks = df[df["entity_type"] == "bank"]
print(len(banks), "banks in the registry")
```

## Buying datasets

The SDK is free and open-source. The datasets themselves are sold at https://openswissdata.com.
- TARES: CHF 299 · Classifications Bundle: CHF 399 · FINMA Registry: CHF 299 · Full Bundle: CHF 799.

## License

Apache 2.0
