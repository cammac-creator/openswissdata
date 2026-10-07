/**
 * API publique en lecture `/api/v1` (tâche osd.donnees, tâche B3 du plan
 * `2026-10-06-prospection-et-api.md`), étendue par la tâche B5 (`/cantons`, `/cantons/:abbr`).
 *
 * Lecture seule, JSON, limitée par réseau (jamais par jeton : ces routes n'authentifient
 * personne). Chaque réponse porte ses sources ; aucune route n'écrit, aucune ne renvoie un corps
 * brut d'une source (voir Global Constraints et Review Focus du plan). Montée dans `createApp()`
 * (`src/index.ts`) comme les autres routes publiques, AVANT le catch-all statique.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { abuseIp, trustedRequestIp } from "../lib/request-ip.js";
import { checkApiRateLimit, type ApiRateLimitResult } from "../lib/api-rate-limit.js";
import { getBfePv, getDataset, getDatasetsIndex, getLocalities, getStreets, getFinmaVersion } from "../mcp/data-loader.js";
import { communeProfile } from "../lib/commune-profile.js";
import { cantonProfile, SWISS_CANTON_ABBREVIATIONS } from "../lib/canton-profile.js";
import { companyCheck } from "../mcp/company/check.js";
import { COMPANY_SOURCES } from "../mcp/company/sources.js";
import { getPublicSource, PUBLIC_SOURCES, type PublicSourceEntry } from "../lib/public-sources.js";
import { datasetCatalogueEntry, filterDatasetRows, licenceRequiresAttribution, paginateDatasetRows, parseDatasetFilters, parseDatasetPagination } from "../lib/dataset-query.js";

// Les cinq sources que `company_check` peut citer (`src/mcp/company/sources.ts`), dans l'ordre
// stable de déclaration de `COMPANY_SOURCES` — toujours les mêmes, que la fiche les ait ou non
// effectivement utilisées pour cet IDE précis (même esprit que `/api/v1/sources` : un registre,
// pas un relevé d'usage par appel).
const COMPANY_SOURCE_IDS = Object.keys(COMPANY_SOURCES);

export const apiV1Route = new Hono();

const HOUR_MS = 60 * 60 * 1000;
// Plafonds de la décision de Claude-Alain du 06.10.2026 (plan, Task B3) : la fiche société
// (`company_check`, qui relaie LINDAS/GLEIF) reste stricte ; les trois autres routes, qui ne
// lisent que des fichiers embarqués, partagent un plafond commun plus large.
const COMPANY_LIMIT = { name: "api-v1-company", max: 60, windowMs: HOUR_MS };
const DATA_LIMIT = { name: "api-v1-data", max: 600, windowMs: HOUR_MS };

function clientKey(c: Context): string {
  return abuseIp(trustedRequestIp(c) ?? "unknown");
}

function rateLimit(c: Context, cfg: { name: string; max: number; windowMs: number }): ApiRateLimitResult {
  return checkApiRateLimit(cfg.name, clientKey(c), cfg.max, cfg.windowMs, () => Date.now());
}

function applyRateLimitHeaders(c: Context, result: ApiRateLimitResult): void {
  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
}

/** `true` (et la réponse 429 déjà envoyée) quand la requête dépasse son quota réseau. */
function enforceRateLimit(c: Context, cfg: { name: string; max: number; windowMs: number }): Response | null {
  const result = rateLimit(c, cfg);
  applyRateLimitHeaders(c, result);
  if (result.allowed) return null;
  c.header("Retry-After", String(result.retryAfterSeconds));
  return c.json({ error: "rate_limited" }, 429);
}

/** Objet source public (id, éditeur, licence, URL) tel qu'exposé par l'API — jamais la référence
 *  de permission TARES en clair (voir `src/lib/public-sources.ts`). Un id inconnu du registre
 *  (ne devrait jamais arriver : les appelants internes ne passent que des ids réels) rend un
 *  objet minimal plutôt qu'un corps brut ou une exception. */
function sourceRef(id: string): PublicSourceEntry {
  return getPublicSource(id) ?? { id, institution: "unknown", url: "", licence: "unknown", description: "" };
}

// --- GET /api/v1/company/:uid -------------------------------------------------------------
// La fiche de `company_check` du serveur MCP (`structuredContent`), inchangée : commerce
// (LINDAS), FINMA, LEI (GLEIF), chaque fait déjà sourcé et daté (`source_id`/`source_url`/
// `retrieved_at`). Un seul champ ajouté à côté, `sources` (id, éditeur, licence, URL), comme les
// trois autres routes — jamais à l'intérieur de la fiche elle-même.
apiV1Route.get("/company/:uid", async (c) => {
  const limited = enforceRateLimit(c, COMPANY_LIMIT);
  if (limited) return limited;
  c.header("Cache-Control", "no-store");
  const uid = c.req.param("uid");
  const result = await companyCheck(uid, { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), now: () => Date.now() });
  if (!result.ok) return c.json({ error: "invalid_uid" }, 400);
  return c.json({ ...result.fiche, sources: COMPANY_SOURCE_IDS.map(sourceRef) });
});

// --- GET /api/v1/localities -------------------------------------------------------------
// Exactement un des deux paramètres de recherche ; lignes du répertoire officiel, telles quelles.
apiV1Route.get("/localities", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const postalCode = c.req.query("postal_code");
  const bfsId = c.req.query("municipality_bfs_id");
  const exactlyOne = (postalCode ? 1 : 0) + (bfsId ? 1 : 0);
  if (exactlyOne !== 1) return c.json({ error: "invalid_query" }, 400);
  const loaded = getLocalities();
  if (!loaded) return c.json({ error: "localities_unavailable" }, 503);
  const rows = postalCode ? (loaded.byPostalCode.get(postalCode) ?? []) : loaded.rows.filter((r) => r.municipality_bfs_id === bfsId);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ rows, edition: loaded.edition, sources: [sourceRef("swisstopo.localities")] });
});

