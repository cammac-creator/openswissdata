/**
 * Low-level HTTP client wrapping the openswissdata MCP JSON-RPC endpoint.
 *
 * The 8 dataset operations are exposed by the live MCP server at
 *   POST https://mcp.openswissdata.com/jsonrpc
 * (also reachable at https://www.openswissdata.com/mcp/jsonrpc).
 *
 * This class is the transport. The dataset-specific surfaces
 * (`Client.tares`, `.classifications`, `.finma`) are mounted by `index.ts`
 * and call back into `Client.callTool()`.
 *
 * Design choices:
 *   - Uses the global `fetch` (Node 18+ and every modern browser). No undici /
 *     node-fetch dependency.
 *   - Exponential backoff with jitter on 5xx + network errors.
 *   - 429 surfaces as `RateLimitError` immediately (no retry — caller decides).
 *   - The mandatory non-official disclaimers carried in `result.structured`
 *     are passed through to the user untouched (we never strip them).
 */

import {
  AuthError,
  NetworkError,
  OpenSwissDataError,
  RateLimitError,
  ServerError,
  ToolError,
} from "./errors.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ServerInfo,
  ToolCallResult,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://mcp.openswissdata.com";
const SDK_VERSION = "0.1.0";
const DEFAULT_USER_AGENT = `openswissdata-sdk-ts/${SDK_VERSION}`;

export interface ClientOptions {
  /**
   * Bearer token. Optional — anonymous callers get the free-tier rate limit
   * (currently 100 req/day per IP) and only the V1 read-only tools.
   */
  apiKey?: string;
  /**
   * Override the MCP base URL. Defaults to `https://mcp.openswissdata.com`.
   * Useful for staging / self-hosted deployments.
   */
  baseUrl?: string;
  /**
   * Per-request timeout in milliseconds. Default 30s.
   */
  timeoutMs?: number;
  /**
   * Max retry attempts on 5xx / network errors. Default 3.
   * Set to 0 to disable retries.
   */
  maxRetries?: number;
  /**
   * Initial backoff in ms; doubled on each retry, with up to 25% jitter.
   * Default 250ms.
   */
  retryBackoffMs?: number;
  /**
   * Custom fetch implementation (test injection / browser polyfill).
   */
  fetch?: typeof fetch;
  /**
   * Extra User-Agent suffix appended after the default one.
   */
  userAgent?: string;
}

