"""pandas integration — turn a list of HS8 codes into a tidy DataFrame.

Requires the optional ``pandas`` extra::

    pip install "openswissdata[pandas]"

Usage::

    python examples/pandas_integration.py
"""

from __future__ import annotations

import os
from typing import Any

import pandas as pd

from openswissdata import Client


def lookup_batch(client: Client, hs8_codes: list[str]) -> pd.DataFrame:
    """Run `tariff_lookup` for each HS8 and return one row per code.

    Failed lookups are dropped from the resulting DataFrame; a warning is
    printed instead. The disclaimer column is preserved so downstream
    consumers can surface it.
    """
    rows: list[dict[str, Any]] = []
    for hs8 in hs8_codes:
        try:
            r = client.tares.lookup(hs8=hs8, lang="fr")
        except Exception as e:
            print(f"  [skip] {hs8}: {e}")
            continue
        rows.append(
            {
                "hs8": r["hs8"],
                "designation_fr": r["designations_all"]["fr"],
                "designation_en": r["designations_all"]["en"],
                "duty_value": r["duty_mfn"]["value"],
                "duty_unit": r["duty_mfn"]["unit"],
                "valid_from": r["valid_from"],
                "disclaimer": r["disclaimer"],
            }
        )
    return pd.DataFrame.from_records(rows)


def main() -> None:
    codes = ["84620010", "82119100", "01051200"]
    with Client(api_key=os.environ.get("OPENSWISSDATA_API_KEY")) as client:
        df = lookup_batch(client, codes)
    if df.empty:
        print("No rows.")
        return
    print(df[["hs8", "designation_fr", "duty_value", "duty_unit", "valid_from"]])


if __name__ == "__main__":
    main()
