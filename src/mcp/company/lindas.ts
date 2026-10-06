/**
 * Lecture en direct du registre du commerce en données liées (LINDAS, graphe Zefix de l'OFRC),
 * pour la fiche de vérification d'une société suisse (tâche osd.fiche, tâche 3).
 *
 * Un POST SPARQL vers `LINDAS_ENDPOINT`, dans le graphe nommé par `LINDAS_ZEFIX_GRAPH`
 * (copie littérale de `getSource("ofrc.zefix_lindas").url` et de `LINDAS_ZEFIX_GRAPH` dans
 * `etl/finma/ingest-zefix.ts` — égalité vérifiée par
 * `tests/mcp/company-sources-provenance.test.ts`, détail plus bas). Prédicats relevés en
 * direct le 06.10.2026 pour AXA Leben AG
 * (société `https://register.ld.admin.ch/zefix/company/431354`) : `schema:legalName`,
 * plusieurs `schema:name` (autres raisons sociales, une par langue), `schema:description`
 * (but), `schema:identifier` → nœuds `CompanyUID` et `CompanyCHID`, `schema:additionalType`
 * (forme juridique eCH-0097, avec son propre `schema:identifier` et ses `schema:name`
 * fr/de), `https://schema.ld.admin.ch/municipality` (nom, identifiant OFS),
 * `schema:address` → nœud `PostalAddress` (rue, NPA, localité, `schema:addressRegion` = canton).
 * Les libellés de forme juridique et de commune sont HORS du graphe Zefix (graphe par
 * défaut) : vérifié par un essai réel le 06.10.2026, d'où le second bloc de la requête,
 * sans `GRAPH`.
 *
 * L'IDE n'entre dans la requête que sous la forme compacte déjà validée par `parseUid`
 * (`CHE` + 9 chiffres) : `lookupLindas` refuse toute autre forme avant tout appel réseau.
 *
 * `LINDAS_ENDPOINT` et `LINDAS_ZEFIX_GRAPH` ci-dessous DOIVENT rester identiques à
 * `getSource("ofrc.zefix_lindas").url` et à `LINDAS_ZEFIX_GRAPH` de `etl/finma/ingest-zefix.ts`.
 * `src/` ne peut pas importer `etl/` : `tsconfig.json` fixe `rootDir: "./src"` et exclut
 * `etl`, et `etl/` n'est de toute façon jamais compilé dans `dist/` (build qui l'exclut
 * aussi) — un `import` depuis `etl/` romprait `npm run typecheck` (TS6059) et n'existerait
 * plus du tout en production. `tests/mcp/company-sources-provenance.test.ts` importe les
 * deux côtés (les tests ne sont pas soumis à cette frontière) et refuse tout écart.
 */

import { TtlCache } from "./cache.js";
import type { LindasCompany, LiveDeps, Part } from "./types.js";

export const LINDAS_ENDPOINT = "https://register.ld.admin.ch/query";
export const LINDAS_ZEFIX_GRAPH = "https://lindas.admin.ch/foj/zefix";

