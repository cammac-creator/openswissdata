"""AsyncClient tests — never hit the live API."""

from __future__ import annotations

import json

import httpx
import pytest

from openswissdata import (
    AsyncClient,
    AuthError,
    NetworkError,
    RateLimitError,
    ServerError,
    ToolError,
)
from conftest import rpc_ok, rpc_tool_error


pytestmark = pytest.mark.asyncio


async def test_async_attaches_authorization_header() -> None:
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=rpc_ok(1, {"ok": True}))

    transport = httpx.MockTransport(_handler)
    async with AsyncClient(api_key="test-key", transport=transport, max_retries=0) as client:
        await client.call_tool("tariff_lookup", {"hs8": "00000000"})
    assert captured[0].headers.get("authorization") == "Bearer test-key"


async def test_async_tares_lookup() -> None:
    captured: list[dict] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(
            200,
            json=rpc_ok(
                1,
                {
                    "hs8": "84620010",
                    "designation": "Machines",
                    "duty_mfn": {"value": 0, "unit": "CHF", "currency": "CHF"},
                    "disclaimer": "AVIS NON-OFFICIEL",
                },
            ),
        )

    transport = httpx.MockTransport(_handler)
    async with AsyncClient(transport=transport, max_retries=0) as client:
        result = await client.tares.lookup(hs8="84620010", lang="fr")
    assert result["hs8"] == "84620010"
    assert captured[0]["params"]["name"] == "tariff_lookup"


async def test_async_retries_on_503_then_succeeds() -> None:
    cursor = {"i": 0}

    def _handler(request: httpx.Request) -> httpx.Response:
        i = cursor["i"]
        cursor["i"] += 1
        if i < 2:
            return httpx.Response(503, json={"error": "down"})
        return httpx.Response(200, json=rpc_ok(1, {"ok": True}))

    transport = httpx.MockTransport(_handler)
    async with AsyncClient(transport=transport, max_retries=3, retry_backoff=0.001) as client:
        result = await client.call_tool("x", {})
    assert result == {"ok": True}
    assert cursor["i"] == 3


async def test_async_raises_auth_error_on_401() -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "boom"}))
    async with AsyncClient(transport=transport, max_retries=0) as client:
        with pytest.raises(AuthError):
            await client.call_tool("x", {})


async def test_async_raises_rate_limit_error() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            429,
            json={"error": "too many"},
            headers={"retry-after": "30", "x-ratelimit-remaining": "0"},
        )
    )
    async with AsyncClient(transport=transport, max_retries=0) as client:
        with pytest.raises(RateLimitError) as info:
            await client.call_tool("x", {})
    assert info.value.retry_after_seconds == 30


async def test_async_raises_server_error_after_retries() -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(500, json={"error": "boom"}))
    async with AsyncClient(transport=transport, max_retries=2, retry_backoff=0.001) as client:
        with pytest.raises(ServerError):
            await client.call_tool("x", {})


async def test_async_wraps_network_errors() -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("ECONNREFUSED")

    transport = httpx.MockTransport(_handler)
    async with AsyncClient(transport=transport, max_retries=1, retry_backoff=0.001) as client:
        with pytest.raises(NetworkError):
            await client.call_tool("x", {})


async def test_async_tool_error() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=rpc_tool_error(1, "Unknown HS8"))
    )
    async with AsyncClient(transport=transport, max_retries=0) as client:
        with pytest.raises(ToolError):
            await client.tares.lookup(hs8="00000000")
