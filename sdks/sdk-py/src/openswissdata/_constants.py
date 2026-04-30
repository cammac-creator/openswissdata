"""Internal constants shared between sync and async clients."""

from __future__ import annotations

DEFAULT_BASE_URL = "https://mcp.openswissdata.com"
SDK_VERSION = "0.1.0"
DEFAULT_USER_AGENT = f"openswissdata-sdk-py/{SDK_VERSION}"

DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_BACKOFF_SECONDS = 0.25

RETRYABLE_STATUS = frozenset({500, 502, 503, 504})