const COMPACT_UID_RE = /^CHE\d{9}$/;
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function toCanonical(compactUid: string): string {
  const digits = compactUid.slice(3);
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

function buildQuery(compactUid: string): string {
  return `PREFIX schema: <http://schema.org/>
PREFIX admin: <https://schema.ld.admin.ch/>
SELECT ?company ?legalName ?name ?legalForm ?legalFormCode ?legalFormLabelFr ?legalFormLabelDe
       ?desc ?chid ?municipality ?municipalityName ?municipalityId
       ?address ?street ?postalCode ?locality ?region
WHERE {
  GRAPH <${LINDAS_ZEFIX_GRAPH}> {
    ?uidNode schema:name "CompanyUID" ;
             schema:value "${compactUid}" .
    ?company schema:identifier ?uidNode .
    OPTIONAL { ?company schema:legalName ?legalName }
    OPTIONAL { ?company schema:name ?name }
    OPTIONAL { ?company schema:additionalType ?legalForm }
    OPTIONAL { ?company schema:description ?desc }
    OPTIONAL {
      ?company schema:identifier ?chidNode .
      ?chidNode schema:name "CompanyCHID" ; schema:value ?chid .
    }
    OPTIONAL { ?company admin:municipality ?municipality }
    OPTIONAL { ?company schema:address ?address }
  }
  OPTIONAL { ?legalForm schema:identifier ?legalFormCode }
  OPTIONAL { ?legalForm schema:name ?legalFormLabelFr . FILTER(lang(?legalFormLabelFr) = "fr") }
  OPTIONAL { ?legalForm schema:name ?legalFormLabelDe . FILTER(lang(?legalFormLabelDe) = "de") }
  OPTIONAL { ?municipality schema:name ?municipalityName }
  OPTIONAL { ?municipality schema:identifier ?municipalityId }
  OPTIONAL { ?address schema:streetAddress ?street }
  OPTIONAL { ?address schema:postalCode ?postalCode }
  OPTIONAL { ?address schema:addressLocality ?locality }
  OPTIONAL { ?address schema:addressRegion ?region }
}`;
}

// Envelope SPARQL JSON : seule la forme de haut niveau (tableau de lignes) est vérifiée
// ici. Chaque ligne peut être n'importe quoi (null, une chaîne, un objet incomplet ou aux
// mauvais types) : `requiredField`/`optionalField` ci-dessous lisent chaque champ de façon
// défensive, jamais un cast de confiance sur une interface TypeScript qui ne protège rien
// à l'exécution.
interface SparqlResponse {
  results: { bindings: unknown[] };
}

function isSparqlResponse(body: unknown): body is SparqlResponse {
  if (typeof body !== "object" || body === null) return false;
  const results = (body as { results?: unknown }).results;
  if (typeof results !== "object" || results === null) return false;
  return Array.isArray((results as { bindings?: unknown }).bindings);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Lit un champ FACULTATIF d'une ligne SPARQL déjà vérifiée comme objet : rend la chaîne
 * `value` si le champ est un objet non nul dont `value` est une chaîne, sinon `undefined`
 * (champ absent ou de mauvais type, les deux sont ignorés sans conséquence pour un champ
 * facultatif). Jamais d'exception.
 */
function optionalField(row: Record<string, unknown>, field: string): string | undefined {
  const binding = row[field];
  if (!isPlainObject(binding)) return undefined;
  const value = binding.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Lit un champ OBLIGATOIRE (`company`, `legalName`) d'une ligne SPARQL déjà vérifiée comme
 * objet, en distinguant trois états :
 *  - "absent" : le champ n'existe pas sur cette ligne (OPTIONAL non satisfait) — toléré,
 *    cette ligne est simplement écartée pour ce champ, le reste de la réponse n'est pas en cause ;
 *  - "invalid" : le champ EXISTE mais n'est pas un objet `{ value: "…non vide…" }` (type
 *    numérique, chaîne vide, etc.) — une vraie réponse malformée, jamais acceptée telle
 *    quelle ni traitée comme une absence ;
 *  - la chaîne elle-même, si elle est valide et non vide.
 */
function requiredField(row: Record<string, unknown>, field: string): "absent" | "invalid" | string {
  if (!(field in row) || row[field] === undefined) return "absent";
  const binding = row[field];
  if (!isPlainObject(binding)) return "invalid";
  const value = binding.value;
  if (typeof value !== "string" || value === "") return "invalid";
  return value;
}

/** Fusionne les lignes d'une même société (une ligne par combinaison d'OPTIONAL) en un seul objet.
 *  Rend `null` si aucune des lignes n'a un `legalName` valide : ce champ est obligatoire dans
 *  `LindasCompany`, son absence totale indique une réponse malformée, pas une société sans nom.
 *  Suppose que `requiredField(r, "legalName")` n'a jamais rendu "invalid" sur `rows` (vérifié
 *  par l'appelant avant le regroupement, sur TOUTES les lignes de la réponse). */
function mergeRows(companyUri: string, rows: Record<string, unknown>[]): LindasCompany | null {
  const legalName = rows.map((r) => optionalField(r, "legalName")).find((v): v is string => v !== undefined);
  if (legalName === undefined) return null;
  const otherNames = [...new Set(
    rows.map((r) => optionalField(r, "name")).filter((n): n is string => n !== undefined && n !== legalName),
  )].sort();
  const first = (field: string): string | null =>
    rows.map((r) => optionalField(r, field)).find((v): v is string => v !== undefined) ?? null;
  return {
    legal_name: legalName,
    other_names: otherNames,
    legal_form_code: first("legalFormCode"),
    legal_form_label_fr: first("legalFormLabelFr"),
    legal_form_label_de: first("legalFormLabelDe"),
    municipality: first("municipalityName"),
    municipality_bfs_id: first("municipalityId"),
    canton: first("region"),
    street_address: first("street"),
    postal_code: first("postalCode"),
    locality: first("locality"),
    purpose: first("desc"),
    ch_id: first("chid"),
    register_uri: companyUri,
  };
}

// Singleton de production ; `resetLindasCache` permet aux tests d'utiliser un cache neuf
// avec leur propre horloge, sans toucher à l'horloge réelle.
let cache = new TtlCache<Part<LindasCompany>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now: () => Date.now() });
export function resetLindasCache(now: () => number = () => Date.now()): void {
  cache = new TtlCache<Part<LindasCompany>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now });
}

