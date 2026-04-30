"""Synchronous client for the openswissdata MCP JSON-RPC endpoint.

Wraps the live API at https://mcp.openswissdata.com/jsonrpc and exposes
typed surfaces for the three datasets (TARES, classifications, FINMA).
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ._constants import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_BACKOFF_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_USER_AGENT,
    RETRYABLE_STATUS,
)
from .exceptions import (
    AuthError,
    NetworkError,
    OpenSwissDataError,
    RateLimitError,
    ServerError,
    ToolError,
)


@dataclass
class RateLimitInfo:
    """Last observed rate-limit header echo (refreshed on every request)."""

    limit: int | None = None
    remaining: int | None = None
    reset: int | None = None


class _BaseClient:
    """Shared state + helpers between sync and async clients."""

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        timeout: float,
        max_retries: int,
        retry_backoff: float,
        user_agent: str | None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff = retry_backoff
        self.user_agent = (
            f"{DEFAULT_USER_AGENT} {user_agent}".strip() if user_agent else DEFAULT_USER_AGENT
        )
        self.last_rate_limit = RateLimitInfo()
        self._id_counter = 0

    def _next_id(self) -> int:
        self._id_counter += 1
        return self._id_counter

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {
            "User-Agent": self.user_agent,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _capture_rate_limit(self, response: httpx.Response) -> None:
        self.last_rate_limit = RateLimitInfo(
            limit=_parse_int(response.headers.get("x-ratelimit-limit")),
            remaining=_parse_int(response.headers.get("x-ratelimit-remaining")),
            reset=_parse_int(response.headers.get("x-ratelimit-reset")),
        )

    def _backoff(self, attempt: int) -> float:
        base = self.retry_backoff * (2 ** (attempt - 1))
        return base + base * 0.25 * random.random()

    def _build_rate_limit_error(self, response: httpx.Response, body: str) -> RateLimitError:
        retry_after_raw = response.headers.get("retry-after")
        retry_after = _parse_int(retry_after_raw) if retry_after_raw else None
        return RateLimitError(
            f"Rate limit exceeded: {body}",
            code=429,
            retry_after_seconds=retry_after,
            limit=self.last_rate_limit.limit,
            remaining=self.last_rate_limit.remaining,
            reset=self.last_rate_limit.reset,
        )

    @staticmethod
    def _unwrap(payload: dict[str, Any]) -> Any:
        if "error" in payload and payload["error"]:
            err = payload["error"]
            raise OpenSwissDataError(
                err.get("message", "JSON-RPC error"),
                code=err.get("code"),
                data=err.get("data"),
            )
        if "result" not in payload:
            raise OpenSwissDataError("JSON-RPC response missing both `result` and `error`")
        return payload["result"]

    @staticmethod
    def _unwrap_tool(name: str, result: dict[str, Any]) -> Any:
        if result.get("isError"):
            text = "\n".join(c.get("text", "") for c in result.get("content", []))
            raise ToolError(name, text or f"Tool '{name}' returned an error")
        if "structured" in result and result["structured"] is not None:
            return result["structured"]
        # Fallback: tool returned only text content (rare).
        return "\n".join(c.get("text", "") for c in result.get("content", []))


class Client(_BaseClient):
    """Synchronous client.

    Uses httpx under the hood. Anonymous mode is fine for evaluation
    (~100 req/day per IP). Pass ``api_key`` for higher quotas.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_backoff: float = DEFAULT_RETRY_BACKOFF_SECONDS,
        transport: httpx.BaseTransport | None = None,
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
        self._http = httpx.Client(timeout=timeout, transport=transport, follow_redirects=True)
        self.tares = TaresAPI(self)
        self.classifications = ClassificationsAPI(self)
        self.finma = FinmaAPI(self)

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    # -- HTTP plumbing ------------------------------------------------------

    def _request(self, method: str, url: str, *, json: Any = None) -> httpx.Response:
        attempt = 0
        last_error: Exception | None = None
        while attempt <= self.max_retries:
            try:
                response = self._http.request(
                    method, url, json=json, headers=self._headers()
                )
            except httpx.RequestError as e:
                last_error = e
                if attempt >= self.max_retries:
                    raise NetworkError(
                        f"Network error after {attempt} retries: {e}"
                    ) from e
                attempt += 1
                time.sleep(self._backoff(attempt))
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
                time.sleep(self._backoff(attempt))
                continue
            raise ServerError(
                f"Server error ({response.status_code}): {body}",
                response.status_code,
            )

        # Loop exited without returning — should be unreachable.
        if last_error is not None:
            raise NetworkError(f"Exhausted retries: {last_error}") from last_error
        raise NetworkError("Exhausted retries")

    def discovery(self) -> dict[str, Any]:
        """Return the MCP server discovery payload."""
        response = self._request("GET", f"{self.base_url}/discovery")
        return response.json()

    def health(self) -> dict[str, Any]:
        """Liveness probe (no auth)."""
        response = self._request("GET", f"{self.base_url}/health")
        return response.json()

    def rpc(self, method: str, params: Any = None) -> Any:
        """Low-level JSON-RPC dispatch."""
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            body["params"] = params
        response = self._request("POST", f"{self.base_url}/jsonrpc", json=body)
        return self._unwrap(response.json())

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Call an MCP tool by name and unwrap ``result.structured``."""
        result = self.rpc("tools/call", {"name": name, "arguments": arguments or {}})
        return self._unwrap_tool(name, result)


# -- Dataset surfaces --------------------------------------------------------


class TaresAPI:
    """Swiss customs (TARES) — backed by 3 MCP tools."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def lookup(self, *, hs8: str, lang: str = "fr") -> dict[str, Any]:
        """Exact HS8 lookup."""
        return self._client.call_tool("tariff_lookup", {"hs8": hs8, "lang": lang})

    def search(self, *, query: str, top_k: int = 5, lang: str = "fr") -> dict[str, Any]:
        """Free-text semantic search."""
        return self._client.call_tool(
            "tariff_semantic_search", {"query": query, "top_k": top_k, "lang": lang}
        )

    def changelog(self, *, hs8: str, since: str | None = None) -> dict[str, Any]:
        """Historical changelog (rolling 12-24 months)."""
        args: dict[str, Any] = {"hs8": hs8}
        if since is not None:
            args["since"] = since
        return self._client.call_tool("tariff_changelog", args)


