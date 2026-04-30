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

## Embeddings (Phase 1 / T1)

Pre-computed multilingual semantic vectors are shipped in `tares_embeddings.parquet`
inside every TARES bundle from version 2026.04.30 onwards.

### Why we ship them
An AI agent that scrapes the customs tariff at session boot cannot afford to recompute
~30k embeddings (would take minutes on CPU, requires a model download). Pre-baking the
vectors lets the buyer do `cosine(query_emb, tares_emb)` instantly, with whatever runtime
they prefer (numpy, FAISS, pgvector, DuckDB, Polars).

### Model
- Identifier: `Xenova/paraphrase-multilingual-mpnet-base-v2`
  (ONNX port of `sentence-transformers/paraphrase-multilingual-mpnet-base-v2`, Apache-2.0)
- Dimensions: **768**
- Pooling: mean pooling on last hidden state
- Normalization: L2-normalized — cosine similarity reduces to a dot product
- Languages: trained on 50+ languages, covers DE/FR/IT/EN natively

The model identifier and a stable version string are recorded **per row** in the
`model` and `model_version` columns. If we change the model in a future release,
old vectors stay distinguishable from new ones.

### Schema (`tares_embeddings.parquet`)

| Column          | Parquet type        | Notes                                                |
| --------------- | ------------------- | ---------------------------------------------------- |
| `hs_code`       | UTF8                | Joins to `tares.parquet#hs8` (string, 8 digits)      |
| `lang`          | UTF8                | One of `'fr'`, `'de'`, `'it'`, `'en'`                |
| `description`   | UTF8                | Source text that was embedded (verbatim)             |
| `embedding`     | REPEATED FLOAT (32) | Length = 768, L2-normalised                          |
| `model`         | UTF8                | `Xenova/paraphrase-multilingual-mpnet-base-v2`       |
| `model_version` | UTF8                | Stable tag, e.g. `…@2024-04`                         |

Volume: ~7 500 rows in v1 (FR only — Option C, fastest first cut). Future releases
will add `lang='de'`/`'it'`/`'en'` rows without breaking schema compatibility.

### Loading & querying (Python)

```python
import pandas as pd
import numpy as np

# 1. Load
df = pd.read_parquet("tares_embeddings.parquet")
emb = np.vstack(df["embedding"].to_numpy()).astype(np.float32)  # shape (N, 768)
hs  = df["hs_code"].to_numpy()
desc = df["description"].to_numpy()

# 2. Embed your query with the SAME model
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
q = model.encode("roulements à billes industriels", normalize_embeddings=True)

# 3. Cosine similarity (vectors are already L2-normalised → dot product)
scores = emb @ q
top = np.argsort(-scores)[:5]
for i in top:
    print(f"{hs[i]} ({scores[i]:.3f}) — {desc[i]}")
```

### Loading & querying with FAISS (faster on >100k vectors)

```python
import faiss
index = faiss.IndexFlatIP(768)   # inner product == cosine on normalised vectors
index.add(emb)
D, I = index.search(q.reshape(1, -1), k=5)
for s, i in zip(D[0], I[0]):
    print(f"{hs[i]} ({s:.3f}) — {desc[i]}")
```

### Sanity check
After loading, verify two related codes are close:
- `84820010` "Roulements à billes" vs `84820090` "Autres roulements" → cosine ≥ 0.7
- `84820010` "Roulements à billes" vs `22030001` "Bières en bouteilles" → cosine < 0.2

The provenance manifest covers `tares_embeddings.parquet` like every other shipped
file, so any tampering breaks the Ed25519 signature.
