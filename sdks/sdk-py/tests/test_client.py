"""Synchronous Client tests — never hit the live API."""

from __future__ import annotations

import json

import httpx
import pytest

from openswissdata import (
    AuthError,
    Client,
    NetworkError,
    OpenSwissDataError,
    RateLimitError,
    ServerError,
    ToolError,
)
from conftest import rpc_error, rpc_ok, rpc_tool_error


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _capture_handler(payloads: list[dict], *, status: int = 200, headers: dict | None = None):
    """Build a transport that records each incoming Request and replies in order."""
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        idx = min(len(captured) - 1, len(payloads) - 1)
        return httpx.Response(
            status,
            content=json.dumps(payloads[idx]).encode(),
            headers=headers or {"content-type": "application/json"},
        )

    return httpx.MockTransport(_handler), captured


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_attaches_authorization_header() -> None:
    transport, captured = _capture_handler([rpc_ok(1, {"ok": True})])
    with Client(api_key="test-key", transport=transport, max_retries=0) as client:
        client.call_tool("tariff_lookup", {"hs8": "00000000"})
    assert captured[0].headers.get("authorization") == "Bearer test-key"


def test_omits_authorization_header_when_anonymous() -> None:
    transport, captured = _capture_handler([rpc_ok(1, {"ok": True})])
    with Client(transport=transport, max_retries=0) as client:
        client.call_tool("tariff_lookup", {"hs8": "00000000"})
    assert "authorization" not in {k.lower() for k in captured[0].headers.keys()}


def test_strips_trailing_slash_from_base_url() -> None:
    transport, captured = _capture_handler([rpc_ok(1, {})])
    with Client(
        base_url="https://staging.example.com/", transport=transport, max_retries=0
    ) as client:
        client.call_tool("noop", {})
    assert str(captured[0].url) == "https://staging.example.com/jsonrpc"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def test_raises_auth_error_on_401() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(401, json={"error": "missing token"})
    )
    with Client(transport=transport, max_retries=0) as client:
        with pytest.raises(AuthError):
            client.call_tool("x", {})


def test_raises_rate_limit_error_with_header_echo() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            429,
            json={"error": "too many"},
            headers={
                "x-ratelimit-limit": "100",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1714512000",
                "retry-after": "60",
            },
        )
    )
    with Client(transport=transport, max_retries=0) as client:
        with pytest.raises(RateLimitError) as info:
            client.call_tool("x", {})
    err = info.value
    assert err.retry_after_seconds == 60
    assert err.limit == 100
    assert err.remaining == 0


def test_retries_on_503_then_succeeds() -> None:
    payloads: list[dict] = [{"error": "down"}, {"error": "down"}, rpc_ok(1, {"ok": True})]
    statuses = [503, 503, 200]
    cursor = {"i": 0}

    def _handler(request: httpx.Request) -> httpx.Response:
        i = cursor["i"]
        cursor["i"] += 1
        return httpx.Response(statuses[i], json=payloads[i])

    transport = httpx.MockTransport(_handler)
    with Client(transport=transport, max_retries=3, retry_backoff=0.001) as client:
        result = client.call_tool("x", {})
    assert result == {"ok": True}
    assert cursor["i"] == 3


def test_gives_up_after_max_retries_on_500() -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(500, json={"error": "boom"}))
    with Client(transport=transport, max_retries=2, retry_backoff=0.001) as client:
        with pytest.raises(ServerError):
            client.call_tool("x", {})


def test_wraps_network_errors() -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("ECONNREFUSED")

    transport = httpx.MockTransport(_handler)
    with Client(transport=transport, max_retries=1, retry_backoff=0.001) as client:
        with pytest.raises(NetworkError):
            client.call_tool("x", {})


def test_protocol_error_becomes_openswissdata_error() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=rpc_error(1, -32601, "unknown method"))
    )
    with Client(transport=transport, max_retries=0) as client:
        with pytest.raises(OpenSwissDataError) as info:
            client.rpc("foo")
    assert "unknown method" in str(info.value)


def test_tool_error_surfaces_as_tool_error() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=rpc_tool_error(1, "No TARES row found for HS8"))
    )
    with Client(transport=transport, max_retries=0) as client:
        with pytest.raises(ToolError) as info:
            client.call_tool("tariff_lookup", {"hs8": "00000000"})
    assert info.value.tool == "tariff_lookup"


def test_captures_rate_limit_headers_on_success() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200,
            json=rpc_ok(1, {"ok": True}),
            headers={
                "x-ratelimit-limit": "100",
                "x-ratelimit-remaining": "73",
                "x-ratelimit-reset": "1714512000",
            },
        )
    )
    with Client(transport=transport, max_retries=0) as client:
        client.call_tool("x", {})
        assert client.last_rate_limit.limit == 100
        assert client.last_rate_limit.remaining == 73
        assert client.last_rate_limit.reset == 1714512000


# ---------------------------------------------------------------------------
# Dataset surfaces
# ---------------------------------------------------------------------------


def test_tares_lookup_forwards_args() -> None:
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
    with Client(transport=transport, max_retries=0) as client:
        result = client.tares.lookup(hs8="84620010", lang="fr")
    assert result["hs8"] == "84620010"
    assert captured[0]["params"]["name"] == "tariff_lookup"
    assert captured[0]["params"]["arguments"] == {"hs8": "84620010", "lang": "fr"}


def test_classifications_cross_walk() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200,
            json=rpc_ok(
                1,
                {
                    "source_scheme": "NACE_2.0",
                    "target_scheme": "NOGA_2025",
                    "source_code": "62.01",
                    "mappings": [
                        {
                            "source_code": "62.01",
                            "target_code": "62.01",
                            "mapping_type": "exact",
                            "notes": "",
                        }
                    ],
                },
            ),
        )
    )
    with Client(transport=transport, max_retries=0) as client:
        result = client.classifications.cross_walk(
            code="62.01", source="NACE_2.0", target="NOGA_2025"
        )
    assert result["mappings"][0]["mapping_type"] == "exact"


def test_finma_search() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200,
            json=rpc_ok(
                1,
                {
                    "query": "Cred Suisse",
                    "matches": [
                        {
                            "name": "Credit Suisse AG",
                            "score": 0.91,
                            "entity_type": "bank",
                            "uid": "CHE-105.884.030",
                            "lei": None,
                            "licence_type": "bank",
                            "status": "authorised",
                            "canton": "ZH",
                            "city": "Zürich",
                            "is_warning_listed": False,
                            "source_url": "https://www.finma.ch/",
                        }
                    ],
                    "match_count": 1,
                },
            ),
        )
    )
    with Client(transport=transport, max_retries=0) as client:
        result = client.finma.search(name="Cred Suisse")
    assert result["matches"][0]["score"] > 0.9
    assert result["match_count"] == 1


def test_discovery_returns_server_info() -> None:
    transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200,
            json={
                "protocol_version": "2025-06-18",
                "server_info": {"name": "openswissdata-mcp", "version": "0.2.0"},
                "capabilities": {"tools": {"list_changed": False}},
                "tools": ["tariff_lookup"],
            },
        )
    )
    with Client(transport=transport, max_retries=0) as client:
        info = client.discovery()
    assert info["protocol_version"] == "2025-06-18"
    assert "tariff_lookup" in info["tools"]