// --- GET /api/v1/communes/:bfs_id -------------------------------------------------------------
apiV1Route.get("/communes/:bfs_id", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const bfsId = c.req.param("bfs_id");
  if (!/^\d+$/.test(bfsId)) return c.json({ error: "invalid_bfs_id" }, 400);
  const localitiesLoaded = getLocalities();
  const streetsLoaded = getStreets();
  // 404 seulement quand AU MOINS un répertoire est chargé et ne connaît pas cette commune :
  // jamais quand les deux répertoires sont indisponibles (répondre 200 avec des champs `null`,
  // comme le reste du service — voir `company_check`, qui ne fait jamais échouer la fiche pour
  // un répertoire absent).
  const knownInLocalities = localitiesLoaded ? localitiesLoaded.rows.some((r) => r.municipality_bfs_id === bfsId) : null;
  const knownInStreets = streetsLoaded ? streetsLoaded.byMunicipality.has(bfsId) : null;
  const found = knownInLocalities === true || knownInStreets === true;
  const anyDirectoryChecked = knownInLocalities !== null || knownInStreets !== null;
  if (!found && anyDirectoryChecked) return c.json({ error: "commune_not_found" }, 404);
  const profile = communeProfile(bfsId);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ ...profile, sources: profile.sources.map(sourceRef) });
});

// --- GET /api/v1/cantons et /api/v1/cantons/:abbr ---------------------------------------
// Tâche osd.donnees, tâche B5. Même plafond réseau que les autres routes de données
// (`DATA_LIMIT`, partagé avec /localities, /communes et /sources).
const CANTON_ABBREVIATIONS = new Set(SWISS_CANTON_ABBREVIATIONS);

apiV1Route.get("/cantons", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  c.header("Cache-Control", "public, max-age=3600");
  // Liste fixe (26 abréviations cantonales), sans donnée sourcée : `sources` reste présent,
  // vide, pour garder la même forme que les autres routes de données (Global Constraint « réponses
  // avec sources ») sans inventer une provenance à une simple énumération.
  return c.json({ cantons: SWISS_CANTON_ABBREVIATIONS, sources: [] });
});

apiV1Route.get("/cantons/:abbr", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const abbr = (c.req.param("abbr") ?? "").toUpperCase();
  if (!CANTON_ABBREVIATIONS.has(abbr)) return c.json({ error: "invalid_canton" }, 400);
  const profile = cantonProfile(abbr);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ ...profile, sources: profile.sources.map(sourceRef) });
});

// --- GET /api/v1/datasets et /api/v1/datasets/:id -----------------------------------------
// Moteur générique de jeux ouverts (tâche osd.jeux, piste G2 du plan
// `2026-10-07-moteur-jeux-ouverts.md`) : catalogue des jeux APPROUVÉS
// (`docs/data-status/datasets-approved.json`, collectés par `scripts/sync-datasets.ts`) et
// lecture filtrée d'un jeu. Même plafond réseau que les autres routes de données (`DATA_LIMIT`).
apiV1Route.get("/datasets", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const index = getDatasetsIndex();
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ datasets: (index?.datasets ?? []).map(datasetCatalogueEntry) });
});

apiV1Route.get("/datasets/:id", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const id = c.req.param("id");
  const loaded = getDataset(id);
  if (!loaded) return c.json({ error: "dataset_not_found" }, 404);

  const query = c.req.query();
  const filterResult = parseDatasetFilters(query, loaded.entry.keys);
  if (!filterResult.ok) return c.json({ error: filterResult.error }, 400);
  const paginationResult = parseDatasetPagination(query);
  if (!paginationResult.ok) return c.json({ error: paginationResult.error }, 400);

  const filtered = filterDatasetRows(loaded.rows, filterResult.filters);
  const { rows, total } = paginateDatasetRows(filtered, paginationResult.limit, paginationResult.offset);
  const { entry } = loaded;
  const hasAttribution = licenceRequiresAttribution(entry.licence) && entry.attribution.trim().length > 0;

  c.header("Cache-Control", "public, max-age=3600");
  return c.json({
    id: entry.id,
    title: entry.title,
    publisher: entry.publisher,
    licence: entry.licence,
    attribution: hasAttribution ? entry.attribution : null,
    source: entry.resource_url,
    edition: entry.edition,
    columns: entry.columns,
    total,
    limit: paginationResult.limit,
    offset: paginationResult.offset,
    data: rows,
  });
});

// --- GET /api/v1/sources -------------------------------------------------------------
// Registre public des sources servies par l'API et le MCP (sans la référence de permission
// TARES, qui porte le nom d'une personne : voir `src/lib/public-sources.ts`).
apiV1Route.get("/sources", (c) => {
  const limited = enforceRateLimit(c, DATA_LIMIT);
  if (limited) return limited;
  const localitiesLoaded = getLocalities();
  const streetsLoaded = getStreets();
  const finmaVersion = getFinmaVersion();
  const bfePvLoaded = getBfePv();
  const sources = PUBLIC_SOURCES.map((s) => ({
    ...s,
    edition:
      s.id === "swisstopo.localities" ? (localitiesLoaded?.edition ?? null)
      : s.id === "swisstopo.streets" ? (streetsLoaded?.edition ?? null)
      : s.id === "finma.uid_csv" ? finmaVersion
      : s.id === "bfe.pv_one_time_remuneration" ? (bfePvLoaded?.edition ?? null)
      : null,
  }));
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ sources });
});