/** Last-seen rate-limit headers from the server. */
export interface RateLimitInfo {
  limit: number | undefined;
  remaining: number | undefined;
  reset: number | undefined;
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export class Client {
  public readonly baseUrl: string;
  public readonly timeoutMs: number;
  public readonly maxRetries: number;
  public readonly retryBackoffMs: number;
  /** Last observed rate-limit headers (mutates after every request). */
  public lastRateLimit: RateLimitInfo = { limit: undefined, remaining: undefined, reset: undefined };

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private idCounter: number = 0;

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 250;

    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new OpenSwissDataError(
        "No fetch implementation available — pass `options.fetch` (Node <18 or restricted environment).",
      );
    }
    this.fetchImpl = f;
    this.userAgent = options.userAgent
      ? `${DEFAULT_USER_AGENT} ${options.userAgent}`
      : DEFAULT_USER_AGENT;
  }

  /** GET /discovery — protocol version, capabilities and tool list. */
  public async discovery(): Promise<ServerInfo> {
    const url = `${this.baseUrl}/discovery`;
    const res = await this.fetchWithRetry(url, { method: "GET" });
    return (await res.json()) as ServerInfo;
  }

  /** GET /health — liveness probe (no auth). */
  public async health(): Promise<{ status: string }> {
    const url = `${this.baseUrl}/health`;
    const res = await this.fetchWithRetry(url, { method: "GET" });
    return (await res.json()) as { status: string };
  }

  /**
   * Low-level JSON-RPC dispatch. Most callers should use `callTool()` or one
   * of the dataset surfaces (`client.tares.lookup(...)` etc.).
   */
  public async rpc<P, R>(method: string, params?: P): Promise<R> {
    const body: JsonRpcRequest<P> = {
      jsonrpc: "2.0",
      id: ++this.idCounter,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const url = `${this.baseUrl}/jsonrpc`;
    const res = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let payload: JsonRpcResponse<R>;
    try {
      payload = (await res.json()) as JsonRpcResponse<R>;
    } catch (e) {
      throw new OpenSwissDataError("Server returned non-JSON response", { cause: e });
    }
    if (payload.error) {
      throw new OpenSwissDataError(payload.error.message, {
        code: payload.error.code,
        data: payload.error.data,
      });
    }
    if (payload.result === undefined) {
      throw new OpenSwissDataError("JSON-RPC response missing both `result` and `error`");
    }
    return payload.result;
  }

  /**
   * Call an MCP tool by name. Unwraps `result.structured` and surfaces tool
   * errors as `ToolError`.
   */
  public async callTool<S>(name: string, args: unknown): Promise<S> {
    const result = await this.rpc<{ name: string; arguments: unknown }, ToolCallResult<S>>(
      "tools/call",
      { name, arguments: args },
    );
    if (result.isError) {
      const text = result.content.map((c) => c.text).join("\n");
      throw new ToolError(name, text || `Tool '${name}' returned an error`);
    }
    if (result.structured === undefined) {
      // Fallback: tool returned only text (rare, but valid per MCP spec).
      // We surface the joined text as a plain string cast to S — callers
      // requesting a typed surface should never hit this.
      const text = result.content.map((c) => c.text).join("\n");
      return text as unknown as S;
    }
    return result.structured;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const headers = new Headers(init.headers);
      headers.set("User-Agent", this.userAgent);
      headers.set("Accept", "application/json");
      if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);

      try {
        const res = await this.fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        this.captureRateLimit(res);

        if (res.ok) return res;

        if (res.status === 401 || res.status === 403) {
          const text = await safeReadText(res);
          throw new AuthError(`Authentication failed (${res.status}): ${text}`, {
            code: res.status,
          });
        }

        if (res.status === 429) {
          const text = await safeReadText(res);
          const retryAfterRaw = res.headers.get("retry-after");
          const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
          throw new RateLimitError(`Rate limit exceeded: ${text}`, {
            code: 429,
            retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
            limit: this.lastRateLimit.limit,
            remaining: this.lastRateLimit.remaining,
            reset: this.lastRateLimit.reset,
          });
        }

        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          attempt++;
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        const text = await safeReadText(res);
        throw new ServerError(`Server error (${res.status}): ${text}`, res.status);
      } catch (e) {
        // AbortError, TypeError (DNS / TCP), or our own re-throws.
        if (
          e instanceof AuthError ||
          e instanceof RateLimitError ||
          e instanceof ServerError ||
          e instanceof OpenSwissDataError
        ) {
          throw e;
        }
        lastError = e;
        if (attempt < this.maxRetries) {
          attempt++;
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }
        throw new NetworkError(
          `Network error after ${attempt} retries: ${(e as Error).message}`,
          { cause: e },
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    // Unreachable in practice: the loop either returns a Response or throws.
    throw new NetworkError("Exhausted retries", { cause: lastError });
  }

  private captureRateLimit(res: Response): void {
    const limit = parseIntSafe(res.headers.get("x-ratelimit-limit"));
    const remaining = parseIntSafe(res.headers.get("x-ratelimit-remaining"));
    const reset = parseIntSafe(res.headers.get("x-ratelimit-reset"));
    this.lastRateLimit = { limit, remaining, reset };
  }

  private computeBackoff(attempt: number): number {
    const base = this.retryBackoffMs * Math.pow(2, attempt - 1);
    const jitter = base * 0.25 * Math.random();
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function parseIntSafe(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
