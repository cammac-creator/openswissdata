"""Synchronous quickstart against the live MCP endpoint.

Usage::

    OPENSWISSDATA_API_KEY=sk_live_... python examples/basic.py

Without the env var the client runs anonymously (free tier ~100 req/day).
"""

from __future__ import annotations

import os

from openswissdata import Client, RateLimitError


def main() -> int:
    with Client(api_key=os.environ.get("OPENSWISSDATA_API_KEY")) as client:
        # 1. TARES exact lookup
        print("=== TARES lookup ===")
        tariff = client.tares.lookup(hs8="84620010", lang="fr")
        print(f"HS8 {tariff['hs8']} — {tariff['designation']}")
        print(
            f"MFN duty: {tariff['duty_mfn']['value']} {tariff['duty_mfn']['unit'] or ''}".strip()
        )
        print(f"({tariff['disclaimer'][:80]}...)")

        # 2. TARES semantic search
        print("\n=== TARES semantic search ===")
        for hit in client.tares.search(query="couteau de cuisine", top_k=3)["hits"]:
            print(f"  {hit['score']:.2f}  HS {hit['hs_code']}  {hit['description']}")

        # 3. Crosswalk
        print("\n=== Crosswalk ===")
        cw = client.classifications.cross_walk(
            code="62.01", source="NACE_2.0", target="NOGA_2025"
        )
        for m in cw["mappings"]:
            print(f"  {cw['source_code']} → {m['target_code']}  ({m['mapping_type']})")

        # 4. Free-text classification
        print("\n=== Classify text ===")
        cls = client.classifications.classify_text(
            text="vente de café en grain et torréfaction", top_k=3
        )
        for h in cls["hits"]:
            print(f"  {h['score']:.2f}  {h['code']}  {h['label_fr']}")

        # 5. FINMA fuzzy search
        print("\n=== FINMA fuzzy search ===")
        fr = client.finma.search(name="Cred Suisse", top_k=3)
        for h in fr["hits"]:
            print(f"  {h['score']:.2f}  {h['name']}  ({h['licence_type']})")

        if client.last_rate_limit.remaining is not None:
            print(
                f"\nRemaining: {client.last_rate_limit.remaining}/"
                f"{client.last_rate_limit.limit}"
            )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RateLimitError as e:
        print(f"Rate limited — retry after {e.retry_after_seconds}s")
        raise SystemExit(2) from e
