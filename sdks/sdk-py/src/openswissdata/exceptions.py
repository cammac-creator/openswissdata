"""Exception hierarchy for the openswissdata Python SDK.

All errors derive from :class:`OpenSwissDataError`, so consumers can do::

    try:
        client.tares.lookup(hs8="00000000")
    except OpenSwissDataError as e:
        ...

without importing every subclass.
"""

from __future__ import annotations


class OpenSwissDataError(Exception):
    """Base class for every SDK-raised error."""

    def __init__(
        self,
        message: str,
        *,
        code: int | str | None = None,
        data: object = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class AuthError(OpenSwissDataError):
    """Raised on 401/403 — invalid Bearer, expired OAuth token or missing scope."""


class RateLimitError(OpenSwissDataError):
    """Raised on 429. Carries the rate-limit header echo when available."""

    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: int | None = None,
        remaining: int | None = None,
        limit: int | None = None,
        reset: int | None = None,
        code: int | str | None = None,
        data: object = None,
    ) -> None:
        super().__init__(message, code=code, data=data)
        self.retry_after_seconds = retry_after_seconds
        self.remaining = remaining
        self.limit = limit
        self.reset = reset


class ServerError(OpenSwissDataError):
    """5xx response after retries are exhausted."""

    def __init__(self, message: str, status: int, *, data: object = None) -> None:
        super().__init__(message, code=status, data=data)
        self.status = status


class NetworkError(OpenSwissDataError):
    """DNS / TCP / timeout failure (httpx.RequestError)."""


class ToolError(OpenSwissDataError):
    """The tool returned ``isError = True`` (e.g. unknown HS8 code)."""

    def __init__(self, tool: str, message: str, *, data: object = None) -> None:
        super().__init__(message, data=data)
        self.tool = tool
