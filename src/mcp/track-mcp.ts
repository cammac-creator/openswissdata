import { reportEventFailure } from '../lib/event-budget.js';
import type { Context } from 'hono';
import { track, visitorHashFromRequest, countryFromRequest, refererOrigin } from '../lib/track.js';
import { mcpCallerClass } from './caller-class.js';
import type { MCPAuthContext } from './oauth/verify.js';
import type { JsonRpcResponse } from './server.js';

/** Mesure facultative des appels d’outils ; une authentification ne prouve pas une présence humaine. */
export function trackMcpToolCall(
  c: Context,
  req: { method?: unknown; params?: unknown },
  res: JsonRpcResponse | undefined,
  auth: MCPAuthContext | null,
  durationMs: number,
): void {
  if (req?.method !== 'tools/call') return;
  // La seule file différée est celle, bornée, du collecteur. Ne pas retenir le contexte HTTP.
  try {
    const params = (req.params ?? {}) as { name?: unknown };
    const tool = typeof params.name === 'string' ? params.name.slice(0, 128) : '(inconnu)';
    const ua = (c.req.header('user-agent') ?? '').slice(0, 1024), recordedAt = Date.now();
    const authenticated = auth !== null, isAdmin = auth?.admin === true;
    track({
      kind: 'custom', origin: 'server', name: 'mcp_tool_call',
      status: res?.error ? 400 : 200, duration_ms: Math.max(0, durationMs), customer_id: null,
      visitor_hash: visitorHashFromRequest(c, recordedAt), country: countryFromRequest(c),
      referer: refererOrigin(c), ua_class: mcpCallerClass(ua, authenticated),
      // Conserver la catégorie calculée ; la chaîne de navigateur brute n’est pas nécessaire.
      meta_json: JSON.stringify({ mcp: true, tool, jsonrpc_method: 'tools/call', authenticated, admin: isAdmin, tier: auth?.tier ?? 'anonymous', client_id: auth?.client_id ?? null }),
    }, recordedAt);
  } catch { reportEventFailure(); }
}
