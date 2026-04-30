/**
 * FINMA registry surface.
 *
 * Backed by 3 MCP tools:
 *   - kyc_check       → substring search over the unified registry
 *   - finma_search    → fuzzy / typo-tolerant search (Levenshtein)
 *   - entity_history  → timeline of changes for a UID
 */

import type { Client } from "./client.js";
import type {
  EntityHistoryInput,
  EntityHistoryResult,
  FinmaSearchInput,
  FinmaSearchResult,
  KycCheckInput,
  KycCheckResult,
} from "./types.js";

export class FinmaAPI {
  constructor(private readonly client: Client) {}

  /**
   * Substring KYC check against the FINMA registry + warnings list.
   *
   * For typo-tolerant matching prefer `finma.search()` instead.
   *
   * @example
   * ```ts
   * const r = await client.finma.kycCheck({ name: "UBS", top_k: 10 });
   * for (const m of r.matches) console.log(m.name, m.licence_type);
   * ```
   */
  public kycCheck(input: KycCheckInput): Promise<KycCheckResult> {
    return this.client.callTool<KycCheckResult>("kyc_check", input);
  }

  /**
   * Fuzzy / typo-tolerant search over the FINMA registry.
   *
   * @example
   * ```ts
   * const r = await client.finma.search({ name: "Cred Suisse", include_warnings: true });
   * for (const h of r.hits) console.log(h.score.toFixed(2), h.name);
   * ```
   */
  public search(input: FinmaSearchInput): Promise<FinmaSearchResult> {
    return this.client.callTool<FinmaSearchResult>("finma_search", input);
  }

  /**
   * Timeline of changes for a FINMA-supervised entity (by Swiss UID).
   *
   * @example
   * ```ts
   * const r = await client.finma.entityHistory({ uid: "CHE-103.137.179" });
   * console.log(r.current.name, "—", r.events.length, "events");
   * ```
   */
  public entityHistory(input: EntityHistoryInput): Promise<EntityHistoryResult> {
    return this.client.callTool<EntityHistoryResult>("entity_history", input);
  }
}
