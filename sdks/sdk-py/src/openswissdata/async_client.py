"""Asynchronous client for the openswissdata MCP JSON-RPC endpoint.

Mirrors :mod:`openswissdata.client` but on top of ``httpx.AsyncClient`` so it
can be awaited inside an asyncio event loop.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx

from ._constants import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_BACKOFF_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    RETRYABLE_STATUS,
)
from .client import _BaseClient
from .exceptions import (
    AuthError,
    NetworkError,
    RateLimitError,
    ServerError,
)


class AsyncClient(_BaseClient):
    """Asyncio-flavoured client.

    Use as an async context manager so the underlying httpx client is closed
    cleanly::

        async with AsyncClient(api_key="...") as client:
            row = await client.tares.lookup(hs8="84620010")
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_backoff: float = DEFAULT_RETRY_BACKOFF_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
        user_agent: str | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            retry_backoff=retry_backoff,
            user_agent=user_agent,
        )
        self._http = httpx.AsyncClient(
            timeout=timeout, transport=transport, follow_redirects=True
        )
        self.tares = AsyncTaresAPI(self)
        self.classifications = AsyncClassificationsAPI(self)
        self.finma = AsyncFinmaAPI(self)

    async def __aenter__(self) -> AsyncClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # -- HTTP plumbing ------------------------------------------------------

    async def _request(self, method: str, url: str, *, json: Any = None) -> httpx.Response:
        attempt = 0
        last_error: Exception | None = None
        while attempt <= self.max_retries:
            try:
                response = await self._http.request(
                    method, url, json=json, headers=self._headers()
                )
            except httpx.RequestError as e:
                last_error = e
                if attempt >= self.max_retries:
                    raise NetworkError(
                        f"Network error after {attempt} retries: {e}"
                    ) from e
                attempt += 1
                await asyncio.sleep(self._backoff(attempt))
                continue

            self._capture_rate_limit(response)

            if response.is_success:
                return response

            body = response.text
            if response.status_code in (401, 403):
                raise AuthError(
                    f"Authentication failed ({response.status_code}): {body}",
                    code=response.status_code,
                )
            if response.status_code == 429:
                raise self._build_rate_limit_error(response, body)
            if response.status_code in RETRYABLE_STATUS and attempt < self.max_retries:
                attempt += 1
                await asyncio.sleep(self._backoff(attempt))
                continue
            raise ServerError(
                f"Server error ({response.status_code}): {body}",
                response.status_code,
            )

        if last_error is not None:
            raise NetworkError(f"Exhausted retries: {last_error}") from last_error
        raise NetworkError("Exhausted retries")

    async def discovery(self) -> dict[str, Any]:
        response = await self._request("GET", f"{self.base_url}/discovery")
        return response.json()

    async def health(self) -> dict[str, Any]:
        response = await self._request("GET", f"{self.base_url}/health")
        return response.json()

    async def rpc(self, method: str, params: Any = None) -> Any:
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            body["params"] = params
        response = await self._request("POST", f"{self.base_url}/jsonrpc", json=body)
        return self._unwrap(response.json())

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        result = await self.rpc("tools/call", {"name": name, "arguments": arguments or {}})
        return self._unwrap_tool(name, result)


# -- Async dataset surfaces -------------------------------------------------


class AsyncTaresAPI:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def lookup(self, *, hs8: str, lang: str = "fr") -> dict[str, Any]:
        return await self._client.call_tool("tariff_lookup", {"hs8": hs8, "lang": lang})

    async def search(
        self, *, query: str, top_k: int = 5, lang: str = "fr"
    ) -> dict[str, Any]:
        return await self._client.call_tool(
            "tariff_semantic_search", {"query": query, "top_k": top_k, "lang": lang}
        )

    async def changelog(self, *, hs8: str, since: str | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {"hs8": hs8}
        if since is not None:
            args["since"] = since
        return await self._client.call_tool("tariff_changelog", args)


class AsyncClassificationsAPI:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def cross_walk(
        self, *, code: str, source: str, target: str
    ) -> dict[str, Any]:
        return await self._client.call_tool(
            "cross_walk", {"code": code, "source": source, "target": target}
        )

    async def classify_text(
        self, *, text: str, top_k: int = 3, scheme: str = "NOGA_2025", lang: str = "fr"
    ) -> dict[str, Any]:
        return await self._client.call_tool(
            "classify_text",
            {"text": text, "top_k": top_k, "scheme": scheme, "lang": lang},
        )


class AsyncFinmaAPI:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def kyc_check(self, *, name: str, top_k: int = 10) -> dict[str, Any]:
        return await self._client.call_tool(
            "kyc_check", {"name": name, "top_k": top_k}
        )

    async def search(
        self, *, name: str, top_k: int = 5, include_warnings: bool = False
    ) -> dict[str, Any]:
        return await self._client.call_tool(
            "finma_search",
            {"name": name, "top_k": top_k, "include_warnings": include_warnings},
        )

    async def entity_history(self, *, uid: str) -> dict[str, Any]:
        return await self._client.call_tool("entity_history", {"uid": uid})


# Re-export the random module's seed-able state holder for testability.
__all__ = ["AsyncClient", "random"]
