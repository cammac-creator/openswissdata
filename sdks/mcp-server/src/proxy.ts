/**
 * Thin HTTP wrapper around the remote openswissdata MCP JSON-RPC endpoint.
 *
 * The standalone STDIO server in `server.ts` instantiates one of these and
 * forwards every `tools/list` / `tools/call` request to the remote.
 *
 * We deliberately do not depend on `@openswissdata/sdk` here — the MCP server
 * needs the *raw* JSON-RPC envelope (so we can pass `result.content[]` straight
 * back to the MCP client), whereas the SDK unpacks `result.structured`.
 */

const DEFAULT_BASE_URL = "https://mcp.openswissdata.com";
const PKG_VERSION = "0.1.0";

export interface ProxyOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  userAgent?: string;
}

export interface JsonRpcResult {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ListToolsResponse {
  tools: ToolDescriptor[];
}

export interface CallToolResponse {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: unknown;
}

export class RemoteProxy {
  public readonly baseUrl: string;
  public readonly userAgent: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private idCounter = 0;

  constructor(options: ProxyOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error(
        "No fetch implementation available — the MCP proxy requires Node 18+ or a custom fetch.",
      );
    }
    this.fetchImpl = f;
    this.userAgent = options.userAgent
      ? `openswissdata-mcp/${PKG_VERSION} ${options.userAgent}`
      : `openswissdata-mcp/${PKG_VERSION}`;
  }

  /** GET /discovery — used as a startup health check. */
  public async discovery(): Promise<{ tools: string[]; server_info: { name: string; version: string } }> {
    const res = await this.request("GET", `${this.baseUrl}/discovery`);
    return (await res.json()) as { tools: string[]; server_info: { name: string; version: string } };
  }

  /** Forward `tools/list` to the remote and return the descriptor list. */
  public async listTools(): Promise<ListToolsResponse> {
    const result = await this.rpc<ListToolsResponse>("tools/list");
    return result;
  }

  /** Forward `tools/call` to the remote and return the raw envelope. */
  public async callTool(name: string, args: unknown): Promise<CallToolResponse> {
    return await this.rpc<CallToolResponse>("tools/call", {
      name,
      arguments: args ?? {},
    });
  }

  private async rpc<R>(method: string, params?: unknown): Promise<R> {
    const body = {
      jsonrpc: "2.0" as const,
      id: ++this.idCounter,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const res = await this.request("POST", `${this.baseUrl}/jsonrpc`, JSON.stringify(body));
    let payload: JsonRpcResult;
    try {
      payload = (await res.json()) as JsonRpcResult;
    } catch (e) {
      throw new Error(`Remote MCP returned non-JSON: ${(e as Error).message}`);
    }
    if (payload.error) {
      throw new Error(`Remote MCP error ${payload.error.code}: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error("Remote MCP returned neither result nor error");
    }
    return payload.result as R;
  }

  private async request(method: string, url: string, body?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(`Remote MCP HTTP ${res.status}: ${text}`);
      }
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
