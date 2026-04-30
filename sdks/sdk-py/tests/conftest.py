"""Shared httpx mock fixtures for the test suite."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest


@pytest.fixture
def make_transport() -> Callable[..., httpx.MockTransport]:
    """Build an httpx.MockTransport from a list of (status, payload) responses.

    Useful when you want to drive multi-step retry scenarios.
    """

    def _builder(*responses: tuple[int, Any]) -> httpx.MockTransport:
        idx = 0

        def _handler(request: httpx.Request) -> httpx.Response:
            nonlocal idx
            status, payload = responses[min(idx, len(responses) - 1)]
            idx += 1
            if isinstance(payload, dict) or isinstance(payload, list):
                return httpx.Response(status, content=json.dumps(payload).encode())
            return httpx.Response(status, content=str(payload).encode())

        return httpx.MockTransport(_handler)

    return _builder


def rpc_ok(rpc_id: int, structured: Any, text: str = "") -> dict[str, Any]:
    """Helper to build a JSON-RPC `tools/call` success envelope."""
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "content": [{"type": "text", "text": text}],
            "structured": structured,
        },
    }


def rpc_tool_error(rpc_id: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "content": [{"type": "text", "text": message}],
            "isError": True,
        },
    }


def rpc_error(rpc_id: int | None, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}
