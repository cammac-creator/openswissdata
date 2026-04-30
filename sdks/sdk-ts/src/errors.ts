/**
 * Error hierarchy for the openswissdata SDK.
 *
 * All errors extend `OpenSwissDataError` so callers can do
 * `catch (e) { if (e instanceof OpenSwissDataError) ... }` without importing
 * every subtype.
 */

export class OpenSwissDataError extends Error {
  /** Underlying transport / JSON-RPC code, if any. */
  public readonly code: number | string | undefined;
  /** Optional structured payload returned by the API. */
  public readonly data: unknown;

  constructor(
    message: string,
    options?: { code?: number | string; data?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = "OpenSwissDataError";
    this.code = options?.code;
    this.data = options?.data;
    if (options?.cause !== undefined) {
      // Preserve the original error for stack traces / debugging.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Auth failure (401, invalid Bearer, expired OAuth token, missing scope). */
export class AuthError extends OpenSwissDataError {
  constructor(message: string, options?: { code?: number | string; data?: unknown }) {
    super(message, options);
    this.name = "AuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Rate limit hit (429). Includes header echo when available. */
export class RateLimitError extends OpenSwissDataError {
  /** Seconds the caller should wait before retrying, parsed from `Retry-After`. */
  public readonly retryAfterSeconds: number | undefined;
  /** Remaining requests in the current window (X-RateLimit-Remaining). */
  public readonly remaining: number | undefined;
  /** Window cap (X-RateLimit-Limit). */
  public readonly limit: number | undefined;
  /** Window reset epoch seconds (X-RateLimit-Reset). */
  public readonly reset: number | undefined;

  constructor(
    message: string,
    options?: {
      retryAfterSeconds?: number;
      remaining?: number;
      limit?: number;
      reset?: number;
      code?: number | string;
      data?: unknown;
    },
  ) {
    super(message, options);
    this.name = "RateLimitError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.remaining = options?.remaining;
    this.limit = options?.limit;
    this.reset = options?.reset;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Server-side error (5xx). Retried by the client unless `retries: 0`. */
export class ServerError extends OpenSwissDataError {
  public readonly status: number;
  constructor(message: string, status: number, options?: { data?: unknown; cause?: unknown }) {
    super(message, { ...options, code: status });
    this.name = "ServerError";
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Network error (DNS, TCP, fetch abort). */
export class NetworkError extends OpenSwissDataError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Tool-level error returned by the API (e.g. unknown HS8 code, invalid input). */
export class ToolError extends OpenSwissDataError {
  public readonly tool: string;
  constructor(tool: string, message: string, options?: { data?: unknown }) {
    super(message, options);
    this.name = "ToolError";
    this.tool = tool;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
