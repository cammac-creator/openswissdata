/**
 * FINMA ↔ Zefix bulk enrichment via LINDAS SPARQL.
 *
 * For each FINMA UID (CHE-xxx.xxx.xxx), fetch the Zefix record from the
 * public LINDAS SPARQL endpoint (`https://register.ld.admin.ch/query`,
 * graph `<https://lindas.admin.ch/foj/zefix>`).
 *
 * What LINDAS exposes today (verified empirically on 2026-04-29):
 *   - schema:legalName       → canonical legal name
 *   - schema:description     → corporate purpose / objet social
 *   - schema:additionalType  → eCH-0097 legal-form URI (e.g. .../0106 = AG/SA)
 *   - schema:address         → structured sub-node (street, postcode, …)
 *
 * What LINDAS does NOT expose (would require Zefix REST API w/ key):
 *   - capital, capital_currency
 *   - status RC (active / inactive / liquidation)
 *   - organes (board / signatures)
 *   - mutations / journal SOGC
 *   - last_update timestamp
 *
 * Therefore in v1 we populate `legal_form`, `legal_form_code`, `purpose`
 * and leave the others `undefined`. Forward-compatible interface.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ZefixOrgane {
  role: string;
  name: string;
  signature_type?: string;
}

export interface ZefixData {
  uid: string;
  status: "active" | "inactive" | "liquidation" | "unknown";
  capital?: number;
  capital_currency?: string;
  legal_form?: string;       // human-readable, e.g. "AG/SA", "GmbH/Sàrl"
  legal_form_code?: string;  // raw eCH-0097 code, e.g. "0106"
  organes?: ZefixOrgane[];
  purpose?: string;          // corporate purpose (objet social)
  last_update?: string;      // ISO date
  /** Zefix internal company id (e.g. "166129") — useful for cross-reference. */
  zefix_id?: string;
}

// ---------------------------------------------------------------------------
// eCH-0097 legal-form code → human-readable label
// Source: https://www.ech.ch/de/ech/ech-0097/4.0
// ---------------------------------------------------------------------------

const ECH_0097_LABELS: Record<string, string> = {
  "0101": "Einzelunternehmen / Entreprise individuelle",
  "0102": "Kollektivgesellschaft / Société en nom collectif",
  "0103": "Kommanditgesellschaft / Société en commandite",
  "0104": "Kommanditaktiengesellschaft / Société en commandite par actions",
  "0105": "Aktiengesellschaft / Société anonyme (AG/SA)",
  "0106": "Aktiengesellschaft / Société anonyme (AG/SA)",
  "0107": "GmbH / Société à responsabilité limitée (Sàrl)",
  "0108": "Genossenschaft / Société coopérative",
  "0109": "Verein / Association",
  "0110": "Stiftung / Fondation",
  "0111": "Investmentgesellschaft mit variablem Kapital (SICAV)",
  "0112": "Investmentgesellschaft mit festem Kapital (SICAF)",
  "0113": "Kommanditgesellschaft für kollektive Kapitalanlagen (KGK)",
  "0114": "Öffentlich-rechtliche Körperschaft / Corporation de droit public",
  "0115": "Particulier / Privatperson",
  "0116": "Filiale (Schweiz) / Succursale en Suisse",
  "0117": "Filiale (Ausland) / Succursale étrangère",
  "0118": "Sonstige Rechtsform / Autre forme juridique",
};

function legalFormLabel(uri: string | undefined): { code?: string; label?: string } {
  if (!uri) return {};
  const m = uri.match(/\/legalforms\/(\d{4})$/);
  if (!m) return {};
  const code = m[1];
  return { code, label: ECH_0097_LABELS[code] ?? `eCH-0097/${code}` };
}

// ---------------------------------------------------------------------------
// SPARQL endpoint
// ---------------------------------------------------------------------------

export const LINDAS_SPARQL_ENDPOINT = "https://register.ld.admin.ch/query";
export const LINDAS_ZEFIX_GRAPH = "https://lindas.admin.ch/foj/zefix";

interface SparqlBinding {
  type: "uri" | "literal";
  value: string;
  "xml:lang"?: string;
  datatype?: string;
}

interface SparqlResponse {
  head: { vars: string[] };
  results: { bindings: Record<string, SparqlBinding>[] };
}

interface BulkBatchOptions {
  batchSize?: number;       // default 500
  timeoutMs?: number;       // default 60_000 per batch
  maxRetries?: number;      // default 2
  onProgress?: (done: number, total: number, batchTimeMs: number) => void;
}

/**
 * Normalize a UID (CHE-103.137.179, CHE-103137179, 103137179, …) to the
 * canonical no-separator form used in the Zefix LINDAS UID identifier
 * sub-node (schema:value), e.g. "CHE103137179".
 */
function uidToZefixFormat(uid: string): string | null {
  const digits = uid.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return null;
  return `CHE${digits}`;
}

function buildBatchQuery(zefixUids: string[]): string {
  const valuesClause = zefixUids.map((u) => `"${u}"`).join(" ");
  return `PREFIX schema: <http://schema.org/>
SELECT ?uidValue ?company ?legalName ?legalForm ?desc WHERE {
  GRAPH <${LINDAS_ZEFIX_GRAPH}> {
    VALUES ?uidValue { ${valuesClause} }
    ?uidNode schema:name "CompanyUID" ;
             schema:value ?uidValue .
    ?company schema:identifier ?uidNode ;
             schema:legalName ?legalName .
    OPTIONAL { ?company schema:additionalType ?legalForm }
    OPTIONAL { ?company schema:description ?desc }
  }
}`;
}

