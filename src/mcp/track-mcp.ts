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

// Nom et version déclarés par le client MCP : lettres, chiffres et ponctuation courante seulement.
// Une valeur qui contient une arobase ou cinq chiffres de suite (adresse, téléphone) n'est pas
// enregistrée du tout : retirer le caractère laisserait l'adresse ou le numéro lisible.
function cleanClientField(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.includes('@') || /\d{5,}/.test(value)) return null;
  const cleaned = value.replace(/[^A-Za-z0-9 ._/+:()-]/g, '').trim().slice(0, max);
  return cleaned || null;
}

/**
 * Mesure facultative des connexions (`initialize`) : quel client déclare quel nom et quelle version
 * de protocole. Le nom est déclaratif et falsifiable : diagnostic seulement, jamais une preuve humaine.
 */
export function trackMcpInitialize(
  c: Context,
  req: { method?: unknown; params?: unknown },
  res: JsonRpcResponse | undefined,
  auth: MCPAuthContext | null,
): void {
  if (req?.method !== 'initialize' || !res || res.error) return;
  try {
    const params = (req.params ?? {}) as { protocolVersion?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
    const negotiated = (res.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    const ua = (c.req.header('user-agent') ?? '').slice(0, 1024), recordedAt = Date.now();
    const authenticated = auth !== null;
    track({
      kind: 'custom', origin: 'server', name: 'mcp_initialize',
      status: 200, duration_ms: null, customer_id: null,
      visitor_hash: visitorHashFromRequest(c, recordedAt), country: countryFromRequest(c),
      referer: refererOrigin(c), ua_class: mcpCallerClass(ua, authenticated),
      meta_json: JSON.stringify({
        mcp: true,
        client_name: cleanClientField(params.clientInfo?.name, 64),
        client_version: cleanClientField(params.clientInfo?.version, 32),
        requested_version: cleanClientField(params.protocolVersion, 16),
        negotiated_version: cleanClientField(negotiated, 16),
        authenticated, admin: auth?.admin === true, tier: auth?.tier ?? 'anonymous',
      }),
    }, recordedAt);
  } catch { reportEventFailure(); }
}

/**
 * Essai sans clé des outils de recherche (29.09.2026) : chaque appel servi, puis le premier refus
 * de la fenêtre du réseau. Sert à lire l'intérêt réel avant toute décision sur l'offre Pro :
 * `used` = 1 compte les réseaux qui commencent un essai, `outcome` = refused ceux qui l'épuisent.
 * Ni argument (un nom cherché dans le registre FINMA peut désigner une personne), ni adresse.
 */
export function trackMcpTrial(c: Context, tool: string, outcome: { allowed: boolean; used: number; limit: number }): void {
  try {
    const ua = (c.req.header('user-agent') ?? '').slice(0, 1024), recordedAt = Date.now();
    track({
      kind: 'custom', origin: 'server', name: 'mcp_trial',
      status: outcome.allowed ? 200 : 429, duration_ms: null, customer_id: null,
      visitor_hash: visitorHashFromRequest(c, recordedAt), country: countryFromRequest(c),
      referer: refererOrigin(c), ua_class: mcpCallerClass(ua, false),
      meta_json: JSON.stringify({ mcp: true, tool: tool.slice(0, 64), outcome: outcome.allowed ? 'call' : 'refused', used: outcome.used, limit: outcome.limit }),
    }, recordedAt);
  } catch { reportEventFailure(); }
}

/** Premier refus 429 d'une fenêtre pour un réseau : combien de réseaux touchent la limite, sans inonder le journal. */
export function trackMcpRateLimited(c: Context, tier: string): void {
  try {
    const ua = (c.req.header('user-agent') ?? '').slice(0, 1024), recordedAt = Date.now();
    track({
      kind: 'custom', origin: 'server', name: 'mcp_rate_limited',
      status: 429, duration_ms: null, customer_id: null,
      visitor_hash: visitorHashFromRequest(c, recordedAt), country: countryFromRequest(c),
      referer: refererOrigin(c), ua_class: mcpCallerClass(ua, false),
      meta_json: JSON.stringify({ mcp: true, tier }),
    }, recordedAt);
  } catch { reportEventFailure(); }
}
