/**
 * Lecture en direct du registre LEI public de GLEIF, pour la fiche de vérification d'une
 * société suisse (tâche osd.fiche, tâche 3).
 *
 * Un GET `filter[entity.registeredAs]=<CHE-xxx.xxx.xxx>` vers `getSource("gleif.lei_api").url`
 * (adresse de base), `accept: application/vnd.api+json`. GLEIF restitue l'IDE recherché dans
 * `attributes.entity.registeredAs` sous la forme canonique `CHE-xxx.xxx.xxx` (vérifié en
 * direct le 06.10.2026 sur AXA Leben AG, LEI `52990032J6E61LFTO024`) : on ne garde que les
 * enregistrements dont cette valeur correspond EXACTEMENT à l'IDE demandé, comparée après
 * normalisation par `parseUid` (et non une simple égalité de chaînes, au cas où GLEIF
 * renverrait un jour une autre forme).
 *
 * `lookupGleif` n'accepte en entrée que la forme canonique `CHE-xxx.xxx.xxx` (celle que
 * rend `parseUid(...).uid`) : toute autre chaîne est refusée avant tout appel réseau, par
 * symétrie avec la règle de `lookupLindas` sur la forme compacte.
 *
 * `GLEIF_LEI_API_URL` ci-dessous DOIT rester identique à `getSource("gleif.lei_api").url`
 * (`etl/shared/sources/registry.ts`). `src/` ne peut pas importer `etl/` (voir le
 * commentaire équivalent dans `lindas.ts`) : `tests/mcp/company-sources-provenance.test.ts`
 * vérifie l'égalité.
 */

import { parseUid } from "./uid.js";
import { TtlCache } from "./cache.js";
import type { GleifRecord, LiveDeps, Part } from "./types.js";

export const GLEIF_LEI_API_URL = "https://api.gleif.org/api/v1/lei-records";

const CANONICAL_UID_RE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface GleifApiRecord {
  attributes?: {
    lei?: string;
    entity?: { legalName?: { name?: string }; registeredAs?: string | null; status?: string };
    registration?: { status?: string; lastUpdateDate?: string };
  };
}

function isGleifResponse(body: unknown): body is { data: GleifApiRecord[] } {
  if (typeof body !== "object" || body === null) return false;
  return Array.isArray((body as { data?: unknown }).data);
}

function toRecord(r: GleifApiRecord): GleifRecord | null {
  const a = r.attributes;
  if (!a?.lei || !a.entity?.legalName?.name) return null;
  return {
    lei: a.lei,
    legal_name: a.entity.legalName.name,
    entity_status: a.entity.status ?? "unknown",
    registration_status: a.registration?.status ?? "unknown",
    last_update: a.registration?.lastUpdateDate ?? null,
    registered_as: a.entity.registeredAs ?? null,
  };
}

// Singleton de production ; `resetGleifCache` permet aux tests d'utiliser un cache neuf
// avec leur propre horloge, sans toucher à l'horloge réelle.
let cache = new TtlCache<Part<GleifRecord[]>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now: () => Date.now() });
export function resetGleifCache(now: () => number = () => Date.now()): void {
  cache = new TtlCache<Part<GleifRecord[]>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now });
}

export async function lookupGleif(uid: string, deps: LiveDeps): Promise<Part<GleifRecord[]>> {
  if (!CANONICAL_UID_RE.test(uid)) {
    return { available: false, reason: "uid must be the canonical form CHE-xxx.xxx.xxx (from parseUid)" };
  }
  const parsedRequested = parseUid(uid);
  if (!parsedRequested.ok) {
    return { available: false, reason: "uid must be a valid Swiss UID (from parseUid)" };
  }
  const cacheKey = parsedRequested.uid;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL(GLEIF_LEI_API_URL);
  url.searchParams.set("filter[entity.registeredAs]", uid);

  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/vnd.api+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { available: false, reason: "GLEIF request failed or timed out" };
  }
  if (res.status !== 200) {
    return { available: false, reason: `GLEIF responded with HTTP ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { available: false, reason: "GLEIF response is not valid JSON" };
  }
  if (!isGleifResponse(body)) {
    return { available: false, reason: "unexpected GLEIF response shape" };
  }

  const retrieved_at = new Date(deps.now()).toISOString();
  const records = body.data
    .map(toRecord)
    .filter((r): r is GleifRecord => {
      if (!r || !r.registered_as) return false;
      const parsedRegistered = parseUid(r.registered_as);
      return parsedRegistered.ok && parsedRegistered.compact === parsedRequested.compact;
    });

  const result: Part<GleifRecord[]> = records.length === 0
    ? { available: true, retrieved_at, found: false, data: null }
    : { available: true, retrieved_at, found: true, data: records };
  cache.set(cacheKey, result);
  return result;
}
