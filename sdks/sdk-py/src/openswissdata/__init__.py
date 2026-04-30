"""openswissdata — Official Python SDK for openswissdata.com.

Quickstart
----------

Synchronous::

    from openswissdata import Client

    client = Client(api_key="sk_live_...")
    row = client.tares.lookup(hs8="84620010", lang="fr")
    print(row["designation"], row["disclaimer"])

Asynchronous::

    import asyncio
    from openswissdata import AsyncClient

    async def main():
        async with AsyncClient(api_key="sk_live_...") as client:
            row = await client.tares.lookup(hs8="84620010")
            print(row["designation"])

    asyncio.run(main())
"""

from .client import Client
from .async_client import AsyncClient
from .exceptions import (
    AuthError,
    NetworkError,
    OpenSwissDataError,
    RateLimitError,
    ServerError,
    ToolError,
)

__version__ = "0.1.0"

__all__ = [
    "AsyncClient",
    "AuthError",
    "Client",
    "NetworkError",
    "OpenSwissDataError",
    "RateLimitError",
    "ServerError",
    "ToolError",
    "__version__",
]
