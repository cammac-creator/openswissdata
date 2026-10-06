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
import { RequestCoalescer, retryAfterMs, SourceBreaker } from "./outbound-guard.js";
import type { GleifRecord, LiveDeps, Part } from "./types.js";

export const GLEIF_LEI_API_URL = "https://api.gleif.org/api/v1/lei-records";

const CANONICAL_UID_RE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Un IDE "non trouvé" (valide mais absent de GLEIF) est gardé en cache une heure seulement
// (relecture finale du 06.10.2026), par symétrie avec `lindas.ts` : un LEI peut être délivré
// entre deux lectures, alors qu'un résultat trouvé change rarement assez vite pour justifier
// moins de 24 h.
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
// Identifie ce client auprès de GLEIF (relecture finale du 06.10.2026), par symétrie avec
// `lindas.ts`.
const USER_AGENT = "OpenSwissData company_check (+https://www.openswissdata.com)";

// Envelope JSON:API : seule la forme de haut niveau (tableau `data`) est vérifiée ici.
// Chaque élément peut être n'importe quoi (null, un objet sans `attributes`, des champs
// aux mauvais types) : `extractItem` ci-dessous distingue un champ ABSENT (toléré : OPTIONAL
// non satisfait par GLEIF, l'élément est simplement ignoré) d'un champ PRÉSENT MAIS INVALIDE
// (type numérique, chaîne vide : jamais toléré, toute la réponse est alors rejetée). Un
// élément qui n'est même pas un objet (null, chaîne, nombre) rejette aussi toute la réponse,
// sans jamais être silencieusement filtré au milieu d'éléments par ailleurs valides. Jamais
// un cast de confiance sur une interface TypeScript qui ne protège rien à l'exécution.
function isGleifResponse(body: unknown): body is { data: unknown[] } {
  if (typeof body !== "object" || body === null) return false;
  return Array.isArray((body as { data?: unknown }).data);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function asObject(v: unknown): Record<string, unknown> | undefined {
  return isPlainObject(v) ? v : undefined;
}
/** Champ FACULTATIF (entity_status, registration_status, last_update) : mauvais type ignoré. */
function optionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
/** Champ OBLIGATOIRE (`lei`, `legalName.name`) : distingue absence (OK) et type invalide (rejet). */
function requiredString(v: unknown): "absent" | "invalid" | string {
  if (v === undefined) return "absent";
  if (typeof v !== "string" || v === "") return "invalid";
  return v;
}

type ItemResult = { kind: "record"; record: GleifRecord } | { kind: "skip" } | { kind: "fail" };

/**
 * Extrait un `GleifRecord` d'un élément brut de `data`.
 *  - `fail` : l'élément lui-même n'est pas un objet, ou un champ obligatoire présent
 *    (`lei`, `legalName.name`, `registeredAs` non nul) est d'un autre type ou vide — rejette
 *    TOUTE la réponse (appelant), jamais filtré en silence.
 *  - `skip` : `lei` ou `legalName.name` est simplement absent (chaîne de containers brisée,
 *    `attributes`/`entity` manquants compris) — élément ignoré, le reste de la réponse n'est
 *    pas en cause.
 *  - `record` : élément exploitable.
 */
function extractItem(raw: unknown): ItemResult {
  if (!isPlainObject(raw)) return { kind: "fail" };
  const a = asObject(raw.attributes);
  const lei = requiredString(a?.lei);
  if (lei === "invalid") return { kind: "fail" };
  const entity = asObject(a?.entity);
  const legalName = requiredString(asObject(entity?.legalName)?.name);
  if (legalName === "invalid") return { kind: "fail" };
  const registeredAsRaw = entity?.registeredAs;
  if (registeredAsRaw !== null && registeredAsRaw !== undefined && typeof registeredAsRaw !== "string") {
    return { kind: "fail" }; // forme inattendue (ex. valeur numérique) : jamais passée à parseUid
  }
  if (registeredAsRaw === "") return { kind: "fail" }; // présent mais vide : invalide, pas "absent"
  if (lei === "absent" || legalName === "absent") return { kind: "skip" };
  const registration = asObject(a?.registration);
  return {
    kind: "record",
    record: {
      lei,
      legal_name: legalName,
      // `null`, jamais une valeur de repli inventée comme "unknown" (correction 1 du
      // 06.10.2026, tâche osd.fiche, tâche 4) : un statut absent de GLEIF reste absent ici.
      entity_status: optionalString(entity?.status) ?? null,
      registration_status: optionalString(registration?.status) ?? null,
      last_update: optionalString(registration?.lastUpdateDate) ?? null,
      registered_as: typeof registeredAsRaw === "string" ? registeredAsRaw : null,
    },
  };
}

// Singleton de production ; `resetGleifCache` permet aux tests d'utiliser un cache neuf
// avec leur propre horloge, sans toucher à l'horloge réelle.
let cache = new TtlCache<Part<GleifRecord[]>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now: () => Date.now() });
export function resetGleifCache(now: () => number = () => Date.now()): void {
  cache = new TtlCache<Part<GleifRecord[]>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now });
  // Remettre le client à zéro remet aussi son disjoncteur (même horloge).
  breaker = new SourceBreaker({ now });
}