async function postSparql(query: string, timeoutMs: number): Promise<SparqlResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LINDAS_SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json",
        "user-agent": "openswissdata.com FINMA enrichment (LINDAS Zefix)",
      },
      body: query,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`LINDAS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as SparqlResponse;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachePayload {
  cache_version: 1;
  fetched_at: string;
  uid_set_hash: string;
  endpoint: string;
  graph: string;
  data: Record<string, ZefixData>;
}

function uidSetHash(uids: string[]): string {
  const sorted = [...uids].sort().join(",");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

function loadCache(path: string, expectedHash: string): Map<string, ZefixData> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CachePayload;
    if (raw.cache_version !== 1) return null;
    if (raw.uid_set_hash !== expectedHash) return null;
    return new Map(Object.entries(raw.data));
  } catch {
    return null;
  }
}

function saveCache(path: string, hash: string, data: Map<string, ZefixData>): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload: CachePayload = {
    cache_version: 1,
    fetched_at: new Date().toISOString(),
    uid_set_hash: hash,
    endpoint: LINDAS_SPARQL_ENDPOINT,
    graph: LINDAS_ZEFIX_GRAPH,
    data: Object.fromEntries(data),
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FetchZefixResult {
  data: Map<string, ZefixData>;
  /** UIDs we couldn't normalize (not 9-digit CHE format). */
  invalidUids: string[];
  /** UIDs not found in LINDAS Zefix graph. */
  missingUids: string[];
  /** Number of LINDAS round-trips. */
  batches: number;
  /** Total wall-clock time for SPARQL calls (ms). */
  totalMs: number;
}

/**
 * Fetch Zefix records (LINDAS subset) for a list of FINMA UIDs.
 *
 * Returns a Map keyed by the canonical FINMA UID format (CHE-xxx.xxx.xxx)
 * — same shape used in `FinmaEntity.uid`.
 *
 * Caches results to `cachePath` (JSON). Invalidates on UID-set change.
 */
export async function fetchZefixForUids(
  uids: string[],
  opts: BulkBatchOptions & { cachePath?: string } = {},
): Promise<FetchZefixResult> {
  const batchSize = opts.batchSize ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;

  // Normalize: keep a mapping FINMA-canonical → Zefix-flat.
  const finmaToZefix = new Map<string, string>();
  const invalidUids: string[] = [];
  for (const uid of uids) {
    const z = uidToZefixFormat(uid);
    if (!z) {
      invalidUids.push(uid);
      continue;
    }
    const canonical = `CHE-${z.slice(3, 6)}.${z.slice(6, 9)}.${z.slice(9, 12)}`;
    finmaToZefix.set(canonical, z);
  }

  const zefixToFinma = new Map<string, string>();
  for (const [f, z] of finmaToZefix.entries()) zefixToFinma.set(z, f);

  const allZefix = [...finmaToZefix.values()];
  const hash = uidSetHash(allZefix);

  // Try cache.
  if (opts.cachePath) {
    const cached = loadCache(opts.cachePath, hash);
    if (cached) {
      const missingUids = [...finmaToZefix.keys()].filter((f) => !cached.has(f));
      return {
        data: cached,
        invalidUids,
        missingUids,
        batches: 0,
        totalMs: 0,
      };
    }
  }

  const result = new Map<string, ZefixData>();
  const t0 = Date.now();
  let batches = 0;

  for (let i = 0; i < allZefix.length; i += batchSize) {
    const batch = allZefix.slice(i, i + batchSize);
    const query = buildBatchQuery(batch);
    let lastErr: unknown;
    let resp: SparqlResponse | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const tBatch = Date.now();
      try {
        resp = await postSparql(query, timeoutMs);
        const dt = Date.now() - tBatch;
        opts.onProgress?.(Math.min(i + batchSize, allZefix.length), allZefix.length, dt);
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === maxRetries) {
          // Don't crash the entire pipeline — log and continue with empty batch.
          console.error(
            `[ingest-zefix] batch ${i}-${i + batch.length} failed after ${maxRetries + 1} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        } else {
          // brief backoff
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    batches++;
    if (!resp) continue;

    for (const b of resp.results.bindings) {
      const zUid = b.uidValue?.value;
      if (!zUid) continue;
      const finmaUid = zefixToFinma.get(zUid);
      if (!finmaUid) continue;

      const companyUri = b.company?.value ?? "";
      const zefixIdMatch = companyUri.match(/\/zefix\/company\/(\d+)$/);

      const lf = legalFormLabel(b.legalForm?.value);

      // We may see the same UID twice if the entity has multiple legalNames
      // (multilingual). Keep first occurrence; merge nothing else.
      if (!result.has(finmaUid)) {
        result.set(finmaUid, {
          uid: finmaUid,
          status: "unknown", // LINDAS does not expose RC status
          legal_form: lf.label,
          legal_form_code: lf.code,
          purpose: b.desc?.value,
          zefix_id: zefixIdMatch?.[1],
        });
      }
    }
  }

  const totalMs = Date.now() - t0;
  if (opts.cachePath) {
    saveCache(opts.cachePath, hash, result);
  }

  const missingUids = [...finmaToZefix.keys()].filter((f) => !result.has(f));
  return { data: result, invalidUids, missingUids, batches, totalMs };
}

// ---------------------------------------------------------------------------
// CLI for ad-hoc testing
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = process.argv.slice(2);
  if (sample.length === 0) {
    console.error("Usage: tsx etl/finma/ingest-zefix.ts CHE-xxx.xxx.xxx [...]");
    process.exit(1);
  }
  fetchZefixForUids(sample).then((r) => {
    console.log(JSON.stringify(
      { count: r.data.size, batches: r.batches, totalMs: r.totalMs, sample: [...r.data.values()].slice(0, 3) },
      null,
      2,
    ));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
