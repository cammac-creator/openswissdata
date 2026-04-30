/**
 * TARES (Swiss customs tariff) surface.
 *
 * Backed by 3 MCP tools:
 *   - tariff_lookup           → exact HS8 lookup with multilingual designations
 *   - tariff_semantic_search  → free-text → top-K HS codes (FR embeddings)
 *   - tariff_changelog        → historical MFN duty changes for an HS8
 *
 * All results carry a non-official disclaimer that callers MUST surface to
 * the end user.
 */

import type { Client } from "./client.js";
import type {
  TariffChangelogInput,
  TariffChangelogResult,
  TariffLookupInput,
  TariffLookupResult,
  TariffSemanticSearchInput,
  TariffSemanticSearchResult,
} from "./types.js";

export class TaresAPI {
  constructor(private readonly client: Client) {}

  /**
   * Lookup a Swiss customs tariff by 8-digit HS code.
   *
   * @example
   * ```ts
   * const row = await client.tares.lookup({ hs8: "84620010", lang: "fr" });
   * console.log(row.designation, row.duty_mfn.value);
   * console.log(row.disclaimer); // ALWAYS surface this
   * ```
   */
  public lookup(input: TariffLookupInput): Promise<TariffLookupResult> {
    return this.client.callTool<TariffLookupResult>("tariff_lookup", input);
  }

  /**
   * Free-text semantic search over the TARES descriptions.
   *
   * @example
   * ```ts
   * const hits = await client.tares.search({ query: "couteau de cuisine", top_k: 5 });
   * for (const h of hits.hits) console.log(h.score, h.hs_code, h.description);
   * ```
   */
  public search(input: TariffSemanticSearchInput): Promise<TariffSemanticSearchResult> {
    return this.client.callTool<TariffSemanticSearchResult>("tariff_semantic_search", input);
  }

  /**
   * Historical changes for a tariff position (rolling 12-24 months).
   *
   * @example
   * ```ts
   * const log = await client.tares.changelog({ hs8: "84620010", since: "2025-01-01" });
   * for (const c of log.changes) console.log(c.field, c.old_value, "→", c.new_value);
   * ```
   */
  public changelog(input: TariffChangelogInput): Promise<TariffChangelogResult> {
    return this.client.callTool<TariffChangelogResult>("tariff_changelog", input);
  }
}