class ClassificationsAPI:
    """NOGA / NACE / ISIC — backed by 2 MCP tools."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def cross_walk(self, *, code: str, source: str, target: str) -> dict[str, Any]:
        """Translate a code from one scheme to another."""
        return self._client.call_tool(
            "cross_walk", {"code": code, "source": source, "target": target}
        )

    def classify_text(
        self, *, text: str, top_k: int = 3, scheme: str = "NOGA_2025", lang: str = "fr"
    ) -> dict[str, Any]:
        """Classify free-text business description."""
        return self._client.call_tool(
            "classify_text",
            {"text": text, "top_k": top_k, "scheme": scheme, "lang": lang},
        )


class FinmaAPI:
    """FINMA registry — backed by 3 MCP tools."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def kyc_check(self, *, name: str, top_k: int = 10) -> dict[str, Any]:
        """Substring KYC check."""
        return self._client.call_tool("kyc_check", {"name": name, "top_k": top_k})

    def search(
        self, *, name: str, top_k: int = 5, include_warnings: bool = False
    ) -> dict[str, Any]:
        """Fuzzy / typo-tolerant search."""
        return self._client.call_tool(
            "finma_search",
            {"name": name, "top_k": top_k, "include_warnings": include_warnings},
        )

    def entity_history(self, *, uid: str) -> dict[str, Any]:
        """Timeline of changes for a UID."""
        return self._client.call_tool("entity_history", {"uid": uid})


# -- Helpers ----------------------------------------------------------------


def _parse_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None