export async function lookupLindas(compactUid: string, deps: LiveDeps): Promise<Part<LindasCompany>> {
  if (!COMPACT_UID_RE.test(compactUid)) {
    return { available: false, reason: "uid must be the compact form CHE + 9 digits (from parseUid)" };
  }
  const cacheKey = toCanonical(compactUid);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await deps.fetch(LINDAS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json",
      },
      body: buildQuery(compactUid),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { available: false, reason: "LINDAS request failed or timed out" };
  }
  if (res.status !== 200) {
    return { available: false, reason: `LINDAS responded with HTTP ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { available: false, reason: "LINDAS request timed out while reading the response" };
    }
    return { available: false, reason: "LINDAS response is not valid JSON" };
  }
  if (!isSparqlResponse(body)) {
    return { available: false, reason: "unexpected LINDAS response shape" };
  }

  const retrieved_at = new Date(deps.now()).toISOString();
  const rawRows = body.results.bindings;
  if (rawRows.length === 0) {
    const result: Part<LindasCompany> = { available: true, retrieved_at, found: false, data: null };
    cache.set(cacheKey, result);
    return cache.get(cacheKey)!; // toujours la valeur figée, y compris au tout premier appel
  }

  // 1. Toute ligne qui n'est pas elle-même un objet non nul (null, chaîne, nombre) rend
  //    TOUTE la réponse inexploitable : on ne peut pas savoir ce qu'elle représente, et on
  //    ne l'écarte jamais silencieusement au milieu de lignes par ailleurs valides.
  const rows: Record<string, unknown>[] = [];
  for (const row of rawRows) {
    if (!isPlainObject(row)) {
      return { available: false, reason: "unexpected LINDAS response shape" };
    }
    rows.push(row);
  }

  // 2. `company` : absent sur une ligne → cette ligne est simplement écartée du regroupement
  //    (OPTIONAL non satisfait, cas normal). Présent mais invalide (mauvais type, chaîne
  //    vide) → toute la réponse est rejetée : jamais groupé sous "" (ce qui la ferait passer
  //    en tête du tri), jamais une valeur numérique acceptée comme URI.
  const withUri: Array<{ uri: string; row: Record<string, unknown> }> = [];
  for (const row of rows) {
    const company = requiredField(row, "company");
    if (company === "invalid") return { available: false, reason: "unexpected LINDAS response shape" };
    if (company !== "absent") withUri.push({ uri: company, row });
  }
  if (withUri.length === 0) {
    // Des lignes existent, mais aucune n'a d'URI exploitable : réponse malformée, jamais
    // mise en cache (pour ne pas figer un faux "non trouvé" pendant 24 h).
    return { available: false, reason: "unexpected LINDAS response shape" };
  }

  // 3. `legalName` : même règle que `company`, vérifiée sur TOUTES les lignes (pas
  //    seulement celles du groupe finalement retenu) — un `legalName` numérique ou vide
  //    n'est jamais toléré ailleurs dans la réponse.
  for (const row of rows) {
    if (requiredField(row, "legalName") === "invalid") {
      return { available: false, reason: "unexpected LINDAS response shape" };
    }
  }

  // Plusieurs sociétés distinctes partageant le même IDE (cas non observé, mais prévu par
  // la tâche) : on prend la première par URI triée, sans lever d'erreur.
  const byCompany = new Map<string, Record<string, unknown>[]>();
  for (const { uri, row } of withUri) {
    byCompany.set(uri, [...(byCompany.get(uri) ?? []), row]);
  }
  const [firstUri, firstRows] = [...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b))[0];

  const data = mergeRows(firstUri, firstRows);
  if (data === null) {
    // Le groupe retenu n'a pas un seul `legalName` présent (toutes ses lignes l'ont
    // "absent", déjà écarté "invalid" à l'étape 3) : champ obligatoire manquant, réponse
    // malformée, jamais mise en cache.
    return { available: false, reason: "unexpected LINDAS response shape" };
  }

  const result: Part<LindasCompany> = { available: true, retrieved_at, found: true, data };
  cache.set(cacheKey, result);
  return cache.get(cacheKey)!; // toujours la valeur figée, y compris au tout premier appel
}