// Disjoncteur par source (garde-fou de charge sortante, avant l'ouverture sans clé) et
// regroupement des appels concurrents pour le même IDE ; symétrique à `lindas.ts`.
let breaker = new SourceBreaker({ now: () => Date.now() });
export function resetGleifBreaker(now: () => number = () => Date.now()): void {
  breaker = new SourceBreaker({ now });
}
const coalescer = new RequestCoalescer<Part<GleifRecord[]>>();

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

  if (breaker.isPaused()) {
    return { available: false, reason: "source temporarily paused after errors" };
  }

  return coalescer.run(cacheKey, () => fetchGleif(uid, parsedRequested.compact, cacheKey, deps));
}

async function fetchGleif(
  uid: string,
  requestedCompact: string,
  cacheKey: string,
  deps: LiveDeps,
): Promise<Part<GleifRecord[]>> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL(GLEIF_LEI_API_URL);
  url.searchParams.set("filter[entity.registeredAs]", uid);

  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/vnd.api+json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    breaker.recordFailure();
    return { available: false, reason: "GLEIF request failed or timed out" };
  }
  if (res.status !== 200) {
    if (res.status === 429 || res.status >= 500) breaker.recordFailure(res.status === 429 ? retryAfterMs(res) : undefined, res.status === 429);
    // Le corps d'une réponse non-200 n'est jamais lu : l'annuler libère la connexion sans
    // attendre son téléchargement complet (relecture finale du 06.10.2026). Seule l'erreur
    // de CETTE annulation est réduite au silence, jamais une erreur de la requête elle-même.
    try {
      await res.body?.cancel();
    } catch {
      // volontairement muet : l'annulation du corps peut échouer sans conséquence.
    }
    return { available: false, reason: `GLEIF responded with HTTP ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      breaker.recordFailure();
      return { available: false, reason: "GLEIF request timed out while reading the response" };
    }
    return { available: false, reason: "GLEIF response is not valid JSON" };
  }
  breaker.recordSuccess();
  if (!isGleifResponse(body)) {
    return { available: false, reason: "unexpected GLEIF response shape" };
  }

  const retrieved_at = new Date(deps.now()).toISOString();
  const rawItems = body.data;
  if (rawItems.length === 0) {
    const result: Part<GleifRecord[]> = { available: true, retrieved_at, found: false, data: null };
    cache.set(cacheKey, result, NOT_FOUND_CACHE_TTL_MS); // "non trouvé" : 1h, pas 24h
    return cache.get(cacheKey)!; // toujours la valeur figée, y compris au tout premier appel
  }

  const wellFormed: GleifRecord[] = [];
  for (const raw of rawItems) {
    const item = extractItem(raw);
    if (item.kind === "fail") {
      // Un élément n'est pas exploitable (pas un objet, ou un champ obligatoire présent
      // mais invalide) : toute la réponse est rejetée, jamais mise en cache, jamais
      // filtrée en silence au milieu d'éléments par ailleurs valides.
      return { available: false, reason: "unexpected GLEIF response shape" };
    }
    if (item.kind === "record") wellFormed.push(item.record);
  }
  if (wellFormed.length === 0) {
    // Des éléments existent, mais aucun n'est exploitable (tous "skip") : réponse
    // malformée, jamais mise en cache (pour ne pas figer un faux "non trouvé" pendant 24 h).
    return { available: false, reason: "unexpected GLEIF response shape" };
  }

  const records = wellFormed.filter((r) => {
    if (!r.registered_as) return false;
    const parsedRegistered = parseUid(r.registered_as);
    return parsedRegistered.ok && parsedRegistered.compact === requestedCompact;
  });

  const result: Part<GleifRecord[]> = records.length === 0
    ? { available: true, retrieved_at, found: false, data: null }
    : { available: true, retrieved_at, found: true, data: records };
  // "non trouvé" (après filtrage sur l'IDE demandé) : 1h, pas 24h, même règle que ci-dessus.
  cache.set(cacheKey, result, records.length === 0 ? NOT_FOUND_CACHE_TTL_MS : undefined);
  return cache.get(cacheKey)!; // toujours la valeur figée, y compris au tout premier appel
}
