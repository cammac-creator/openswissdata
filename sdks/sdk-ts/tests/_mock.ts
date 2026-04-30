/**
 * Shared fetch mock helpers for the SDK test suite.
 *
 * Tests never hit the live API — every request is intercepted by a fake
 * fetch passed via `new Client({ fetch: mock })`.
 */

export interface MockCall {
  url: string;
  init: RequestInit | undefined;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function makeMock(handler: (call: MockCall) => MockResponse | Promise<MockResponse>) {
  const calls: MockCall[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const call: MockCall = { url, init };
    calls.push(call);
    const r = await handler(call);
    const status = r.status ?? 200;
    const body = r.body ?? {};
    const headers = new Headers({
      "content-type": "application/json",
      ...(r.headers ?? {}),
    });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers,
    });
  };

  return { fetch: fetchImpl, calls };
}

/** Build a JSON-RPC success envelope for `tools/call`. */
export function rpcOk(id: number, structured: unknown, text: string = "") {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      structured,
    },
  };
}

/** Build a JSON-RPC tool error envelope (handler returned isError). */
export function rpcToolError(id: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: message }],
      isError: true,
    },
  };
}

/** Build a JSON-RPC protocol error envelope. */
export function rpcError(id: number | null, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}
