# openswissdata

[![PyPI](https://img.shields.io/pypi/v/openswissdata.svg)](https://pypi.org/project/openswissdata/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

Official Python SDK for [openswissdata.com](https://openswissdata.com) — Swiss customs (TARES), economic classifications (NOGA / NACE / ISIC) and the FINMA registry of supervised entities.

Ships sync (`Client`) and async (`AsyncClient`) flavours on top of [httpx](https://www.python-httpx.org/), with optional pandas helpers and a small CLI (`python -m openswissdata`).

## Install

```bash
pip install openswissdata
# or with pandas helpers:
pip install "openswissdata[pandas]"
```

## Quickstart

```python
from openswissdata import Client

with Client(api_key="sk_live_...") as client:
    row = client.tares.lookup(hs8="84620010", lang="fr")
    print(row["designation"], row["duty_mfn"]["value"])
    print(row["disclaimer"])  # always surface to end users
```

Async:

```python
import asyncio
from openswissdata import AsyncClient

async def main():
    async with AsyncClient(api_key="sk_live_...") as client:
        r = await client.tares.lookup(hs8="84620010")
        print(r["designation"])

asyncio.run(main())
```

## Datasets

### TARES — Swiss customs tariffs

```python
client.tares.lookup(hs8="84620010", lang="fr")
client.tares.search(query="couteau de cuisine", top_k=5)
client.tares.changelog(hs8="84620010", since="2025-01-01")
```

### Classifications — NOGA / NACE / ISIC

```python
client.classifications.cross_walk(code="62.01", source="NACE_2.0", target="NOGA_2025")
client.classifications.classify_text(text="vente de café en grain", top_k=3)
```

### FINMA — supervised entities + warnings

```python
client.finma.kyc_check(name="UBS", top_k=10)
client.finma.search(name="Cred Suisse", include_warnings=True)
client.finma.entity_history(uid="CHE-103.137.179")
```

## CLI

The package installs an `openswissdata` command (also reachable as `python -m openswissdata`):

```bash
$ openswissdata --help
$ openswissdata tariff-lookup 84620010 --lang fr
$ openswissdata crosswalk 62.01 --source NACE_2.0 --target NOGA_2025
$ openswissdata finma-search "Cred Suisse" --top-k 5 --warnings
```

## Authentication

| Tier        | How                                              | Limits                          |
| ----------- | ------------------------------------------------ | ------------------------------- |
| Anonymous   | `Client()` (no key)                              | ~100 req/day per IP, V1 tools   |
| Bearer      | `Client(api_key="sk_live_...")` or env var       | Plan-dependent                  |
| OAuth 2.1   | Token issued via `/oauth/*` endpoints            | All tools, scope-checked        |

## Error handling

```python
from openswissdata import (
    Client,
    AuthError,
    RateLimitError,
    ServerError,
    NetworkError,
    ToolError,
)

try:
    client.tares.lookup(hs8="00000000")
except RateLimitError as e:
    print(e.retry_after_seconds, e.remaining, e.limit)
except AuthError:
    ...
except ToolError as e:
    print(e.tool, e)
except ServerError:
    ...
except NetworkError:
    ...
```

The client retries 5xx and network errors with exponential backoff + jitter (default 3 attempts, 250ms initial). Set `max_retries=0` to disable.

## Configuration

```python
Client(
    api_key="sk_live_...",                     # optional
    base_url="https://mcp.openswissdata.com",  # override for staging / self-host
    timeout=30.0,
    max_retries=3,
    retry_backoff=0.25,
    user_agent="my-app/1.0",                   # appended to the SDK UA
)
```

## pandas

```python
import pandas as pd
from openswissdata import Client

with Client() as client:
    rows = [client.tares.lookup(hs8=h) for h in ["84620010", "82119100"]]
df = pd.json_normalize(rows)
print(df[["hs8", "designation", "duty_mfn.value"]])
```

A fuller example is in [`examples/pandas_integration.py`](./examples/pandas_integration.py).

## Disclaimers

OpenSwissData is a non-official mirror of public Swiss government datasets. TARES results carry a mandatory disclaimer (`row["disclaimer"]`) that you **MUST** surface to your end users. For final customs, classification and FINMA decisions always check the source linked in `source_url`.

## Development

```bash
pip install -e ".[dev]"
pytest -q
ruff check .
mypy src
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
