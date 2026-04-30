"""Asynchronous parallel-fetch demo.

Fires three independent calls concurrently with ``asyncio.gather`` to show
the AsyncClient in a realistic setting (e.g. classifying a batch of company
descriptions while looking up a tariff)."""

from __future__ import annotations

import asyncio
import os

from openswissdata import AsyncClient


async def main() -> None:
    async with AsyncClient(api_key=os.environ.get("OPENSWISSDATA_API_KEY")) as client:
        tariff_task = client.tares.lookup(hs8="84620010")
        cls_task = client.classifications.classify_text(
            text="vente de café en grain", top_k=3
        )
        fr_task = client.finma.search(name="UBS", top_k=3)

        tariff, cls, fr = await asyncio.gather(tariff_task, cls_task, fr_task)

        print("HS8:", tariff["hs8"], "-", tariff["designation"])
        print("Top NOGA:", cls["hits"][0]["code"], cls["hits"][0]["label_fr"])
        print("Top FINMA match:", fr["matches"][0]["name"])


if __name__ == "__main__":
    asyncio.run(main())
